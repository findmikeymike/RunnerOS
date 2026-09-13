import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContextDoc } from '../workspace-context/index.ts';
import {
  ARTIST_CAREER_RESEARCH_CONTEXT_SLUG,
  buildCareerResearchView,
  normalizeCareerResearchSeeds,
  normalizeSpotifyArtistProfile,
  rebuildCareerResearchProjection,
  writeCareerResearchRecord,
  type CareerResearchRecordData,
} from './career-research.ts';

const roots: string[] = [];
const spotifyId = '1234567890123456789012';
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'career-research-'));
  roots.push(value);
  process.env.CRAFT_CONFIG_DIR = join(value, 'private');
  return value;
}

function data(): CareerResearchRecordData {
  return {
    version: 1,
    hqWorkspaceId: 'hq-1',
    deliveryPolicy: { enabled: true, routing: { mode: 'broadcast' }, delivery: 'on-demand' },
    identity: { key: 'identity-1', generation: 1, artistName: 'Artist', spotifyArtistId: spotifyId, supportingUrls: [] },
    findings: [{
      id: 'finding-1', claimKey: 'claim-1', category: 'achievement', subjectKey: 'award-2025', predicate: 'achieved',
      text: 'Won an independent music award.', attribution: 'documented', state: 'historical',
      evidence: [{ receiptId: 'receipt-1', url: 'https://example.com/story', title: 'Award story', retrievedAt: '2026-09-13T00:00:00.000Z', support: 'The artist won.' }],
      firstSeenAt: '2026-09-13T00:00:00.000Z', lastVerifiedAt: '2026-09-13T00:00:00.000Z',
    }],
    overrides: [],
  };
}

afterEach(() => {
  roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true }));
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
});

describe('career research context', () => {
  test('normalizes public seeds and rejects non-artist Spotify URLs', () => {
    expect(normalizeSpotifyArtistProfile(spotifyId)).toEqual({ artistId: spotifyId, url: `https://open.spotify.com/artist/${spotifyId}` });
    expect(normalizeCareerResearchSeeds({ officialUrl: 'artist.example/about', supportingUrls: ['http://press.example/story'] })).toEqual({
      artistName: undefined,
      spotifyProfile: undefined,
      officialUrl: 'https://artist.example/about',
      supportingUrls: ['https://press.example/story'],
    });
    expect(() => normalizeSpotifyArtistProfile(`https://open.spotify.com/track/${spotifyId}`)).toThrow('Spotify artist URL');
    expect(() => normalizeCareerResearchSeeds({ officialUrl: 'http://127.0.0.1/private' })).toThrow('public internet');
    expect(normalizeCareerResearchSeeds({ officialUrl: 'https://feature.fm/story?p=123&utm_source=test' }).officialUrl).toBe('https://feature.fm/story?p=123');
    expect(normalizeCareerResearchSeeds({ officialUrl: 'https://press.example/story?p=456' }).officialUrl).toBe('https://press.example/story?p=456');
    expect(() => normalizeCareerResearchSeeds({ officialUrl: 'https://[fd00::1]/private' })).toThrow('public internet');
    expect(() => normalizeCareerResearchSeeds({ officialUrl: 'https://[::ffff:7f00:1]/private' })).toThrow('public internet');
    expect(() => normalizeCareerResearchSeeds({ officialUrl: 'https://100.64.0.1/private' })).toThrow('public internet');
    expect(() => normalizeCareerResearchSeeds({ officialUrl: 'https://240.0.0.1/private' })).toThrow('public internet');
    expect(normalizeCareerResearchSeeds({ officialUrl: 'https://[2606:4700:4700::1111]/story' }).officialUrl).toBe('https://[2606:4700:4700::1111]/story');
    expect(normalizeCareerResearchSeeds({ officialUrl: 'https://press.example/story?p=123&token=secret&X-Amz-Signature=sig' }).officialUrl).toBe('https://press.example/story?p=123');
  });

  test('applies correction/removal overlays and rebuilds the managed projection', () => {
    const workspace = root();
    const first = writeCareerResearchRecord(workspace, data(), { machineId: 'machine-a' });
    if (first.status !== 'written') throw new Error('fixture write failed');
    const corrected = { ...first.entity, overrides: [{ claimKey: 'claim-1', kind: 'corrected' as const, text: 'Won the 2025 independent music award.', revision: 1, actorId: 'machine-a', at: '2026-09-13T01:00:00.000Z' }] };
    const second = writeCareerResearchRecord(workspace, corrected, { machineId: 'machine-a', baseline: first.baseline });
    if (second.status !== 'written') throw new Error('fixture correction failed');
    expect(buildCareerResearchView(second.entity).findings[0]).toMatchObject({ text: 'Won the 2025 independent music award.', correctedByUser: true });
    rebuildCareerResearchProjection(workspace);
    const projected = loadContextDoc(workspace, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG);
    expect(projected?.body).toContain('Corrected by artist');
    expect(projected?.body).toContain('Current performance metrics come from the existing Growth/Pulse context');
  });
});
