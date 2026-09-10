import * as filesystem from 'node:fs';
import * as processIdentity from '../durable-execution/process-identity';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, lstatSync, utimesSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withOutputBundleLock } from './storage';
const roots: string[] = [], children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGKILL'); await exited;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'output-lock-')); roots.push(root);
  const id = randomUUID(), path = join(root, 'context', '.locks', 'outputs', `${id}.lock`);
  mkdirSync(join(root, 'context', '.locks', 'outputs'), { recursive: true });
  return { root, id, path };
}
function worker(f: ReturnType<typeof fixture>, mode: string) {
  const marker = join(f.root, randomUUID());
  const child = spawn(process.execPath, [join(import.meta.dir, 'output-lock-worker.ts'), f.root, f.id, mode, marker], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let errors = ''; child.stderr!.on('data', chunk => { errors += chunk; });
  const done = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { child, marker, done, errors: () => errors };
}
async function ready(w: ReturnType<typeof worker>) {
  for (let i = 0; i < 500 && !existsSync(w.marker); i++) {
    if (w.child.exitCode !== null) throw new Error(`worker exited: ${w.errors()}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(existsSync(w.marker)).toBe(true);
}
async function kill(w: ReturnType<typeof worker>) { w.child.kill('SIGKILL'); await w.done; }
for (const boundary of ['before-link', 'after-link']) test(`SIGKILL ${boundary} never leaves an ownerless blocking lock`, async () => {
  const f = fixture(), w = worker(f, boundary); await ready(w);
  if (boundary === 'before-link') expect(existsSync(f.path)).toBe(false);
  else { expect(lstatSync(f.path).isFile()).toBe(true); expect(JSON.parse(readFileSync(f.path, 'utf8')).pid).toBe(w.child.pid); }
  await kill(w);
  let entered = false; withOutputBundleLock(f.root, f.id, () => { entered = true; }); expect(entered).toBe(true); expect(existsSync(f.path)).toBe(false);
}, 10000);

test('two dead-owner recovery contenders execute exclusively', async () => {
  const f = fixture(), dead = worker(f, 'after-link'); await ready(dead); await kill(dead);
  const a = worker(f, 'normal'), b = worker(f, 'normal');
  expect(await a.done).toBe(0); expect(await b.done).toBe(0);
  expect(readFileSync(join(f.root, 'completed'), 'utf8').trim().split('\n')).toHaveLength(2);
}, 10000);

test('a crashed reclaimer can itself be recovered by concurrent contenders', async () => {
  const f = fixture(), dead = worker(f, 'after-link'); await ready(dead); await kill(dead);
  const reclaimer = worker(f, 'reclaimer'); await ready(reclaimer); await kill(reclaimer);
  const a = worker(f, 'normal'), b = worker(f, 'normal');
  expect(await a.done).toBe(0); expect(await b.done).toBe(0);
  expect(readFileSync(join(f.root, 'completed'), 'utf8').trim().split('\n')).toHaveLength(2);
}, 10000);

test('paused live writer is never stolen; contender proceeds after its death', async () => {
  const f = fixture(), holder = worker(f, 'hold'); await ready(holder); holder.child.kill('SIGSTOP');
  const contender = worker(f, 'normal'); await new Promise(resolve => setTimeout(resolve, 200));
  expect(existsSync(contender.marker)).toBe(false); expect(JSON.parse(readFileSync(f.path, 'utf8')).pid).toBe(holder.child.pid);
  await kill(holder); expect(await contender.done).toBe(0);
}, 10000);

test('legacy directory owner interoperability stays safe', async () => {
  const f = fixture(), dead = worker(f, 'after-link'); await ready(dead); const owner = readFileSync(f.path, 'utf8'); await kill(dead);
  rmSync(f.path); mkdirSync(f.path); writeFileSync(join(f.path, 'owner.json'), owner);
  expect(withOutputBundleLock(f.root, f.id, () => 'recovered')).toBe('recovered');
  mkdirSync(f.path); writeFileSync(join(f.path, 'owner.json'), JSON.stringify({ pid: process.pid, hostname: hostname(), token: 'live' }));
  expect(() => withOutputBundleLock(f.root, f.id, () => 'bad')).toThrow('busy');
}, 10000);

test('bounded reclaimer recovery and legacy ownerless locks fail closed', async () => {
  const f = fixture(), dead = worker(f, 'after-link'); await ready(dead);
  const deadOwner = JSON.parse(readFileSync(f.path, 'utf8')); await kill(dead);
  let path = f.path;
  const paths = [path];
  for (let index = 0; index < 16; index++) {
    const stat = lstatSync(path), owner = JSON.parse(readFileSync(path, 'utf8'));
    const identity = JSON.stringify([stat.dev, stat.ino, stat.birthtimeMs, owner.token]);
    path = join(f.root, 'context', '.locks', 'outputs', `.reclaim-${createHash('sha256').update(path + identity).digest('hex')}.lock`);
    writeFileSync(path, JSON.stringify({ ...deadOwner, token: randomUUID() })); paths.push(path);
  }
  let now = Date.now(); const clock = spyOn(Date, 'now').mockImplementation(() => now += 20_000);
  try { expect(() => withOutputBundleLock(f.root, f.id, () => 'bad')).toThrow('Timed out'); }
  finally { clock.mockRestore(); }
  expect(paths.every(path => existsSync(path))).toBe(true);
  const legacy = fixture(); mkdirSync(legacy.path);
  now = Date.now(); const legacyClock = spyOn(Date, 'now').mockImplementation(() => now += 20_000);
  try { expect(() => withOutputBundleLock(legacy.root, legacy.id, () => 'bad')).toThrow('Timed out'); }
  finally { legacyClock.mockRestore(); }
  expect(lstatSync(legacy.path).isDirectory()).toBe(true);
}, 10000);

test('failed prepared-file cleanup cannot strand an acquired live lock', () => {
  const f = fixture();
  const original = filesystem.unlinkSync;
  const cleanupFailure = spyOn(filesystem, 'unlinkSync').mockImplementation(path => {
    if (String(path).includes('.owner-')) throw new Error('simulated cleanup failure');
    original(path);
  });
  try { expect(withOutputBundleLock(f.root, f.id, () => 'entered')).toBe('entered'); }
  finally { cleanupFailure.mockRestore(); }
  expect(existsSync(f.path)).toBe(false);
  expect(withOutputBundleLock(f.root, f.id, () => 'again')).toBe('again');
});

test('OS birth identity recovers reused PID while unavailable inspection keeps live ownership', () => {
  const f = fixture();
  const owner = { token: 'prior-owner', pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString(), processIdentity: 'os:fixture:old' };
  writeFileSync(f.path, JSON.stringify(owner));
  const identity = spyOn(processIdentity, 'readProcessIdentity').mockReturnValue('os:fixture:new');
  try { expect(withOutputBundleLock(f.root, f.id, () => 'recovered')).toBe('recovered'); }
  finally { identity.mockRestore(); }
  writeFileSync(f.path, JSON.stringify(owner));
  const unavailable = spyOn(processIdentity, 'readProcessIdentity').mockReturnValue(null);
  try { expect(() => withOutputBundleLock(f.root, f.id, () => 'bad')).toThrow('busy'); }
  finally { unavailable.mockRestore(); }
  expect(JSON.parse(readFileSync(f.path, 'utf8')).token).toBe('prior-owner');
});

test('aged ownerless legacy lock never steals from a suspended writer', async () => {
  const f = fixture(), holder = worker(f, 'legacy-ownerless'); await ready(holder);
  holder.child.kill('SIGSTOP');
  const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  utimesSync(f.path, old, old);
  let now = Date.now(); const clock = spyOn(Date, 'now').mockImplementation(() => now += 20_000);
  try { expect(() => withOutputBundleLock(f.root, f.id, () => 'stolen')).toThrow('Timed out'); }
  finally { clock.mockRestore(); }
  expect(lstatSync(f.path).isDirectory()).toBe(true);
  expect(holder.child.exitCode).toBeNull();
  await kill(holder);
  // Even after death the ownerless artifact contains no proof linking it to that PID.
  now = Date.now(); const laterClock = spyOn(Date, 'now').mockImplementation(() => now += 20_000);
  try { expect(() => withOutputBundleLock(f.root, f.id, () => 'guessed')).toThrow('Timed out'); }
  finally { laterClock.mockRestore(); }
  expect(existsSync(f.path)).toBe(true);
}, 10000);
