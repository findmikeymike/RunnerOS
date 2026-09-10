import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';
test('SIGKILL after saved remote read resumes normal durable host without repeating fetch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-web-crash-')); writeFileSync(join(root, 'synthetic-only'), 'web-read-fixture');
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' }; let child: RunningProcess | undefined;
  try {
    child = startProcess([join(import.meta.dir, 'web-read-worker.ts'), root, 'start'], env);
    const admitted = JSON.parse(await child.line(line => line.includes('"barrier":"saved-web-result"')));
    expect(admitted.state.turns[0].calls[0].attempts).toBe(1); expect(admitted.state.turns[0].calls[0].result).toBeDefined();
    child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
    child = startProcess([join(import.meta.dir, 'web-read-worker.ts'), root, 'recover'], env); const done = await child.done;
    expect({ code: done.code, error: done.code ? done.stderr : '' }).toEqual({ code: 0, error: '' });
    const recovered = JSON.parse(done.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
    expect(recovered.after.status).toBe('succeeded'); expect(recovered.after.spec.webReadUrls).toEqual(['https://example.com/article']); expect(recovered.after.turns[0].calls[0].attempts).toBe(1);
    expect(readFileSync(join(root, 'remote-dispatches'), 'utf8')).toBe('fetch\n');
  } finally { if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; } rmSync(root, { recursive: true, force: true }); }
}, 45000);
