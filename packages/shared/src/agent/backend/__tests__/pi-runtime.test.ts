import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { requirePiBunRuntime } from '../internal/pi-runtime.ts';

test('accepts the actual Bun runtime used to run the Pi bundle', () => {
  expect(requirePiBunRuntime(process.execPath)).toBe(process.execPath);
});

test('missing or unavailable runtime fails immediately with repair instructions', () => {
  expect(() => requirePiBunRuntime(undefined)).toThrow('Reinstall Artist OS');
  expect(() => requirePiBunRuntime('/nonexistent/artist-os-bun')).toThrow('Reinstall Artist OS');
});

test('plain Node cannot substitute for the Bun-targeted Pi bundle', () => {
  const nodePath = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]!;
  expect(() => requirePiBunRuntime(nodePath)).toThrow('Bun runtime');
});
