#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const vendorRoot = join(toolRoot, 'vendor', 'squad');
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function hasFlag(name) {
  return args.includes(name);
}

function opt(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1] ?? fallback;
}

function allOpt(name) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}

function jsonMode() {
  return hasFlag('--json');
}

function print(payload) {
  if (jsonMode()) console.log(JSON.stringify(payload, null, 2));
  else if (payload.lines) console.log(payload.lines.join('\n'));
  else console.log(JSON.stringify(payload, null, 2));
}

function fail(message, extra = {}) {
  print({ ok: false, error: message, ...extra });
  process.exit(1);
}

function usage() {
  print({
    ok: true,
    lines: [
      'runneros-squad',
      '',
      'Commands:',
      '  doctor --json',
      '  recipe --brief-file brief.json --json',
      '  storyboard --brief-file brief.json [--output-dir dir] --json',
      '  preflight --brief-file brief.json [--provider-mode auto|openai|modular|external] --json',
      '  run --brief-file brief.json --approved [--provider-mode auto|openai|modular|external] --json',
      '',
      'Modular mode lets agents use WaveSpeed, Fal, Replicate, Zero, or existing media without forcing OpenAI.',
    ],
  });
}

function requireBriefFile() {
  const briefFile = opt('brief-file');
  if (!briefFile) fail('Missing --brief-file');
  const path = isAbsolute(briefFile) ? briefFile : resolve(process.cwd(), briefFile);
  if (!existsSync(path)) fail(`Brief file not found: ${path}`);
  return path;
}

function readBrief(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    fail(`Could not read brief JSON: ${error.message}`, { brief_file: path });
  }
}

function runPython(script, scriptArgs) {
  const python = process.env.SQUAD_PYTHON || process.env.PYTHON || 'python3';
  const env = {
    ...process.env,
    PYTHONPATH: [vendorRoot, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
  };
  return spawnSync(python, [join(vendorRoot, 'scripts', script), ...scriptArgs], {
    cwd: vendorRoot,
    env,
    encoding: 'utf-8',
  });
}

function parsePythonResult(result, fallbackMode) {
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }
  return {
    ok: result.status === 0,
    status: result.status,
    payload,
    stdout,
    stderr,
    mode: payload?.mode || fallbackMode,
  };
}

function providerMode() {
  const mode = (opt('provider-mode', 'auto') || 'auto').toLowerCase();
  if (!['auto', 'openai', 'modular', 'external'].includes(mode)) {
    fail('Invalid --provider-mode. Use auto, openai, modular, or external.');
  }
  return mode;
}

function providerState() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY || process.env.SQUAD_OPENAI_API_KEY),
    wavespeed: Boolean(process.env.WAVESPEED_API_KEY || process.env.SQUAD_WAVESPEED_API_KEY),
    fal: Boolean(process.env.FAL_API_KEY || process.env.SQUAD_FAL_API_KEY),
    replicate: Boolean(process.env.REPLICATE_API_TOKEN),
    heygen: Boolean(process.env.HEYGEN_API_KEY || process.env.SQUAD_HEYGEN_API_KEY),
    muapi: Boolean(process.env.MUAPI_API_KEY),
    runpod: Boolean(process.env.RUNPOD_API_KEY),
    zero: Boolean(process.env.ZERO_CLI_PATH || commandExists('zero')),
  };
}

function commandExists(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf-8' });
  return result.status === 0;
}

function hasNonOpenAiProvider(state = providerState()) {
  return state.wavespeed || state.fal || state.replicate || state.heygen || state.muapi || state.runpod || state.zero;
}

function validateBrief(brief) {
  const blockers = [];
  if (!String(brief.product_description || '').trim()) blockers.push({ code: 'invalid_brief', message: 'product_description is required' });
  if (!String(brief.campaign_goal || '').trim()) blockers.push({ code: 'invalid_brief', message: 'campaign_goal is required' });
  if (!String(brief.platform || '').trim()) blockers.push({ code: 'invalid_brief', message: 'platform is required' });
  const maxCost = Number(brief.max_cost_usd ?? 1);
  if (!Number.isFinite(maxCost) || maxCost <= 0) blockers.push({ code: 'invalid_brief', message: 'max_cost_usd must be positive' });
  return blockers;
}

function artifactDir(kind, briefFile) {
  const root = opt('output-dir') || join(dirname(briefFile), 'squad-artifacts', kind);
  mkdirSync(root, { recursive: true });
  return root;
}

function runId(briefFile) {
  const stem = briefFile.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'brief';
  return `${stem}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function normalizeOpenAiBlockers(payload, mode, state) {
  if (!payload || mode === 'openai') return payload;
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  const downgraded = [];
  const kept = [];
  for (const blocker of blockers) {
    if (blocker?.code === 'missing_openai_key' && hasNonOpenAiProvider(state)) downgraded.push({ ...blocker, code: 'openai_director_unavailable' });
    else kept.push(blocker);
  }
  if (!downgraded.length) return payload;
  return {
    ...payload,
    ok: kept.length === 0,
    provider_mode: mode,
    blockers: kept,
    warnings: [...(Array.isArray(payload.warnings) ? payload.warnings : []), ...downgraded],
    modular_routing: {
      enabled: true,
      reason: 'OpenAI director is unavailable, but non-OpenAI generation or external asset routing is available.',
      allowed_inputs: ['agent shot plan', 'approved provider prompt', 'generated still', 'generated clip', 'existing footage', 'manual assembly notes'],
    },
  };
}

function modularPreflight(briefFile, mode) {
  const brief = readBrief(briefFile);
  const state = providerState();
  const blockers = validateBrief(brief);
  const outputRoot = artifactDir('runs', briefFile);
  const externalAssets = allOpt('external-asset');
  if (mode === 'openai' && !state.openai) {
    blockers.push({ code: 'missing_openai_key', message: 'OPENAI_API_KEY or SQUAD_OPENAI_API_KEY is required for openai provider mode.' });
  }
  if (mode === 'external' && externalAssets.length === 0) {
    blockers.push({ code: 'missing_external_asset', message: 'External mode needs at least one --external-asset path or an agent-supplied asset manifest.' });
  }
  if (mode !== 'openai' && !hasNonOpenAiProvider(state) && externalAssets.length === 0) {
    blockers.push({ code: 'missing_generation_route', message: 'Connect WaveSpeed, Fal, Replicate, Zero, HeyGen, MuAPI, RunPod, or pass --external-asset.' });
  }
  return {
    ok: blockers.length === 0,
    mode: 'runneros_squad_modular_preflight',
    provider_mode: mode,
    provider_spend_enabled: false,
    brief_file: briefFile,
    brief_summary: {
      output_type: brief.output_type || 'image',
      platform: brief.platform,
      product_type: brief.product_type || 'general',
      cinema_mode: brief.cinema_mode || '',
    },
    providers: state,
    external_assets: externalAssets,
    output_root: outputRoot,
    blockers,
    warnings: state.openai ? [] : [{ code: 'openai_director_unavailable', message: 'OpenAI director path is unavailable; use modular provider injection or external assets.' }],
    modular_contract: {
      accepts: ['brief', 'storyboard', 'shot_plan', 'image_prompts', 'video_prompts', 'external_assets', 'provider_choice', 'format_rules'],
      preserves_workflows: ['product', 'ugc', 'app_demo', 'faceless_youtube', 'music', 'carousel', 'spotify_canvas'],
      stop_before_spend: true,
    },
  };
}

function modularRun(briefFile, mode) {
  if (!hasFlag('--approved')) {
    fail('Run requires --approved. Use preflight/storyboard first.', { code: 'approval_required' });
  }
  const preflight = modularPreflight(briefFile, mode);
  if (!preflight.ok) {
    print({ ...preflight, mode: 'runneros_squad_modular_run_blocked' });
    process.exit(1);
  }
  const dir = join(artifactDir('runs', briefFile), runId(briefFile));
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'modular-run-plan.json');
  const payload = {
    ok: true,
    mode: 'runneros_squad_modular_run_plan',
    provider_spend_enabled: false,
    final_status: 'planned_waiting_for_external_generation_or_assembly',
    brief_file: briefFile,
    provider_mode: mode,
    budget_cap_usd: Number(opt('budget-cap-usd', '1.00')),
    manifest_path: manifestPath,
    next_actions: [
      'Use storyboard/recipe output to choose the lane.',
      'Generate or attach stills/clips with the selected provider/tool.',
      'Re-run with --external-asset for assembly/review once assets exist.',
    ],
    preflight,
  };
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  print(payload);
}

function passThrough(script, scriptArgs, fallbackMode) {
  const result = parsePythonResult(runPython(script, scriptArgs), fallbackMode);
  if (result.payload) print(result.payload);
  else print({ ok: result.ok, mode: fallbackMode, stdout: result.stdout, stderr: result.stderr });
  process.exit(result.ok ? 0 : 1);
}

if (command === 'help' || command === '--help' || command === '-h') {
  usage();
} else if (command === 'doctor') {
  const state = providerState();
  print({
    ok: existsSync(vendorRoot) && existsSync(join(vendorRoot, 'scripts', 'run_creative_production.py')),
    mode: 'runneros_squad_doctor',
    tool_root: toolRoot,
    vendor_root: vendorRoot,
    python: process.env.SQUAD_PYTHON || process.env.PYTHON || 'python3',
    providers: state,
    modular_generation_ready: hasNonOpenAiProvider(state),
    openai_director_ready: state.openai,
  });
} else if (command === 'recipe') {
  const briefFile = requireBriefFile();
  passThrough('recommend_creative_recipe.py', ['--brief-file', briefFile, '--limit', opt('limit', '3')], 'recipe');
} else if (command === 'storyboard') {
  const briefFile = requireBriefFile();
  const out = opt('output-dir') || join(artifactDir('storyboards', briefFile), runId(briefFile));
  const pyArgs = ['--brief-file', briefFile, '--output-dir', out, '--video-quality', opt('video-quality', 'budget')];
  for (const root of allOpt('asset-root')) pyArgs.push('--asset-root', root);
  passThrough('build_storyboard_plan_board.py', pyArgs, 'storyboard_plan_board');
} else if (command === 'audit') {
  const briefFile = opt('brief-file');
  const pyArgs = briefFile ? ['--brief-file', isAbsolute(briefFile) ? briefFile : resolve(process.cwd(), briefFile)] : [];
  passThrough('audit_creative_flows.py', pyArgs, 'creative_flow_audit');
} else if (command === 'preflight') {
  const briefFile = requireBriefFile();
  const mode = providerMode();
  if (mode === 'modular' || mode === 'external' || (!providerState().openai && hasNonOpenAiProvider())) {
    const payload = modularPreflight(briefFile, mode === 'auto' ? 'modular' : mode);
    print(payload);
    process.exit(payload.ok ? 0 : 1);
  }
  const pyArgs = ['--brief-file', briefFile, '--preflight-only', '--video-quality', opt('video-quality', 'budget'), '--budget-cap-usd', opt('budget-cap-usd', '1.00')];
  const result = parsePythonResult(runPython('run_creative_production.py', pyArgs), 'creative_production_preflight');
  const payload = normalizeOpenAiBlockers(result.payload, mode, providerState());
  print(payload || { ok: result.ok, stdout: result.stdout, stderr: result.stderr });
  process.exit(payload?.ok || result.ok ? 0 : 1);
} else if (command === 'run') {
  const briefFile = requireBriefFile();
  const mode = providerMode();
  if (mode === 'modular' || mode === 'external' || (!providerState().openai && hasNonOpenAiProvider())) {
    modularRun(briefFile, mode === 'auto' ? 'modular' : mode);
  } else {
    if (!hasFlag('--approved')) fail('Run requires --approved. Use preflight/storyboard first.', { code: 'approval_required' });
    const pyArgs = ['--brief-file', briefFile, '--video-quality', opt('video-quality', 'budget'), '--budget-cap-usd', opt('budget-cap-usd', '1.00')];
    passThrough('run_creative_production.py', pyArgs, 'creative_production_run');
  }
} else {
  fail(`Unknown command: ${command}`);
}
