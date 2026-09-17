import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAuthorizedContextDocsForAgent, upsertContextDoc, type ContextDocMetadata } from '@craft-agent/shared/workspace-context';
import { withScriptwriterArtistContext } from './scriptwriter-context';
import { writeBrandingState } from '@craft-agent/shared/artist-context/branding-state-storage';
import { selectContextDocsForAgentLaunch } from '../agent-launch/context';
import { filterContextDocsForTaskMode, type ResolvedAgentTaskMode } from '@craft-agent/shared/agent-definitions';
import * as config from '@craft-agent/shared/config';
import { getAuthorizedWorkspaceContext, listAuthorizedWorkspaceContext } from './manager-tools';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'scriptwriter-context-')); roots.push(root);
  const hq = join(root, 'hq'), campaign = join(root, 'campaign');
  const workspaces = [{ rootPath: hq, artistWorkspaceScope: 'hq' }, { rootPath: campaign, artistWorkspaceScope: 'campaign' }];
  const write = (path: string, slug: string, body: string, metadata: Partial<ContextDocMetadata> = {}) => upsertContextDoc(path, {
    slug, body, metadata: { name: slug, enabled: true, routing: { mode: 'broadcast' }, ...metadata },
  });
  const read = (agent = 'scriptwriter', path = campaign) => withScriptwriterArtistContext(path, agent, loadAuthorizedContextDocsForAgent(path, agent), workspaces);
  return { hq, campaign, workspaces, write, read };
}
describe('Scriptwriter HQ identity', () => {
  for (const agent of ['branding-agent', 'world-builder']) {
    test(`${agent} reads current HQ identity alongside local campaign direction without copying it`, () => {
      const f = setup();
      f.write(f.hq, 'artist-branding', 'approved artist stance');
      f.write(f.campaign, 'artist-branding', 'stale campaign copy');
      f.write(f.campaign, 'campaign-creative-direction', 'Proposed release idea; awaiting artist choice');
      expect(f.read(agent).map(d => [d.slug, d.body, d.workspaceRootPath])).toEqual([
        ['artist-branding', 'approved artist stance', f.hq],
        ['campaign-creative-direction', 'Proposed release idea; awaiting artist choice', f.campaign],
      ]);
      expect(loadAuthorizedContextDocsForAgent(f.campaign, agent).find(d => d.slug === 'artist-branding')!.body).toBe('stale campaign copy');
      expect(loadAuthorizedContextDocsForAgent(f.hq, agent).some(d => d.slug === 'campaign-creative-direction')).toBe(false);
    });
    test(`${agent} respects disabled/private routing and ambiguous HQ without stale fallback`, () => {
      const f = setup();
      for (const slug of ['artist-branding', 'artist-profile', 'artist-voice']) f.write(f.campaign, slug, 'stale');
      f.write(f.hq, 'artist-branding', 'disabled', { enabled: false });
      f.write(f.hq, 'artist-profile', 'private', { private: true, routing: { mode: 'targeted', agents: ['writer'] } });
      f.write(f.hq, 'artist-voice', 'other audience', { routing: { mode: 'targeted', agents: ['writer'] } });
      expect(f.read(agent)).toEqual([]);
      const local = loadAuthorizedContextDocsForAgent(f.campaign, agent);
      expect(withScriptwriterArtistContext(f.campaign, agent, local, [f.workspaces[1]!])).toEqual([]);
      expect(withScriptwriterArtistContext(f.campaign, agent, local, [...f.workspaces, { rootPath: '/another', artistWorkspaceScope: 'hq' }])).toEqual([]);
    });
  }
  test('replaces stale campaign identity, keeps campaign brief and original HQ provenance', () => {
    const f = setup();
    f.write(f.campaign, 'artist-branding', 'stale'); f.write(f.hq, 'artist-branding', 'approved world');
    f.write(f.campaign, 'mission-brief', 'current release'); f.write(f.hq, 'private-finances', 'not identity');
    expect(f.read().map(d => [d.slug, d.body, d.workspaceRootPath])).toEqual([
      ['artist-branding', 'approved world', f.hq], ['mission-brief', 'current release', f.campaign],
    ]);
    f.write(f.hq, 'artist-branding', 'new approved world');
    expect(f.read()[0]!.body).toBe('new approved world');
  });
  test('disabled and targeted HQ identity never leaks via campaign copies', () => {
    const f = setup();
    for (const slug of ['artist-branding', 'artist-profile', 'artist-voice']) f.write(f.campaign, slug, 'stale secret');
    f.write(f.hq, 'artist-branding', 'disabled', { enabled: false });
    f.write(f.hq, 'artist-profile', 'private', { private: true, routing: { mode: 'targeted', agents: ['branding-agent'] } });
    f.write(f.hq, 'artist-voice', 'custom audience', { routing: { mode: 'targeted', agents: ['writer'] } });
    expect(f.read()).toEqual([]);
  });
  test('uses HQ Branding for every agent and refuses ambiguous artist identity', () => {
    const f = setup(); f.write(f.campaign, 'artist-branding', 'local'); f.write(f.hq, 'artist-branding', 'global');
    expect(f.read('writer')[0]!.body).toBe('global'); expect(f.read('scriptwriter', f.hq)[0]!.body).toBe('global');
    const local = loadAuthorizedContextDocsForAgent(f.campaign, 'scriptwriter');
    expect(withScriptwriterArtistContext(f.campaign, 'scriptwriter', local, [f.workspaces[1]!])).toEqual([]);
    expect(withScriptwriterArtistContext(f.campaign, 'scriptwriter', local, [...f.workspaces, { rootPath: '/another', artistWorkspaceScope: 'hq' }])).toEqual([]);
  });
  test('inherits public artist context from HQ for every campaign agent', () => {
    const f = setup();
    f.write(f.campaign, 'artist-public-context', 'stale campaign copy');
    f.write(f.hq, 'artist-public-context', 'current links and notes', { delivery: 'always' });
    expect(f.read('writer').map(d => [d.slug, d.body, d.workspaceRootPath])).toEqual([
      ['artist-public-context', 'current links and notes', f.hq],
    ]);
  });
});

describe('Approved Branding supporting context', () => {
  test('reads active HQ attachments on demand, excludes proposals, refreshes removal, and preserves core authority', () => {
    const f = setup(); f.write(f.hq, 'artist-branding', 'Approved core identity');
    const old = { id: 'older', title: 'Earlier insight', body: 'older full body', createdAt: '2026-09-01T00:00:00Z' };
    const recent = { id: 'newer', title: 'Recent insight', body: 'newer full body', createdAt: '2026-09-16T00:00:00Z' };
    writeBrandingState(f.hq, { revision: '1', history: [], attachments: [old, recent], proposals: [{ id: 'proposal', title: 'Pending', createdAt: recent.createdAt, patches: [], additions: [{ ...recent, id: 'pending', body: 'unapproved secret' }], status: 'pending' }] });
    const docs = f.read();
    expect(docs.map(d => d.slug)).toEqual(['artist-branding', 'branding-support-index', 'branding-support-newer', 'branding-support-older']);
    expect(docs.every(d => d.workspaceRootPath === f.hq)).toBe(true);
    expect(JSON.stringify(docs)).not.toContain('unapproved secret');
    expect(docs[1]!.body).toContain('relevance to the current task, then favor newer');
    expect(docs[1]!.body).toContain('does not silently replace core DNA');
    expect(selectContextDocsForAgentLaunch(f.read('branding-agent'), 'branding-agent').map(d => d.slug)).toEqual(['artist-branding', 'branding-support-index']);
    // Any agent authorized for core Branding can retrieve supporting text, even
    // when that agent does not receive Branding automatically in its prompt.
    expect(f.read('writer').some(d => d.slug === 'branding-support-newer')).toBe(true);
    writeBrandingState(f.hq, { revision: '2', history: [], attachments: [old], proposals: [] });
    expect(f.read().some(d => d.slug === 'branding-support-newer')).toBe(false);
    expect(f.read()[1]!.body).not.toContain('Recent insight');
    const configured = spyOn(config, 'getWorkspaces').mockReturnValue(f.workspaces as ReturnType<typeof config.getWorkspaces>);
    try {
      expect(getAuthorizedWorkspaceContext(f.campaign, 'branding-agent', { slug: 'branding-support-older' }).ok).toBe(true);
      writeBrandingState(f.hq, { revision: '3', history: [], attachments: [], proposals: [] });
      expect(getAuthorizedWorkspaceContext(f.campaign, 'branding-agent', { slug: 'branding-support-older' }).ok).toBe(false);
      expect(JSON.stringify(listAuthorizedWorkspaceContext(f.campaign, 'branding-agent', { query: 'branding-support-' }))).not.toContain('branding-support-older');
      expect(f.read()[1]!.body).toContain('No active supporting attachments');
      expect(f.read()[1]!.path).toBe('context://branding-support-index');
    } finally { configured.mockRestore(); }
  });
  test('disabled or restricted core gates all attachments, including stale campaign files', () => {
    const f = setup();
    writeBrandingState(f.hq, { revision: '1', history: [], proposals: [], attachments: [{ id: 'secret', title: 'Secret', body: 'secret text', createdAt: '2026-09-16' }] });
    f.write(f.campaign, 'branding-support-secret', 'stale copy');
    for (const metadata of [{ enabled: false }, { private: true, routing: { mode: 'targeted' as const, agents: ['branding-agent'] } }]) {
      f.write(f.hq, 'artist-branding', 'restricted', metadata);
      expect(f.read('scriptwriter')).toEqual([]);
    }
  });
  test('HQ receives a bounded recent index with large attachments only on demand; focused recipes keep index', () => {
    const f = setup(); f.write(f.hq, 'artist-branding', 'Approved core');
    writeBrandingState(f.hq, { revision: '1', history: [], proposals: [], attachments: Array.from({ length: 30 }, (_, i) => ({ id: `doc-${i}`, title: 'A'.repeat(200), body: 'FULL_BODY'.repeat(1_000), createdAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z` })) });
    const docs = f.read('branding-agent', f.hq);
    const mode = { context: { preloadTopics: ['artist-branding'] } } as ResolvedAgentTaskMode;
    const selected = selectContextDocsForAgentLaunch(docs, 'branding-agent', mode);
    expect(selected.map(d => d.slug)).toEqual(['artist-branding', 'branding-support-index']);
    expect(filterContextDocsForTaskMode(selected, mode, 'branding-agent')).toEqual(selected);
    expect(selected[1]!.body.length).toBeLessThan(4_000);
    expect(selected[1]!.body).not.toContain('FULL_BODY');
    expect(docs.filter(d => d.slug.startsWith('branding-support-doc')).length).toBe(30);
  });
  test('damaged attachment state replaces old attachments with a visible unavailable notice', () => {
    const f = setup(); f.write(f.hq, 'artist-branding', 'Approved core');
    writeBrandingState(f.hq, { revision: '1', history: [], proposals: [], attachments: [] });
    writeFileSync(join(f.hq, 'branding', 'state.json'), '{broken');
    const docs = f.read('branding-agent');
    expect(docs.map(d => d.slug)).toEqual(['artist-branding', 'branding-support-index']);
    expect(docs[1]!.body).toContain('Supporting context unavailable');
    expect(docs[1]!.body).toContain('Do not reuse previous Branding attachments');
  });
});
