/**
 * Spawn Session Tool (spawn_session)
 *
 * Session-scoped tool that enables the main agent to create independent sessions
 * with configurable connection, model, sources, and an initial prompt.
 *
 * Two modes:
 * - help=true: Returns available connections, models, and sources
 * - Default: Creates a session and sends the prompt (fire-and-forget)
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { SpawnSessionResult, SpawnSessionHelpResult } from './base-agent.ts';
import {
  type DelegationConfigShape,
  buildSubagentRefusalPayload,
  createIsolatedApprovalCallback,
  getCurrentSpawnDepth,
  getMaxSpawnDepth,
  intersectSourceSlugs,
  shouldRejectSpawn,
  spawnDepthStorage,
  runWithSubagentApproval,
} from './spawn-session-isolation.ts';

export type SpawnSessionFn = (input: Record<string, unknown>) => Promise<SpawnSessionResult | SpawnSessionHelpResult>;

// Tool result type - matches what the SDK expects
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function refusalResponse(toolName: string): ToolResult {
  const payload = buildSubagentRefusalPayload(toolName);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export interface SpawnSessionToolOptions {
  sessionId: string;
  /**
   * Lazy resolver for the spawn session callback.
   * Called at execution time to get the current callback from the session registry.
   */
  getSpawnSessionFn: () => SpawnSessionFn | undefined;
  /**
   * Optional resolver for delegation config (`max_spawn_depth`,
   * `subagent_auto_approve`). When omitted, defaults are used
   * (`max_spawn_depth = 1`, deny by default). Injected so the tool can be
   * unit-tested without touching disk.
   */
  getDelegationConfig?: () => DelegationConfigShape;
  /**
   * Optional resolver for the parent session's effective `enabledSourceSlugs`
   * list. When present, the child's requested `enabledSourceSlugs` are
   * intersected with this list so a subagent cannot reach a source
   * (GitHub, Gmail, MCP server, etc.) the parent itself doesn't have
   * access to.
   *
   * Return `undefined` (not `[]`) when the parent has no explicit source
   * allowlist — `[]` is interpreted as "deny all".
   *
   * NOTE: this is source-level access control, not tool-name level. The
   * SPAWN_SESSION_BLOCKED_TOOLS blocklist operates separately at the SDK
   * tool layer where tools are registered (see session-scoped-tools.ts).
   */
  getParentSourceSlugs?: () => readonly string[] | undefined;
  /**
   * @deprecated renamed to `getParentSourceSlugs` to reflect that this is
   * a source-slug list, not a tool-name list. Kept temporarily for
   * backward compatibility with the original Hermes-port naming.
   */
  getParentToolset?: () => readonly string[] | undefined;
  /**
   * Optional ACP (Agent Client Protocol) endpoint. When set, spawn_session
   * delegates the prompt to a remote ACP-compliant agent over stdio JSON-RPC
   * instead of creating a local RunnerOS session.
   *
   * Format: `stdio:<command> [args...]` — e.g. `stdio:./node_modules/.bin/zed-acp-agent`.
   *
   * Ported from Hermes hermes_acp/ (MIT). See packages/shared/src/protocol/acp/.
   */
  acpEndpoint?: string;
  /**
   * Wall-clock timeout (ms) for the ACP delegation. Forwarded to
   * `delegateToAcpEndpoint`. Defaults to 5 minutes (300_000) when omitted.
   */
  acpTimeoutMs?: number;
  /**
   * R7 + R8 composition guard: the active subconscious-mode policy for the
   * parent session. When set to anything other than `'default'`,
   * `spawn_session(acpEndpoint=...)` is refused because the remote ACP
   * agent is a different process and cannot honor RunnerOS' escalation
   * gate (`gateWriteAttempt` lives in the local agent layer).
   *
   * Pass a resolver, not a static value, so the tool sees the current mode
   * at call time even if the parent session changes modes.
   */
  getSubconsciousMode?: () => 'default' | 'subconscious' | 'yolo' | undefined;
}

export function createSpawnSessionTool(options: SpawnSessionToolOptions) {
  return tool(
    'spawn_session',
    `Create a new session that runs independently with its own prompt, connection, model, and sources.

Use this to delegate tasks to parallel sessions — research, analysis, drafts, or any work that benefits from separate context.

Call with help=true first to discover available connections, models, and sources.
When spawning, the 'prompt' parameter is required.

Optional overrides: model, llmConnection, permissionMode, thinkingLevel, enabledSourceSlugs, labels, workingDirectory. Omitted fields inherit from the spawning session or the workspace default.

thinkingLevel is silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash) — the SDK drops the reasoning param rather than erroring.

The spawned session appears in the session list and runs fire-and-forget.
Only use 'attachments' for existing file paths on disk — the tool reads them automatically.`,
    {
      help: z.boolean().optional()
        .describe('If true, returns available connections, models, and sources instead of creating a session'),
      prompt: z.string().optional()
        .describe('Instructions for the new session (required when not in help mode)'),
      name: z.string().optional()
        .describe('Session name'),
      llmConnection: z.string().optional()
        .describe('Connection slug (e.g., "anthropic-api", "codex")'),
      model: z.string().optional()
        .describe('Model ID override'),
      enabledSourceSlugs: z.array(z.string()).optional()
        .describe('Source slugs to enable in the new session'),
      permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional()
        .describe('Permission mode for the new session'),
      thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).optional()
        .describe('Reasoning level for the new session. Silently ignored on non-reasoning models (e.g. gpt-4o, gemini-2.5-flash). Omit to inherit the workspace default.'),
      labels: z.array(z.string()).optional()
        .describe('Labels for the new session'),
      workingDirectory: z.string().optional()
        .describe('Working directory for the new session'),
      attachments: z.array(z.object({
        path: z.string().describe('Absolute file path on disk'),
        name: z.string().optional().describe('Display name (defaults to file basename)'),
      })).optional()
        .describe('Files to include with the prompt'),
    },
    async (args) => {
      // --- Isolation hardening (ported from Hermes, MIT) ---
      // Audit blocker B2: these gates MUST run BEFORE the ACP delegation
      // branch. Previously the ACP branch returned first, letting a subagent
      // at `max_spawn_depth` spawn unbounded REMOTE agents via `acpEndpoint`
      // and bypassing source-slug intersection entirely.
      const delegationConfig: DelegationConfigShape = options.getDelegationConfig?.() ?? {};
      const currentDepth = getCurrentSpawnDepth();
      const maxDepth = getMaxSpawnDepth(delegationConfig);
      if (shouldRejectSpawn(currentDepth, maxDepth)) {
        // Return a refusal payload to the calling subagent (never throw).
        // Applies to BOTH local spawn and ACP-targeted spawn.
        return refusalResponse('spawn_session');
      }

      // Apply parent/child source-slug intersection. Source slugs identify
      // sources (github, gmail, MCP servers) — a different namespace from
      // tool names. The SPAWN_SESSION_BLOCKED_TOOLS blocklist operates at
      // the SDK tool layer (see session-scoped-tools.ts) and is NOT applied
      // here, because that would conflate two namespaces (see B3 in the
      // 01-01 review).
      //
      // We mutate a shallow copy of the args so we don't disturb the caller.
      const childArgs: Record<string, unknown> = { ...(args as Record<string, unknown>) };
      const requestedSlugs = Array.isArray(childArgs.enabledSourceSlugs)
        ? (childArgs.enabledSourceSlugs as string[])
        : undefined;
      if (requestedSlugs !== undefined) {
        const parentSlugs =
          options.getParentSourceSlugs?.() ?? options.getParentToolset?.();
        if (parentSlugs !== undefined) {
          childArgs.enabledSourceSlugs = intersectSourceSlugs(parentSlugs, requestedSlugs);
        }
        // If parentSlugs is undefined, the parent has no explicit allowlist
        // (inherit defaults) — pass requested through unchanged.
      }

      // ACP delegation path. When the host supplies an `acpEndpoint`, the
      // prompt is routed through a remote ACP-compliant agent (Hermes MIT
      // port — see packages/shared/src/protocol/acp/). Local spawn is
      // bypassed entirely. The isolation gates above (depth + intersection)
      // have already run for this path; only the local execution branch
      // below remains.
      if (options.acpEndpoint) {
        // Audit blocker B3 (R7 + R8): subconscious mode cannot survive the
        // ACP boundary — `gateWriteAttempt` is a local-process gate and
        // the remote agent does not honor RunnerOS' escalation flow.
        // Refuse ACP delegation when subconscious mode is non-default
        // rather than silently degrading the user's policy.
        const subMode = options.getSubconsciousMode?.();
        if (subMode && subMode !== 'default') {
          return errorResponse(
            `spawn_session via ACP refused: subconscious mode "${subMode}" cannot ` +
              `be enforced across the ACP boundary (the remote agent does not ` +
              `honor RunnerOS' escalation gate). Either drop the ACP endpoint or ` +
              `set permission_mode back to "default".`
          );
        }
        const { delegateToAcpEndpoint } = await import(
          '../protocol/acp/spawn-bridge.ts'
        );
        try {
          const result = await delegateToAcpEndpoint({
            endpoint: options.acpEndpoint,
            prompt: typeof childArgs.prompt === 'string'
              ? (childArgs.prompt as string)
              : '',
            cwd:
              typeof childArgs.workingDirectory === 'string'
                ? (childArgs.workingDirectory as string)
                : process.cwd(),
            timeoutMs: options.acpTimeoutMs,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          if (error instanceof Error) {
            return errorResponse(`spawn_session via ACP failed: ${error.message}`);
          }
          throw error;
        }
      }

      const spawnFn = options.getSpawnSessionFn();
      if (!spawnFn) {
        return errorResponse('spawn_session is not available in this context.');
      }

      const childApprovalCb = createIsolatedApprovalCallback(delegationConfig);

      // Wrap the subagent execution in the isolation scopes so the child
      // sees (a) its own approval callback (never the parent's stdin-bound
      // one) and (b) an incremented depth counter for fork-bomb protection.
      try {
        const result = await runWithSubagentApproval(childApprovalCb, () =>
          spawnDepthStorage.run(currentDepth + 1, () =>
            spawnFn(childArgs),
          ),
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        if (error instanceof Error) {
          return errorResponse(`spawn_session failed: ${error.message}`);
        }
        throw error;
      }
    }
  );
}
