#!/usr/bin/env node

import { accessSync, closeSync, constants, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const repoRoot = resolve(toolDir, '..', '..');
const platformDir = `${process.platform}-${process.arch}`;
const binaryName = process.platform === 'win32' ? 'printify-pp-cli.exe' : 'printify-pp-cli';

function hasFlag(args, flag) {
  return args.includes(flag);
}

function jsonOut(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function pathCandidates() {
  const candidates = [];
  if (process.env.PRINTIFY_PP_CLI) candidates.push(process.env.PRINTIFY_PP_CLI);
  if (process.env.CRAFT_RESOURCES_BASE) {
    candidates.push(join(process.env.CRAFT_RESOURCES_BASE, 'resources', 'bin', platformDir, binaryName));
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app', 'resources', 'bin', platformDir, binaryName));
  }
  if (process.env.RUNNEROS_DISABLE_PRINTIFY_BUNDLED_CLI !== '1') {
    candidates.push(join(toolDir, 'bin', platformDir, binaryName));
    candidates.push(join(repoRoot, 'apps', 'electron', 'resources', 'bin', platformDir, binaryName));
    candidates.push(join(repoRoot, 'resources', 'bin', platformDir, binaryName));
    candidates.push(join(repoRoot, 'bin', platformDir, binaryName));
  }
  candidates.push(join(homedir(), '.local', 'bin', binaryName));
  candidates.push(binaryName);
  return candidates;
}

function resolveBinary() {
  for (const candidate of pathCandidates()) {
    if (candidate === binaryName) {
      const onPath = findExecutableOnPath(binaryName);
      if (onPath) return onPath;
      continue;
    }
    if (isRunnableFile(candidate)) return candidate;
  }
  return null;
}

function findExecutableOnPath(command) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (isRunnableFile(candidate)) return candidate;
  }
  return null;
}

function isRunnableFile(candidate) {
  if (!existsSync(candidate)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isSafeReadLike(args) {
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const command = positional[0]?.toLowerCase();
  if (!command) return true;

  const safeCommands = new Set([
    'agent-context',
    'analytics',
    'api',
    'asset-reuse',
    'catalog',
    'catalog-margin-matrix',
    'completion',
    'doctor',
    'fulfillment-risk',
    'help',
    'personalization-audit',
    'personalization-batch',
    'placement-matrix',
    'product-drift',
    'search',
    'shops-json',
    'uploads-json',
    'version',
    'which',
  ]);

  return safeCommands.has(command);
}

function isPrivateDraftWrite(args) {
  if (!hasFlag(args, '--private-draft')) return false;
  const positional = args.filter((arg) => !arg.startsWith('--'));
  return (
    positional[0]?.toLowerCase() === 'uploads'
    && positional[1]?.toLowerCase() === 'an-image'
  ) || (
    positional[0]?.toLowerCase() === 'shops'
    && positional[1]?.toLowerCase() === 'products-json'
    && positional[2]?.toLowerCase() === 'create-anew-product'
  );
}

const inputDigestFlag = '--runner-input-sha256';

function importInput(args) {
  // Native persistent flags may precede the subcommand. Skip their values,
  // which can themselves be named 'import'. Equals forms are already one arg.
  const valuedGlobalFlags = new Set([
    '--config', '--deliver', '--data-source', '--max-age', '--profile',
    '--select', '--rate-limit', '--timeout',
  ]);
  let commandIndex = 0;
  while (commandIndex < args.length && args[commandIndex].startsWith('-')) {
    const arg = args[commandIndex++];
    if (arg === '--') break;
    if (valuedGlobalFlags.has(arg)) commandIndex++;
  }
  if (args[commandIndex] !== 'import') return null;
  const matches = [];
  for (let i = commandIndex + 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      matches.push({ index: i, length: 2, path: args[++i] });
    } else if (arg.startsWith('--input=') || arg.startsWith('-i=')) {
      matches.push({ index: i, length: 1, path: arg.slice(arg.indexOf('=') + 1) });
    } else if (arg.startsWith('-i') && !arg.startsWith('--')) {
      matches.push({ index: i, length: 1, path: arg.slice(2) });
    }
  }
  if (matches.length > 1) throw new Error('Import approval requires an unambiguous input: specify --input or -i once.');
  const input = matches.at(-1);
  if (!input?.path || input.path === '-') return null;
  return input;
}

function readImportBytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Import input must be a readable regular file.');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function inputDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function extractInputDigest(args) {
  const clean = [];
  let expected;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === inputDigestFlag || args[i].startsWith(`${inputDigestFlag}=`)) {
      if (expected !== undefined) throw new Error('Duplicate import approval digest.');
      expected = args[i] === inputDigestFlag ? args[++i] : args[i].slice(inputDigestFlag.length + 1);
      if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Invalid import approval digest.');
    } else clean.push(args[i]);
  }
  return { args: clean, expected };
}

function approvalPacket(args) {
  const safeArgs = redactSensitiveArgs(args);
  const commandArgv = ['node', 'bin/printify.mjs', ...safeArgs];
  const input = importInput(args);
  const digest = input ? inputDigest(readImportBytes(input.path)) : undefined;
  const approveArgv = [...commandArgv, '--confirm-runner', ...(digest ? [inputDigestFlag, digest] : [])];
  return {
    ok: true,
    requiresApproval: true,
    operation: 'printify.write',
    message: 'No Printify changes were made. Run with --dry-run for provider preview or rerun with --confirm-runner after explicit user approval.',
    command: commandArgv.map(shellQuote).join(' '),
    approveCommand: approveArgv.map(shellQuote).join(' '),
    argv: commandArgv,
    approveArgv,
  };
}

function shellQuote(arg) {
  if (arg === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

function redactSensitiveArgs(args) {
  const sensitiveName = /token|secret|password|bearer|authorization|api[-_]?key/i;
  const redacted = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push('[redacted]');
      redactNext = false;
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const name = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    if (sensitiveName.test(name)) {
      redacted.push(eqIndex === -1 ? arg : `${name}=[redacted]`);
      if (eqIndex === -1) redactNext = true;
    } else {
      redacted.push(arg);
    }
  }
  return redacted;
}

function installationHelp(exitCode = 127) {
  jsonOut({
    ok: false,
    error: 'printify-pp-cli binary not found or not executable',
    checked: pathCandidates(),
    fix: 'Install with `npx -y @mvanhorn/printing-press-library install printify --cli-only`, bundle printify-pp-cli under tools/printify/bin/<platform-arch>/, or set PRINTIFY_PP_CLI.',
  }, exitCode);
}

function doctor(binary, args) {
  const tokenConfigured = Boolean(process.env.PRINTIFY_API_TOKEN?.trim());
  if (!binary) {
    installationHelp(127);
    return true;
  }
  if (!tokenConfigured) {
    jsonOut({
      ok: false,
      connectionStatus: 'needs_auth',
      fix: 'Save PRINTIFY_API_TOKEN in RunnerOS Settings -> Secrets.',
    }, 1);
    return true;
  }

  const result = spawnSync(binary, ['doctor', ...args.filter((arg) => arg !== 'doctor')], {
    stdio: 'inherit',
    env: buildEnv(),
  });
  process.exitCode = result.status ?? 0;
  return true;
}

function buildEnv() {
  const env = { ...process.env };
  if (env.PRINTIFY_API_TOKEN && !env.PRINTIFY_BEARER_AUTH) {
    env.PRINTIFY_BEARER_AUTH = env.PRINTIFY_API_TOKEN;
  }
  return env;
}

function main() {
  const { args, expected } = extractInputDigest(process.argv.slice(2));
  const binary = resolveBinary();
  const confirmed = hasFlag(args, '--confirm-runner');
  const dryRun = hasFlag(args, '--dry-run');
  const privateDraft = isPrivateDraftWrite(args);
  const passthroughArgs = args.filter((arg) => arg !== '--confirm-runner' && arg !== '--private-draft');

  if (args[0] === 'doctor') {
    doctor(binary, args.slice(1));
  } else if (!isSafeReadLike(args) && !dryRun && !confirmed && !privateDraft) {
    jsonOut(approvalPacket(args));
  } else {
    if (!binary) {
      installationHelp(127);
    } else {
      let snapshotDir;
      try {
        const input = confirmed && !dryRun ? importInput(passthroughArgs) : null;
        if (input) {
          if (!expected) throw new Error('Import approval digest missing. Run without --confirm-runner and use the returned approveCommand.');
          const bytes = readImportBytes(input.path);
          if (inputDigest(bytes) !== expected) throw new Error('Import input changed since review. Request approval for the updated file.');
          snapshotDir = mkdtempSync(join(tmpdir(), 'runneros-printify-import-'));
          const snapshot = join(snapshotDir, 'input.jsonl');
          writeFileSync(snapshot, bytes, { mode: 0o400, flag: 'wx' });
          passthroughArgs.splice(input.index, input.length, '--input', snapshot);
        }
        const result = spawnSync(binary, passthroughArgs.length ? passthroughArgs : ['--help'], {
          stdio: 'inherit',
          env: buildEnv(),
        });

        if (result.error) {
          console.error(result.error.message);
          process.exitCode = 1;
          return;
        }

        process.exitCode = result.status ?? 0;
      } finally {
        if (snapshotDir) rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  }
}
try {
  main();
} catch (error) {
  jsonOut({ ok: false, error: error.message }, 1);
}
