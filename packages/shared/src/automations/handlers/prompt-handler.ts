/**
 * PromptHandler - Processes prompt actions for App events
 *
 * Subscribes to App events and collects prompt actions to be executed.
 * Prompts are queued and delivered via callback for the caller to execute.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, PromptHandlerOptions, AutomationsConfigProvider } from './types.ts';
import { APP_EVENTS, type AutomationEvent, type PromptAction, type PendingPrompt, type AppEvent } from '../types.ts';
import type { PermissionMode } from '../../agent/mode-types.ts';
import { matcherMatches, buildPromptEnvFromPayload, expandEnvVars, parsePromptReferences } from '../utils.ts';
import { deriveAutomationName } from '../name-utils.ts';
import { assemblePrompt, scanForInjection } from '../../agent/prompt-builder.ts';

const log = createLogger('prompt-handler');
const EXTERNAL_INPUT_EVENTS = new Set<AutomationEvent>([
  'FileWatch',
  'PollUrl',
  'WebhookReceive',
  'MessageReceive',
]);

function getMessagingChannelFromPayload(payload: BaseEventPayload): PendingPrompt['messagingChannel'] | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const platform = record.platform;
  const channelId = record.channelId;
  if (typeof platform !== 'string' || typeof channelId !== 'string') return undefined;
  const senderName = record.senderName;
  return {
    platform,
    channelId,
    channelName: typeof senderName === 'string' ? senderName : null,
  };
}

function normalizePromptPermissionMode(event: AutomationEvent, mode: PermissionMode | undefined): PermissionMode | undefined {
  if (mode === 'allow-all' && EXTERNAL_INPUT_EVENTS.has(event)) return 'ask';
  return mode;
}

// ============================================================================
// PromptHandler Implementation
// ============================================================================

export class PromptHandler implements AutomationHandler {
  private readonly options: PromptHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: PromptHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  /**
   * Subscribe to App events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[PromptHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by processing matching prompt actions.
   */
  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    // Only process App events for prompt actions
    if (!APP_EVENTS.includes(event as AppEvent)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Group prompt actions by matcher for per-matcher history
    const matcherPrompts: Array<{
      matcherId: string | undefined;
      automationName: string;
      prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: PermissionMode }>;
    }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      const prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: PermissionMode }> = [];
      for (const action of matcher.actions) {
        if (action.type === 'prompt') {
          prompts.push({ prompt: action, labels: matcher.labels, permissionMode: matcher.permissionMode });
        }
      }
      if (prompts.length > 0) {
        matcherPrompts.push({ matcherId: matcher.id, automationName: deriveAutomationName(event, matcher), prompts });
      }
    }

    if (matcherPrompts.length === 0) return;

    const totalPrompts = matcherPrompts.reduce((s, m) => s + m.prompts.length, 0);
    log.debug(`[PromptHandler] Processing ${totalPrompts} prompts for ${event}`);

    // Build environment variables
    const env = buildPromptEnvFromPayload(event, payload);

    // Process prompts per matcher
    const pendingPrompts: PendingPrompt[] = [];

    for (const { matcherId, automationName, prompts } of matcherPrompts) {
      for (const { prompt, labels, permissionMode } of prompts) {
        const gatewayAlreadyHandled =
          event === 'MessageReceive' &&
          prompt.bindMessagingChannel === true &&
          (payload as unknown as Record<string, unknown>).handledByGateway === true;
        if (gatewayAlreadyHandled) continue;

        // Expand environment variables in the prompt
        const expandedPrompt = expandEnvVars(prompt.prompt, env);

        // Prompt-injection scan (run-time, against the fully-assembled prompt).
        // Closes Hermes bug #3968 — skill bodies loaded at runtime can carry
        // injection payloads that the create-time prompt scan would miss.
        // We have no skill loader here yet (Phase 1 scaffold) so the assembled
        // prompt is just the expanded user prompt; the scanner still catches
        // anything env-var expansion injected into the cron prompt itself.
        // TODO(#3968): thread loadedSkills + contextFiles into assemblePrompt
        // once the loader lands in this lane. Until then this scan is
        // incomplete — a malicious skill body would slip through because the
        // scanner only sees `userPrompt`.
        const assembled = assemblePrompt({ userPrompt: expandedPrompt });
        const scan = scanForInjection(assembled);
        if (scan.blocked) {
          // Server-side structured log carries the full pattern/reason for
          // debugging. Do NOT surface that detail to anything user-reachable
          // — an attacker can iterate against the scanner if they can read
          // which pattern fired.
          log.warn(
            `[PromptHandler] prompt blocked by injection scanner — event=${event} automation=${automationName} matcher=${matcherId ?? '<none>'} pattern=${scan.pattern} reason=${scan.reason}`
          );
          continue;
        }

        // Parse references
        const references = parsePromptReferences(expandedPrompt);

        // Expand labels
        const expandedLabels = labels?.map(label => expandEnvVars(label, env));

        // R7 / Plan 01-07: subconscious-mode DSL alias normalization.
        // The DSL accepts `mode: "escalate-on-write"` as a synonym for
        // `"subconscious"`; both collapse to the trigger-level union.
        let subconsciousMode: 'default' | 'subconscious' | 'yolo' | undefined;
        if (prompt.mode === 'escalate-on-write') {
          subconsciousMode = 'subconscious';
        } else if (
          prompt.mode === 'default' ||
          prompt.mode === 'subconscious' ||
          prompt.mode === 'yolo'
        ) {
          subconsciousMode = prompt.mode;
        }

        pendingPrompts.push({
          sessionId: this.options.sessionId,
          matcherId,
          automationName,
          prompt: expandedPrompt,
          mentions: references.mentions,
          labels: expandedLabels,
          agentSlug: prompt.agentSlug,
          messagingChannel: prompt.bindMessagingChannel
            ? getMessagingChannelFromPayload(payload)
            : undefined,
          permissionMode: normalizePromptPermissionMode(event, permissionMode),
          llmConnection: prompt.llmConnection,
          model: prompt.model,
          thinkingLevel: prompt.thinkingLevel,
          subconsciousMode,
          onEscalation: prompt.onEscalation,
        });
      }

    }

    // Deliver prompts via callback
    if (pendingPrompts.length > 0 && this.options.onPromptsReady) {
      log.debug(`[PromptHandler] Delivering ${pendingPrompts.length} prompts`);
      await this.options.onPromptsReady(pendingPrompts);
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug(`[PromptHandler] Disposed`);
  }
}
