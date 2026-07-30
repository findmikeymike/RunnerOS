import { describe, expect, test } from 'bun:test';
import { normalizeWorkflowTriggerInputs } from './trigger-inputs.ts';
import type { LoadedWorkflow } from './types.ts';

function workflow(inputs: LoadedWorkflow['metadata']['trigger']['inputs']): LoadedWorkflow {
  return {
    slug: 'demo',
    path: '/tmp/demo/WORKFLOW.md',
    source: 'global',
    body: '',
    metadata: {
      name: 'Demo',
      description: 'Demo workflow',
      trigger: { type: 'manual', inputs },
      steps: [{ id: 'one', agent: 'agent', input: 'Do it' }],
    },
  };
}

describe('normalizeWorkflowTriggerInputs', () => {
  test('applies defaults and keeps declared fields only', () => {
    expect(normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
      { name: 'limit', type: 'number', default: 3 },
    ]), { topic: 'markets', extra: 'ignored' })).toEqual({
      topic: 'markets',
      limit: 3,
    });
  });

  test('rejects missing required inputs', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'topic', type: 'string', required: true },
    ]), {})).toThrow('Missing required workflow input: topic');
  });

  test('rejects invalid input types', () => {
    expect(() => normalizeWorkflowTriggerInputs(workflow([
      { name: 'limit', type: 'number' },
    ]), { limit: '5' })).toThrow('Workflow input "limit" must be a number.');
  });

  test('enforces finite numeric range and integer contracts', () => {
    const bounded = workflow([
      { name: 'count', type: 'number', min: 1, max: 25, integer: true },
    ]);

    expect(normalizeWorkflowTriggerInputs(bounded, { count: 12 })).toEqual({ count: 12 });
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 0 })).toThrow('must be at least 1');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 26 })).toThrow('must be at most 25');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: 1.5 })).toThrow('must be a whole number');
    expect(() => normalizeWorkflowTriggerInputs(bounded, { count: Number.POSITIVE_INFINITY })).toThrow('must be a number');
  });

  test('enforces a number input ceiling from another input', () => {
    const related = workflow([
      { name: 'targets', type: 'number', min: 1, max: 25, integer: true },
      { name: 'drafts', type: 'number', min: 0, max: 10, integer: true, maxFrom: 'targets' },
    ]);

    expect(normalizeWorkflowTriggerInputs(related, { targets: 3, drafts: 3 })).toEqual({
      targets: 3,
      drafts: 3,
    });
    expect(() => normalizeWorkflowTriggerInputs(related, { targets: 2, drafts: 3 }))
      .toThrow('Workflow input "drafts" must be no greater than "targets" (2).');
  });
});
