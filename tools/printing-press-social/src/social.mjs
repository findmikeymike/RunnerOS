#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, checkBrowserEngine } from './browser-engines.mjs';
import { listAssets, listContent, normalizeList } from './content-assets.mjs';

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
            ...(flags.live ? ['--live'] : []),
          ]);
          platformResult.profiles.push({
            id: profile.id,
            confirmPolicy: profile.confirmPolicy,
            browserEngine: profile.browserEngine,
            ready: status.ok ? status.data.ready : false,
            localSessionExists: status.ok ? status.data.localSessionExists : false,
            live: status.ok ? status.data.live || null : null,
            error: status.ok ? null : status.error,
          });
        }
      } else {
        platformResult.ok = false;
        platformResult.error = list.error || list.data?.error || 'profile list failed';
      }
    }

    platforms.push(platformResult);
  }

  const ok = checks.every((check) => check.ok) && platforms.every((platform) => platform.ok);
  const result = {
    ok,
    status: ok ? 'succeeded' : 'failed',
    command: 'doctor',
    model: registry.model,
    browserEngine,
    liveChecked: Boolean(flags.live),
    checks,
    platforms,
    next: [
      'Add profiles with social profile add <platform> --profile <name> --json',
      'Login with social profile login <platform> --profile <name>',
      'Verify sessions with social doctor --live --json',
      'Dry-run every action before live execution',
    ],
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.status}: ${result.command}`);
  for (const platform of platforms) {
    console.log(`${platform.platform}: ${platform.ok ? 'ok' : 'failed'} profiles=${platform.profiles.length}`);
  }
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
  if (!action.options?.dryRun) {
    throw new CliError('execute only accepts action files produced by a dry-run result', 'ACTION_NOT_DRY_RUN');
  }
  assertAccountVerificationReady(browserPlan);

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
      message: 'runner-cdp execution is delegated to RunnerOS native browser tools after account verification and approval.',
      code: 'RUNNER_CDP_DELEGATED',
      next: [
        'Open the browser session named in browserPlan.sessionPath.',
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
  return { action: data.action, browserPlan: data.browserPlan };
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
  if (!['post', 'comment', 'dm'].includes(action.verb)) {
    throw new CliError(`Unsupported action verb: ${action.verb}`, 'UNSUPPORTED_VERB');
  }
  if (!['instagram', 'tiktok', 'x', 'youtube'].includes(action.platform)) {
    throw new CliError(`Unsupported platform: ${action.platform}`, 'UNSUPPORTED_PLATFORM');
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

function buildLiveReplayArgs(action, flags) {
  const payload = action.payload || {};
  const out = [action.verb, action.platform, '--profile', action.profile, '--action-id', action.actionId, '--confirm', 'yes'];

  if (action.options?.idempotencyKey) out.push('--idempotency-key', action.options.idempotencyKey);
  if (flags.json) out.push('--json');
  if (flags.headed || action.options?.headed) out.push('--headed');
  for (const key of ['engine', 'settle-ms', 'timeout']) {
    if (flags[key] && flags[key] !== true) out.push(`--${key}`, String(flags[key]));
  }

  if (action.verb === 'post') addPostPayloadArgs(out, action.platform, payload);
  if (action.verb === 'comment') addCommentPayloadArgs(out, payload);
  if (action.verb === 'dm') addDmPayloadArgs(out, payload);
  return out;
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
  if (payload.text) out.push('--text', payload.text);
}

function addDmPayloadArgs(out, payload) {
  if (payload.recipient) out.push('--to', payload.recipient);
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
  const [group, command, maybePlatform] = argv;
  if (group === 'profile') return argv.find((part) => ['instagram', 'tiktok', 'x', 'youtube'].includes(part));
  if (['post', 'comment', 'dm'].includes(group)) return command;
  if (maybePlatform && ['instagram', 'tiktok', 'x', 'youtube'].includes(maybePlatform)) return maybePlatform;
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
  social profile update x --profile artist01 --handle @artist01 --account-url https://x.com/artist01 --json
  social profile status x --profile artist01 --live --json
  social profile delete x --profile artist01 --json
  social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
  social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
  social post x --profile artist01 --text "post text" --dry-run --json
  social post youtube --profile channel01 --post-type short --text "title" --media short.mp4 --dry-run --json
`);
}
