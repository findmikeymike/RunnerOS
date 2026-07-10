import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import {
  APP_EVENTS,
  type AppEvent,
  type AutomationEvent,
  type PendingQueuedWork,
  type QueueWorkAction,
} from '../types.ts';
import { buildPromptEnvFromPayload, expandEnvVars, matcherMatches } from '../utils.ts';
import { deriveAutomationName } from '../name-utils.ts';
import type { AutomationHandler, AutomationsConfigProvider, QueueWorkHandlerOptions } from './types.ts';

const log = createLogger('queue-work-handler');

export class QueueWorkHandler implements AutomationHandler {
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(
    private readonly options: QueueWorkHandlerOptions,
    private readonly configProvider: AutomationsConfigProvider,
  ) {}

  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (!APP_EVENTS.includes(event as AppEvent)) return;
    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;
    const env = buildPromptEnvFromPayload(event, payload);
    const pending: PendingQueuedWork[] = [];
    for (const matcher of matchers) {
      if (!matcher.id || !matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;
      for (const action of matcher.actions) {
        if (action.type !== 'queue-work') continue;
        pending.push({
          matcherId: matcher.id,
          automationName: deriveAutomationName(event, matcher),
          event: event as AppEvent,
          eventTimestamp: payload.timestamp,
          eventKey: eventKey(event as AppEvent, payload),
          timezone: event === 'SchedulerTick' ? matcher.timezone : undefined,
          action: expandAction(action, env),
        });
      }
    }
    if (pending.length === 0 || !this.options.onWorkReady) return;
    try {
      await this.options.onWorkReady(pending);
      log.debug(`Queued ${pending.length} tracked work action(s) for ${event}`);
    } catch (error) {
      this.options.onError?.(event, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  dispose(): void {
    if (this.bus && this.boundHandler) this.bus.offAny(this.boundHandler);
    this.boundHandler = null;
    this.bus = null;
  }
}

function eventKey(event: AppEvent, payload: BaseEventPayload): string {
  const data = payload as unknown as Record<string, unknown>;
  if (event === 'MessageReceive') {
    return ['message', data.platform, data.channelId, data.messageId].map(String).join(':');
  }
  if (event === 'WebhookReceive') {
    const headers = data.headers && typeof data.headers === 'object' ? data.headers as Record<string, unknown> : {};
    const signedAt = headers['x-craft-timestamp'];
    const signature = headers['x-craft-signature'];
    const idempotencyKey = headers['idempotency-key'] ?? headers['x-idempotency-key'];
    if (signedAt && signature) return `webhook:${String(signedAt)}:${String(signature)}`;
    if (idempotencyKey) return `webhook:idempotency:${String(idempotencyKey)}`;
  }
  if (event === 'PollUrl') {
    return ['poll', data.url, data.previousFingerprint, data.fingerprint].map(String).join(':');
  }
  return `${event}:${payload.timestamp}`;
}

function expandAction(action: QueueWorkAction, env: Record<string, string>): QueueWorkAction {
  return expandValue(action, env) as QueueWorkAction;
}

function expandValue(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === 'string') return expandEnvVars(value, env);
  if (Array.isArray(value)) return value.map((item) => expandValue(item, env));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, expandValue(item, env)]),
  );
}
