import { expect, mock, test } from 'bun:test';
const handlers = new Map<string, (...args: any[]) => unknown>();
let installs = 0;
let menuRebuilds = 0;
let checkError: Error | null = null;
let installError: Error | null = null;
let failedInstallRecoveries = 0;
const autoUpdater = {
  on: (event: string, fn: (...args: any[]) => unknown) => handlers.set(event, fn),
  checkForUpdates: async () => { if (checkError) throw checkError; return null; },
  quitAndInstall: () => {
    installs++;
    if (installError) handlers.get('error')?.(installError);
  },
};
mock.module('electron-updater', () => ({ autoUpdater }));
mock.module('electron', () => ({ app: { getVersion: () => '1.0.0', getName: () => 'Fixture', getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }));
mock.module('./logger', () => ({ mainLog: { info() {}, warn() {}, error() {} }, autoUpdateLog: { info() {}, warn() {}, error() {} } }));
mock.module('./menu', () => ({ rebuildMenu() { menuRebuilds++; } }));
mock.module('@craft-agent/shared/config', () => ({ getDismissedUpdateVersion: () => null, clearDismissedUpdateVersion() {} }));
const updates = await import('./auto-update');

test('a failed update check rejects instead of reporting the current version as up to date', async () => {
  checkError = new Error('feed unavailable');
  await expect(updates.checkForUpdates()).rejects.toThrow('feed unavailable');
  expect(updates.getUpdateInfo().downloadState).toBe('error');
  checkError = null;
});

test('update availability waits for updater validation instead of trusting cached files or private state', async () => {
  Object.assign(autoUpdater, { downloadedUpdateHelper: { versionInfo: { version: '1.5.0' } } });
  await handlers.get('update-available')!({ version: '2.0.0' });
  expect(updates.getUpdateInfo()).toMatchObject({ latestVersion: '2.0.0', downloadState: 'downloading' });
  await handlers.get('update-downloaded')!({ version: '2.0.0' });
  expect(updates.getUpdateInfo()).toMatchObject({ latestVersion: '2.0.0', downloadState: 'ready' });
});

test('an updater error after cleanup requests process recovery', async () => {
  await handlers.get('update-downloaded')!({ version: '2.1.0' });
  updates.setBeforeUpdateInstallHook(async () => {});
  updates.setInstallQuitFailedHook(() => { failedInstallRecoveries++; });
  const beforeMenuRebuilds = menuRebuilds;
  installError = new Error('installer handoff failed');
  await updates.installUpdate();
  expect(failedInstallRecoveries).toBe(1);
  expect(updates.isUpdating()).toBe(false);
  expect(menuRebuilds).toBeGreaterThan(beforeMenuRebuilds);
  expect(updates.getUpdateInfo().downloadState).toBe('error');
  installError = null;
});

test('failed shutdown prevents update install and leaves the downloaded update retryable', async () => {
  await handlers.get('update-downloaded')!({ version: '2.0.0' });
  updates.setBeforeUpdateInstallHook(async () => { throw new Error('host still open'); });
  const before = installs;
  await expect(updates.installUpdate()).rejects.toThrow('host still open');
  expect(installs).toBe(before); expect(updates.isUpdating()).toBe(false);
  expect(updates.getUpdateInfo().downloadState).toBe('ready');
  updates.setBeforeUpdateInstallHook(async () => {});
  await updates.installUpdate(); expect(installs).toBe(before + 1);
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
