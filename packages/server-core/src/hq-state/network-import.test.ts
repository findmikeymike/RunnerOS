import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artistNetworkMetadata, createNetworkPerson, emptyArtistNetwork } from '@craft-agent/shared/artist-context';
import { getContextDocFile, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { importArtistNetwork as importNetwork } from './network-import.ts';
import type { ImportArtistNetworkInput } from '@craft-agent/session-tools-core';
const importArtistNetwork = (root: string, input: ImportArtistNetworkInput) => importNetwork(root, input, 'setup-concierge');
const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'network-import-')); roots.push(root); writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'test-network', name: 'Network Test', slug: 'network-test', createdAt: 1, updatedAt: 1 })); return root; };
const file = (root: string) => getContextDocFile(root, 'artist-network');
const saved = (root: string) => JSON.parse(loadContextDoc(root, 'artist-network')!.body.match(/```json\s*([\s\S]*?)```/)![1]!);
function seed(root: string, people: unknown[]) {
  const network = { ...emptyArtistNetwork(), people };
  upsertContextDoc(root, { slug: 'artist-network', metadata: { ...artistNetworkMetadata(), private: true, enabled: true, routing: { mode: 'targeted', agents: ['setup-concierge'] } }, body: `My important prose\n\n\`\`\`json\n${JSON.stringify(network, null, 2)}\n\`\`\`\nKeep this too.` });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('Artist Network import', () => {
  test('adds only local people, preserves notes and returns concise receipts', async () => {
    const root = fixture();
    const receipt = await importArtistNetwork(root, { people: [{ name: 'Jane Doe', email: 'Jane@Example.com', notes: 'Met at SXSW.\nFollow up in May.', tags: ['press, music'] }] });
    expect(receipt.counts).toEqual({ added: 1, existing: 0, needsClarification: 0 });
    const person = saved(root).people[0];
    expect(person.notes).toBe('Met at SXSW.\nFollow up in May.');
    expect(person.tags).toEqual(['press, music']);
    expect(person.google).toBeUndefined();
    expect(person.workspaceLinks).toEqual([]);
    expect(receipt).not.toHaveProperty('people');
  });
  test('deduplicates normalized names/emails within the batch and on retries without rewriting', async () => {
    const root = fixture();
    const first = await importArtistNetwork(root, { people: [{ name: 'Jane Doe', email: 'Jane@Example.com' }, { name: ' jane   doe ', email: 'jane@example.com' }] });
    expect(first.counts).toEqual({ added: 1, existing: 1, needsClarification: 0 });
    const before = readFileSync(file(root), 'utf8');
    const retry = await importArtistNetwork(root, { people: [{ name: 'JANE DOE', email: 'JANE@EXAMPLE.COM', notes: 'new information' }] });
    expect(retry.existing[0]?.reason).toContain('differing details');
    expect(readFileSync(file(root), 'utf8')).toBe(before);
  });
  test('does not guess aliases, overwrite conflicting emails, or choose multiple candidates', async () => {
    const root = fixture();
    seed(root, [createNetworkPerson({ name: 'Jane Doe', email: 'jane@example.com', category: 'press' }), createNetworkPerson({ name: 'Alex', category: 'other' }), createNetworkPerson({ name: 'Alex', email: 'alex@example.com', category: 'other' })]);
    const before = readFileSync(file(root), 'utf8');
    const result = await importArtistNetwork(root, { people: [{ name: 'Janey Doe', email: 'jane@example.com' }, { name: 'Jane Doe', email: 'other@example.com' }, { name: 'Alex' }] });
    expect(result.counts).toEqual({ added: 0, existing: 0, needsClarification: 3 });
    expect(readFileSync(file(root), 'utf8')).toBe(before);
  });
  test('holds every conflicting input rather than letting batch order choose an identity', async () => {
    const root = fixture();
    const result = await importArtistNetwork(root, { people: [{ name: 'One', email: 'same@example.com' }, { name: 'Two', email: 'SAME@example.com' }, { name: 'Same Name', email: 'first@example.com' }, { name: 'Same Name', email: 'second@example.com' }] });
    expect(result.counts).toEqual({ added: 0, existing: 0, needsClarification: 4 });
    expect(loadContextDoc(root, 'artist-network')).toBeNull();
  });
  test('supports explicitly confirmed same-name people with distinct known emails and retries safely', async () => {
    const root = fixture();
    seed(root, [createNetworkPerson({ name: 'Alex Doe', email: 'first@example.com', category: 'other' })]);
    const input = { people: [{ name: 'Alex Doe', email: 'second@example.com', distinctPersonConfirmed: true }] };
    expect((await importArtistNetwork(root, input)).counts.added).toBe(1);
    expect((await importArtistNetwork(root, input)).counts.existing).toBe(1);
    expect((await importArtistNetwork(root, { people: [{ name: 'Alex Doe', email: 'first@example.com' }] })).counts.existing).toBe(1);
    expect(saved(root).people).toHaveLength(2);
  });
  test('distinct confirmation cannot bypass unknown emails or conflicting email identities', async () => {
    const root = fixture();
    seed(root, [createNetworkPerson({ name: 'Alex Doe', category: 'other' }), createNetworkPerson({ name: 'Other Person', email: 'other@example.com', category: 'other' })]);
    const before = readFileSync(file(root), 'utf8');
    const result = await importArtistNetwork(root, { people: [{ name: 'Alex Doe', email: 'new@example.com', distinctPersonConfirmed: true }, { name: 'Alex Doe', email: 'other@example.com', distinctPersonConfirmed: true }] });
    expect(result.counts.needsClarification).toBe(2);
    expect(readFileSync(file(root), 'utf8')).toBe(before);
  });
  test('preserves existing rows, document metadata, and prose when appending', async () => {
    const root = fixture();
    const person = { ...createNetworkPerson({ name: '  Original  ', category: 'custom', notes: 'Unchanged' }), extraCustomProperty: { hello: 'world' } };
    seed(root, [person]);
    const before = loadContextDoc(root, 'artist-network')!;
    await importArtistNetwork(root, { people: [{ name: 'New Person' }] });
    const after = loadContextDoc(root, 'artist-network')!;
    expect(after.metadata).toEqual(before.metadata);
    expect(saved(root).people[0]).toEqual(person);
    expect(after.body).toStartWith('My important prose');
    expect(after.body).toEndWith('Keep this too.');
  });
  test('makes newly imported contacts visible when only custom categories exist', async () => {
    const root = fixture();
    seed(root, []);
    const doc = loadContextDoc(root, 'artist-network')!;
    const network = saved(root);
    network.categories = [{ id: 'custom', label: 'My Friends' }];
    upsertContextDoc(root, { slug: 'artist-network', metadata: doc.metadata, body: `\`\`\`json\n${JSON.stringify(network)}\n\`\`\`` });
    await importArtistNetwork(root, { people: [{ name: 'A Person' }] });
    expect(saved(root).categories).toEqual([{ id: 'custom', label: 'My Friends' }, { id: 'other', label: 'Other' }]);
    expect(saved(root).people[0].category).toBe('other');
  });
  test('serializes simultaneous imports to avoid lost additions and duplicates', async () => {
    const root = fixture();
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => importArtistNetwork(root, { people: [{ name: 'Shared Person', email: 'shared@example.com' }, { name: `Person ${index}` }] })));
    expect(saved(root).people).toHaveLength(13);
    expect(results.reduce((sum, result) => sum + result.counts.added, 0)).toBe(13);
  });
  test('fails closed on malformed existing JSON or frontmatter, never replacing the file', async () => {
    const root = fixture();
    seed(root, []);
    for (const raw of ['---\nname: [invalid\n---\n{}', '---\nname: Artist Network\n---\n```json\n{broken}\n```', '---\nname: Artist Network\n---\n']) {
      writeFileSync(file(root), raw);
      await expect(importArtistNetwork(root, { people: [{ name: 'New Person' }] })).rejects.toThrow();
      expect(readFileSync(file(root), 'utf8')).toBe(raw);
    }
  });
  test('fails closed on malformed person rows instead of filtering and erasing them', async () => {
    const root = fixture();
    for (const invalid of [null, { name: 'No id', category: 'other', tags: [] }, { ...createNetworkPerson({ name: 'Bad Email', category: 'other' }), email: 'invalid' }, { ...createNetworkPerson({ name: 'Bad Tags', category: 'other' }), tags: [42] }, { ...createNetworkPerson({ name: 'Bad Links', category: 'other' }), workspaceLinks: [null] }, { ...createNetworkPerson({ name: 'Bad State', category: 'other' }), google: { etag: 4 } }]) {
      seed(root, [invalid]);
      const before = readFileSync(file(root), 'utf8');
      await expect(importArtistNetwork(root, { people: [{ name: 'New Person' }] })).rejects.toThrow();
      expect(readFileSync(file(root), 'utf8')).toBe(before);
    }
  });
  test('enforces disabled and private routing inside the import lock', async () => {
    const root = fixture();
    seed(root, []);
    const before = readFileSync(file(root), 'utf8');
    await expect(importNetwork(root, { people: [{ name: 'New Person' }] }, 'another-agent')).rejects.toThrow('unavailable');
    expect(readFileSync(file(root), 'utf8')).toBe(before);
    const doc = loadContextDoc(root, 'artist-network')!;
    upsertContextDoc(root, { slug: 'artist-network', metadata: { ...doc.metadata, enabled: false }, body: doc.body });
    const disabled = readFileSync(file(root), 'utf8');
    await expect(importArtistNetwork(root, { people: [{ name: 'New Person' }] })).rejects.toThrow('disabled');
    expect(readFileSync(file(root), 'utf8')).toBe(disabled);
  });
  test('rejects invalid input before changing any network', async () => {
    const root = fixture();
    for (const people of [[{ name: 'Bad', email: 'not email' }], [{ name: '' }], Array.from({ length: 101 }, () => ({ name: 'Person' }))]) {
      await expect(importArtistNetwork(root, { people })).rejects.toThrow('Invalid Network import');
    }
    expect(loadContextDoc(root, 'artist-network')).toBeNull();
  });
});
