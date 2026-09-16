import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from './context.ts';
import { buildSessionResultLink, sessionResultLinkText } from './result-links.ts';
const context = (id: unknown = 'actual-workspace-id') => ({ workspaceId: id }) as Pick<SessionToolContext, 'workspaceId'>;
describe('session result deep links', () => {
  test('Artist OS uses host workspace identity and valid entity routes', () => {
    expect(buildSessionResultLink(context(), 'agent', 'my-worker', 'artist-os')).toBe('artistos://workspace/actual-workspace-id/agents/agent/my-worker');
    expect(buildSessionResultLink(context(), 'workflow', 'my-flow', 'artist-os')).toBe('artistos://workspace/actual-workspace-id/workflows/my-flow');
    expect(buildSessionResultLink(context(), 'automation', 'abc123', 'artist-os')).toBe('artistos://workspace/actual-workspace-id/automations/automation/abc123');
    expect(buildSessionResultLink(context(), 'work', undefined, 'artist-os')).toBe('artistos://workspace/actual-workspace-id/automations');
  });
  test('generic Runner retains its scheme', () => {
    expect(buildSessionResultLink(context(), 'agent', 'worker', 'runner')).toStartWith('craftagents://workspace/actual-workspace-id/');
  });
  test('unknown identity and malformed targets produce no broken or cross-workspace link', () => {
    for (const id of [null, '', '../other', 'workspace/other', 'ws?send=true', 'ws#other']) expect(buildSessionResultLink(context(id), 'agent', 'worker', 'artist-os')).toBeUndefined();
    expect(buildSessionResultLink(context(), 'agent', '../other', 'artist-os')).toBeUndefined();
    expect(buildSessionResultLink(context(), 'agent', undefined, 'artist-os')).toBeUndefined();
    const missing = {};
    expect(sessionResultLinkText(missing, 'agent', 'worker')).toBe('');
  });
});

test('host identity wins over stale local config and path identities', () => {
  let reads = 0;
  const ctx = {
    workspaceId: '4584f472-9af3-1985-66ff-73b73efc6afa',
    workspacePath: '/tmp/ws_folder',
    fs: { readFile: () => { reads++; return JSON.stringify({ id: 'ws_c291d137' }); } },
  };
  expect(buildSessionResultLink(ctx, 'workflow', 'report', 'artist-os')).toBe('artistos://workspace/4584f472-9af3-1985-66ff-73b73efc6afa/workflows/report');
  expect(buildSessionResultLink({ ...ctx, workspaceId: undefined }, 'workflow', 'report', 'artist-os')).toBeUndefined();
  expect(reads).toBe(0);
});
