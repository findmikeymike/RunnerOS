import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runVideoStudioProcess } from './video-studio-process';
import { VIDEO_RENDER_TIMEOUT_MS, rpcHandlerTimeout, rpcRequestTimeout } from '../../transport/timeout-policy';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture(code: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'video-process-'));
  roots.push(cwd);
  const file = join(cwd, 'worker.mjs');
  writeFileSync(file, code);
  return { cwd, file };
}

test('render subprocess leaves the server event loop responsive and captures results', async () => {
  const { cwd, file } = fixture('setTimeout(() => console.log("rendered"), 150)');
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 20);
  const result = await runVideoStudioProcess([file], { cwd });
  clearTimeout(timer);
  expect(timerRan).toBe(true);
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('rendered');
});

test('failed render reports nonzero status and diagnostics', async () => {
  const { cwd, file } = fixture('console.error("bad input"); process.exit(7)');
  const result = await runVideoStudioProcess([file], { cwd });
  expect(result.status).toBe(7);
  expect(result.stderr).toContain('bad input');
});

test('timed out render is terminated and reported as failure', async () => {
  const { cwd, file } = fixture('setInterval(() => {}, 1000)');
  const result = await runVideoStudioProcess([file], { cwd, timeoutMs: 100 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('time limit');
});

test('unbounded render diagnostics are stopped', async () => {
  const { cwd, file } = fixture('process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)');
  const result = await runVideoStudioProcess([file], { cwd, maxOutputBytes: 1024 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('too much');
  expect(result.stdout.length).toBeLessThanOrEqual(1024);
});

test('export response deadlines outlive the bounded child, without changing ordinary RPCs', () => {
  const channel = RPC_CHANNELS.videoStudio.EXPORT;
  expect(rpcHandlerTimeout(channel, 60_000)).toBeGreaterThan(VIDEO_RENDER_TIMEOUT_MS);
  expect(rpcRequestTimeout(channel, 30_000)).toBeGreaterThan(rpcHandlerTimeout(channel, 60_000));
  expect(rpcHandlerTimeout('ordinary', 60_000)).toBe(60_000);
  expect(rpcRequestTimeout('ordinary', 30_000)).toBe(30_000);
});


test.skipIf(process.platform === 'win32')('timeout also stops the renderer descendant', async () => {
  const { cwd, file } = fixture(`import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('late-output', 'bad'), 300)"], { stdio: 'inherit' });
setInterval(() => {}, 1000);`);
  const result = await runVideoStudioProcess([file], { cwd, timeoutMs: 120 });
  expect(result.status).not.toBe(0);
  await Bun.sleep(400);
  expect(existsSync(join(cwd, 'late-output'))).toBe(false);
});
