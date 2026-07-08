#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const vendorRoot = join(toolRoot, 'vendor', 'genesis');
const pythonScript = join(here, 'genesis_lyric.py');
const args = process.argv.slice(2);
const command = args[0] ?? 'help';

function jsonMode() {
  return args.includes('--json');
}

function print(payload) {
  if (jsonMode()) console.log(JSON.stringify(payload, null, 2));
  else if (payload.lines) console.log(payload.lines.join('\n'));
  else console.log(JSON.stringify(payload, null, 2));
}

function usage() {
  print({
    ok: true,
    lines: [
      'runneros-genesis-lyric',
      '',
      'Commands:',
      '  doctor --json',
      '  storyboard --brief-file brief.json --json',
      '  plan --brief-file brief.json --json',
      '  preflight --brief-file brief.json --json',
      '  render --brief-file brief.json --approved --json',
      '',
      'Storyboard is no-spend Genesis director planning for shots, image prompts, and motion prompts.',
      'Render accepts existing video_file/image_file assets and burns lyric captions with the audio.',
    ],
  });
}

if (command === 'help' || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

if (!existsSync(pythonScript)) {
  print({ ok: false, error: `Missing Genesis lyric helper: ${pythonScript}` });
  process.exit(1);
}

function firstNonEmpty(...values) {
  return values.map((value) => value?.trim()).find(Boolean);
}

function resolvePythonRuntime() {
  const explicitPython = firstNonEmpty(process.env.GENESIS_LYRIC_PYTHON);
  if (explicitPython) return { command: explicitPython, argsPrefix: [] };

  const uv = firstNonEmpty(process.env.CRAFT_UV);
  if (uv) return { command: uv, argsPrefix: ['run', '--python', '3.12'] };

  const python = firstNonEmpty(process.env.PYTHON);
  if (python) return { command: python, argsPrefix: [] };

  return { command: 'python3', argsPrefix: [] };
}

const runtime = resolvePythonRuntime();
const env = {
  ...process.env,
  PYTHONPATH: [vendorRoot, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
  GENESIS_LYRIC_TOOL_ROOT: toolRoot,
  GENESIS_LYRIC_VENDOR_ROOT: vendorRoot,
};

const result = spawnSync(runtime.command, [...runtime.argsPrefix, pythonScript, ...args], {
  cwd: toolRoot,
  env,
  encoding: 'utf-8',
  maxBuffer: 8 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (!result.stdout && result.status !== 0) {
  print({
    ok: false,
    error: 'Genesis lyric helper failed before producing output',
    runtime: runtime.command,
    status: result.status,
  });
}

process.exit(result.status ?? 1);
