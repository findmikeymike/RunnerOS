import { expect, test } from 'bun:test';
import { parseWorkflowFile, serializeWorkflow } from './parser.ts';
import type { WorkflowMetadata } from './types.ts';
const metadata: WorkflowMetadata = { name: 'Read', description: 'Read local files', trigger: { type: 'manual' }, outputs: { mode: 'none' }, steps: [{ id: 'read', agent: 'reader', input: 'Read the notes.' }] };
test('explicit durable local read execution survives serialization and parsing', () => {
  const text = serializeWorkflow({ ...metadata, execution: 'durable-local-read' }, 'Body');
  expect(text).toContain('execution: durable-local-read');
  expect(parseWorkflowFile(text)?.metadata.execution).toBe('durable-local-read');
  expect(parseWorkflowFile(text)?.body).toBe('Body');
});
test('absent execution retains legacy metadata without an inferred engine', () => {
  const text = serializeWorkflow(metadata, '');
  expect(text).not.toContain('execution:');
  expect(Object.hasOwn(parseWorkflowFile(text)!.metadata, 'execution')).toBe(false);
});
test('unknown or malformed execution engines reject rather than disappear', () => {
  for (const value of ['other-engine', 'legacy', '', null, false, 1, {}, ['durable-local-read']]) {
    const invalid = { ...metadata, execution: value } as unknown as WorkflowMetadata;
    expect(() => serializeWorkflow(invalid, '')).toThrow('execution engine');
    const text = serializeWorkflow(metadata, '').replace('---\n', `---\nexecution: ${JSON.stringify(value)}\n`);
    expect(parseWorkflowFile(text)).toBeNull();
  }
});
