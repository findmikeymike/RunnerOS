import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

test('SIGKILL preserves admitted skill references and preferences; only a new run uses changed preferences', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-skill-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'skill-snapshot-fixture');
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
  let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'skill-snapshot-worker.ts'), root, 'start'], env);
    await child.line(line => line.includes('"barrier":"saved-skill-model"'));
    child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
    for (const mode of ['recover', 'new']) {
      child = startProcess([join(import.meta.dir, 'skill-snapshot-worker.ts'), root, mode], env);
      const done = await child.done;
      expect({ code: done.code, error: done.code ? done.stderr : '' }).toEqual({ code: 0, error: '' });
      expect(done.stdout.includes('"publicHistorySafe":true')).toBe(true);
      expect(done.stdout.includes('PRIVATE_PREFERENCE_')).toBe(false);
      expect(done.stdout.includes('private-durable-skill-guidance')).toBe(false);
    }
    // Recovery reuses the completed model turn; the fresh run dispatches once with new preferences.
    expect(readFileSync(join(root, 'model-dispatches'), 'utf8')).toBe('start\nnew\n');
  } finally {
    if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
