import { expect, test } from 'bun:test';
import { createLocalDurableWorkflowAuthority } from './durable-workflow-authority';
const installationId = '11111111-1111-4111-8111-111111111111';
function fixture() {
  let permission = true;
  const clients = new Set(['client-a']); let workspaces = [{ id: 'w' }];
  const binding = { host: '127.0.0.1', serverModeEnabled: false };
  const options = { installationId, server: { isAuthenticatedClientConnected: (id: string) => clients.has(id) }, getBinding: () => binding, getWorkspaces: () => workspaces, assertWorkspacePermission: () => { if (!permission) throw new Error('team-permission-denied'); } };
  return { resolve: createLocalDurableWorkflowAuthority(options), options, clients, binding, revokePermission: () => { permission = false; }, removeWorkspace: () => workspaces = [] };
}

test('local authenticated reconnects and reconstruction retain the same desktop principal', () => {
  const f = fixture(); const principal = f.resolve('w', { clientId: 'client-a' });
  expect(principal).toBe(`desktop-owner:${installationId}`);
  f.clients.delete('client-a'); f.clients.add('client-b');
  expect(() => f.resolve('w', { clientId: 'client-a' })).toThrow('unauthenticated');
  expect(f.resolve('w', { clientId: 'client-b' })).toBe(principal);
  expect(createLocalDurableWorkflowAuthority(f.options)('w', { clientId: 'client-b' })).toBe(principal);
});

test('shared-server mode and external bindings cannot inherit local owner authority', () => {
  const f = fixture(); f.binding.serverModeEnabled = true;
  expect(() => f.resolve('w', { clientId: 'client-a' })).toThrow('unauthenticated');
  f.binding.serverModeEnabled = false;
  for (const host of ['0.0.0.0', '::', '192.168.1.10', 'localhost']) {
    f.binding.host = host; expect(() => f.resolve('w', { clientId: 'client-a' })).toThrow('unauthenticated');
  }
});

test('current workspace list is authoritative and caller claims cannot widen access', () => {
  const f = fixture();
  expect(() => f.resolve('other', { clientId: 'client-a', workspaceId: 'other' })).toThrow('access-denied');
  expect(() => f.resolve('w', { clientId: 'client-a', workspaceId: 'other' })).toThrow('workspace-mismatch');
  f.removeWorkspace(); expect(() => f.resolve('w', { clientId: 'client-a' })).toThrow('access-denied');
});

test('missing installation identity fails closed and different profiles have distinct owners', () => {
  const f = fixture();
  expect(() => createLocalDurableWorkflowAuthority({ ...f.options, installationId: '' })).toThrow('installation-required');
  const other = createLocalDurableWorkflowAuthority({ ...f.options, installationId: '22222222-2222-4222-8222-222222222222' });
  expect(other('w', { clientId: 'client-a' })).not.toBe(f.resolve('w', { clientId: 'client-a' }));
});

test('listed workspace cannot grant a viewer or revoked team member execution authority', () => {
  const f = fixture(), principal = f.resolve('w', { clientId: 'client-a' });
  f.resolve.assertRunPrincipal('w', principal);
  f.revokePermission();
  expect(() => f.resolve('w', { clientId: 'client-a' })).toThrow('team-permission-denied');
  expect(() => f.resolve.assertRunPrincipal('w', principal)).toThrow('team-permission-denied');
  expect(() => createLocalDurableWorkflowAuthority({ ...f.options, assertWorkspacePermission: undefined } as never)).toThrow('permission-required');
});
