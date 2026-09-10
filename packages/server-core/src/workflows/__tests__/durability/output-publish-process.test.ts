import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

test('SIGKILL after bundle publication reuses saved output on explicit Resume without model replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-output-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'output-publish-fixture');
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
  let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'output-publish-worker.ts'), root, 'start'], env);
    const admitted = JSON.parse(await child.line(line => line.includes('"barrier":"bundle-before-receipt"')));
    expect(admitted.state.status).toBe('running');
    expect(admitted.state.publication.status).toBe('pending');
    expect(admitted.outputs).toHaveLength(1);
    const outputId = admitted.outputs[0].id;
    const content = join(root, 'outputs', outputId, 'content.md');
    const manifest = join(root, 'outputs', outputId, 'output.json');
    const bytes = readFileSync(content), manifestBytes = readFileSync(manifest);
    const modified = statSync(content).mtimeMs, manifestModified = statSync(manifest).mtimeMs;
    child.child.kill('SIGKILL');
    expect((await child.done).signal).toBe('SIGKILL');
    child = startProcess([join(import.meta.dir, 'output-publish-worker.ts'), root, 'recover'], env);
    const result = await child.done;
    expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
    const recovered = JSON.parse(result.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
    expect(recovered.before.publication.status).toBe('pending');
    expect(recovered.projectedBefore.state).toBe('interrupted');
    expect(recovered.attemptsBefore).toBe('publish\n');
    expect(recovered.after.status).toBe('succeeded');
    expect(recovered.projectedAfter.finalOutputId).toBe(outputId);
    expect(recovered.outputs).toHaveLength(1);
    expect(recovered.after.spec.runId).toBe(admitted.state.spec.runId);
    expect(recovered.after.reservedUnits).toBe(admitted.state.reservedUnits);
    expect(recovered.after.spec.deadlineAt).toBe(admitted.state.spec.deadlineAt);
    expect(recovered.after.spec.costPolicy).toEqual(admitted.state.spec.costPolicy);
    expect(readFileSync(join(root, 'model-dispatches'), 'utf8')).toBe('model\n');
    expect(readFileSync(join(root, 'publish-attempts'), 'utf8')).toBe('publish\npublish\n');
    expect(readFileSync(content)).toEqual(bytes);
    expect(readFileSync(manifest)).toEqual(manifestBytes);
    expect(statSync(content).mtimeMs).toBe(modified);
    expect(statSync(manifest).mtimeMs).toBe(manifestModified);
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
