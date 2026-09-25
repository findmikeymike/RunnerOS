import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { CLIENT_CONFIRM_DIALOG, CLIENT_OPEN_FILE_DIALOG } from './capabilities';

/** Bound the renderer independently of ordinary machine-to-machine RPCs. */
export const VIDEO_RENDER_TIMEOUT_MS = 5 * 60_000;

/** Human browsing time for native file and confirmation dialogs. */
export const DIALOG_TIMEOUT_MS = 10 * 60_000;

const dialogRequests = new Set<string>([
  RPC_CHANNELS.file.OPEN_DIALOG,
  RPC_CHANNELS.dialog.OPEN_FOLDER,
  RPC_CHANNELS.gitbash.BROWSE,
  RPC_CHANNELS.missionAssets.CHOOSE_FILES,
  RPC_CHANNELS.artistVault.CHOOSE_FILES,
  RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD,
  RPC_CHANNELS.videoStudio.IMPORT_MEDIA,
  RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION,
  RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION,
]);

export function isClientDialog(channel: string): boolean {
  return channel === CLIENT_OPEN_FILE_DIALOG || channel === CLIENT_CONFIRM_DIALOG;
}

export function clientCapabilityTimeout(channel: string): number {
  return isClientDialog(channel) ? DIALOG_TIMEOUT_MS : 30_000;
}

// Outer timers must outlive the native dialog and allow its result/error to return.
export function rpcHandlerTimeout(channel: string, defaultMs: number): number {
  if (channel === RPC_CHANNELS.videoStudio.EXPORT) return Math.max(defaultMs, VIDEO_RENDER_TIMEOUT_MS + 30_000);
  return dialogRequests.has(channel) ? Math.max(defaultMs, DIALOG_TIMEOUT_MS + 60_000) : defaultMs;
}

export function rpcRequestTimeout(channel: string, defaultMs: number): number {
  if (channel === RPC_CHANNELS.videoStudio.EXPORT) return Math.max(defaultMs, VIDEO_RENDER_TIMEOUT_MS + 60_000);
  return dialogRequests.has(channel) ? Math.max(defaultMs, DIALOG_TIMEOUT_MS + 90_000) : defaultMs;
}
