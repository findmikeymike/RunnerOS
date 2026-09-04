/**
 * How often the Community Agent looks for something worth sending.
 *
 * The agent decides whether anything is worth an email; this only decides
 * how often it is asked. Manual by default, because an artist who has not
 * chosen a rhythm should not start getting weekly prompts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type CommunityCadence = 'weekly' | 'monthly' | 'manual';

export interface CommunityRoutineConfig {
  cadence: CommunityCadence;
  /** 0 = Sunday. Weekly only. */
  dayOfWeek?: number;
  /** 1-28, capped so every month has the day. Monthly only. */
  dayOfMonth?: number;
  hour?: number;
  lastRunAt?: string;
}

export const DEFAULT_COMMUNITY_ROUTINE: CommunityRoutineConfig = {
  cadence: 'manual',
  dayOfWeek: 1,
  dayOfMonth: 1,
  hour: 10,
};

const ROUTINE_FILE = 'records/community/routine.json';

function routinePath(workspaceRootPath: string): string {
  return join(workspaceRootPath, ROUTINE_FILE);
}

export function loadCommunityRoutine(workspaceRootPath: string): CommunityRoutineConfig {
  const file = routinePath(workspaceRootPath);
  if (!existsSync(file)) return { ...DEFAULT_COMMUNITY_ROUTINE };
  try {
    return { ...DEFAULT_COMMUNITY_ROUTINE, ...JSON.parse(readFileSync(file, 'utf-8')) as CommunityRoutineConfig };
  } catch {
    return { ...DEFAULT_COMMUNITY_ROUTINE };
  }
}

export function saveCommunityRoutine(
  workspaceRootPath: string,
  config: Partial<CommunityRoutineConfig>,
): CommunityRoutineConfig {
  const next = { ...loadCommunityRoutine(workspaceRootPath), ...config };
  const file = routinePath(workspaceRootPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function clampHour(hour: number | undefined): number {
  if (!Number.isFinite(hour)) return 10;
  return Math.min(23, Math.max(0, Math.trunc(hour!)));
}

export function cronForCommunityRoutine(config: CommunityRoutineConfig): string | null {
  const hour = clampHour(config.hour);
  if (config.cadence === 'weekly') {
    const day = Number.isFinite(config.dayOfWeek) ? Math.min(6, Math.max(0, Math.trunc(config.dayOfWeek!))) : 1;
    return `0 ${hour} * * ${day}`;
  }
  if (config.cadence === 'monthly') {
    const day = Number.isFinite(config.dayOfMonth) ? Math.min(28, Math.max(1, Math.trunc(config.dayOfMonth!))) : 1;
    return `0 ${hour} ${day} * *`;
  }
  return null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeCommunityCadence(config: CommunityRoutineConfig): string {
  const hour = clampHour(config.hour);
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  if (config.cadence === 'manual') return 'Only when you ask';
  if (config.cadence === 'weekly') {
    const day = Number.isFinite(config.dayOfWeek) ? Math.min(6, Math.max(0, Math.trunc(config.dayOfWeek!))) : 1;
    return `Every ${DAY_NAMES[day]} at ${clock}`;
  }
  const day = Number.isFinite(config.dayOfMonth) ? Math.min(28, Math.max(1, Math.trunc(config.dayOfMonth!))) : 1;
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `The ${day}${suffix} of each month at ${clock}`;
}
