import { expect, test } from 'bun:test';
import { createDurableWorkflowStartup, type DurableWorkflowStartupOptions } from './durable-workflow-startup';
import type { DurableWorkflowHost } from '@craft-agent/server-core/workflows/durable-workflow-host';

function fixture() {
  const calls: string[] = [], binding = { host: '127.0.0.1', serverModeEnabled: false };
  const principal = Object.assign(() => 'desktop-owner:fixture', { assertRunPrincipal: () => {}, assertPublicationPrincipal: () => {}, resolveScheduledPrincipal: () => 'desktop-owner:fixture' });
  const host = { close: async () => {} } as DurableWorkflowHost;
  const options: DurableWorkflowStartupOptions = { getBinding: () => binding,
    server: { isAuthenticatedClientConnected: () => true },
    runnerOptions: { hostRuntime: { appRootPath: '/fixture', isPackaged: false }, resolveBinding: () => { throw new Error('must not execute'); } } };
  const deps = { createAuthority: async () => { calls.push('authority'); return principal; },
    openHost: async (input: Parameters<typeof import('./durable-workflow-storage').openElectronDurableWorkflowHost>[0]) => {
      calls.push('host'); expect(input.resolvePrincipal).toBe(principal); expect(input.runnerOptions.resolveBinding).toBe(options.runnerOptions.resolveBinding); expect(input.runnerOptions.authorizeTool).toBeFunction(); expect(input.runnerOptions.readPolicyRevision).toBeFunction(); expect(input.runnerOptions.authorizePublication).toBeFunction(); expect(input.runnerOptions.resolvePublicationWorkspace).toBeFunction(); return host;
    } };
  return { calls, binding, options, deps, host };
}

test('startup defaults off without touching identity, binding or journal', async () => {
  const f = fixture(), start = createDurableWorkflowStartup(f.deps);
  f.options.getBinding = () => { throw new Error('must not inspect disabled startup'); };
  expect(await start(f.options)).toBeUndefined();
  expect(await start({ ...f.options, enabled: false })).toBeUndefined(); expect(f.calls).toEqual([]);
});

test('enabled local startup joins authority and storage without executing a workflow', async () => {
  const f = fixture(); expect(await createDurableWorkflowStartup(f.deps)({ ...f.options, enabled: true })).toBe(f.host);
  expect(f.calls).toEqual(['authority', 'host']);
});

test('shared or external startup is refused before identity/storage access', async () => {
  const f = fixture(), start = createDurableWorkflowStartup(f.deps);
  f.binding.serverModeEnabled = true;
  await expect(start({ ...f.options, enabled: true })).rejects.toThrow('local-startup-required');
  f.binding.serverModeEnabled = false; f.binding.host = '0.0.0.0';
  await expect(start({ ...f.options, enabled: true })).rejects.toThrow('local-startup-required'); expect(f.calls).toEqual([]);
});

test('policy changes during identity loading and identity failures cannot open storage', async () => {
  const f = fixture();
  const start = createDurableWorkflowStartup({ ...f.deps, createAuthority: async () => {
    f.binding.serverModeEnabled = true; return Object.assign(() => 'owner', { assertRunPrincipal: () => {}, assertPublicationPrincipal: () => {}, resolveScheduledPrincipal: () => 'desktop-owner:fixture' });
  } });
  await expect(start({ ...f.options, enabled: true })).rejects.toThrow('local-startup-required'); expect(f.calls).toEqual([]);
  f.binding.serverModeEnabled = false;
  const failed = createDurableWorkflowStartup({ ...f.deps, createAuthority: async () => { throw new Error('identity unavailable'); } });
  await expect(failed({ ...f.options, enabled: true })).rejects.toThrow('identity unavailable'); expect(f.calls).toEqual([]);
});
