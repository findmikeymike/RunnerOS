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

test('explicit model roles survive roundtrip and invalid roles reject', () => {
  for (const modelRole of ['reasoning', 'fast'] as const) {
    const definition = { ...metadata, steps: [{ ...metadata.steps[0]!, modelRole }] };
    expect(parseWorkflowFile(serializeWorkflow(definition, ''))?.metadata.steps[0]?.modelRole).toBe(modelRole);
  }
  for (const modelRole of ['cheap', '', null, 1, {}]) {
    const definition = { ...metadata, steps: [{ ...metadata.steps[0]!, modelRole }] } as unknown as WorkflowMetadata;
    expect(() => serializeWorkflow(definition, '')).toThrow('model role');
    expect(parseWorkflowFile(serializeWorkflow(metadata, '').replace('    agent: reader', `    agent: reader\n    modelRole: ${JSON.stringify(modelRole)}`))).toBeNull();
  }
});

test('approved durable web URLs roundtrip and cannot leak into legacy workflows', () => {
  const valid = { ...metadata, execution: 'durable-local-read' as const, webReadUrls: ['https://example.com/article'] };
  expect(parseWorkflowFile(serializeWorkflow(valid, ''))?.metadata.webReadUrls).toEqual(valid.webReadUrls);
  for (const webReadUrls of [[], ['http://example.com/'], ['https://user:pass@example.com/'], ['https://example.com/#section'], ['https://example.com:444/'], ['https://example.com/','https://example.com/'], Array.from({length:9},(_,i)=>`https://example.com/${i}`)]) {
    expect(() => serializeWorkflow({ ...valid, webReadUrls }, '')).toThrow('web read');
  }
  expect(() => serializeWorkflow({ ...metadata, webReadUrls: valid.webReadUrls }, '')).toThrow('web read');
});

test('web redirects require an explicit boolean and a durable URL grant', () => {
  const valid = { ...metadata, execution: 'durable-local-read' as const, webReadUrls: ['https://example.com/article'] };
  for (const webReadRedirects of [true, false]) {
    expect(parseWorkflowFile(serializeWorkflow({ ...valid, webReadRedirects }, ''))?.metadata.webReadRedirects).toBe(webReadRedirects);
    expect(() => serializeWorkflow({ ...metadata, webReadRedirects }, '')).toThrow('web read');
  }
  expect(parseWorkflowFile(serializeWorkflow(valid, ''))?.metadata.webReadRedirects).toBeUndefined();
  for (const webReadRedirects of ['true', 1, null, {}]) {
    expect(() => serializeWorkflow({ ...valid, webReadRedirects } as unknown as WorkflowMetadata, '')).toThrow('web read');
    const source = serializeWorkflow(valid, '').replace('webReadUrls:', `webReadRedirects: ${JSON.stringify(webReadRedirects)}\nwebReadUrls:`);
    expect(parseWorkflowFile(source)).toBeNull();
  }
  expect(parseWorkflowFile(serializeWorkflow(metadata, '').replace('name:', 'webReadRedirects: true\nname:'))).toBeNull();
});
