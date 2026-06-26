/**
 * WorkflowHandler - Processes workflow actions for App events.
 *
 * Subscribes to App events and collects workflow starts for the host to run.
 * The host owns WorkflowRunner wiring because it knows workspace/session state.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, WorkflowHandlerOptions, AutomationsConfigProvider } from './types.ts';
import { APP_EVENTS, type AppEvent, type AutomationEvent, type PendingWorkflow, type WorkflowAction } from '../types.ts';
import { buildPromptEnvFromPayload, expandEnvVars, matcherMatches } from '../utils.ts';
import { deriveAutomationName } from '../name-utils.ts';

const log = createLogger('workflow-handler');

function expandTriggerInputs(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === 'string') return expandEnvVars(value, env);
  if (Array.isArray(value)) return value.map((item) => expandTriggerInputs(item, env));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = expandTriggerInputs(nested, env);
    }
    return out;
  }
  return value;
}

export class WorkflowHandler implements AutomationHandler {
  private readonly options: WorkflowHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: WorkflowHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug('[WorkflowHandler] Subscribed to event bus');
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (!APP_EVENTS.includes(event as AppEvent)) return;

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    const env = buildPromptEnvFromPayload(event, payload);
    const pendingWorkflows: PendingWorkflow[] = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;
      for (const action of matcher.actions) {
        if (action.type !== 'workflow') continue;
        const workflow = action as WorkflowAction;
        pendingWorkflows.push({
          matcherId: matcher.id,
          automationName: deriveAutomationName(event, matcher),
          workflowSlug: workflow.workflowSlug,
          triggerInputs: (expandTriggerInputs(workflow.triggerInputs ?? {}, env) ?? {}) as Record<string, unknown>,
        });
      }
    }

    if (pendingWorkflows.length > 0 && this.options.onWorkflowsReady) {
      log.debug(`[WorkflowHandler] Delivering ${pendingWorkflows.length} workflow starts`);
      this.options.onWorkflowsReady(pendingWorkflows);
    }
  }

  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug('[WorkflowHandler] Disposed');
  }
}
