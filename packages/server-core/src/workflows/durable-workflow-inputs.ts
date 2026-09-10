import { normalizeWorkflowTriggerInputs } from '../../../shared/src/workflows/trigger-inputs';
import type { LoadedWorkflow, WorkflowTriggerInput } from '../../../shared/src/workflows/types';

const reserved = new Set(['__proto__', 'constructor', 'prototype', 'enabled_source_slugs', 'permission_mode']);
const unsupported = () => new Error('unsupported-durable-trigger-inputs');
export function assertDurableTriggerDeclarations(workflow: LoadedWorkflow): void {
  const definitions = workflow.metadata.trigger.inputs ?? [];
  if (!Array.isArray(definitions)) throw unsupported();
  const known = new Map<string, WorkflowTriggerInput>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)
      || typeof definition.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(definition.name) || reserved.has(definition.name)
      || known.has(definition.name) || !['string', 'number', 'boolean'].includes(definition.type)
      || Object.keys(definition).some(key => !['name', 'type', 'required', 'default', 'description', 'min', 'max', 'integer', 'maxFrom'].includes(key))
      || definition.required !== undefined && typeof definition.required !== 'boolean'
      || definition.description !== undefined && typeof definition.description !== 'string') throw unsupported();
    if (definition.default !== undefined && (typeof definition.default !== definition.type || definition.type === 'number' && !Number.isFinite(definition.default))) throw unsupported();
    const numeric = definition.min !== undefined || definition.max !== undefined || definition.integer !== undefined || definition.maxFrom !== undefined;
    if (numeric && definition.type !== 'number') throw unsupported();
    if (definition.min !== undefined && !Number.isFinite(definition.min) || definition.max !== undefined && !Number.isFinite(definition.max)
      || definition.integer !== undefined && typeof definition.integer !== 'boolean'
      || definition.min !== undefined && definition.max !== undefined && definition.min > definition.max
      || definition.maxFrom !== undefined && (typeof definition.maxFrom !== 'string' || !definition.maxFrom)) throw unsupported();
    if (typeof definition.default === 'number' && (definition.min !== undefined && definition.default < definition.min
      || definition.max !== undefined && definition.default > definition.max || definition.integer && !Number.isInteger(definition.default))) throw unsupported();
    known.set(definition.name, definition);
  }
  for (const definition of definitions) {
    if (definition.maxFrom === undefined) continue;
    const ceiling = known.get(definition.maxFrom);
    if (!ceiling || ceiling.type !== 'number' || ceiling.name === definition.name
      || typeof definition.default === 'number' && typeof ceiling.default === 'number' && definition.default > ceiling.default) throw unsupported();
  }
}
export function normalizeDurableTriggerInputs(workflow: LoadedWorkflow, raw: Record<string, unknown> = {}, untrusted: string[] = []): {
  triggerInputs: Record<string, unknown>; untrustedTriggerInputs: string[];
} {
  assertDurableTriggerDeclarations(workflow);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.keys(raw).some(key => reserved.has(key))) throw unsupported();
  const known = new Set((workflow.metadata.trigger.inputs ?? []).map(definition => definition.name));
  if (!Array.isArray(untrusted) || untrusted.some(name => typeof name !== 'string' || !known.has(name))) throw unsupported();
  // A null-prototype map prevents ambient prototype properties supplying absent business inputs.
  const ownInputs = Object.assign(Object.create(null), raw) as Record<string, unknown>;
  return { triggerInputs: normalizeWorkflowTriggerInputs(workflow, ownInputs), untrustedTriggerInputs: [...new Set(untrusted)].sort() };
}
export function durableTriggerTemplateContext(workflow: LoadedWorkflow | undefined, inputs: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.assign(Object.create(null), Object.fromEntries((workflow?.metadata.trigger.inputs ?? []).map(definition => [definition.name, ''])), inputs);
}
