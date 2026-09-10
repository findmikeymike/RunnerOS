import { expect, test } from 'bun:test';
import { durableWorkflowOccurrenceIdentity as identity } from './durable-workflow-occurrence';

const occurrence = { workOrderId: 'order', attemptId: 'attempt', workflowSlug: 'read', workflowDigest: 'definition' };
test('scheduled identity is stable per workspace and persisted attempt; definition changes cannot mint a replacement', () => {
  const first = identity('w', occurrence);
  expect(identity('w', { ...occurrence })).toEqual(first);
  expect(first.runId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  for (const field of ['workflowSlug', 'workflowDigest'] as const) {
    const changed = identity('w', { ...occurrence, [field]: 'changed' });
    expect(changed.runId).toBe(first.runId); expect(changed.commandId).not.toBe(first.commandId);
  }
  expect(identity('other', occurrence).runId).not.toBe(first.runId);
  for (const field of ['workOrderId', 'attemptId'] as const) expect(identity('w', { ...occurrence, [field]: 'changed' }).runId).not.toBe(first.runId);
  for (const field of Object.keys(occurrence)) expect(() => identity('w', { ...occurrence, [field]: '' })).toThrow();
});
