import type { WorkflowTriggerInput } from '../workflows/types.ts';
import type { WorkflowInputBinding, WorkflowInputTriggerSource } from './types.ts';

export type WorkflowBindingTrigger =
  | 'SchedulerTick'
  | 'FileWatch'
  | 'WebhookReceive'
  | 'PollUrl'
  | 'MessageReceive'
  | 'schedule'
  | 'file-change'
  | 'webhook'
  | 'url-change'
  | 'message';

const TRIGGER_SOURCES: Record<WorkflowBindingTrigger, ReadonlySet<WorkflowInputTriggerSource>> = {
  SchedulerTick: new Set(),
  schedule: new Set(),
  FileWatch: new Set(['file.path', 'file.name']),
  'file-change': new Set(['file.path', 'file.name']),
  WebhookReceive: new Set(['webhook.body']),
  webhook: new Set(['webhook.body']),
  PollUrl: new Set(['url.content']),
  'url-change': new Set(['url.content']),
  MessageReceive: new Set(['message.text']),
  message: new Set(['message.text']),
};

export function workflowInputBindingValidationError(
  definitions: readonly WorkflowTriggerInput[],
  bindings: Record<string, WorkflowInputBinding>,
  trigger: WorkflowBindingTrigger,
  options: { allowUnauthenticatedWebhook?: boolean } = {},
): string | undefined {
  const declared = new Set(definitions.map((definition) => definition.name));
  for (const name of Object.keys(bindings)) {
    if (!declared.has(name)) return `Workflow input binding is not declared: ${name}`;
  }
  for (const definition of definitions) {
    const binding = bindings[definition.name];
    if (definition.required && !binding) return `Workflow input needs a binding: ${definition.name}`;
    if (!binding) continue;
    if (!definition.required && binding.mode === 'ask') {
      return `Optional workflow input cannot pause every run: ${definition.name}`;
    }
    if (binding.mode === 'fixed') {
      if (!Object.prototype.hasOwnProperty.call(binding, 'value') || binding.value === undefined) {
        return `Fixed workflow input is missing a value: ${definition.name}`;
      }
      continue;
    }
    if (binding.mode === 'ask') continue;
    if (definition.type !== 'string') return `Trigger-bound workflow input must be a string: ${definition.name}`;
    if (!TRIGGER_SOURCES[trigger].has(binding.from)) {
      return `Trigger ${trigger} cannot provide workflow input source: ${binding.from}`;
    }
    if (options.allowUnauthenticatedWebhook && binding.from === 'webhook.body') {
      return 'Unauthenticated webhooks cannot supply workflow input values.';
    }
  }
  return undefined;
}

export function assertWorkflowInputBindings(
  definitions: readonly WorkflowTriggerInput[],
  bindings: Record<string, WorkflowInputBinding>,
  trigger: WorkflowBindingTrigger,
  options?: { allowUnauthenticatedWebhook?: boolean },
): void {
  const error = workflowInputBindingValidationError(definitions, bindings, trigger, options);
  if (error) throw new Error(error);
}
