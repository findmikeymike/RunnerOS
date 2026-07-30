import type { LoadedWorkflow } from './types.ts';

export function normalizeWorkflowTriggerInputs(
  workflow: LoadedWorkflow,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const inputDefs = workflow.metadata.trigger.inputs ?? [];
  if (inputDefs.length === 0) return {};

  const out: Record<string, unknown> = {};
  for (const def of inputDefs) {
    let value = raw?.[def.name];
    if (value === undefined) value = def.default;

    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required workflow input: ${def.name}`);
    }
    if (value === undefined || value === null || value === '') continue;

    if (def.type === 'string') {
      if (typeof value !== 'string') throw new Error(`Workflow input "${def.name}" must be a string.`);
      out[def.name] = value;
    } else if (def.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Workflow input "${def.name}" must be a number.`);
      }
      if (def.integer && !Number.isInteger(value)) {
        throw new Error(`Workflow input "${def.name}" must be a whole number.`);
      }
      if (def.min !== undefined && value < def.min) {
        throw new Error(`Workflow input "${def.name}" must be at least ${def.min}.`);
      }
      if (def.max !== undefined && value > def.max) {
        throw new Error(`Workflow input "${def.name}" must be at most ${def.max}.`);
      }
      out[def.name] = value;
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Workflow input "${def.name}" must be a boolean.`);
      out[def.name] = value;
    }
  }
  for (const def of inputDefs) {
    if (!def.maxFrom) continue;
    const value = out[def.name];
    const ceiling = out[def.maxFrom];
    if (typeof value === 'number' && typeof ceiling === 'number' && value > ceiling) {
      throw new Error(`Workflow input "${def.name}" must be no greater than "${def.maxFrom}" (${ceiling}).`);
    }
  }
  return out;
}
