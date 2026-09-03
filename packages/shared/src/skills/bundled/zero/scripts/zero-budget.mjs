#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const VERSION = 1;
const MAX_LEDGER_ROWS = 500;

class CliError extends Error {
  constructor(message, code = 1, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function fail(message, code = 1, details = {}) {
  throw new CliError(message, code, details);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'json' || key === 'read-only') {
      values[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function validateArgs(command, values) {
  const allowed = {
    status: new Set(['json']),
    configure: new Set(['weekly-limit', 'json']),
    fetch: new Set(['capability', 'max-pay', 'method', 'data-json', 'read-only', 'json']),
  }[command];
  if (!allowed) fail('Usage: zero-budget.mjs <status|configure|fetch> [options]');
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) fail(`Unsupported option for ${command}: --${key}`);
  }
}

function dataRoot() {
  const configured = process.env.CRAFT_CONFIG_DIR?.trim();
  if (configured) return configured;
  return join(homedir(), process.env.CRAFT_PRODUCT_VARIANT === 'artist-os' ? '.artist-os' : '.craft-agent');
}

function paths() {
  const root = join(dataRoot(), 'integrations', 'zero');
  return { root, state: join(root, 'spend-policy.json'), lock: join(root, '.spend-policy.lock') };
}

function number(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    fail(`${label} must be ${allowZero ? 'zero or a positive number' : 'a positive number'}.`);
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function readState(statePath) {
  if (!existsSync(statePath)) return { version: VERSION, weeklyLimitUsd: null, updatedAt: null, ledger: [] };
  try {
    const value = JSON.parse(readFileSync(statePath, 'utf8'));
    return {
      version: VERSION,
      weeklyLimitUsd: Number.isFinite(value.weeklyLimitUsd) && value.weeklyLimitUsd >= 0 ? value.weeklyLimitUsd : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
      ledger: Array.isArray(value.ledger) ? value.ledger : [],
    };
  } catch {
    fail('Zero spend policy is unreadable. Repair or reconfigure it before spending.');
  }
}

function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}

function withLock(callback) {
  const { root, lock } = paths();
  mkdirSync(root, { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs <= 60_000) {
        fail('Another Zero budget operation is in progress. Try again later; do not bypass the guard.');
      }
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail('The Zero budget lock could not be recovered. Stop rather than bypassing the guard.');
    }
  }
  try {
    return callback();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function weekStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function currentLedger(state, now = new Date()) {
  const startMs = weekStart(now).getTime();
  return state.ledger.filter((entry) => Date.parse(entry.createdAt) >= startMs);
}

function entryCost(entry) {
  const value = Number(entry.status === 'settled' ? entry.actualUsd ?? entry.reservedUsd : entry.reservedUsd);
  if (!Number.isFinite(value) || value < 0) fail('Zero spend ledger contains an invalid charge. Repair it before spending.');
  return value;
}

function roundMoney(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function budgetStatus(state, now = new Date()) {
  const ledger = currentLedger(state, now);
  const spentUsd = ledger.reduce((sum, entry) => sum + entryCost(entry), 0);
  const weeklyLimitUsd = state.weeklyLimitUsd;
  return {
    configured: Number.isFinite(weeklyLimitUsd),
    weekStart: weekStart(now).toISOString(),
    weeklyLimitUsd,
    spentUsd: roundMoney(spentUsd),
    remainingUsd: Number.isFinite(weeklyLimitUsd) ? roundMoney(Math.max(0, weeklyLimitUsd - spentUsd)) : null,
    callsThisWeek: ledger.length,
  };
}

function paymentAmount(payment, fallback) {
  if (payment == null) return fallback;
  const candidates = [payment.amount, payment.cost, payment.paid, payment.price, payment.amountUsd, payment.usd];
  for (const candidate of candidates) {
    const parsed = Number(typeof candidate === 'object' && candidate !== null ? candidate.amount : candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return roundMoney(parsed);
  }
  return fallback;
}

function pruneLedger(ledger, now = new Date()) {
  const cutoff = weekStart(now).getTime() - (14 * 24 * 60 * 60 * 1000);
  return ledger.filter((entry) => Date.parse(entry.createdAt) >= cutoff).slice(-MAX_LEDGER_ROWS);
}

function configure(values) {
  const weeklyLimitUsd = number(values['weekly-limit'], '--weekly-limit', { allowZero: true });
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    state.weeklyLimitUsd = weeklyLimitUsd;
    state.updatedAt = new Date().toISOString();
    state.ledger = pruneLedger(state.ledger);
    writeState(statePath, state);
    return { ok: true, ...budgetStatus(state), message: 'Weekly Zero allowance saved.' };
  });
}

function status() {
  const { state: statePath } = paths();
  const state = readState(statePath);
  return { ok: true, ...budgetStatus(state), updatedAt: state.updatedAt };
}

function buildFetchArgs(values, maxPay) {
  const capability = values.capability;
  if (!capability || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(capability)) fail('Provide the exact inspected capability slug with --capability.');
  const method = (values.method ?? (values['data-json'] ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'POST') fail('Automatic read-like calls support only GET or POST.');
  const args = ['fetch', '--capability', capability, '--method', method];
  if (values['data-json']) {
    if (values['data-json'].length > 262_144) fail('--data-json exceeds the 256 KB automatic-call limit.');
    try {
      JSON.parse(values['data-json']);
    } catch {
      fail('--data-json must be valid JSON.');
    }
    args.push('--data', values['data-json'], '--header', 'Content-Type:application/json');
  }
  args.push('--max-pay', String(maxPay), '--json', '--agent', 'anything-agent');
  return args;
}

function reserve(values, maxPay) {
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    const before = budgetStatus(state);
    if (!before.configured) fail('No weekly Zero allowance is configured. Ask the user for one weekly USD limit, then run configure once.', 2);
    if (maxPay > before.remainingUsd + Number.EPSILON) {
      fail('This call could exceed the weekly Zero allowance.', 3, { ...before, requestedMaxPayUsd: maxPay });
    }
    const entry = {
      id: randomUUID(), createdAt: new Date().toISOString(), status: 'reserved', reservedUsd: maxPay,
      capability: values.capability, readOnly: true,
    };
    state.ledger = pruneLedger([...state.ledger, entry]);
    writeState(statePath, state);
    return { entry };
  });
}

function settle(entryId, result, fallback) {
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    const entry = state.ledger.find((candidate) => candidate.id === entryId);
    if (!entry) fail('Reserved Zero call is missing from the spend ledger. The reservation remains conservatively charged.', 4);
    entry.status = 'settled';
    entry.settledAt = new Date().toISOString();
    entry.ok = result?.ok === true;
    entry.runId = result?.runId ?? null;
    entry.actualUsd = paymentAmount(result?.payment, fallback);
    state.ledger = pruneLedger(state.ledger);
    writeState(statePath, state);
    return budgetStatus(state);
  });
}

function fetchCapability(values) {
  if (!values['read-only']) fail('Automatic Zero calls require --read-only. External mutations need separate current approval.');
  const maxPay = number(values['max-pay'], '--max-pay');
  const fetchArgs = buildFetchArgs(values, maxPay);
  const reservation = reserve(values, maxPay);
  const zeroCli = process.env.ZERO_CLI?.trim() || 'zero';
  const child = spawnSync(zeroCli, fetchArgs, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  let result = null;
  try {
    result = child.stdout ? JSON.parse(child.stdout) : null;
  } catch {
    result = null;
  }
  // Once Zero has been invoked, missing or malformed payment metadata cannot be
  // treated as free. Keep the full reservation charged so a broken response
  // cannot create additional weekly spending room.
  const chargedUsd = paymentAmount(result?.payment, maxPay);
  const after = settle(reservation.entry.id, result, maxPay);
  const response = {
    ok: child.status === 0 && result?.ok === true,
    providerResult: result,
    guard: {
      reservedUsd: maxPay,
      chargedUsd,
      remainingUsd: after.remainingUsd,
      weeklyLimitUsd: after.weeklyLimitUsd,
      weekStart: after.weekStart,
    },
  };
  if (child.error) response.error = child.error.message;
  if (child.stderr) response.stderr = child.stderr.trim();
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  process.exitCode = response.ok ? 0 : (child.status || 5);
}

try {
  const { command, values } = parseArgs(process.argv.slice(2));
  validateArgs(command, values);
  if (command === 'configure') {
    process.stdout.write(`${JSON.stringify(configure(values), null, 2)}\n`);
  } else if (command === 'status') {
    process.stdout.write(`${JSON.stringify(status(), null, 2)}\n`);
  } else if (command === 'fetch') {
    fetchCapability(values);
  } else {
    fail('Usage: zero-budget.mjs <status|configure|fetch> [options]');
  }
} catch (error) {
  if (error instanceof CliError) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, ...error.details }, null, 2)}\n`);
    process.exitCode = error.code;
  } else {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
