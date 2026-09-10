import { expect, test } from 'bun:test';
import { createSafeRelaunch } from './safe-relaunch';

test('pending cleanup holds relaunch and exit, concurrent requests share one shutdown', async () => {
  let release!: () => void;
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const relaunch = createSafeRelaunch({ prepare: () => { calls.push('prepare'); }, cleanup: () => { calls.push('cleanup'); return cleanup; }, relaunch: () => { calls.push('relaunch'); }, exit: () => { calls.push('exit'); }, failed: () => { calls.push('failed'); } });
  const first = relaunch(); expect(relaunch()).toBe(first);
  await Promise.resolve(); expect(calls).toEqual(['prepare', 'cleanup']);
  release(); await first; expect(calls).toEqual(['prepare', 'cleanup', 'relaunch', 'exit']);
});

test('failed cleanup schedules no restart and permits a later successful retry', async () => {
  let fail = true, quitting = false, scheduled = 0, exited = 0;
  const failure = new Error('journal drain failed');
  const relaunch = createSafeRelaunch({ prepare: () => { quitting = true; }, cleanup: async () => { if (fail) throw failure; }, relaunch: () => { scheduled++; }, exit: () => { exited++; }, failed: () => { quitting = false; } });
  await expect(relaunch()).rejects.toBe(failure);
  expect(quitting).toBe(false); expect(scheduled).toBe(0); expect(exited).toBe(0);
  fail = false; await relaunch();
  expect(quitting).toBe(true); expect(scheduled).toBe(1); expect(exited).toBe(1);
});
