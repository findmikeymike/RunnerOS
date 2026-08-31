/**
 * First-use consent gate for polyglot shell hooks.
 *
 * Ported from NousResearch/hermes-agent (MIT) `agent/shell_hooks.py`
 * (`_prompt_and_record`, `_resolve_effective_accept`). See
 * THIRD_PARTY_NOTICES.md for the full attribution row.
 *
 * Behaviour matrix:
 *
 *   | allowlist hit  | TTY  | acceptHooks | outcome                           |
 *   |----------------|------|-------------|-----------------------------------|
 *   | yes (sha match)| any  | any         | silent approve                    |
 *   | no             | yes  | any         | interactive prompt                |
 *   | no             | no   | true        | silent approve (logged)           |
 *   | no             | no   | false       | throws HookConsentRequiredError   |
 *
 * "TTY" defaults to `process.stdin.isTTY`. Tests inject via `ConsentOptions`.
 */

import { createInterface } from 'node:readline';

import { createLogger } from '../../utils/debug.ts';
import {
  addAllowlistEntry,
  computeScriptContentHash,
  findEntry,
  getDefaultAllowlistPath,
  resolveRealScriptPath,
} from './allowlist-store.ts';
import type { ConsentOptions, HookSpec } from './types.ts';
import { HookConsentRequiredError } from './types.ts';

const log = createLogger('shell-hook-consent');

const ACCEPT_HOOKS_ENV = 'RUNNEROS_ACCEPT_HOOKS';

function resolveAcceptHooks(opt: boolean | undefined): boolean {
  if (opt === true) return true;
  const raw = process.env[ACCEPT_HOOKS_ENV];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on';
}

async function defaultPrompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((resolve) => rl.question(message, resolve));
  } finally {
    rl.close();
  }
}

/**
 * Resolve consent for a hook spec, recording an allowlist entry on first approval.
 *
 * Returns `true` on approval. Throws `HookConsentRequiredError` for the
 * non-TTY-without-acceptHooks case so callers can fail closed.
 */
export async function requestConsent(spec: HookSpec, opts: ConsentOptions = {}): Promise<boolean> {
  const allowlistPath = opts.allowlistPath ?? getDefaultAllowlistPath();
  // Canonicalise via realpath so the allowlist key/hash defend against
  // symlink-swap attacks (an attacker who repoints the link after consent
  // either resolves to a different real path OR produces a different hash).
  const { scriptPath } = await resolveRealScriptPath(spec.command);
  const contentHash = await computeScriptContentHash(scriptPath);

  const existing = await findEntry(spec.event, scriptPath, contentHash, allowlistPath);
  if (existing) return true;

  const acceptHooks = resolveAcceptHooks(opts.acceptHooks);
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);

  if (!isTTY && !acceptHooks) {
    throw new HookConsentRequiredError(spec.event, spec.command);
  }

  if (!isTTY && acceptHooks) {
    await addAllowlistEntry(
      {
        event: spec.event,
        command: spec.command,
        scriptPath,
        scriptContentHash: contentHash,
        registeredAt: new Date().toISOString(),
      },
      allowlistPath
    );
    log.info(`[consent] auto-approved via acceptHooks: event=${spec.event} command=${spec.command}`);
    return true;
  }

  // TTY path — prompt
  const promptFn = opts.promptFn ?? defaultPrompt;
  const banner =
    `\n⚠ RunnerOS is about to register a shell hook that runs a command on your behalf.\n` +
    `   Event:   ${spec.event}\n` +
    `   Command: ${spec.command}\n` +
    `   Script:  ${scriptPath}\n` +
    `   Hash:    sha256:${contentHash.slice(0, 16)}…\n` +
    `Commands run with your full user credentials. Only approve commands you trust.\n`;
  process.stderr.write(banner);
  let answer = '';
  try {
    answer = (await promptFn('Allow this hook to run? [y/N]: ')).trim().toLowerCase();
  } catch (err) {
    log.warn(`[consent] prompt aborted: ${(err as Error).message}`);
    return false;
  }
  if (answer === 'y' || answer === 'yes') {
    await addAllowlistEntry(
      {
        event: spec.event,
        command: spec.command,
        scriptPath,
        scriptContentHash: contentHash,
        registeredAt: new Date().toISOString(),
      },
      allowlistPath
    );
    return true;
  }
  return false;
}
