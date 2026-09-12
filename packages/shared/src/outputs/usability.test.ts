import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOutputBundle, getOutputDir } from './storage';
import { isOutputUsable } from './usability';
import type { OutputManifest } from './types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'output-usability-')); roots.push(root);
  const output = createOutputBundle(root, { workspaceId: 'ws', title: 'Report', kind: 'report', content: 'Finished report', origin: { source: 'session', sessionId: 'session' } });
  return { root, output };
}

test('missing primary cannot be replaced by its preview snippet, another asset, link, or receipt', () => {
  const { root, output } = fixture();
  expect(isOutputUsable(root, output)).toBe(true);
  writeFileSync(join(getOutputDir(root, output.id), 'attachment.txt'), 'attachment');
  output.assets.push({ id: 'attachment', label: 'Attachment', role: 'attachment', path: 'attachment.txt' });
  output.links.push({ id: 'link', label: 'Reference', url: 'https://example.com' });
  output.receipts.push({ id: 'receipt', provider: 'canvas', action: 'opened', status: 'succeeded', occurredAt: output.createdAt });
  rmSync(join(getOutputDir(root, output.id), output.primary!.path));
  expect(isOutputUsable(root, output)).toBe(false);
});

test('failed and cancelled records never satisfy work, while a usable draft remains reviewable', () => {
  const { root, output } = fixture();
  for (const status of ['failed', 'cancelled'] as const) expect(isOutputUsable(root, { ...output, status })).toBe(false);
  expect(isOutputUsable(root, { ...output, status: 'draft' })).toBe(true);
});

test('empty shells fail, but fileless text, links, and outcome receipts remain valid', () => {
  const { root, output } = fixture();
  const shell: OutputManifest = { ...output, primary: undefined, assets: [], preview: undefined };
  expect(isOutputUsable(root, shell)).toBe(false);
  expect(isOutputUsable(root, { ...shell, status: 'draft', kind: 'collection' })).toBe(false);
  expect(isOutputUsable(root, { ...shell, preview: { mode: 'text', inlineText: 'Complete inline answer' } })).toBe(true);
  expect(isOutputUsable(root, { ...shell, preview: { mode: 'text', inlineText: '   ' } })).toBe(false);
  expect(isOutputUsable(root, { ...shell, links: [{ id: 'web', label: 'Preview', url: 'http://localhost:4187', role: 'primary' }] })).toBe(true);
  for (const status of ['pending', 'failed', 'succeeded'] as const) {
    expect(isOutputUsable(root, { ...shell, kind: 'receipt', receipts: [{ id: 'action', provider: 'service', action: 'Result', status, occurredAt: output.createdAt }] })).toBe(true);
  }
});

test('a declared preview asset must exist, even when inline text is present', () => {
  const { root, output } = fixture();
  const previewOnly = { ...output, primary: undefined, assets: [] };
  expect(isOutputUsable(root, previewOnly)).toBe(false);
});

test('collections can deliver supporting assets without a single primary', () => {
  const { root, output } = fixture();
  const collection: OutputManifest = { ...output, kind: 'collection', primary: undefined, preview: undefined, assets: [{ ...output.primary!, role: 'supporting' }] };
  expect(isOutputUsable(root, collection)).toBe(true);
  const referencesOnly: OutputManifest = { ...collection, assets: [{ ...output.primary!, role: 'source' }] };
  expect(isOutputUsable(root, referencesOnly)).toBe(false);
  expect(isOutputUsable(root, { ...referencesOnly, links: [{ id: 'deliverable', label: 'Published work', url: 'https://example.com/work' }] })).toBe(true);
  expect(isOutputUsable(root, { ...referencesOnly, receipts: [{ id: 'receipt', provider: 'service', action: 'Result', status: 'pending', occurredAt: output.createdAt }] })).toBe(true);
  rmSync(join(getOutputDir(root, output.id), output.primary!.path));
  expect(isOutputUsable(root, collection)).toBe(false);
});

test('social sets count a usable ready variant, never an empty plan or an archived render', () => {
  const { root, output } = fixture();
  const socialVariantSet = { variants: [{ id: 'variant', state: 'ready', assetId: output.primary!.id }] } as OutputManifest['socialVariantSet'];
  const collection: OutputManifest = { ...output, primary: undefined, preview: undefined, assets: [{ ...output.primary!, role: 'supporting' }], socialVariantSet };
  expect(isOutputUsable(root, collection)).toBe(true);
  for (const state of ['planned', 'rendering', 'failed', 'archived'] as const) {
    collection.socialVariantSet!.variants[0]!.state = state;
    expect(isOutputUsable(root, collection)).toBe(false);
  }
  collection.socialVariantSet!.variants[0]!.state = 'ready';
  rmSync(join(getOutputDir(root, output.id), output.primary!.path));
  expect(isOutputUsable(root, collection)).toBe(false);
});
