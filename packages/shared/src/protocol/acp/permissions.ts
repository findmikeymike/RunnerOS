/**
 * ACP permission negotiation.
 *
 * Ported from Hermes hermes_acp/permissions.py + hermes_acp/edit_approval.py (MIT).
 *   - permissions.py:107-168  → makeApprovalCallback
 *   - edit_approval.py:37-69  → editApprovalStorage (AsyncLocalStorage)
 *   - edit_approval.py:148-178 → shouldAutoApproveEdit / isSensitivePath
 *   - edit_approval.py:234-286 → makeAcpEditApprovalRequester
 *
 * 60s default timeout; timeout = deny.
 * Sensitive paths ALWAYS prompt regardless of policy.
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve, basename, normalize, sep, dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type {
  AutoApprovePolicy,
  EditProposal,
  PermissionOption,
  PermissionResponse,
  SessionId,
  ToolCallStart,
} from './types.ts';
import { AUTO_APPROVE_ASK, AUTO_APPROVE_SESSION, AUTO_APPROVE_WORKSPACE } from './types.ts';
import { translateAcpCwd } from './session.ts';

// ---------- Permission options ----------

export function buildPermissionOptions(allowPermanent: boolean): PermissionOption[] {
  const opts: PermissionOption[] = [
    { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'allow_session', kind: 'allow_always', name: 'Allow for session' },
  ];
  if (allowPermanent) {
    opts.push({ optionId: 'allow_always', kind: 'allow_always', name: 'Allow always' });
  }
  opts.push({ optionId: 'deny', kind: 'reject_once', name: 'Deny' });
  return opts;
}

export type PermissionOutcome = 'once' | 'session' | 'always' | 'deny';

const OPTION_ID_TO_OUTCOME: Record<string, PermissionOutcome> = {
  allow_once: 'once',
  allow_session: 'session',
  allow_always: 'always',
  deny: 'deny',
  deny_always: 'deny',
};

export type RequestPermissionFn = (
  req: { sessionId: SessionId; toolCall: ToolCallStart; options: PermissionOption[] },
) => Promise<PermissionResponse | null>;

let _permCounter = 0;
function permCheckId(): string {
  _permCounter += 1;
  return `perm-check-${_permCounter}`;
}

/**
 * Build an approval callback for dangerous-command tooling.
 *
 * Returns a function that takes `(command, description, opts)` and returns
 * a PermissionOutcome. 60s default timeout; timeout = deny.
 */
export function makeApprovalCallback(
  requestPermissionFn: RequestPermissionFn,
  sessionId: SessionId,
  timeoutMs = 60_000,
): (command: string, description: string, opts?: { allowPermanent?: boolean }) => Promise<PermissionOutcome> {
  return async (command, description, opts) => {
    const allowPermanent = opts?.allowPermanent ?? true;
    const options = buildPermissionOptions(allowPermanent);
    const title = description ? `${description}: ${command}` : command;
    const contentText = description ? `${description}\n$ ${command}` : `$ ${command}`;
    const toolCall: ToolCallStart = {
      sessionUpdate: 'tool_call',
      toolCallId: permCheckId(),
      title,
      kind: 'execute',
      status: 'pending',
      content: [{ type: 'text', text: contentText }],
      rawInput: { command, description },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        requestPermissionFn({ sessionId, toolCall, options }),
        new Promise<null>((res) => {
          timer = setTimeout(() => res(null), timeoutMs);
        }),
      ]);
      if (!response) return 'deny';
      const outcome = response.outcome;
      if (outcome.outcome !== 'selected') return 'deny';
      return OPTION_ID_TO_OUTCOME[outcome.optionId] ?? 'deny';
    } catch {
      return 'deny';
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ---------- Edit approval (AsyncLocalStorage-bound) ----------

export type EditApprovalRequester = (proposal: EditProposal) => Promise<boolean>;

/**
 * AsyncLocalStorage replaces Python's ContextVar — binds the edit-approval
 * requester for one logical ACP agent run so CLI/gateway sessions bypass
 * the guard automatically.
 *
 * Hermes ref: hermes_acp/edit_approval.py:37-69
 */
export const editApprovalStorage = new AsyncLocalStorage<EditApprovalRequester>();

export function getEditApprovalRequester(): EditApprovalRequester | undefined {
  return editApprovalStorage.getStore();
}

export function setEditApprovalRequester<T>(
  requester: EditApprovalRequester,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return editApprovalStorage.run(requester, fn);
}

// ---------- Sensitive paths ----------

const SENSITIVE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
]);

const SENSITIVE_DIR_PARTS = new Set(['.ssh', '.git']);

/**
 * Resolve a path to its real on-disk location, following symlinks. Falls
 * back to walking up parent directories when the leaf doesn't exist yet
 * (a brand-new file edit through a symlinked parent should still be
 * canonicalised against the parent's realpath). Final fallback is the
 * lexically-normalised path.
 *
 * Audit blocker H1: without realpath the sensitive-path heuristic can be
 * bypassed by a workspace-internal symlink pointing at `~/.ssh/id_rsa`.
 */
function resolveRealPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // Walk up to the nearest existing ancestor and realpath that, then
    // re-attach the missing tail. Bounded loop — stops at filesystem root.
    let cur = abs;
    const tail: string[] = [];
    while (true) {
      const parent = dirname(cur);
      if (parent === cur) break; // hit root
      try {
        const real = realpathSync(parent);
        return tail.length ? resolve(real, ...tail.reverse()) : real;
      } catch {
        tail.push(basename(cur));
        cur = parent;
      }
    }
    return normalize(abs);
  }
}

export function isSensitivePath(path: string): boolean {
  // H1: canonicalise via realpath first so a symlink → ~/.ssh/id_rsa
  // doesn't slip past the heuristic.
  const norm = resolveRealPath(path);
  const base = basename(norm).toLowerCase();
  if (SENSITIVE_FILES.has(base)) return true;
  if (base.includes('id_rsa')) return true;
  const parts = norm.split(sep).map((p) => p.toLowerCase());
  return parts.some((p) => SENSITIVE_DIR_PARTS.has(p));
}

// ---------- Auto-approve policy ----------

export function shouldAutoApproveEdit(
  proposal: EditProposal,
  policy: AutoApprovePolicy | string,
  cwd?: string | null,
): boolean {
  const p = String(policy || AUTO_APPROVE_ASK).trim();
  if (p === AUTO_APPROVE_ASK) return false;
  // H1: sensitive-path check is realpath-aware (see isSensitivePath above).
  if (isSensitivePath(proposal.path)) return false;
  // H1: workspace-prefix check must also be realpath-aware. Without this,
  // a symlink inside the workspace pointing at `~/.ssh/id_rsa` would match
  // both the sensitive-path bypass AND the prefix check.
  const path = resolveRealPath(proposal.path);
  if (p === AUTO_APPROVE_SESSION) return true;
  if (p === AUTO_APPROVE_WORKSPACE) {
    // Treat both the OS tempdir (`/var/folders/...` on macOS) AND the
    // resolved `/tmp` path as workspace-acceptable, matching Hermes
    // `tempfile.gettempdir()` behaviour across platforms.
    const candidates = new Set<string>([resolveRealPath(tmpdir()), resolveRealPath('/tmp')]);
    for (const root of candidates) {
      if (path === root || path.startsWith(root + sep)) return true;
    }
    if (cwd) {
      const root = resolveRealPath(cwd);
      if (path === root || path.startsWith(root + sep)) return true;
    }
    return false;
  }
  return false;
}

// ---------- Edit approval requester factory ----------

export function makeAcpEditApprovalRequester(
  requestPermissionFn: RequestPermissionFn,
  sessionId: SessionId,
  timeoutMs = 60_000,
  autoApproveGetter?: () => { policy: AutoApprovePolicy | string; cwd?: string | null },
): EditApprovalRequester {
  let _editCounter = 0;
  const editCallId = () => {
    _editCounter += 1;
    return `edit-approval-${_editCounter}`;
  };

  return async (proposal) => {
    // Apply WSL path translation at the edit-approval boundary too. Without
    // this, a Windows ACP client targeting a WSL agent sends `C:\repo\.env`
    // while cwd is `/mnt/c/repo`, and `shouldAutoApproveEdit`'s
    // `path.startsWith(root + sep)` check silently fails. Translation is a
    // no-op on non-WSL hosts (see `translateAcpCwd`).
    const translatedProposal: EditProposal = {
      ...proposal,
      path: translateAcpCwd(proposal.path),
    };

    if (autoApproveGetter) {
      try {
        const { policy, cwd } = autoApproveGetter();
        if (shouldAutoApproveEdit(translatedProposal, policy, cwd)) {
          return true;
        }
      } catch {
        // policy check failed; fall through to prompt
      }
    }

    const options: PermissionOption[] = [
      { optionId: 'allow_once', kind: 'allow_once', name: 'Allow edit' },
      { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
    ];
    const toolCall: ToolCallStart = {
      sessionUpdate: 'tool_call',
      toolCallId: editCallId(),
      title: `Approve edit: ${translatedProposal.path}`,
      kind: 'edit',
      status: 'pending',
      content: [
        {
          type: 'diff',
          path: translatedProposal.path,
          oldText: translatedProposal.oldText,
          newText: translatedProposal.newText,
        },
      ],
      rawInput: { tool: translatedProposal.toolName, arguments: translatedProposal.arguments },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        requestPermissionFn({ sessionId, toolCall, options }),
        new Promise<null>((res) => {
          timer = setTimeout(() => res(null), timeoutMs);
        }),
      ]);
      if (!response) return false;
      const outcome = response.outcome;
      return outcome.outcome === 'selected' && outcome.optionId === 'allow_once';
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
