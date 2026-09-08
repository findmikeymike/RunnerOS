import { expect, test } from 'bun:test';
import { ARTIST_VOICE_TARGET_AGENT_SLUGS, artistVoiceDoc } from '../artist-context/voice';
import { upgradeDefaultArtistVoiceRouting } from './storage';

test('standard persisted Artist Voice audience gains Scriptwriter without changing its body or source', () => {
  const metadata = artistVoiceDoc.metadata();
  metadata.routing = { mode: 'targeted', agents: ARTIST_VOICE_TARGET_AGENT_SLUGS.filter(a => a !== 'scriptwriter') };
  expect(upgradeDefaultArtistVoiceRouting('artist-voice', metadata).routing).toEqual(artistVoiceDoc.metadata().routing);
  expect(metadata.routing.agents).not.toContain('scriptwriter');
  for (const changed of [
    { ...metadata, enabled: false }, { ...metadata, private: true },
    { ...metadata, routing: { mode: 'targeted' as const, agents: ['writer'] } },
    { ...metadata, name: 'Private voice notes' },
  ]) expect(upgradeDefaultArtistVoiceRouting('artist-voice', changed)).toBe(changed);
  expect(upgradeDefaultArtistVoiceRouting('other-voice', metadata)).toBe(metadata);
});


test('loading a persisted default Voice doc upgrades its audience without rewriting the file', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { upsertContextDoc, loadAuthorizedContextDocsForAgent, getContextDocFile } = await import('./storage');
  const root = mkdtempSync(join(tmpdir(), 'voice-routing-'));
  try {
    const metadata = artistVoiceDoc.metadata();
    metadata.routing = { mode: 'targeted', agents: ARTIST_VOICE_TARGET_AGENT_SLUGS.filter(a => a !== 'scriptwriter') };
    upsertContextDoc(root, { slug: 'artist-voice', body: 'Approved voice', metadata });
    const path = getContextDocFile(root, 'artist-voice');
    const before = readFileSync(path, 'utf8');
    const docs = loadAuthorizedContextDocsForAgent(root, 'scriptwriter');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.body).toBe('Approved voice');
    expect(readFileSync(path, 'utf8')).toBe(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
