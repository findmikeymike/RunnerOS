import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

test('SIGKILL between durable steps preserves completed output and resumes only unfinished work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-multistep-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'multistep-crash-fixture');
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
  let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'multistep-start-worker.ts'), root, 'start'], env);
    const saved = JSON.parse(await child.line(line => line.includes('"barrier":"between-steps"')));
    expect(saved.journal.status).toBe('running');
    expect(saved.journal.workflowSteps[0].output).toBe('First result: exact durable text.');
    expect(saved.journal.workflowSteps[0].endTurn).toBe(1);
    expect(saved.journal.workflowSteps[1].startTurn).toBe(1);
    expect(saved.journal.workflowSteps[1].endTurn).toBeUndefined();
    expect(saved.projected.steps.map((step: { state: string }) => step.state)).toEqual(['succeeded', 'running']);
    expect(saved.journal.modelAttempts).toBe(1);
    expect(saved.journal.reservedUnits).toBe(1);
    child.child.kill('SIGKILL');
    expect((await child.done).signal).toBe('SIGKILL');
    child = startProcess([join(import.meta.dir, 'multistep-start-worker.ts'), root, 'recover'], env);
    const result = await child.done;
    expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    const recovered = JSON.parse(result.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
    expect(recovered.creationsBeforeResume).toBe(0);
    expect(recovered.creations).toBe(1);
    expect(recovered.journalCount).toBe(1);
    expect(recovered.projectedBefore.state).toBe('interrupted');
    expect(recovered.projectedBefore.steps.map((step: { state: string }) => step.state)).toEqual(['succeeded', 'interrupted']);
    expect(recovered.before.workflowSteps).toEqual(saved.journal.workflowSteps);
    expect(recovered.after.workflowSteps[0]).toEqual(saved.journal.workflowSteps[0]);
    expect(recovered.after.spec).toEqual(saved.journal.spec);
    expect(recovered.after.modelAttempts).toBe(2);
    expect(recovered.after.reservedUnits).toBe(2);
    expect(recovered.after.spec.deadlineAt).toBe(saved.journal.spec.deadlineAt);
    expect(recovered.after.spec.costPolicy).toEqual(saved.journal.spec.costPolicy);
    expect(recovered.after.status).toBe('succeeded');
    expect(recovered.projectedAfter.steps.map((step: { state: string }) => step.state)).toEqual(['succeeded', 'succeeded']);
    expect(recovered.projectedAfter.steps.map((step: { output: string }) => step.output)).toEqual(['First result: exact durable text.', 'Second result: summary complete.']);
    const dispatches = readFileSync(join(root, 'model-dispatches'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(dispatches).toEqual([{ mode: 'start', step: 'read', prompt: 'Read local notes.' }, { mode: 'recover', step: 'summarize', prompt: 'Summarize this saved result: First result: exact durable text.' }]);
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
