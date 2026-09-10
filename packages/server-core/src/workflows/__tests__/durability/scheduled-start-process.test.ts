import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

test('SIGKILL after scheduled journal admission reconciles the persisted attempt without a second dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-scheduled-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'scheduled-crash-fixture');
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
  let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'scheduled-start-worker.ts'), root, 'start'], env);
    const admitted = JSON.parse(await child.line(line => line.includes('"barrier":"admitted-before-reply"')));
    expect(admitted.order.status).toBe('running');
    expect(admitted.order.runs).toHaveLength(1);
    expect(admitted.order.runs[0].id).toBe(admitted.attemptId);
    expect(admitted.order.runs[0].workflowRunId).toBeUndefined();
    child.child.kill('SIGKILL');
    expect((await child.done).signal).toBe('SIGKILL');
    child = startProcess([join(import.meta.dir, 'scheduled-start-worker.ts'), root, 'recover'], env);
    const result = await child.done;
    expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    const recovered = JSON.parse(result.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
    expect(recovered.before.runs[0].workflowRunId).toBeUndefined();
    expect(recovered.after.runs).toHaveLength(1);
    expect(recovered.after.runs[0].id).toBe(admitted.attemptId);
    expect(recovered.after.runs[0].workflowRunId).toBe(admitted.runId);
    // Keep the scheduled claim attached while the saved run awaits explicit Resume.
    expect(recovered.after.status).toBe('running');
    expect(recovered.starts).toBe(0);
    expect(recovered.recoveries).toBe(1);
    expect(recovered.journalCount).toBe(1);
    expect(recovered.journal.spec.runId).toBe(admitted.runId);
    expect(recovered.journal.reservedUnits).toBe(1);
    expect(recovered.journal.reservedUnits).toBe(admitted.journal.reservedUnits);
    expect(recovered.journal.spec.deadlineAt).toBe(admitted.journal.spec.deadlineAt);
    expect(recovered.journal.spec.costPolicy).toEqual(admitted.journal.spec.costPolicy);
    expect(recovered.projected.state).toBe('interrupted');
    expect(readFileSync(join(root, 'start-dispatches'), 'utf8')).toBe('start\n');
    expect(readFileSync(join(root, 'model-dispatches'), 'utf8')).toBe('dispatch\n');
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
