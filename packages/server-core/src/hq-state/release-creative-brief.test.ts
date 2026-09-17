import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getContextDocFile, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { RELEASE_CREATIVE_BRIEF_SLUG as slug, saveReleaseCreativeBrief } from './release-creative-brief';

const roots: string[] = [];
const actor = { agentSlug: 'branding-agent', workspaceScope: 'campaign' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-direction-'));
  roots.push(root);
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: root, name: 'Campaign', slug: 'campaign', createdAt: 1, updatedAt: 1 }));
  return root;
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

test('saves a proposed campaign brief and preserves unrelated identity', async () => {
  const root = fixture();
  upsertContextDoc(root, { slug: 'artist-branding', metadata: { name: 'Artist Direction', enabled: true, routing: { mode: 'broadcast' } }, body: 'Existing identity' });
  const result = await saveReleaseCreativeBrief(root, { body: 'An intimate performance for people starting over.', status: 'proposed', expectedBody: null }, actor);
  expect(result.saved).toBe(true);
  expect(result.status).toBe('proposed');
  const doc = loadContextDoc(root, slug)!;
  expect(doc.metadata.name).toBe('Release Creative Direction');
  expect(doc.body).toBe(result.body);
  expect(doc.body).toStartWith('Direction status: proposed');
  expect(loadContextDoc(root, 'artist-branding')!.body).toBe('Existing identity');
});

test('updates with exact body, explicit acceptance and preserved routing', async () => {
  const root = fixture();
  const metadata = { name: 'My release direction', enabled: true, private: true, routing: { mode: 'targeted' as const, agents: ['branding-agent', 'world-builder'] } };
  upsertContextDoc(root, { slug, metadata, body: 'Original proposal' });
  const saved = await saveReleaseCreativeBrief(root, { body: 'Direction status: proposed\n\nThe direction the artist chose.', status: 'accepted', expectedBody: 'Original proposal' }, actor);
  expect(saved.body).toBe('Direction status: accepted\n\nThe direction the artist chose.');
  expect(loadContextDoc(root, slug)!.metadata).toEqual(metadata);
});

test('concurrent writes cannot overwrite one another and null cannot replace existing work', async () => {
  const root = fixture();
  const results = await Promise.allSettled(['First', 'Second'].map(body => saveReleaseCreativeBrief(root, { body, status: 'proposed', expectedBody: null }, actor)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const before = loadContextDoc(root, slug)!.body;
  await expect(saveReleaseCreativeBrief(root, { body: 'Overwrite', status: 'accepted', expectedBody: null }, actor)).rejects.toThrow('CONTEXT_DOC_CONFLICT');
  expect(loadContextDoc(root, slug)!.body).toBe(before);
});

test('rejects HQ, unknown scope and other agents without creating a brief', async () => {
  const root = fixture();
  for (const invalid of [{ ...actor, workspaceScope: 'hq' }, { ...actor, workspaceScope: undefined }, { ...actor, agentSlug: 'world-builder' }, { ...actor, agentSlug: null }]) {
    await expect(saveReleaseCreativeBrief(root, { body: 'No', status: 'proposed', expectedBody: null }, invalid)).rejects.toThrow('Only Creative Direction');
  }
  expect(loadContextDoc(root, slug)).toBeNull();
});

test('does not overwrite disabled, unauthorized or malformed saved briefs', async () => {
  const root = fixture();
  for (const metadata of [
    { name: 'Disabled', enabled: false, routing: { mode: 'broadcast' as const } },
    { name: 'Private', enabled: true, private: true, routing: { mode: 'targeted' as const, agents: ['world-builder'] } },
  ]) {
    upsertContextDoc(root, { slug, metadata, body: 'Keep this' });
    await expect(saveReleaseCreativeBrief(root, { body: 'Replacement', status: 'proposed', expectedBody: 'Keep this' }, actor)).rejects.toThrow('not available');
    expect(loadContextDoc(root, slug)!.body).toBe('Keep this');
  }
  const file = getContextDocFile(root, slug);
  writeFileSync(file, 'not valid context frontmatter');
  await expect(saveReleaseCreativeBrief(root, { body: 'Replacement', status: 'proposed', expectedBody: null }, actor)).rejects.toThrow('read safely');
  expect(readFileSync(file, 'utf8')).toBe('not valid context frontmatter');
});

test('validates strict arguments and requires normal workspace write permission', async () => {
  const root = fixture();
  await expect(saveReleaseCreativeBrief(root, { body: 'x'.repeat(11001), status: 'proposed', expectedBody: null }, actor)).rejects.toThrow();
  rmSync(join(root, 'config.json'));
  await expect(saveReleaseCreativeBrief(root, { body: 'No', status: 'proposed', expectedBody: null }, actor)).rejects.toThrow('workspace config');
  expect(loadContextDoc(root, slug)).toBeNull();
});

test('shared-workspace permission denial cannot create a brief', async () => {
  const root = fixture();
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  config.storage = { mode: 'shared-folder', portabilityVersion: 1, provider: 'generic-folder', sharedRootId: root, enabledAt: new Date().toISOString(), vaultPolicy: 'copy-into-workspace', pathPolicy: 'relative-required' };
  config.team = { enabled: true, teamId: root, revision: 1, automationsPolicy: 'runner-only', backgroundTriggersEnabled: true, runnerMissedTickPolicy: 'run-once', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  await expect(saveReleaseCreativeBrief(root, { body: 'No', status: 'proposed', expectedBody: null }, actor)).rejects.toThrow('Team permission denied');
  expect(loadContextDoc(root, slug)).toBeNull();
});
