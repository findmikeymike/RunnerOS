import { createLogger } from '../../utils/debug.ts';
import { createHash } from 'node:crypto';
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
      let queueWorkActionIndex = 0;
      for (const action of matcher.actions) {
        if (action.type !== 'queue-work') continue;
        const actionIndex = queueWorkActionIndex++;
        if (event === 'WebhookReceive'
          && matcher.allowUnauthenticated === true
          && Object.values(action.inputBindings ?? {}).some((binding) => binding.mode === 'trigger' && binding.from === 'webhook.body')) {
          const error = new Error('Unauthenticated webhooks cannot supply workflow input values.');
          await this.options.onWorkRejected?.({
            event,
            matcherId: matcher.id,
            workTitle: action.title,
            error,
          });
          this.options.onError?.(event, error);
          continue;
        }
        pending.push({
          matcherId: matcher.id,
          actionIndex,
          automationName: deriveAutomationName(event, matcher),
          event: event as AppEvent,
          eventTimestamp: payload.timestamp,
          eventKey: eventKey(event as AppEvent, payload),
          timezone: event === 'SchedulerTick' ? matcher.timezone : undefined,
          triggerData: triggerData(event as AppEvent, payload),
          configuredAction: action,
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

function triggerData(
  event: AppEvent,
  payload: BaseEventPayload,
): PendingQueuedWork['triggerData'] {
  const data = payload as unknown as Record<string, unknown>;
  if (event === 'FileWatch') {
    const path = typeof data.path === 'string' ? data.path : undefined;
    if (!path) return undefined;
    const normalized = path.replace(/\\/g, '/');
    return {
      'file.path': path,
      'file.name': normalized.split('/').filter(Boolean).at(-1) ?? path,
    };
  }
  if (event === 'WebhookReceive') {
    const body = typeof data.bodyRaw === 'string'
      ? data.bodyRaw
      : data.body === undefined || data.body === null
        ? undefined
        : JSON.stringify(data.body);
    return body ? { 'webhook.body': body } : undefined;
  }
  if (event === 'MessageReceive' && typeof data.text === 'string') {
    return { 'message.text': data.text };
  }
  if (event === 'PollUrl' && typeof data.body === 'string') {
    return { 'url.content': data.body };
  }
  return undefined;
}

function eventKey(event: AppEvent, payload: BaseEventPayload): string {
  const data = payload as unknown as Record<string, unknown>;
  if (event === 'SchedulerTick' && typeof data.catchUpFromMs === 'number') {
    return `SchedulerTick:catch-up:${data.catchUpFromMs}`;
  }
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
  if (event === 'FileWatch') {
    if (typeof data.eventId === 'string' && data.eventId) return `FileWatch:${data.eventId}`;
    const identity = [
      typeof data.path === 'string' ? data.path.replace(/\\/g, '/') : '',
      typeof data.relativePath === 'string' ? data.relativePath.replace(/\\/g, '/') : '',
      typeof data.changeType === 'string' ? data.changeType : '',
      typeof data.size === 'number' ? data.size : null,
      data.isDirectory === true,
    ];
    const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 20);
    return `FileWatch:${payload.timestamp}:${digest}`;
  }
  return `${event}:${payload.timestamp}`;
}

function expandAction(action: QueueWorkAction, env: Record<string, string>): QueueWorkAction {
  const { inputBindings, ...expandableAction } = action;
  const expanded = expandValue(expandableAction, env) as QueueWorkAction;
  return inputBindings === undefined ? expanded : { ...expanded, inputBindings };
}

function expandValue(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === 'string') return expandEnvVars(value, env);
  if (Array.isArray(value)) return value.map((item) => expandValue(item, env));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, expandValue(item, env)]),
  );
}
