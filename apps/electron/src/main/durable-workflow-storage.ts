import { electronDurableWorkflowLifetime } from './durable-workflow-lifetime';
import { DurableWorkflowHost, type DurableWorkflowHostOptions } from '@craft-agent/server-core/workflows/durable-workflow-host';
import type { DurableSafeStorage } from '@craft-agent/shared/durable-execution';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/** Presence only: never decrypt or open storage just to decide whether scans may run. */
export function hasSavedDurableWorkflowStorage(configRoot: string): boolean {
  for (const name of ['journal.sqlite', 'journal.sqlite-wal', 'key.envelope']) {
    try { lstatSync(join(configRoot, 'durable-execution', name)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true; // unreadable is unknown, not absent
    }
  }
  return false;
}

/** Narrow Electron surface permits tests without mocking the process-global electron module. */
export function createElectronDurableProtection(runtime: {
  app: { isReady(): boolean };
  safeStorage: DurableSafeStorage;
}): DurableSafeStorage {
  const { app, safeStorage } = runtime;
  const assertAvailable = () => {
    if (!app.isReady()) throw new Error('durable-electron-not-ready');
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('durable-secure-storage-unavailable');
    }
  };
  return {
    isEncryptionAvailable() { assertAvailable(); return true; },
    encryptString(value) { assertAvailable(); return safeStorage.encryptString(value); },
    decryptString(value) { assertAvailable(); return safeStorage.decryptString(value); },
    ...(safeStorage.getSelectedStorageBackend ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend!() } : {}),
  };
}

/** Main-process factory only. Caller must invoke after app readiness; no startup registration here. */
export async function openElectronDurableWorkflowHost(options: Omit<DurableWorkflowHostOptions, 'configRoot' | 'protection'>): Promise<DurableWorkflowHost> {
  return electronDurableWorkflowLifetime.open(async () => {
  const { app, safeStorage } = await import('electron');
  return DurableWorkflowHost.open({ ...options, configRoot: RUNTIME_IDENTITY.dataRoot,
    protection: createElectronDurableProtection({ app, safeStorage }) });
  });
}
