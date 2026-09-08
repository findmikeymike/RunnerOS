import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAuthorizedContextDocsForAgent, upsertContextDoc, type ContextDocMetadata } from '@craft-agent/shared/workspace-context';
import { withScriptwriterArtistContext } from './scriptwriter-context';

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
  test('does not change other agents or HQ and refuses ambiguous artist identity', () => {
    const f = setup(); f.write(f.campaign, 'artist-branding', 'local'); f.write(f.hq, 'artist-branding', 'global');
    expect(f.read('writer')[0]!.body).toBe('local'); expect(f.read('scriptwriter', f.hq)[0]!.body).toBe('global');
    const local = loadAuthorizedContextDocsForAgent(f.campaign, 'scriptwriter');
    expect(withScriptwriterArtistContext(f.campaign, 'scriptwriter', local, [f.workspaces[1]!])).toEqual([]);
    expect(withScriptwriterArtistContext(f.campaign, 'scriptwriter', local, [...f.workspaces, { rootPath: '/another', artistWorkspaceScope: 'hq' }])).toEqual([]);
  });
});
