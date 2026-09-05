import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../config/paths.ts';

export const DEFAULT_MONID_SINGLE_CALL_CAP_USD = 0.50;
export const DEFAULT_MONID_WEEKLY_CAP_USD = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface MonidBudgetStatus {
  singleCallCapUsd: number;
  weeklyCapUsd: number;
  spentLast7DaysUsd: number;
  remainingWeeklyUsd: number;
}

interface SpendEntry {
  id: string;
  timestamp: number;
  amountUsd: number;
  pending?: boolean;
}

interface StoredMonidBudget {
  version: 1;
  singleCallCapUsd: number;
  weeklyCapUsd: number;
  entries: SpendEntry[];
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class MonidBudgetStore {
  constructor(
    private readonly filePath = join(CONFIG_DIR, 'monid-budget.json'),
    private readonly now: () => number = Date.now,
  ) {}

  private load(): StoredMonidBudget {
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredMonidBudget>;
        if (validLimit(parsed.singleCallCapUsd) && validLimit(parsed.weeklyCapUsd) && Array.isArray(parsed.entries)) {
          return {
            version: 1,
            singleCallCapUsd: parsed.singleCallCapUsd,
            weeklyCapUsd: parsed.weeklyCapUsd,
            entries: parsed.entries.filter((entry): entry is SpendEntry =>
              Boolean(entry) && typeof entry.id === 'string' && validLimit(entry.timestamp) && validLimit(entry.amountUsd)
            ),
          };
        }
      } catch {
        // Corrupt settings fall back to safe defaults without executing unbounded calls.
      }
    }
    return {
      version: 1,
      singleCallCapUsd: DEFAULT_MONID_SINGLE_CALL_CAP_USD,
      weeklyCapUsd: DEFAULT_MONID_WEEKLY_CAP_USD,
      entries: [],
    };
  }

  private prune(state: StoredMonidBudget): StoredMonidBudget {
    const cutoff = this.now() - WEEK_MS;
    return { ...state, entries: state.entries.filter((entry) => entry.timestamp >= cutoff) };
  }

  private save(state: StoredMonidBudget): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }

  getStatus(): MonidBudgetStatus {
    const state = this.prune(this.load());
    const spent = roundUsd(state.entries.reduce((total, entry) => total + entry.amountUsd, 0));
    return {
      singleCallCapUsd: state.singleCallCapUsd,
      weeklyCapUsd: state.weeklyCapUsd,
      spentLast7DaysUsd: spent,
      remainingWeeklyUsd: roundUsd(Math.max(0, state.weeklyCapUsd - spent)),
    };
  }

  updateLimits(singleCallCapUsd: number, weeklyCapUsd: number): MonidBudgetStatus {
    if (!validLimit(singleCallCapUsd) || !validLimit(weeklyCapUsd)) {
      throw new Error('Monid spend limits must be non-negative numbers.');
    }
    const state = this.prune(this.load());
    state.singleCallCapUsd = roundUsd(singleCallCapUsd);
    state.weeklyCapUsd = roundUsd(weeklyCapUsd);
    this.save(state);
    return this.getStatus();
  }

  reserve(projectedMaxUsd: number): string {
    if (!validLimit(projectedMaxUsd)) throw new Error('Monid price could not be verified.');
    const state = this.prune(this.load());
    const spent = state.entries.reduce((total, entry) => total + entry.amountUsd, 0);
    if (projectedMaxUsd > state.singleCallCapUsd) {
      throw new Error(`Monid run blocked: $${projectedMaxUsd.toFixed(2)} exceeds the $${state.singleCallCapUsd.toFixed(2)} single-call cap.`);
    }
    if (spent + projectedMaxUsd > state.weeklyCapUsd) {
      const remaining = Math.max(0, state.weeklyCapUsd - spent);
      throw new Error(`Monid run blocked: $${projectedMaxUsd.toFixed(2)} would exceed the weekly cap ($${remaining.toFixed(2)} remaining).`);
    }

    const id = randomUUID();
    state.entries.push({ id, timestamp: this.now(), amountUsd: roundUsd(projectedMaxUsd), pending: true });
    this.save(state);
    return id;
  }

  commit(reservationId: string, actualCostUsd?: number): void {
    const state = this.prune(this.load());
    const entry = state.entries.find((candidate) => candidate.id === reservationId);
    if (!entry) return;
    if (validLimit(actualCostUsd)) entry.amountUsd = roundUsd(actualCostUsd);
    entry.pending = false;
    this.save(state);
  }

  release(reservationId: string): void {
    const state = this.prune(this.load());
    state.entries = state.entries.filter((entry) => entry.id !== reservationId);
    this.save(state);
  }
}

export const monidBudgetStore = new MonidBudgetStore();
