import { expect, test } from 'bun:test';
import { createDurableWorkflowAuthority } from './durable-workflow-authority.ts';

function fixture() {
  const clients = new Map([['connection-a', 'alice']]);
  const memberships = new Map([['alice', new Set(['workspace-a'])], ['bob', new Set(['workspace-b'])]]);
  const resolve = createDurableWorkflowAuthority({
    getAuthenticatedPrincipal: clientId => clients.get(clientId) ?? null,
    canAccessWorkspace: (principal, workspace) => memberships.get(principal)?.has(workspace) === true,
  });
  return { clients, memberships, resolve };
}

test('returns stable host principal across reconnects and ignores caller identity claims', () => {
  const { clients, resolve } = fixture();
  expect(resolve('workspace-a', { clientId: 'connection-a', principalId: 'bob' } as never)).toBe('alice');
  clients.delete('connection-a'); clients.set('connection-new', 'alice');
  expect(() => resolve('workspace-a', { clientId: 'connection-a' })).toThrow('unauthenticated');
  expect(resolve('workspace-a', { clientId: 'connection-new' })).toBe('alice');
});

test('rejects unknown connections, wrong workspace, deleted workspace and revoked membership', () => {
  const { memberships, resolve } = fixture();
  expect(() => resolve('workspace-a', { clientId: 'unknown' })).toThrow('unauthenticated');
  expect(() => resolve('workspace-a', { clientId: 'connection-a', workspaceId: 'workspace-b' })).toThrow('workspace-mismatch');
  expect(() => resolve('workspace-b', { clientId: 'connection-a' })).toThrow('access-denied');
  memberships.get('alice')!.delete('workspace-a');
  expect(() => resolve('workspace-a', { clientId: 'connection-a' })).toThrow('access-denied');
});

test('rechecks account changes without caching the previous user or permissions', () => {
  const { clients, resolve } = fixture();
  expect(resolve('workspace-a', { clientId: 'connection-a' })).toBe('alice');
  clients.set('connection-a', 'bob');
  expect(() => resolve('workspace-a', { clientId: 'connection-a' })).toThrow('access-denied');
  expect(resolve('workspace-b', { clientId: 'connection-a' })).toBe('bob');
});

test('fails closed for malformed inputs, missing identity and failed authority lookup', () => {
  const { resolve } = fixture();
  for (const actor of [null, {}, { clientId: '' }]) expect(() => resolve('workspace-a', actor as never)).toThrow();
  expect(() => resolve('', { clientId: 'connection-a' })).toThrow();
  const missing = createDurableWorkflowAuthority({ getAuthenticatedPrincipal: () => ' ', canAccessWorkspace: () => true });
  expect(() => missing('workspace-a', { clientId: 'c' })).toThrow('unauthenticated');
  const failed = createDurableWorkflowAuthority({ getAuthenticatedPrincipal: () => { throw new Error('auth unavailable'); }, canAccessWorkspace: () => true });
  expect(() => failed('workspace-a', { clientId: 'c' })).toThrow('auth unavailable');
});
