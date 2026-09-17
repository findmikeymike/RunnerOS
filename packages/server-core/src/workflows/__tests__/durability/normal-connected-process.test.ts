import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProcess, type RunningProcess } from './process-support';

function dispatches(root: string, name: string): any[] {
 const path = join(root, name);
 return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
for (const scenario of ['saved', 'inflight', 'rotated'] as const) {
 test(`normal connected workflow recovers after SIGKILL with ${scenario} read`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-connected-crash-'));
  writeFileSync(join(root, 'synthetic-only'), 'normal-connected-fixture');
  writeFileSync(join(root, 'credential'), 'synthetic-account-secret');
  const directory = join(root, 'sources', 'account'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ id: 'source', slug: 'account', name: 'Account', provider: 'fixture', type: 'api', enabled: true, isAuthenticated: true, api: { baseUrl: 'https://api.spotify.com/v1/', authType: 'bearer' } }));
  const env = { CRAFT_CONFIG_DIR: join(root, 'config'), CRAFT_PRODUCT_VARIANT: 'artist-os' };
  let child: RunningProcess | undefined;
  try {
   child = startProcess([join(import.meta.dir, 'normal-connected-worker.ts'), root, scenario === 'inflight' ? 'start-inflight' : 'start-saved'], env);
   const saved = JSON.parse(await child.line(line => line.includes('"barrier":"read-')));
   expect(saved.journal.status).toBe('running');
   expect(saved.journal.operations[0].status).toBe(scenario === 'inflight' ? 'inflight' : 'succeeded');
   expect(saved.journal.modelAttempts).toBe(0);
   expect(saved.journal.reservedUnits).toBe(0);
   expect(saved.journal.approvals).toEqual([]);
   expect(dispatches(root, 'get-dispatches')).toHaveLength(1);
   expect(dispatches(root, 'model-dispatches')).toEqual([]);
   child.child.kill('SIGKILL'); expect((await child.done).signal).toBe('SIGKILL');
   if (scenario === 'rotated') writeFileSync(join(root, 'credential'), 'rotated-account-secret');
   child = startProcess([join(import.meta.dir, 'normal-connected-worker.ts'), root, scenario === 'rotated' ? 'recover-rotated' : 'recover'], env);
   const result = await child.done;
   expect({ code: result.code, error: result.code ? result.stderr : '' }).toEqual({ code: 0, error: '' });
   let recovered = JSON.parse(result.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
   expect(recovered.creationsBeforeResume).toBe(0);
   expect(recovered.after.spec).toEqual(saved.journal.spec);
   expect(recovered.before.workflowSteps).toEqual(saved.journal.workflowSteps);
   expect(recovered.after.approvals).toEqual([]);
   if (scenario === 'rotated') {
    expect(recovered.after.status).toBe('paused');
    expect(recovered.creations).toBe(0);
    expect(dispatches(root, 'get-dispatches')).toHaveLength(1);
    expect(dispatches(root, 'model-dispatches')).toEqual([]);
    writeFileSync(join(root, 'credential'), 'synthetic-account-secret');
    child = startProcess([join(import.meta.dir, 'normal-connected-worker.ts'), root, 'recover-restored'], env);
    const restored = await child.done;
    expect({ code: restored.code, error: restored.code ? restored.stderr : '' }).toEqual({ code: 0, error: '' });
    recovered = JSON.parse(restored.stdout.split('\n').find(line => line.includes('"result":"recovered"'))!);
   }
   expect(recovered.after.status).toBe('succeeded');
   expect(recovered.after.modelAttempts).toBe(1);
   expect(recovered.after.reservedUnits).toBe(1);
   expect(recovered.after.approvals).toEqual([]);
   expect(recovered.after.operations[0].attempts).toHaveLength(scenario === 'inflight' ? 2 : 1);
   expect(dispatches(root, 'get-dispatches')).toHaveLength(scenario === 'inflight' ? 2 : 1);
   const models = dispatches(root, 'model-dispatches'); expect(models).toHaveLength(1);
   expect(JSON.stringify(models[0])).toContain('Saved fixture artist');
   expect(JSON.stringify(models[0])).not.toContain('synthetic-account-secret');
   if (saved.systemPrompt) {
    expect(models[0].systemPrompt).toBe(saved.systemPrompt);
    expect(recovered.after.operations[0]).toEqual(saved.journal.operations[0]);
   }
  } finally {
   if (child && child.child.exitCode === null) { child.child.kill('SIGKILL'); await child.done; }
   rmSync(root, { recursive: true, force: true });
  }
 }, 45_000);
}
