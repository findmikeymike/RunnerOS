import { describe, expect, test } from 'bun:test';
import { workflowInputBindingValidationError } from './workflow-input-bindings.ts';

const definitions = [
  { name: 'brief', type: 'string' as const, required: true },
  { name: 'count', type: 'number' as const },
];

describe('workflow input binding validation', () => {
  test('enforces the same required binding at every setup door', () => {
    expect(workflowInputBindingValidationError(definitions, {}, 'schedule'))
      .toBe('Workflow input needs a binding: brief');
    expect(workflowInputBindingValidationError(definitions, {}, 'SchedulerTick'))
      .toBe('Workflow input needs a binding: brief');
  });

  test('rejects optional asks and non-string trigger bindings', () => {
    expect(workflowInputBindingValidationError(definitions, {
      brief: { mode: 'fixed', value: 'Launch' },
      count: { mode: 'ask' },
    }, 'schedule')).toBe('Optional workflow input cannot pause every run: count');
    expect(workflowInputBindingValidationError(definitions, {
      brief: { mode: 'fixed', value: 'Launch' },
      count: { mode: 'trigger', from: 'message.text' },
    }, 'message')).toBe('Trigger-bound workflow input must be a string: count');
  });
});
