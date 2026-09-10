import { expect, test } from 'bun:test';
import type { LoadedWorkflow, WorkflowTriggerInput } from '../../../shared/src/workflows/types';
import { assertDurableTriggerDeclarations, normalizeDurableTriggerInputs, durableTriggerTemplateContext } from './durable-workflow-inputs';
import { supportsDurableReadWorkflow } from './durable-read-runner';
function workflow(inputs: WorkflowTriggerInput[] = []): LoadedWorkflow {
  return { slug: 'test', source: 'global', path: '/test', body: '', metadata: { name: 'Test', description: '', trigger: { type: 'manual', inputs }, outputs: { mode: 'none' }, steps: [{ id: 'first', agent: 'reader', input: 'Read notes' }] } };
}
test('uses normal scalar defaults, required types, numeric bounds, integer and maxFrom', () => {
  const w = workflow([{ name: 'topic', type: 'string', required: true }, { name: 'ceiling', type: 'number', default: 5 },
    { name: 'count', type: 'number', min: 1, max: 10, integer: true, maxFrom: 'ceiling' }, { name: 'include', type: 'boolean', default: false }]);
  expect(normalizeDurableTriggerInputs(w, { topic: 'release', count: 3, ignored: 'extra' }, ['topic', 'topic'])).toEqual({ triggerInputs: { topic: 'release', ceiling: 5, count: 3, include: false }, untrustedTriggerInputs: ['topic'] });
  for (const raw of [{ count: 3 }, { topic: 42 }, { topic: 'release', count: 0 }, { topic: 'release', count: 1.5 }, { topic: 'release', count: 6 }, { topic: 'release', count: NaN }, { topic: 'release', include: 'true' }]) {
    expect(() => normalizeDurableTriggerInputs(w, raw)).toThrow();
  }
});
test('unknown fields drop, missing optional only becomes empty in template context', () => {
  const w = workflow([{ name: 'optional', type: 'string' }]);
  const values = normalizeDurableTriggerInputs(w, { unknown: true });
  expect(values.triggerInputs).toEqual({}); expect(durableTriggerTemplateContext(w, values.triggerInputs)).toEqual({ optional: '' });
  expect(() => normalizeDurableTriggerInputs(w, {}, ['unknown'])).toThrow();
});
test('rejects duplicate, prototype, runner-control and invalid declaration names', () => {
  for (const name of ['__proto__', 'constructor', 'prototype', 'enabled_source_slugs', 'permission_mode', 'nested.field', 'with-dash', '9first']) {
    expect(() => assertDurableTriggerDeclarations(workflow([{ name, type: 'string' }]))).toThrow();
  }
  expect(() => assertDurableTriggerDeclarations(workflow([{ name: 'x', type: 'string' }, { name: 'x', type: 'string' }]))).toThrow();
  for (const name of ['__proto__', 'constructor', 'prototype', 'enabled_source_slugs', 'permission_mode']) {
    expect(() => normalizeDurableTriggerInputs(workflow(), JSON.parse(`{"${name}": "invalid"}`))).toThrow();
  }
});
test('rejects malformed declaration contracts even if raw value would override a bad default', () => {
  for (const extra of [{ default: 'text' }, { default: Infinity }, { min: 10, max: 1 }, { integer: 'yes' }, { maxFrom: 'unknown' }, { maxFrom: 'x' }, { other: true }]) {
    expect(() => assertDurableTriggerDeclarations(workflow([{ name: 'x', type: 'number', ...extra } as WorkflowTriggerInput]))).toThrow();
  }
  expect(() => assertDurableTriggerDeclarations(workflow([{ name: 'x', type: 'string', min: 1 }]))).toThrow();
});
test('only declared trigger refs and prior plain step output refs are supported', () => {
  const w = workflow([{ name: 'topic', type: 'string' }]);
  for (const input of ['{{trigger.topic}}', '{{ trigger.topic | escape }}']) { w.metadata.steps[0]!.input = input; expect(supportsDurableReadWorkflow(w)).toBe(true); }
  for (const input of ['{{trigger.missing}}', '{{trigger.topic.nested}}', '{{run.id}}', '{{trigger.topic | raw}}', '{{steps.later.output}}', '{{trigger.topic', '{{trigger.__proto__}}']) {
    w.metadata.steps[0]!.input = input; expect(supportsDurableReadWorkflow(w)).toBe(false);
  }
});
