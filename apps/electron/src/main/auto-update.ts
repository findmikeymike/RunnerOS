/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. Packaged builds receive a product-specific public
 * generic feed through their generated app-update.yml.
 *
 * Platform behavior:
 * - macOS: Downloads zip, extracts and swaps app bundle atomically
 * - Windows: Downloads NSIS installer, runs silently on quit
 * - Linux: Downloads AppImage, replaces current file
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 * quitAndInstall() handles restart natively — no external scripts.
 */

import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { autoUpdateLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false
let preparingInstall = false
let preparationError: Error | null = null
let beforeUpdateQuitHook: (() => void) | null = null
let beforeUpdateInstallHook: (() => Promise<void>) | null = null
let installQuitFailedHook: (() => void) | null = null

/** Capture window state before electron-updater destroys renderer windows. */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
}

/** Flush and release app resources before installer handoff. */
export function setBeforeUpdateInstallHook(fn: () => Promise<void>): void {
  beforeUpdateInstallHook = fn
}

/** Recover from a failed handoff after app resources have already been released. */
export function setInstallQuitFailedHook(fn: () => void): void {
  installQuitFailedHook = fn
}

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Auto-download updates in the background after detection
autoUpdater.autoDownload = true

// Install on app quit (if update is downloaded but user hasn't clicked "Restart")
autoUpdater.autoInstallOnAppQuit = true

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => autoUpdateLog.info('electron-updater', msg),
  warn: (msg: unknown) => autoUpdateLog.warn('electron-updater', msg),
  error: (msg: unknown) => autoUpdateLog.error('electron-updater', msg),
  debug: (msg: unknown) => autoUpdateLog.info('electron-updater debug', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function refreshUpdateMenu(): void {
  void import('./menu').then(({ rebuildMenu }) => rebuildMenu()).catch(error => {
    autoUpdateLog.warn('Could not refresh update menu', error)
  })
}

autoUpdater.on('checking-for-update', () => {
  autoUpdateLog.info('Checking for updates')
  updateInfo = { ...updateInfo, error: undefined }
})

autoUpdater.on('update-available', (info) => {
  autoUpdateLog.info(`Update available: ${updateInfo.currentVersion} → ${info.version}`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'downloading',
    downloadProgress: 0,
    error: undefined,
  }
  broadcastUpdateInfo()
  refreshUpdateMenu()
})

autoUpdater.on('update-not-available', (info) => {
  autoUpdateLog.info(`Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
    downloadProgress: 0,
    error: undefined,
  }
  broadcastUpdateInfo()
  refreshUpdateMenu()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadState: 'downloading', downloadProgress: percent, error: undefined }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', async (info) => {
  autoUpdateLog.info(`Update downloaded: v${info.version}`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'ready',
    downloadProgress: 100,
    error: undefined,
  }
  broadcastUpdateInfo()

  // Rebuild menu to show "Install Update..." option
  refreshUpdateMenu()
})

function recordUpdaterError(error: Error): void {
  autoUpdateLog.error('electron-updater error', error)
  // Recovery exits the process. Never invoke it while the durable journal and
  // pending session writes are still draining in the pre-install hook.
  if (preparingInstall) preparationError ??= error
  const installNeedsRecovery = __isUpdating && !preparingInstall
  if (!preparingInstall) __isUpdating = false
  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
  refreshUpdateMenu()
  if (installNeedsRecovery) {
    try {
      installQuitFailedHook?.()
    } catch (hookError) {
      autoUpdateLog.error('installQuitFailed hook failed', hookError)
    }
  }
}

autoUpdater.on('error', (error) => recordUpdaterError(error))

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true) */
  autoDownload?: boolean
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  const { autoDownload = true } = options

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    // Check for updates - this returns a promise that resolves with the check result
    await autoUpdater.checkForUpdates()

    // Cached downloads become installable only after electron-updater emits its
    // validated update-downloaded event. Raw cache files are never trusted here.
  } catch (error) {
    autoUpdateLog.error('Update check failed', error)
    const failure = error instanceof Error ? error : new Error('Check failed')
    recordUpdaterError(failure)
    throw failure
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

/**
 * Install the downloaded update and restart the app.
 * Calls electron-updater's quitAndInstall which handles:
 * - macOS: Extracts zip and swaps app bundle
 * - Windows: Runs NSIS installer silently
 * - Linux: Replaces AppImage file
 * Then relaunches the app automatically.
 */
export async function installUpdate(): Promise<void> {
  if (__isUpdating) throw new Error('Update installation is already in progress')
  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  autoUpdateLog.info('Installing update and restarting')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true
  preparingInstall = true
  preparationError = null

  autoUpdateLog.info('installUpdate pre-quit', {
    electronWindowCount: BrowserWindow.getAllWindows().length,
    latestVersion: updateInfo.latestVersion,
  })

  try {
    beforeUpdateQuitHook?.()
  } catch (error) {
    autoUpdateLog.error('beforeUpdateQuit hook failed', error)
  }

  try {
    await beforeUpdateInstallHook?.()
  } catch (error) {
    autoUpdateLog.error('beforeUpdateInstall cleanup hook failed', error)
    preparingInstall = false
    __isUpdating = false
    updateInfo = { ...updateInfo, downloadState: preparationError ? 'error' : 'ready' }
    preparationError = null
    broadcastUpdateInfo()
    throw error
  }

  preparingInstall = false
  if (preparationError) {
    const error = preparationError
    preparationError = null
    recordUpdaterError(error)
    throw error
  }

  try {
    // isSilent=false shows the installer UI on Windows if needed (fallback)
    // isForceRunAfter=true ensures the app relaunches after install
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    recordUpdaterError(error instanceof Error ? error : new Error('Update install failed'))
    throw error
  }
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}

/**
 * Check for updates on app launch.
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Auto-downloads if update available
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  autoUpdateLog.info('Checking for updates on launch')

  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    autoUpdateLog.info(`Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress — will notify when ready via update-downloaded event
  return { action: 'downloading', version: info.latestVersion }
}
