import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import {
  getArtistContextDetail,
  getAuthorizedWorkspaceContext,
  getLiveManagerBrief,
  listAuthorizedWorkspaceContext,
} from './manager-tools.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Manager context retrieval', () => {
  test('builds a live bounded brief without mutating persisted context', () => {
    const root = workspace();
    write(root, 'artist-profile', jsonBody({
      version: 1,
      artistName: 'Mikey Mike',
      sound: 'raw soul over strange pop',
      audience: 'cinematic underdog listeners',
      updatedAt: '2026-08-29T00:00:00.000Z',
    }));
    expect(loadContextDoc(root, 'hq-state-of-play')).toBeNull();

    const result = getLiveManagerBrief(root, {});

    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(12_000);
    expect(loadContextDoc(root, 'hq-state-of-play')).toBeNull();
  });

  test('generic reads list and return only documents authorized for that agent', () => {
    const root = workspace();
    write(root, 'broadcast', 'Visible to everyone.');
    write(root, 'worker-only', 'Visible to worker.', {
      routing: { mode: 'targeted', agents: ['worker'] },
    });
    write(root, 'manager-private', 'Manager secret.', {
      routing: { mode: 'targeted', agents: ['concierge'] },
      private: true,
    });

    const listed = listAuthorizedWorkspaceContext(root, 'worker', {});
    expect(listed.ok).toBe(true);
    expect(JSON.stringify(listed)).toContain('worker-only');
    expect(JSON.stringify(listed)).not.toContain('manager-private');
    expect(getAuthorizedWorkspaceContext(root, 'worker', { slug: 'manager-private' }).ok).toBe(false);
    expect(getAuthorizedWorkspaceContext(root, 'concierge', { slug: 'manager-private' }).ok).toBe(true);
  });

  test('full context reads truncate to the requested hard-bounded size', () => {
    const root = workspace();
    write(root, 'long-note', 'x'.repeat(20_000));

    const result = getAuthorizedWorkspaceContext(root, null, { slug: 'long-note', maxChars: 40 });
    const document = result.document as { body: string; truncated: boolean };
    expect(result.ok).toBe(true);
    expect(document.body).toHaveLength(40);
    expect(document.truncated).toBe(true);
  });

  test('semantic artist lookup normalizes results and never exposes filesystem paths', () => {
    const root = workspace();
    write(root, 'artist-profile', jsonBody({
      version: 1,
      artistName: 'Mikey Mike',
      sound: 'raw soul',
      updatedAt: '2026-08-29T00:00:00.000Z',
    }));

    const result = getArtistContextDetail(root, 'concierge', { topic: 'profile' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('Mikey Mike');
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'artist-manager-tools-'));
  roots.push(root);
  return root;
}

function write(
  root: string,
  slug: string,
  body: string,
  metadata: Partial<{
    routing: { mode: 'broadcast' } | { mode: 'targeted'; agents: string[] };
    private: boolean;
  }> = {},
): void {
  upsertContextDoc(root, {
    slug,
    metadata: {
      name: slug,
      routing: metadata.routing ?? { mode: 'broadcast' },
      enabled: true,
      delivery: 'on-demand',
      private: metadata.private ?? false,
    },
    body,
  });
}

function jsonBody(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
