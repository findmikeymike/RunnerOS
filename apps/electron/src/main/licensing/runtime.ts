import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron';
import { DesktopEntitlementAuthority, HttpDesktopEntitlementServiceClient } from '@craft-agent/server-core/licensing';
import { isArtistOSPaidChannel, validateArtistOSActivateInput, type ArtistOSActivateInputV1, type ArtistOSLicenseLinkKind } from '@craft-agent/shared/licensing';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { ElectronInstallationIdentityStore, ElectronProtectedLicenseStore } from './protected-store';
import { ARTIST_OS_DESKTOP_ENTITLEMENT_KEYRING } from './public-keyring';
import { shouldAutomaticallyRefreshLicense } from './automatic-refresh';

export const LICENSE_IPC = {
  GET_STATE: '__license:get-state',
  ACTIVATE: '__license:activate',
  REFRESH: '__license:refresh',
  DEACTIVATE: '__license:deactivate',
  STATE_CHANGED: '__license:state-changed',
  AUTHORIZE_CHANNEL: '__license:authorize-channel',
  REQUIRED: '__license:required',
  OPEN_LINK: '__license:open-link',
} as const;

const LICENSE_LINKS: Record<ArtistOSLicenseLinkKind, string> = {
  buy: developmentOverride('ARTIST_OS_BUY_URL', 'https://artistos.app/buy'),
  recover: developmentOverride('ARTIST_OS_LICENSE_RECOVERY_URL', 'https://app.lemonsqueezy.com/my-orders'),
  manage: developmentOverride('ARTIST_OS_LICENSE_MANAGE_URL', 'https://app.lemonsqueezy.com/my-orders'),
  support: developmentOverride('ARTIST_OS_SUPPORT_URL', 'https://artistos.app/support'),
  privacy: developmentOverride('ARTIST_OS_PRIVACY_URL', 'https://artistos.app/privacy'),
};

function developmentOverride(name: string, productionUrl: string): string {
  return !app.isPackaged && process.env[name] ? process.env[name]! : productionUrl;
}

let authority: DesktopEntitlementAuthority | null = null;
let lastAutomaticRefreshAt: number | null = null;
let resumeRefreshRegistered = false;

export async function initializeDesktopLicensing(): Promise<DesktopEntitlementAuthority> {
  if (RUNTIME_IDENTITY.variant !== 'artist-os') {
    throw new Error('Artist OS licensing cannot initialize in the Runner runtime');
  }
  if (authority) return authority;
  const configured = process.env.ARTIST_OS_LICENSE_SERVICE_URL;
  const serviceUrl = !app.isPackaged && configured ? configured : 'https://license.artistos.app';
  const instance = new DesktopEntitlementAuthority({
    packaged: app.isPackaged,
    appVersion: app.getVersion(),
    architecture: process.arch === 'x64' ? 'x64' : 'arm64',
    keyring: ARTIST_OS_DESKTOP_ENTITLEMENT_KEYRING,
    installationStore: new ElectronInstallationIdentityStore(),
    recordStore: new ElectronProtectedLicenseStore(),
    service: new HttpDesktopEntitlementServiceClient(serviceUrl),
  });
  authority = instance;
  instance.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(LICENSE_IPC.STATE_CHANGED, snapshot);
  });
  await instance.initialize();
  registerLicenseIpc(instance);
  registerAutomaticRefresh(instance);
  void attemptAutomaticRefresh(instance);
  return instance;
}

function registerAutomaticRefresh(instance: DesktopEntitlementAuthority): void {
  if (resumeRefreshRegistered) return;
  resumeRefreshRegistered = true;
  powerMonitor.on('resume', () => void attemptAutomaticRefresh(instance));
}

async function attemptAutomaticRefresh(instance: DesktopEntitlementAuthority): Promise<void> {
  const now = Date.now();
  if (!shouldAutomaticallyRefreshLicense(instance.getSnapshot(), lastAutomaticRefreshAt, now)) return;
  lastAutomaticRefreshAt = now;
  try {
    await instance.refresh();
  } catch {
    // Offline and transient service failures preserve the signed perpetual entitlement.
  }
}

export function getDesktopLicensing(): DesktopEntitlementAuthority {
  if (!authority) throw new Error('Desktop licensing has not initialized');
  return authority;
}

function registerLicenseIpc(instance: DesktopEntitlementAuthority): void {
  ipcMain.handle(LICENSE_IPC.GET_STATE, () => instance.getSnapshot());
  ipcMain.handle(LICENSE_IPC.ACTIVATE, async (_event, input: ArtistOSActivateInputV1) => {
    if (!validateArtistOSActivateInput(input)) throw safeError('INVALID_REQUEST');
    return await instance.activate(input);
  });
  ipcMain.handle(LICENSE_IPC.REFRESH, async () => await instance.refresh());
  ipcMain.handle(LICENSE_IPC.DEACTIVATE, async () => await instance.deactivate());
  ipcMain.handle(LICENSE_IPC.OPEN_LINK, async (_event, kind: unknown) => {
    if (!isLicenseLinkKind(kind)) throw safeError('INVALID_REQUEST');
    const url = new URL(LICENSE_LINKS[kind]);
    if (url.protocol !== 'https:') throw safeError('INVALID_CONFIGURATION');
    await shell.openExternal(url.toString());
  });
  ipcMain.handle(LICENSE_IPC.AUTHORIZE_CHANNEL, (_event, channel: unknown) => {
    try {
      assertLicensedChannel(instance, channel);
    } catch (error) {
      _event.sender.send(LICENSE_IPC.REQUIRED);
      throw error;
    }
    return true;
  });
}

function isLicenseLinkKind(value: unknown): value is ArtistOSLicenseLinkKind {
  return value === 'buy' || value === 'recover' || value === 'manage' || value === 'support' || value === 'privacy';
}

export function assertLicensedChannel(instance: DesktopEntitlementAuthority, channel: unknown): void {
  if (typeof channel !== 'string' || channel.length === 0 || channel.length > 160) throw safeError('INVALID_REQUEST');
  if (isArtistOSPaidChannel(channel) && !instance.isPaidExecutionAuthorized()) throw safeError('LICENSE_REQUIRED');
}

export function assertProductLicensedChannel(channel: unknown): void {
  if (RUNTIME_IDENTITY.variant !== 'artist-os') return;
  assertLicensedChannel(getDesktopLicensing(), channel);
}

function safeError(code: string): Error {
  const error = new Error(code);
  (error as Error & { code?: string }).code = code;
  return error;
}
