import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAutomationSchedulerState,
  recordAutomationSchedulerTick,
  resolveAutomationSchedulerStatePath,
} from './scheduler-state.ts';

describe('automation scheduler state', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'automation-scheduler-state-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('atomically persists and reads the last delivered tick', () => {
    const at = '2026-09-02T14:00:00.000Z';
    recordAutomationSchedulerTick(root, at, at);

    expect(readAutomationSchedulerState(root)).toMatchObject({
      version: 1,
      lastDeliveredTickAt: at,
      lastDeliveredTickKey: at,
    });
    expect(readFileSync(resolveAutomationSchedulerStatePath(root), 'utf-8')).toEndWith('\n');
  });

  it('returns null before a checkpoint exists', () => {
    expect(readAutomationSchedulerState(root)).toBeNull();
  });

  it('rejects corrupt state instead of inventing a catch-up window', () => {
    writeFileSync(resolveAutomationSchedulerStatePath(root), '{"version":1,"lastDeliveredTickAt":"nope"}');
    expect(() => readAutomationSchedulerState(root)).toThrow('Invalid automation scheduler state');
  });
});
