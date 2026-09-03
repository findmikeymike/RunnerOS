#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, checkBrowserEngine } from './browser-engines.mjs';
import { listAssets, listContent, normalizeList } from './content-assets.mjs';
import { buildProfileBrowserSession, duplicateActionResult, findCompletedAction } from './action-safety.mjs';
import { computeApprovalDigest } from './approval-contract.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'registry.json');

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: 'failed',
    error: error.message,
    code: error.code || 'UNHANDLED_ERROR',
  }, null, 2)}\n`);
  process.exit(1);
});

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'repl') {
    await runRepl();
    return;
  }

  if (argv.includes('--help') || argv[0] === 'help') {
    printHelp();
    return;
  }

  if (argv[0] === 'registry') {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    } else {
      console.log(registry.commands.map((cmd) => `${cmd.verb} ${cmd.platform}`).join('\n'));
    }
    return;
  }

  if (argv[0] === 'doctor') {
    await runDoctor(argv.slice(1));
    return;
  }

  if (argv[0] === 'catalog') {
    await runCatalog(argv.slice(1));
    return;
  }

  if (argv[0] === 'assets') {
    await runAssets(argv.slice(1));
    return;
  }

  if (argv[0] === 'content') {
    await runContent(argv.slice(1));
    return;
  }

  if (argv[0] === 'execute') {
    await runExecute(argv.slice(1));
    return;
  }

  const platform = resolvePlatform(argv);
  if (!platform) {
    throw new CliError(`Could not resolve platform from command: ${argv.join(' ')}`, 'PLATFORM_REQUIRED');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const entry = registry.platforms[platform];
  if (!entry) throw new CliError(`Unsupported platform: ${platform}`, 'UNSUPPORTED_PLATFORM');

  const cliPath = path.join(ROOT, entry.path, entry.entrypoint);
  const result = await run(process.execPath, [cliPath, ...argv]);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

async function runRepl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('social REPL. Type commands after `social`, or `exit`.');
  while (true) {
    const line = (await rl.question('social> ')).trim();
    if (!line || line === 'exit' || line === 'quit') break;
    const args = splitArgs(line);
    const result = await run(process.execPath, [path.join(ROOT, 'src/social.mjs'), ...args]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  rl.close();
}

async function runDoctor(args) {
  const flags = parseFlags(args);
  const result = await buildDoctorResult({ live: Boolean(flags.live) });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.status}: ${result.command}`);
  for (const platform of result.platforms) {
    console.log(`${platform.platform}: ${platform.ok ? 'ok' : 'failed'} profiles=${platform.profiles.length}`);
  }
}

async function runCatalog(args) {
  const flags = parseFlags(args);
  const doctor = await buildDoctorResult({ live: Boolean(flags.live) });
  const profiles = doctor.platforms.flatMap((platform) => platform.profiles || []);
  const safeProfiles = profiles.map((profile) => safeCatalogProfile(profile));
  const accountSets = buildAccountSets(safeProfiles);
  const result = {
    ok: doctor.ok,
    status: doctor.status,
    command: 'catalog',
    liveChecked: doctor.liveChecked,
    summary: {
      accountSets: accountSets.length,
      profiles: safeProfiles.length,
      readyProfiles: safeProfiles.filter((profile) => profile.ready).length,
      unverifiedProfiles: safeProfiles.filter((profile) => !profile.ready).length,
    },
    accountSets,
    profiles: safeProfiles,
    noSecrets: true,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.status}: ${result.command}`);
  for (const set of accountSets) {
    console.log(`${set.name}: ${set.profiles.map((profile) => profile.ref).join(', ')}`);
  }
}

async function buildDoctorResult({ live = false } = {}) {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const checks = [];
  const platforms = [];
  const browserEngine = process.env.SOCIAL_BROWSER_ENGINE || DEFAULT_BROWSER_ENGINE;
  const browserEngineAvailability = checkBrowserEngine(browserEngine, registry, ROOT);

  checks.push({
    name: 'browser-engine',
    ok: browserEngineAvailability.available !== false,
    engine: browserEngine,
    ...browserEngineAvailability,
  });

  checks.push({
    name: 'schemas',
    ok: fs.existsSync(path.join(ROOT, registry.schemas.action)) && fs.existsSync(path.join(ROOT, registry.schemas.result)),
    actionSchema: registry.schemas.action,
    resultSchema: registry.schemas.result,
  });

  for (const [platform, entry] of Object.entries(registry.platforms)) {
    const cliPath = path.join(ROOT, entry.path, entry.entrypoint);
    const platformResult = {
      platform,
      ok: fs.existsSync(cliPath),
      cliPath,
      harnessPath: path.join(ROOT, entry.path, entry.harness),
      skillPath: path.join(ROOT, entry.path, entry.skill),
      profiles: [],
    };

    if (platformResult.ok) {
      const list = await runJson(process.execPath, [cliPath, 'profile', 'list', '--json']);
      if (list.ok && list.data.ok) {
        for (const profile of (list.data.profiles || []).filter((item) => item.platform === platform)) {
          const status = await runJson(process.execPath, [
            cliPath,
            'profile',
            'status',
            platform,
            '--profile',
            profile.id,
            '--json',
            ...(live ? ['--live'] : []),
          ]);
          platformResult.profiles.push(doctorProfileJson(profile, status));
        }
      } else {
        platformResult.ok = false;
        platformResult.error = list.error || list.data?.error || 'profile list failed';
      }
    }

    platforms.push(platformResult);
  }

  const ok = checks.every((check) => check.ok) && platforms.every((platform) => platform.ok);
  return {
    ok,
    status: ok ? 'succeeded' : 'failed',
    command: 'doctor',
    model: registry.model,
    browserEngine,
    liveChecked: live,
    summary: doctorSummary(platforms),
    checks,
    platforms,
    next: [
      'Add profiles with social profile add <platform> --profile <name> --json',
      'Login with social profile login <platform> --profile <name>',
      'Verify sessions with social doctor --live --json',
      'Dry-run every action before live execution',
    ],
  };
}

function safeCatalogProfile(profile) {
  const browserSession = buildProfileBrowserSession({ platform: profile.platform, id: profile.profile });
  return {
    ref: `${profile.platform}/${profile.profile}`,
    platform: profile.platform,
    profile: profile.profile,
    accountSet: profile.accountGroup || null,
    accountHandle: profile.accountHandle || null,
    accountUrl: profile.accountUrl || null,
    adsAccountId: profile.adsAccountId || null,
    status: profile.profileStatus || null,
    ready: Boolean(profile.ready),
    nextAction: profile.nextAction || null,
    message: profile.message || null,
    browserSession,
  };
}

function buildAccountSets(profiles) {
  const groups = new Map();
  for (const profile of profiles) {
    const name = profile.accountSet || 'Ungrouped';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(profile);
  }
  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      profiles: items.sort((a, b) => a.platform.localeCompare(b.platform)),
      platforms: Object.fromEntries(items.map((profile) => [profile.platform, profile.ref])),
      ready: items.length > 0 && items.every((profile) => profile.ready),
    }))
    .sort((a, b) => {
      if (a.name === 'Ungrouped') return 1;
      if (b.name === 'Ungrouped') return -1;
      return a.name.localeCompare(b.name);
    });
}

function doctorProfileJson(profile, status) {
  if (!status.ok) {
    return {
      id: profile.id,
      profile: profile.id,
      platform: profile.platform,
      accountHandle: profile.accountHandle || null,
      accountUrl: profile.accountUrl || null,
      adsAccountId: profile.adsAccountId || null,
      accountGroup: profile.accountGroup || null,
      confirmPolicy: profile.confirmPolicy,
      browserEngine: profile.browserEngine,
      profileStatus: 'verification_failed',
      severity: 'error',
      message: 'Could not load profile status.',
      nextAction: 'retry_verify',
      lastCheckedAt: null,
      ready: false,
      localSessionExists: false,
      liveChecked: false,
      loggedIn: null,
      matchesExpected: null,
      evidence: { type: 'error', summary: status.error || 'profile status failed' },
      live: null,
      error: status.error,
    };
  }

  const data = status.data;
  return {
    id: data.profileId || profile.id,
    profile: data.profileId || profile.id,
    platform: data.platform || profile.platform,
    accountHandle: data.accountHandle || null,
    accountUrl: data.accountUrl || null,
    adsAccountId: data.adsAccountId || null,
    accountGroup: data.accountGroup || null,
    sessionPath: data.sessionPath || null,
    confirmPolicy: profile.confirmPolicy,
    browserEngine: profile.browserEngine,
    profileStatus: data.profileStatus || null,
    severity: data.severity || null,
    message: data.message || null,
    nextAction: data.nextAction || null,
    lastCheckedAt: data.lastCheckedAt || null,
    ready: Boolean(data.ready),
    localSessionExists: Boolean(data.localSessionExists),
    liveChecked: Boolean(data.liveChecked),
    loggedIn: data.loggedIn ?? null,
    matchesExpected: data.matchesExpected ?? null,
    evidence: data.evidence || null,
    live: data.live || null,
    error: null,
  };
}

function doctorSummary(platforms) {
  const summary = {
    totalProfiles: 0,
    readyProfiles: 0,
    loginNeeded: 0,
    unverified: 0,
    wrongAccount: 0,
    failed: 0,
  };

  for (const platform of platforms) {
    for (const profile of platform.profiles || []) {
      summary.totalProfiles += 1;
      if (profile.ready) summary.readyProfiles += 1;
      if (profile.profileStatus === 'login_needed') summary.loginNeeded += 1;
      else if (profile.profileStatus === 'session_exists_unverified') summary.unverified += 1;
      else if (profile.profileStatus === 'wrong_account') summary.wrongAccount += 1;
      else if (profile.profileStatus === 'verification_failed') summary.failed += 1;
    }
  }

  return summary;
}

async function runAssets(args) {
  const flags = parseFlags(args);
  const assets = listAssets({
    assetRoot: flags['asset-root'],
    platform: flags.platform,
  });
  const result = {
    ok: true,
    status: 'succeeded',
    command: 'assets',
    assetRoot: flags['asset-root'] || process.env.SOCIAL_ASSET_ROOT || null,
    platform: flags.platform || null,
    assets,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  for (const item of assets) console.log(`${item.relativePath}\t${item.kind}\t${item.platforms.join(',')}`);
}

async function runContent(args) {
  const flags = parseFlags(args);
  const content = listContent({ contentRoot: flags['content-root'] });
  const result = {
    ok: true,
    status: 'succeeded',
    command: 'content',
    contentRoot: flags['content-root'] || process.env.SOCIAL_CONTENT_ROOT || null,
    content,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  for (const item of content) console.log(`${item.relativePath}\t${item.kind}`);
}

async function runExecute(args) {
  const flags = parseFlags(args);
  const actionFile = flags['action-file'] || flags.file || flags.from;
  if (!actionFile || actionFile === true) {
    throw new CliError('execute needs --action-file <dry-run-result.json>', 'MISSING_ACTION_FILE');
  }
  if (flags.confirm !== 'yes') {
    throw new CliError('Refusing execute without explicit --confirm yes', 'CONFIRM_REQUIRED');
  }

  const approved = readApprovedActionFile(actionFile);
  const { action, browserPlan } = approved;
  const expectedActionId = flags['expected-action-id'];
  if (!expectedActionId || expectedActionId === true) {
    throw new CliError('execute needs --expected-action-id <act_...>', 'EXPECTED_ACTION_ID_REQUIRED');
  }
  if (expectedActionId !== action.actionId) {
    throw new CliError(`Action id mismatch: expected ${expectedActionId}, got ${action.actionId}`, 'ACTION_ID_MISMATCH');
  }
  const approvalDigest = computeApprovalDigest(action, browserPlan);
  if (approved.approvalDigest) {
    if (approved.approvalDigest !== approvalDigest) {
      throw new CliError('Dry-run approval digest does not match its action and browser plan', 'ACTION_DIGEST_MISMATCH');
    }
    const expectedDigest = flags['expected-action-digest'];
    if (!expectedDigest || expectedDigest === true) {
      throw new CliError('Spotify execute needs --expected-action-digest <sha256:...>', 'EXPECTED_ACTION_DIGEST_REQUIRED');
    }
    if (expectedDigest !== approvalDigest) {
      throw new CliError('Approved action digest does not match the current action contract', 'ACTION_DIGEST_MISMATCH');
    }
  } else if (action.platform === 'spotify') {
    throw new CliError('Spotify dry-run is missing its approval digest', 'ACTION_DIGEST_REQUIRED');
  }
  if (!action.options?.dryRun) {
    throw new CliError('execute only accepts action files produced by a dry-run result', 'ACTION_NOT_DRY_RUN');
  }
  assertAccountVerificationReady(browserPlan);
  assertBrowserPlanMatchesCurrentProfile(action, browserPlan);

  if (action.platform === 'spotify' && action.verb === 'playlist-create') {
    const completed = findCompletedAction({ action, socialHome: socialHome(action.platform) });
    if (completed) {
      process.stdout.write(`${JSON.stringify(duplicateActionResult(action, completed, 'execute.spotify'), null, 2)}\n`);
      return;
    }
  }

  const engine = flags.engine || process.env.SOCIAL_BROWSER_ENGINE || DEFAULT_BROWSER_ENGINE;
  if (engine === 'runner-cdp') {
    const result = {
      ok: true,
      status: 'delegated',
      command: `execute.${action.platform}`,
      actionId: action.actionId,
      platform: action.platform,
      profile: action.profile,
      action,
      browserPlan,
      approvalDigest: approved.approvalDigest || null,
      message: 'runner-cdp execution is delegated to RunnerOS native browser tools after account verification and approval.',
      code: 'RUNNER_CDP_DELEGATED',
      next: [
        'Open the browser session named in browserPlan.browserSession.',
        'Verify the visible account matches browserPlan.accountVerification.',
        'Execute the browserPlan steps and submit when the visible account and draft match the approved dry-run; stop only on mismatch, ambiguity, unexpected platform choices, or upload/UI failure.',
      ],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const entry = registry.platforms[action.platform];
  if (!entry) throw new CliError(`Unsupported platform: ${action.platform}`, 'UNSUPPORTED_PLATFORM');

  const cliPath = path.join(ROOT, entry.path, entry.entrypoint);
  const commandArgs = buildLiveReplayArgs(action, flags);
  const result = await run(process.execPath, [cliPath, ...commandArgs]);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

function readApprovedActionFile(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(String(filePath)), 'utf8'));
  } catch (error) {
    throw new CliError(`Could not read action file: ${error.message}`, 'INVALID_ACTION_FILE');
  }
  assertDryRunResultShape(data);
  assertActionShape(data.action);
  return { action: data.action, browserPlan: data.browserPlan, approvalDigest: data.approvalDigest || null };
}

function assertActionShape(action) {
  if (!action || typeof action !== 'object') {
    throw new CliError('Action file does not contain an action object', 'INVALID_ACTION_FILE');
  }
  for (const key of ['actionId', 'verb', 'platform', 'profile', 'mode', 'payload', 'options']) {
    if (action[key] === undefined || action[key] === null) {
      throw new CliError(`Action file is missing ${key}`, 'INVALID_ACTION_FILE');
    }
  }
  if (!['post', 'comment', 'dm', 'playlist-create'].includes(action.verb)) {
    throw new CliError(`Unsupported action verb: ${action.verb}`, 'UNSUPPORTED_VERB');
  }
  if (!['instagram', 'tiktok', 'x', 'youtube', 'spotify'].includes(action.platform)) {
    throw new CliError(`Unsupported platform: ${action.platform}`, 'UNSUPPORTED_PLATFORM');
  }
  const isSpotifyPlaylistCreate = action.platform === 'spotify' && action.verb === 'playlist-create';
  const isStandardSocialAction = action.platform !== 'spotify' && ['post', 'comment', 'dm'].includes(action.verb);
  if (!isSpotifyPlaylistCreate && !isStandardSocialAction) {
    throw new CliError(`Unsupported action combination: ${action.verb}.${action.platform}`, 'UNSUPPORTED_ACTION');
  }
  if (action.mode !== 'browser') {
    throw new CliError(`Unsupported action mode: ${action.mode}`, 'UNSUPPORTED_MODE');
  }
}

function assertDryRunResultShape(data) {
  if (!data || typeof data !== 'object' || !data.action || !data.browserPlan) {
    throw new CliError('execute only accepts full dry-run result JSON with action and browserPlan', 'INVALID_ACTION_FILE');
  }
  if (data.status !== 'dry_run' || data.ok !== true) {
    throw new CliError('execute only accepts successful dry-run result JSON', 'ACTION_NOT_DRY_RUN');
  }
  if (data.actionId !== data.action.actionId) {
    throw new CliError('Dry-run result actionId does not match nested action actionId', 'ACTION_ID_MISMATCH');
  }
  if (data.platform !== data.action.platform || data.profile !== data.action.profile) {
    throw new CliError('Dry-run result identity does not match nested action identity', 'INVALID_ACTION_FILE');
  }
}

function assertAccountVerificationReady(browserPlan) {
  const verification = browserPlan?.accountVerification;
  if (!verification?.verificationTargetKnown) {
    throw new CliError('Refusing execute because the dry-run browserPlan is missing a known account handle or account URL', 'ACCOUNT_VERIFICATION_REQUIRED');
  }
}

function assertBrowserPlanMatchesCurrentProfile(action, browserPlan) {
  const profile = readCurrentProfile(action.platform, action.profile);
  const expectedSessionPath = sessionDir(profile);
  if (browserPlan.sessionPath !== expectedSessionPath) {
    throw new CliError('Refusing execute because the dry-run browserPlan session does not match the current profile session', 'PROFILE_SESSION_MISMATCH');
  }

  const expectedBrowserSession = buildProfileBrowserSession(profile);
  const browserSession = browserPlan.browserSession;
  if (
    !browserSession
    || browserSession.kind !== expectedBrowserSession.kind
    || browserSession.platform !== expectedBrowserSession.platform
    || browserSession.profile !== expectedBrowserSession.profile
    || browserSession.instanceId !== expectedBrowserSession.instanceId
    || browserSession.partition !== expectedBrowserSession.partition
  ) {
    throw new CliError('Refusing execute because the dry-run browserPlan browser session does not match the current profile', 'PROFILE_BROWSER_SESSION_MISMATCH');
  }

  const verification = browserPlan.accountVerification || {};
  if (
    verification.platform !== action.platform
    || verification.profile !== action.profile
    || (verification.expectedHandle || null) !== (profile.accountHandle || null)
    || (verification.expectedAccountUrl || null) !== (profile.accountUrl || null)
  ) {
    throw new CliError('Refusing execute because the dry-run account verification target no longer matches the current profile', 'PROFILE_VERIFICATION_MISMATCH');
  }
}

function readCurrentProfile(platform, profileId) {
  const filePath = path.join(socialHome(platform), 'profiles.json');
  let store;
  try {
    store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
  }
  const profile = store.profiles?.[`${platform}:${profileId}`];
  if (!profile) throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
  return profile;
}

function sessionDir(profile) {
  return path.join(socialHome(profile.platform), profile.sessionRef || path.join('sessions', profile.platform, profile.id));
}

function socialHome(platform) {
  if (process.env.SOCIAL_HOME) return process.env.SOCIAL_HOME;
  return path.join(os.homedir(), '.config', 'printing-press-clis', platform);
}

function buildLiveReplayArgs(action, flags) {
  const payload = action.payload || {};
  const out = action.platform === 'spotify' && action.verb === 'playlist-create'
    ? ['playlist', 'spotify', 'create', '--profile', action.profile, '--action-id', action.actionId, '--confirm', 'yes', '--approved-handoff']
    : [action.verb, action.platform, '--profile', action.profile, '--action-id', action.actionId, '--confirm', 'yes'];

  if (action.options?.idempotencyKey) out.push('--idempotency-key', action.options.idempotencyKey);
  if (flags.json) out.push('--json');
  if (flags.headed || action.options?.headed) out.push('--headed');
  for (const key of ['engine', 'settle-ms', 'timeout']) {
    if (flags[key] && flags[key] !== true) out.push(`--${key}`, String(flags[key]));
  }

  if (action.verb === 'post') addPostPayloadArgs(out, action.platform, payload);
  if (action.verb === 'comment') addCommentPayloadArgs(out, payload);
  if (action.verb === 'dm') addDmPayloadArgs(out, payload);
  if (action.verb === 'playlist-create') addSpotifyPlaylistPayloadArgs(out, payload);
  return out;
}

function addSpotifyPlaylistPayloadArgs(out, payload) {
  if (payload.name) out.push('--name', payload.name);
  if (payload.description) out.push('--description', payload.description);
  if (payload.visibility) out.push('--visibility', payload.visibility);
  if (Array.isArray(payload.tracks) && payload.tracks.length) out.push('--tracks', payload.tracks.join(','));
}

function addPostPayloadArgs(out, platform, payload) {
  const text = platform === 'youtube' ? (payload.title || payload.text) : payload.text;
  if (text) out.push('--text', text);
  for (const item of normalizeList(payload.media)) out.push('--media', item);
  if (payload.postType) out.push('--post-type', payload.postType);

  if (platform === 'youtube') {
    if (payload.description) out.push('--description', payload.description);
    if (payload.visibility) out.push('--visibility', payload.visibility);
    if (payload.madeForKids) out.push('--made-for-kids', payload.madeForKids);
    if (Array.isArray(payload.tags) && payload.tags.length) out.push('--tags', payload.tags.join(','));
  }
}

function addCommentPayloadArgs(out, payload) {
  if (payload.targetUrl) out.push('--url', payload.targetUrl);
  if (payload.replyTo) out.push('--reply-to', payload.replyTo);
  if (payload.text) out.push('--text', payload.text);
}

function addDmPayloadArgs(out, payload) {
  if (payload.recipient) out.push('--to', payload.recipient);
  if (payload.threadUrl) out.push('--thread-url', payload.threadUrl);
  if (payload.text) out.push('--text', payload.text);
}

function splitArgs(line) {
  return line.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const raw = token.slice(2);
    const [key, inline] = raw.split('=', 2);
    if (inline !== undefined) {
      out[key] = inline;
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function resolvePlatform(argv) {
  const platforms = ['instagram', 'tiktok', 'x', 'youtube', 'spotify'];
  const [group, command, maybePlatform] = argv;
  if (group === 'profile') return argv.find((part) => platforms.includes(part));
  if (['post', 'comment', 'dm', 'snapshot', 'playlist'].includes(group)) return command;
  if (maybePlatform && platforms.includes(maybePlatform)) return maybePlatform;
  return null;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runJson(command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || result.stdout || `Exited ${result.code}` };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON from ${args.join(' ')}: ${error.message}` };
  }
}

function printHelp() {
  console.log(`social - root dispatcher for Printing Press CLIs

Commands:
  social registry --json
  social catalog --json
  social doctor --json
  social doctor --live --json
  social repl
  social assets --asset-root ./assets --platform instagram --json
  social content --content-root ./content --json
  social execute --action-file ./dry-run-result.json --expected-action-id act_... --confirm yes --json
  social profile add instagram --profile artist01 --json
  social profile add tiktok --profile creator01 --json
  social profile add x --profile artist01 --json
  social profile add youtube --profile channel01 --json
  social profile add spotify --profile artist01 --json
  social profile update x --profile artist01 --handle @artist01 --account-url https://x.com/artist01 --json
  social profile status x --profile artist01 --live --json
  social profile delete x --profile artist01 --json
  social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
  social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
  social post x --profile artist01 --text "post text" --dry-run --json
  social post youtube --profile channel01 --post-type short --text "title" --media short.mp4 --dry-run --json
  social playlist spotify create --profile artist01 --name "Late Night Drive" --tracks spotify:track:... --dry-run --json
`);
}
