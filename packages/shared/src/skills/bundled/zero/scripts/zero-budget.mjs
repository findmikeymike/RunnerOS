#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const VERSION = 2;
const MAX_PRIOR_LEDGER_ROWS = 500;
const MAX_AUTHORIZATION_HOURS = 24 * 365;
const MAX_AUTHORIZATION_CALLS = 100_000;
const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'json') {
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
    authorize: new Set(['capability', 'method', 'max-calls', 'max-total-pay', 'expires-in-hours', 'purpose', 'json']),
    revoke: new Set(['authorization', 'json']),
    fetch: new Set(['capability', 'max-pay', 'method', 'data-json', 'authorization', 'json']),
  }[command];
  if (!allowed) fail('Usage: zero-budget.mjs <status|configure|authorize|revoke|fetch> [options]');
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
  const rounded = Math.round(parsed * 1_000_000) / 1_000_000;
  if (!allowZero && rounded <= 0) fail(`${label} must be at least 0.000001.`);
  return rounded;
}

function positiveInteger(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    fail(`${label} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCapabilitySlug(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);
}

function normalizeMethod(value, label = '--method') {
  const method = String(value ?? '').toUpperCase();
  if (!SUPPORTED_METHODS.has(method)) fail(`${label} must be GET, POST, PUT, PATCH, or DELETE.`);
  return method;
}

function validateLedgerEntry(entry) {
  if (!isRecord(entry)
    || typeof entry.id !== 'string'
    || !validDate(entry.createdAt)
    || !['reserved', 'settled'].includes(entry.status)
    || !validCapabilitySlug(entry.capability)
    || !Number.isFinite(entry.reservedUsd)
    || entry.reservedUsd < 0
    || (entry.actualUsd !== undefined && (!Number.isFinite(entry.actualUsd) || entry.actualUsd < 0))) {
    fail('Zero spend policy contains an invalid ledger entry. Repair or reconfigure it before spending.');
  }
  return {
    ...entry,
    method: entry.method === undefined ? 'GET' : normalizeMethod(entry.method, 'ledger method'),
    authorizationId: typeof entry.authorizationId === 'string' ? entry.authorizationId : null,
  };
}

function validateAuthorization(entry) {
  if (!isRecord(entry)
    || typeof entry.id !== 'string'
    || !validDate(entry.createdAt)
    || !validDate(entry.expiresAt)
    || !validCapabilitySlug(entry.capability)
    || typeof entry.capabilityUid !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.capabilityDigest)
    || typeof entry.purpose !== 'string'
    || entry.purpose.length < 4
    || !Number.isSafeInteger(entry.maxCalls)
    || entry.maxCalls <= 0
    || !Number.isSafeInteger(entry.usedCalls)
    || entry.usedCalls < 0
    || !Number.isFinite(entry.maxTotalPayUsd)
    || entry.maxTotalPayUsd <= 0
    || !Number.isFinite(entry.committedUsd)
    || entry.committedUsd < 0
    || !Number.isFinite(entry.settledUsd)
    || entry.settledUsd < 0
    || (entry.revokedAt !== null && entry.revokedAt !== undefined && !validDate(entry.revokedAt))) {
    fail('Zero spend policy contains an invalid action authorization. Repair or reconfigure it before spending.');
  }
  const method = normalizeMethod(entry.method, 'authorization method');
  if (method === 'GET') fail('Zero spend policy contains an invalid GET action authorization.');
  return { ...entry, method, revokedAt: entry.revokedAt ?? null };
}

function emptyState() {
  return { version: VERSION, weeklyLimitUsd: null, updatedAt: null, ledger: [], authorizations: [] };
}

function readState(statePath) {
  if (!existsSync(statePath)) return emptyState();
  let value;
  try {
    value = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    fail('Zero spend policy is unreadable. Repair or reconfigure it before spending.');
  }
  if (!isRecord(value)
    || ![1, VERSION].includes(value.version)
    || (value.weeklyLimitUsd !== null && (!Number.isFinite(value.weeklyLimitUsd) || value.weeklyLimitUsd < 0))
    || (value.updatedAt !== null && value.updatedAt !== undefined && !validDate(value.updatedAt))
    || !Array.isArray(value.ledger)
    || (value.authorizations !== undefined && !Array.isArray(value.authorizations))) {
    fail('Zero spend policy has an invalid shape. Repair or reconfigure it before spending.');
  }
  return {
    version: VERSION,
    weeklyLimitUsd: value.weeklyLimitUsd,
    updatedAt: value.updatedAt ?? null,
    ledger: value.ledger.map(validateLedgerEntry),
    authorizations: (value.authorizations ?? []).map(validateAuthorization),
  };
}

function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...state, version: VERSION }, null, 2)}\n`, { mode: 0o600 });
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
  return state.ledger.filter(entry => Date.parse(entry.createdAt) >= startMs);
}

function entryCost(entry) {
  return entry.status === 'settled' ? entry.actualUsd ?? entry.reservedUsd : entry.reservedUsd;
}

function roundMoney(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function authorizationSummary(entry, now = new Date()) {
  return {
    id: entry.id,
    capability: entry.capability,
    method: entry.method,
    purpose: entry.purpose,
    expiresAt: entry.expiresAt,
    active: !entry.revokedAt && Date.parse(entry.expiresAt) > now.getTime()
      && entry.usedCalls < entry.maxCalls && entry.committedUsd < entry.maxTotalPayUsd,
    remainingCalls: Math.max(0, entry.maxCalls - entry.usedCalls),
    remainingPayUsd: roundMoney(Math.max(0, entry.maxTotalPayUsd - entry.committedUsd)),
  };
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
    actionAuthorizations: state.authorizations.map(entry => authorizationSummary(entry, now)),
  };
}

function paymentAmount(payment, fallback) {
  if (!isRecord(payment)) return fallback;
  if (typeof payment.asset === 'string' && !['USD', 'USDC'].includes(payment.asset.toUpperCase())) return fallback;
  const candidates = [payment.amount, payment.cost, payment.paid, payment.price, payment.amountUsd, payment.usd];
  for (const candidate of candidates) {
    const parsed = Number(isRecord(candidate) ? candidate.amount : candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return roundMoney(parsed);
  }
  return fallback;
}

function pruneLedger(ledger, now = new Date()) {
  const currentStart = weekStart(now).getTime();
  const cutoff = currentStart - (14 * 24 * 60 * 60 * 1000);
  const prior = [];
  const current = [];
  for (const entry of ledger) {
    const createdAt = Date.parse(entry.createdAt);
    if (createdAt >= currentStart) current.push(entry);
    else if (createdAt >= cutoff) prior.push(entry);
  }
  return [...prior.slice(-MAX_PRIOR_LEDGER_ROWS), ...current];
}

function zeroCli() {
  return process.env.ZERO_CLI?.trim() || 'zero';
}

function inspectCapability(capability) {
  if (!validCapabilitySlug(capability)) fail('Provide the exact inspected capability slug with --capability.');
  const child = spawnSync(zeroCli(), ['get', capability, '--agent', 'anything-agent'], {
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (child.status !== 0 || child.error) {
    fail('Zero could not inspect the exact capability. Stop rather than executing stale capability data.', 7, {
      detail: child.error?.message ?? child.stderr?.trim() ?? null,
    });
  }
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    fail('Zero returned invalid capability metadata. Stop rather than executing it.', 7);
  }
  if (!isRecord(result)
    || result.slug !== capability
    || typeof result.uid !== 'string'
    || typeof result.url !== 'string'
    || !validCapabilitySlug(result.slug)) {
    fail('Zero capability metadata did not match the requested exact slug.', 7);
  }
  let url;
  try {
    url = new URL(result.url);
  } catch {
    fail('Zero capability metadata contained an invalid URL.', 7);
  }
  if (url.protocol !== 'https:') fail('Automatic Zero capabilities must use HTTPS.', 7);
  const method = normalizeMethod(result.method, 'capability method');
  const digest = createHash('sha256').update(JSON.stringify({
    uid: result.uid, slug: result.slug, url: result.url, method,
  })).digest('hex');
  return { uid: result.uid, slug: result.slug, url: result.url, method, digest };
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

function authorize(values) {
  const inspected = inspectCapability(values.capability);
  const method = normalizeMethod(values.method ?? inspected.method);
  if (method !== inspected.method) fail('Requested method does not match the inspected Zero capability.', 7);
  if (method === 'GET') fail('GET retrieval already runs inside the weekly allowance and does not need action authorization.');
  const maxCalls = positiveInteger(values['max-calls'], '--max-calls', MAX_AUTHORIZATION_CALLS);
  const maxTotalPayUsd = number(values['max-total-pay'], '--max-total-pay');
  const expiresInHours = number(values['expires-in-hours'], '--expires-in-hours');
  if (expiresInHours > MAX_AUTHORIZATION_HOURS) fail(`--expires-in-hours cannot exceed ${MAX_AUTHORIZATION_HOURS}.`);
  const purpose = String(values.purpose ?? '').trim();
  if (purpose.length < 4 || purpose.length > 240) fail('--purpose must clearly describe the authorized job in 4 to 240 characters.');

  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    if (!Number.isFinite(state.weeklyLimitUsd)) fail('Set the weekly Zero allowance before authorizing a job.', 2);
    const createdAt = new Date();
    const authorization = {
      id: `zero_auth_${randomUUID()}`,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
      revokedAt: null,
      capability: inspected.slug,
      capabilityUid: inspected.uid,
      capabilityDigest: inspected.digest,
      method,
      purpose,
      maxCalls,
      usedCalls: 0,
      maxTotalPayUsd,
      committedUsd: 0,
      settledUsd: 0,
    };
    state.authorizations.push(authorization);
    state.updatedAt = new Date().toISOString();
    writeState(statePath, state);
    return { ok: true, authorization: authorizationSummary(authorization), message: 'Bounded Zero job authorized.' };
  });
}

function revoke(values) {
  const id = String(values.authorization ?? '');
  if (!/^zero_auth_[a-f0-9-]{36}$/.test(id)) fail('Provide a valid --authorization id.');
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    const authorization = state.authorizations.find(entry => entry.id === id);
    if (!authorization) fail('Zero action authorization was not found.', 6);
    if (!authorization.revokedAt) authorization.revokedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    writeState(statePath, state);
    return { ok: true, authorization: authorizationSummary(authorization), message: 'Zero action authorization revoked.' };
  });
}

function buildFetchArgs(values, maxPay, inspected) {
  const method = normalizeMethod(values.method ?? inspected.method);
  if (method !== inspected.method) fail('Requested method does not match the inspected Zero capability.', 7);
  if (method === 'GET' && values['data-json']) fail('GET capabilities cannot receive --data-json.');
  const args = ['fetch', inspected.url, '--capability', inspected.slug, '--method', method];
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
  return { args, method };
}

function reserve(values, maxPay, inspected, method) {
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    const before = budgetStatus(state);
    if (!before.configured) fail('No weekly Zero allowance is configured. Ask the user for one weekly USD limit, then run configure once.', 2);
    if (maxPay > before.remainingUsd + Number.EPSILON) {
      fail('This call could exceed the weekly Zero allowance.', 3, { ...before, requestedMaxPayUsd: maxPay });
    }

    let authorization = null;
    if (method !== 'GET') {
      const authorizationId = String(values.authorization ?? '');
      authorization = state.authorizations.find(entry => entry.id === authorizationId);
      if (!authorization) fail('This non-GET job needs one bounded action authorization before its calls can run.', 6);
      if (authorization.revokedAt) fail('This Zero action authorization was revoked.', 6);
      if (Date.parse(authorization.expiresAt) <= Date.now()) fail('This Zero action authorization expired.', 6);
      if (authorization.capability !== inspected.slug
        || authorization.capabilityUid !== inspected.uid
        || authorization.capabilityDigest !== inspected.digest
        || authorization.method !== method) {
        fail('The Zero capability changed since authorization. Reinspect it and request one new bounded authorization.', 6);
      }
      if (authorization.usedCalls >= authorization.maxCalls) fail('This Zero action authorization reached its call limit.', 6);
      if (authorization.committedUsd + maxPay > authorization.maxTotalPayUsd + Number.EPSILON) {
        fail('This call could exceed the authorized job spending limit.', 6, {
          authorization: authorizationSummary(authorization), requestedMaxPayUsd: maxPay,
        });
      }
      authorization.usedCalls += 1;
      authorization.committedUsd = roundMoney(authorization.committedUsd + maxPay);
    }

    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'reserved',
      reservedUsd: maxPay,
      capability: inspected.slug,
      method,
      authorizationId: authorization?.id ?? null,
    };
    state.ledger = pruneLedger([...state.ledger, entry]);
    state.updatedAt = new Date().toISOString();
    writeState(statePath, state);
    return { entry };
  });
}

function settle(entryId, result, fallback) {
  return withLock(() => {
    const { state: statePath } = paths();
    const state = readState(statePath);
    const entry = state.ledger.find(candidate => candidate.id === entryId);
    if (!entry) fail('Reserved Zero call is missing from the spend ledger. The reservation remains conservatively charged.', 4);
    const actualUsd = paymentAmount(result?.payment, fallback);
    entry.status = 'settled';
    entry.settledAt = new Date().toISOString();
    entry.ok = result?.ok === true;
    entry.runId = result?.runId ?? null;
    entry.actualUsd = actualUsd;
    if (entry.authorizationId) {
      const authorization = state.authorizations.find(candidate => candidate.id === entry.authorizationId);
      if (!authorization) fail('The action authorization disappeared after the paid call. Its weekly reservation remains charged.', 4);
      authorization.committedUsd = roundMoney(Math.max(0, authorization.committedUsd - entry.reservedUsd) + actualUsd);
      authorization.settledUsd = roundMoney(authorization.settledUsd + actualUsd);
    }
    state.ledger = pruneLedger(state.ledger);
    state.updatedAt = new Date().toISOString();
    writeState(statePath, state);
    return budgetStatus(state);
  });
}

function fetchCapability(values) {
  const maxPay = number(values['max-pay'], '--max-pay');
  const inspected = inspectCapability(values.capability);
  const built = buildFetchArgs(values, maxPay, inspected);
  const reservation = reserve(values, maxPay, inspected, built.method);
  const child = spawnSync(zeroCli(), built.args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  let result = null;
  try {
    result = child.stdout ? JSON.parse(child.stdout) : null;
  } catch {
    result = null;
  }
  const chargedUsd = paymentAmount(result?.payment, maxPay);
  const after = settle(reservation.entry.id, result, maxPay);
  const response = {
    ok: child.status === 0 && result?.ok === true,
    providerResult: result,
    guard: {
      authorizationId: reservation.entry.authorizationId,
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
  } else if (command === 'authorize') {
    process.stdout.write(`${JSON.stringify(authorize(values), null, 2)}\n`);
  } else if (command === 'revoke') {
    process.stdout.write(`${JSON.stringify(revoke(values), null, 2)}\n`);
  } else if (command === 'fetch') {
    fetchCapability(values);
  } else {
    fail('Usage: zero-budget.mjs <status|configure|authorize|revoke|fetch> [options]');
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
