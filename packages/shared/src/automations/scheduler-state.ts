import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { AUTOMATIONS_SCHEDULER_STATE_FILE } from './constants.ts';

export interface AutomationSchedulerState {
  version: 1;
  lastDeliveredTickAt: string;
  lastDeliveredTickKey: string;
  updatedAt: string;
}

export function resolveAutomationSchedulerStatePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, AUTOMATIONS_SCHEDULER_STATE_FILE);
}

export function readAutomationSchedulerState(workspaceRootPath: string): AutomationSchedulerState | null {
  const file = resolveAutomationSchedulerStatePath(workspaceRootPath);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<AutomationSchedulerState>;
  if (
    parsed.version !== 1
    || typeof parsed.lastDeliveredTickAt !== 'string'
    || !Number.isFinite(Date.parse(parsed.lastDeliveredTickAt))
    || typeof parsed.lastDeliveredTickKey !== 'string'
    || !parsed.lastDeliveredTickKey
    || typeof parsed.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(parsed.updatedAt))
  ) {
    throw new Error(`Invalid automation scheduler state at ${file}`);
  }
  return parsed as AutomationSchedulerState;
}

export function recordAutomationSchedulerTick(
  workspaceRootPath: string,
  tickKey: string,
  tickAt = new Date().toISOString(),
): AutomationSchedulerState {
  const file = resolveAutomationSchedulerStatePath(workspaceRootPath);
  const state: AutomationSchedulerState = {
    version: 1,
    lastDeliveredTickAt: tickAt,
    lastDeliveredTickKey: tickKey,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    renameSync(temp, file);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
  return state;
}
