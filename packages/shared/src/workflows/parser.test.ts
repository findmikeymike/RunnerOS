import { expect, test } from 'bun:test';
import { parseWorkflowFile, serializeWorkflow } from './parser.ts';
import { isDurableConnectedReadUrl, isDurableWorkflowConnectedReads } from './connected-reads.ts';
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

const artistUrl = 'https://api.spotify.com/v1/artists/0123456789ABCDEFGHIJKL';
test('declared connected reads roundtrip only for the durable engine', () => {
 const connectedReads = [{ sourceSlug: 'spotify', url: artistUrl }, { sourceSlug: 'spotify', url: artistUrl.replace('012345', 'abcdef') }];
 const value = { ...metadata, execution: 'durable-local-read' as const, connectedReads };
 expect(parseWorkflowFile(serializeWorkflow(value, 'Notes'))?.metadata.connectedReads).toEqual(connectedReads);
 expect(isDurableWorkflowConnectedReads(connectedReads)).toBe(true);
 expect(() => serializeWorkflow({ ...metadata, connectedReads }, '')).toThrow('connected reads');
 expect(parseWorkflowFile(serializeWorkflow(metadata, '').replace('---\n', `---\nconnectedReads: ${JSON.stringify(connectedReads)}\n`))).toBeNull();
 expect(Object.hasOwn(parseWorkflowFile(serializeWorkflow(metadata, ''))!.metadata, 'connectedReads')).toBe(false);
});
test('connected read declarations reject malformed entries in both parse and serialization', () => {
 const read = { sourceSlug: 'spotify', url: artistUrl };
 const values: unknown[] = [null, false, {}, [], [null], [read, read], [read, { ...read, sourceSlug: 'two' }, { ...read, sourceSlug: 'three' }],
  [{ ...read, method: 'GET' }], [{ sourceSlug: 'spotify' }], [{ url: artistUrl }],
  ...['', ' spotify', 'spotify ', 'spotify\n', '../spotify', 'a/b', 'a.b', '-spotify', 'a%2fb'].map(sourceSlug => [{ ...read, sourceSlug }])];
 for (const connectedReads of values) {
  expect(isDurableWorkflowConnectedReads(connectedReads)).toBe(false);
  expect(() => serializeWorkflow({ ...metadata, execution: 'durable-local-read', connectedReads } as WorkflowMetadata, '')).toThrow('connected reads');
  expect(parseWorkflowFile(serializeWorkflow({ ...metadata, execution: 'durable-local-read' }, '').replace('---\n', `---\nconnectedReads: ${JSON.stringify(connectedReads)}\n`))).toBeNull();
 }
});
test.each([
 'https://api.spotify.com/v1/artists/0123456789ABCDEFGHIJKL',
 'https://api.github.com/repos/artist-os/demo',
 'https://analytics.example.com/v2/reports/latest',
])('connected read URL shape supports different providers without bespoke rules: %s', url => {
 const connectedReads = [{ sourceSlug: 'account', url }];
 expect(isDurableConnectedReadUrl(url)).toBe(true);
 expect(parseWorkflowFile(serializeWorkflow({ ...metadata, execution: 'durable-local-read', connectedReads }, ''))?.metadata.connectedReads).toEqual(connectedReads);
});
test('connected reads refuse noncanonical URLs, query strings, and ambiguous path separators', () => {
 for (const url of [artistUrl + '?market=US', artistUrl + '#x', artistUrl + '\n', artistUrl + '?', artistUrl + '#', artistUrl.replace('https:', 'http:'), artistUrl.replace('api.spotify.com', 'API.SPOTIFY.COM'), artistUrl.replace('api.spotify.com', 'api.spotify.com:443'), artistUrl.replace('api.spotify.com', 'user:pass@api.spotify.com'), artistUrl.replace('/artists/', '/artists/../artists/'), artistUrl + '%2fother', artistUrl + '%5Cother', artistUrl + '%00', 'not-a-url']) {
  expect(isDurableConnectedReadUrl(url)).toBe(false);
  expect(() => serializeWorkflow({ ...metadata, execution: 'durable-local-read', connectedReads: [{ sourceSlug: 'account', url }] }, '')).toThrow('connected reads');
  expect(parseWorkflowFile(serializeWorkflow({ ...metadata, execution: 'durable-local-read' }, '').replace('---\n', `---\nconnectedReads: ${JSON.stringify([{ sourceSlug: 'account', url }])}\n`))).toBeNull();
 }
});
