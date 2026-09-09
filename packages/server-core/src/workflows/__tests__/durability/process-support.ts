import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureJournal } from './fixture-journal.ts';

export function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'artist-os-durability-'));
  writeFileSync(join(root, 'fixture-only'), 'SYNTHETIC DATA ONLY\n', { mode: 0o600 });
  return root;
}
export const fixtureKey = (): Buffer => randomBytes(32);
const workerPath = join(import.meta.dir, 'fixture-worker.ts');
const providerPath = join(import.meta.dir, 'fixture-provider.ts');
export interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  done: Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>;
  line: (predicate: (line: string) => boolean) => Promise<string>;
}
export function startProcess(args: string[], env: NodeJS.ProcessEnv = {}, executable = process.execPath, timeoutMs = 20_000): RunningProcess {
  const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: 'pipe' });
  let stdout = '', stderr = '', exited = false;
  const pending = new Set<{ predicate: (line: string) => boolean; resolve: (line: string) => void; reject: (error: Error) => void }>();
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    for (const wait of pending) {
      const found = stdout.split('\n').find(wait.predicate);
      if (found) { pending.delete(wait); wait.resolve(found); }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const done = new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on('error', error => { clearTimeout(timeout); exited = true; for (const p of pending) p.reject(error); pending.clear(); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout); exited = true;
      for (const p of pending) p.reject(new Error(`Process exited before barrier (${code}/${signal}): ${stderr}`));
      pending.clear(); resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, done, line: predicate => {
    const found = stdout.split('\n').find(predicate);
    if (found) return Promise.resolve(found);
    if (exited) return Promise.reject(new Error('Process already exited: ' + stderr));
    return new Promise((resolve, reject) => pending.add({ predicate, resolve, reject }));
  } };
}
export function worker(root: string, key: Buffer, action: string, id: string, endpoint = '', barrier = ''): RunningProcess {
  return startProcess([workerPath, root, action, id, endpoint, barrier], { DURABILITY_FIXTURE_KEY: key.toString('hex') });
}
export async function killAt(root: string, key: Buffer, action: string, id: string, endpoint: string, barrier: string): Promise<void> {
  const proc = worker(root, key, action, id, endpoint, barrier);
  try {
    await proc.line(line => line.includes('"barrier":"' + barrier + '"'));
    proc.child.kill('SIGKILL');
    const result = await proc.done;
    if (result.signal !== 'SIGKILL') throw new Error('Expected supervisor SIGKILL');
  } finally { if (proc.child.exitCode === null) proc.child.kill('SIGKILL'); }
}
export async function runWorker(root: string, key: Buffer, id: string, endpoint: string): Promise<void> {
  const result = await worker(root, key, 'recover', id, endpoint).done;
  if (result.code !== 0) throw new Error(result.stderr);
}
export async function provider(): Promise<{ endpoint: string; stats: () => Promise<{ calls: { id: string; count: number }[]; effects: { id: string }[] }>; stop: () => Promise<void> }> {
  const root = fixtureRoot();
  const proc = startProcess([providerPath, root], {}, process.execPath, 600_000);
  const line = await proc.line(line => line.startsWith('{"port":'));
  // Provider outlives hundreds of short-lived app workers; its test lifetime is controlled explicitly.
  const endpoint = 'http://127.0.0.1:' + JSON.parse(line).port;
  return {
    endpoint,
    stats: async () => (await fetch(endpoint + '/stats', { method: 'POST', body: '{}', signal: AbortSignal.timeout(1500) })).json() as Promise<{ calls: { id: string; count: number }[]; effects: { id: string }[] }>,
    stop: async () => { proc.child.kill('SIGKILL'); await proc.done; rmSync(root, { recursive: true, force: true }); },
  };
}
export function approve(journal: FixtureJournal, id: string): void {
  journal.command(id, 'fixture', 'approve-' + id, 'approve', journal.read(id).approval!.digest);
}
