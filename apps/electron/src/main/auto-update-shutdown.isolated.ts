import { expect, mock, test } from 'bun:test';
const handlers = new Map<string, (...args: any[]) => unknown>();
let installs = 0;
mock.module('electron-updater', () => ({ autoUpdater: { on: (event: string, fn: (...args: any[]) => unknown) => handlers.set(event, fn), quitAndInstall: () => { installs++; } } }));
mock.module('electron', () => ({ app: { getVersion: () => '1.0.0', getName: () => 'Fixture', getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }));
mock.module('./logger', () => ({ mainLog: { info() {}, warn() {}, error() {} }, autoUpdateLog: { info() {}, warn() {}, error() {} } }));
mock.module('./menu', () => ({ rebuildMenu() {} }));
mock.module('@craft-agent/shared/config', () => ({ getDismissedUpdateVersion: () => null, clearDismissedUpdateVersion() {} }));
const updates = await import('./auto-update');

test('failed shutdown prevents update install and leaves the downloaded update retryable', async () => {
  await handlers.get('update-downloaded')!({ version: '2.0.0' });
  updates.setBeforeUpdateInstallHook(async () => { throw new Error('host still open'); });
  await expect(updates.installUpdate()).rejects.toThrow('host still open');
  expect(installs).toBe(0); expect(updates.isUpdating()).toBe(false);
  expect(updates.getUpdateInfo().downloadState).toBe('ready');
  updates.setBeforeUpdateInstallHook(async () => {});
  await updates.installUpdate(); expect(installs).toBe(1);
});

test('hung cleanup reports waiting and cannot install until the original cleanup settles', async () => {
  const { waitForSafeShutdown } = await import('./shutdown-wait');
  await handlers.get('update-downloaded')!({ version: '3.0.0' });
  let finish!: () => void, announce!: () => void;
  const cleanup = new Promise<void>(resolve => finish = resolve), notice = new Promise<void>(resolve => announce = resolve);
  updates.setBeforeUpdateInstallHook(() => waitForSafeShutdown(cleanup, { waitMs: 1, onWaiting: announce }));
  const before = installs, installation = updates.installUpdate(); await notice;
  expect(installs).toBe(before); expect(updates.isUpdating()).toBe(true);
  finish(); await installation; expect(installs).toBe(before + 1);
});
