import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySiteContentOperations,
  defaultSiteContent,
  defaultWebsiteManifest,
  loadWebsiteManifest,
  recordDeploy,
  saveSiteContent,
  loadSiteContent,
  saveWebsiteManifest,
  websiteExists,
} from './index.ts';
import type { DeployRecord, SiteContentOperation } from './index.ts';

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'website-storage-'));
}

describe('site content operations', () => {
  const base = defaultSiteContent('Vera Lane');

  test('adds a show and keeps shows in date order', () => {
    const ops: SiteContentOperation[] = [
      { op: 'upsert-show', value: { id: 's2', date: '2026-12-02', city: 'Chicago, IL', venue: 'Schubas' } },
      { op: 'upsert-show', value: { id: 's1', date: '2026-11-14', city: 'Minneapolis, MN', venue: '7th St Entry' } },
    ];
    const result = applySiteContentOperations(base, ops);
    expect(result.content.shows.map(show => show.id)).toEqual(['s1', 's2']);
    expect(result.applied).toBe(2);
    expect(result.changeClass).toBe('content-only');
    expect(result.changes[0]).toContain('Added show 2026-12-02');
  });

  test('upserting an existing id merges instead of duplicating', () => {
    const seeded = applySiteContentOperations(base, [
      { op: 'upsert-show', value: { id: 's1', date: '2026-11-14', city: 'Minneapolis, MN', venue: '7th St Entry' } },
    ]).content;
    const updated = applySiteContentOperations(seeded, [
      { op: 'upsert-show', value: { id: 's1', date: '2026-11-14', city: 'Minneapolis, MN', venue: 'First Ave', soldOut: true } },
    ]);
    expect(updated.content.shows).toHaveLength(1);
    expect(updated.content.shows[0]!.venue).toBe('First Ave');
    expect(updated.content.shows[0]!.soldOut).toBe(true);
    expect(updated.changes[0]).toContain('Updated show');
  });

  test('releases sort newest first', () => {
    const result = applySiteContentOperations(base, [
      { op: 'upsert-release', value: { id: 'old', title: 'Old', type: 'single', date: '2024-01-01', links: {} } },
      { op: 'upsert-release', value: { id: 'new', title: 'New', type: 'album', date: '2026-08-01', links: {} } },
    ]);
    expect(result.content.releases.map(release => release.id)).toEqual(['new', 'old']);
  });

  test('remove drops the entry from its collection', () => {
    const seeded = applySiteContentOperations(base, [
      { op: 'upsert-link', value: { id: 'l1', label: 'Instagram', url: 'https://instagram.com/x', kind: 'social' } },
    ]).content;
    const result = applySiteContentOperations(seeded, [{ op: 'remove', collection: 'links', id: 'l1' }]);
    expect(result.content.links).toHaveLength(0);
  });

  test('remove handles the nested signup form collection', () => {
    const result = applySiteContentOperations(base, [{ op: 'remove', collection: 'signupForms', id: 'newsletter' }]);
    expect(result.content.signup.forms).toHaveLength(0);
  });

  test('set-artist merges without dropping untouched fields', () => {
    const seeded = applySiteContentOperations(base, [
      { op: 'set-artist', value: { tagline: 'Songs from a cold room.' } },
    ]).content;
    expect(seeded.artist.name).toBe('Vera Lane');
    expect(seeded.artist.tagline).toBe('Songs from a cold room.');
  });

  test('does not mutate the input content', () => {
    const before = structuredClone(base);
    applySiteContentOperations(base, [
      { op: 'upsert-show', value: { id: 's1', date: '2026-11-14', city: 'Duluth, MN', venue: 'Sacred Heart' } },
    ]);
    expect(base).toEqual(before);
  });
});

describe('website manifest storage', () => {
  test('round-trips a manifest and reports existence', () => {
    const root = workspace();
    try {
      expect(websiteExists(root)).toBe(false);
      expect(loadWebsiteManifest(root)).toBeNull();
      saveWebsiteManifest(root, defaultWebsiteManifest());
      expect(websiteExists(root)).toBe(true);
      expect(loadWebsiteManifest(root)?.mode).toBe('managed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('round-trips site content', () => {
    const root = workspace();
    try {
      saveSiteContent(root, defaultSiteContent('Vera Lane'));
      expect(loadSiteContent(root)?.artist.name).toBe('Vera Lane');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('recording a deploy supersedes the previous live deploy for that target', () => {
    const root = workspace();
    try {
      const manifest = saveWebsiteManifest(root, defaultWebsiteManifest());
      const first: DeployRecord = {
        id: 'd1', target: 'production', at: new Date().toISOString(),
        url: 'https://a.example', buildHash: 'h1', origin: { kind: 'user' }, status: 'live',
      };
      const afterFirst = recordDeploy(root, manifest, first);
      expect(afterFirst.urls.production).toBe('https://a.example');

      const second: DeployRecord = { ...first, id: 'd2', url: 'https://b.example', buildHash: 'h2', previousDeployId: 'd1' };
      const afterSecond = recordDeploy(root, afterFirst, second);

      expect(afterSecond.history[0]!.id).toBe('d2');
      expect(afterSecond.history[0]!.status).toBe('live');
      expect(afterSecond.history[1]!.status).toBe('superseded');
      expect(afterSecond.urls.production).toBe('https://b.example');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a preview deploy does not supersede the live production deploy', () => {
    const root = workspace();
    try {
      const manifest = saveWebsiteManifest(root, defaultWebsiteManifest());
      const production = recordDeploy(root, manifest, {
        id: 'p1', target: 'production', at: new Date().toISOString(),
        url: 'https://live.example', buildHash: 'h1', origin: { kind: 'user' }, status: 'live',
      });
      const withPreview = recordDeploy(root, production, {
        id: 'v1', target: 'preview', at: new Date().toISOString(),
        url: 'https://preview.example', buildHash: 'h2', origin: { kind: 'agent' }, status: 'live',
      });
      expect(withPreview.history.find(entry => entry.id === 'p1')?.status).toBe('live');
      expect(withPreview.urls.production).toBe('https://live.example');
      expect(withPreview.urls.preview).toBe('https://preview.example');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
