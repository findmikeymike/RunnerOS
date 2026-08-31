/**
 * ShellHookHandler — routes the `shell-hook` automation action type to the
 * polyglot runner.
 *
 * Ported from NousResearch/hermes-agent (MIT) `agent/shell_hooks.py`
 * (`_make_callback` / `register_from_config`). See THIRD_PARTY_NOTICES.md.
 *
 * DSL shape (per Phase 1 SPEC R6):
 *
 *   {
 *     "PreToolUse": [
 *       { "matcher": "terminal", "actions": [
 *         {
 *           "type": "shell-hook",
 *           "command": "~/.runneros/hooks/firewall.sh",
 *           "event": "pre_tool_call",
 *           "timeoutMs": 60000
 *         }
 *       ]}
 *     ]
 *   }
 *
 * Outcome:
 *   - `{action: "block"}`  → handler emits a block outcome via callback; the
 *     dispatcher is expected to halt the originating tool call and surface
 *     `message` to the agent.
 *   - `{action: "allow"}`  → no-op; the workflow continues.
 *   - `{context: "..."}`   → handler emits a context-injection outcome; the
 *     dispatcher is expected to prepend `context` to the next prompt assembly.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, AutomationsConfigProvider } from './types.ts';
import type { AutomationEvent, AutomationMatcher } from '../types.ts';
import { matcherMatches } from '../utils.ts';
import { runShellHook } from '../hooks/shell-hook-runner.ts';
import type { HookEvent, HookResponse, HookSpec } from '../hooks/types.ts';
import { HookConsentRequiredError } from '../hooks/types.ts';

const log = createLogger('shell-hook-handler');

/** The DSL shape for a `shell-hook` action. Permissively typed because the
 * automation action union (`AutomationAction`) does not yet include this; a
 * follow-up will widen the union once R6 lands in handlers/index.ts. */
export interface ShellHookAction {
  type: 'shell-hook';
  command: string;
  /** Mapped 1:1 from the automation event when omitted. */
  event?: string;
  timeoutMs?: number;
  /** Per-action acceptance flag — bypasses the TTY prompt for this hook only. */
  acceptHooks?: boolean;
}

export interface ShellHookOutcome {
  matcherId: string | undefined;
  event: AutomationEvent;
  response: HookResponse;
}

export interface ShellHookHandlerOptions {
  workspaceId: string;
  workspaceRootPath: string;
  sessionId?: string;
  /** Optional override of the allowlist path (mainly for tests). */
  allowlistPath?: string;
  /** Called when a hook resolves with a usable response (block / context). */
  onHookResult?: (outcome: ShellHookOutcome) => void;
  /** Called when a hook throws an unrecoverable error. */
  onError?: (event: AutomationEvent, err: Error) => void;
}

/** Convert CamelCase / PascalCase to snake_case using regex match positions.
 *
 * The previous implementation passed `offset` as the third arg of
 * `String.replace`'s callback, but the callback signature is
 * `(match, ...captures, offset, fullString)` — with one capture group the
 * `offset` arg is at index 2 and is the index of the MATCH within the source
 * string, not a loop counter. A capital letter at position 0 should not be
 * prefixed with `_`, and a capital letter at any other position SHOULD be.
 * Use that index directly rather than rebuilding a misleading "i" variable. */
function camelToSnake(input: string): string {
  return input.replace(/([A-Z])/g, (_match, letter: string, offset: number) =>
    offset === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`
  );
}

/** Map an `AutomationEvent` (CamelCase) to a hook-wire event name (snake_case). */
function defaultHookEventName(event: AutomationEvent): string {
  // Best-effort mapping — keeps the wire stable for the dual-canonical hook protocol.
  switch (event) {
    case 'PreToolUse': return 'pre_tool_call';
    case 'PostToolUse': return 'post_tool_call';
    case 'UserPromptSubmit': return 'pre_llm_call';
    case 'SessionStart': return 'session_start';
    case 'SessionEnd': return 'session_end';
    case 'Notification': return 'notification';
    default: return camelToSnake(event);
  }
}

/** Action `type` strings that look like a shell-hook typo. Used to surface
 * silent-ignore mistakes (e.g. `"shellhook"` or `"shell_hook"`) as a warning
 * instead of letting the action vanish from the dispatch. */
const SHELL_HOOK_TYPO_PATTERNS: readonly string[] = [
  'shellhook',
  'shell_hook',
  'shell.hook',
  'sh-hook',
  'shellhook ',
];

/** Construct a HookEvent payload from the bus event + payload. */
export function buildHookEvent(
  event: AutomationEvent,
  payload: BaseEventPayload,
  action: ShellHookAction,
  sessionId: string | undefined
): HookEvent {
  const extras: Record<string, unknown> = { ...payload };
  // Pull a few well-known fields up to the top level when present.
  const toolName = (payload as unknown as { toolName?: string }).toolName;
  const toolInput = (payload as unknown as { toolInput?: unknown }).toolInput;
  delete extras.toolName;
  delete extras.toolInput;
  return {
    hook_event_name: action.event ?? defaultHookEventName(event),
    tool_name: toolName,
    tool_input: toolInput,
    session_id: sessionId ?? payload.sessionId ?? '',
    cwd: process.cwd(),
    extra: extras,
  };
}

function isShellHookAction(a: unknown): a is ShellHookAction {
  return (
    typeof a === 'object' && a !== null &&
    (a as { type?: unknown }).type === 'shell-hook' &&
    typeof (a as { command?: unknown }).command === 'string'
  );
}

export class ShellHookHandler implements AutomationHandler {
  private readonly options: ShellHookHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: ShellHookHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug('[ShellHookHandler] Subscribed to event bus');
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;
      await this.dispatchMatcher(matcher, event, payload);
    }
  }

  private async dispatchMatcher(
    matcher: AutomationMatcher,
    event: AutomationEvent,
    payload: BaseEventPayload
  ): Promise<void> {
    // `shell-hook` is not yet part of the `AutomationAction` union (R6 widens
    // it in a follow-up). Iterate over the actions as `unknown` so the guard
    // does the type assertion without TS narrowing to never.
    for (const raw of matcher.actions as unknown as unknown[]) {
      if (!isShellHookAction(raw)) {
        // Make typos visible: an action whose `type` looks like "shell-hook"
        // but isn't quite right would otherwise be silently skipped.
        const rawType = typeof raw === 'object' && raw !== null
          ? (raw as { type?: unknown }).type
          : undefined;
        if (typeof rawType === 'string') {
          const norm = rawType.trim().toLowerCase();
          if (norm !== 'shell-hook' && SHELL_HOOK_TYPO_PATTERNS.includes(norm)) {
            log.warn(
              `[ShellHookHandler] action with type="${rawType}" looks like a ` +
                `shell-hook typo; did you mean "shell-hook"? Skipping.`
            );
          }
        }
        continue;
      }
      const action = raw;
      const hookEvent = buildHookEvent(event, payload, action, this.options.sessionId);
      const spec: HookSpec = {
        command: action.command,
        event: hookEvent.hook_event_name,
        timeoutMs: action.timeoutMs,
      };
      try {
        const response = await runShellHook(spec, hookEvent, {
          acceptHooks: action.acceptHooks,
          allowlistPath: this.options.allowlistPath,
        });
        if (this.options.onHookResult) {
          this.options.onHookResult({ matcherId: matcher.id, event, response });
        }
        if ('action' in response && response.action === 'block') {
          log.warn(
            `[ShellHookHandler] hook blocked event=${event} matcher=${matcher.id ?? '<none>'} ` +
              `command=${action.command} message=${response.message ?? ''}`
          );
        }
      } catch (err) {
        if (err instanceof HookConsentRequiredError) {
          log.warn(
            `[ShellHookHandler] consent required for event=${event} ` +
              `command=${action.command}: ${err.message}`
          );
          this.options.onError?.(event, err);
          continue;
        }
        log.warn(`[ShellHookHandler] hook execution error: ${(err as Error).message}`);
        this.options.onError?.(event, err as Error);
      }
    }
  }

  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug('[ShellHookHandler] Disposed');
  }
}
