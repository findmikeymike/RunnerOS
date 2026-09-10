import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess, type RunningProcess } from './process-support';
test('SIGKILL after fallback decision never retries exhausted original provider on reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fallback-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'fallback-test');
  let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'fallback-transition-worker.ts'), root, 'start']);
    await child.line(line => line.includes('provider-failure-saved'));
    child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
    child = startProcess([join(import.meta.dir, 'fallback-transition-worker.ts'), root, 'recover']);
    const result = await child.done;
    expect({ code: result.code, stderr: result.code ? result.stderr : '' }).toEqual({ code: 0, stderr: '' });
    expect(result.stdout).toContain('"result":"succeeded"');
    expect(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n')).toEqual(['primary', 'backup']);
  } finally { if (child?.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; } rmSync(root, { recursive: true, force: true }); }
}, 30000);
