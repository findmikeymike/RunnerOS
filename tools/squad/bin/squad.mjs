#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const runnerRoot = resolve(toolDir, '..', '..');
const defaultSquadHome = '/Users/michaelb.williams/CAS4/Squad';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (args[key] === undefined) {
      args[key] = next;
    } else if (Array.isArray(args[key])) {
      args[key].push(next);
    } else {
      args[key] = [args[key], next];
    }
    i += 1;
  }
  return args;
}

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function jsonOut(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

function resolveSquadHome(args) {
  const raw = args['squad-home'] || process.env.SQUAD_HOME || (existsSync(defaultSquadHome) ? defaultSquadHome : '');
  return raw ? resolve(String(raw)) : '';
}

function resolveWorkspaceRoot(args) {
  const raw = args['workspace-root'] || process.env.RUNNER_WORKSPACE_ROOT || process.env.CRAFT_WORKSPACE_ROOT || process.cwd();
  return resolve(String(raw));
}

function resolveInputPath(path, baseDir) {
  if (!path || typeof path !== 'string') return '';
  return isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
}

function isPathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || Boolean(rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeName(input) {
  return String(input || 'squad')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'squad';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pythonFor(squadHome) {
  if (process.env.SQUAD_PYTHON) return process.env.SQUAD_PYTHON;
  const venvPython = join(squadHome, '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

function scriptPath(squadHome, scriptName) {
  return join(squadHome, 'scripts', scriptName);
}

function doctor(args) {
  const squadHome = resolveSquadHome(args);
  const python = squadHome ? pythonFor(squadHome) : 'python3';
  const checks = {
    squad_home: squadHome || null,
    squad_home_exists: Boolean(squadHome && existsSync(squadHome)),
    skill_md_exists: Boolean(squadHome && existsSync(join(squadHome, 'SKILL.md'))),
    storyboard_script_exists: Boolean(squadHome && existsSync(scriptPath(squadHome, 'build_storyboard_plan_board.py'))),
    production_script_exists: Boolean(squadHome && existsSync(scriptPath(squadHome, 'run_creative_production.py'))),
    inspect_script_exists: Boolean(squadHome && existsSync(scriptPath(squadHome, 'show_creative_production_run.py'))),
    python,
  };
  const ok = checks.squad_home_exists && checks.storyboard_script_exists && checks.production_script_exists;
  return {
    ok,
    source: 'squad',
    tool_dir: toolDir,
    runner_root: runnerRoot,
    ...checks,
    fix: ok ? undefined : 'Set SQUAD_HOME to a valid Squad checkout, then rerun doctor.',
  };
}

function runPython(squadHome, scriptName, scriptArgs) {
  const python = pythonFor(squadHome);
  const child = spawnSync(python, [scriptPath(squadHome, scriptName), ...scriptArgs], {
    cwd: squadHome,
    encoding: 'utf-8',
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    status: child.status ?? 1,
    signal: child.signal,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
    error: child.error ? child.error.message : undefined,
  };
}

function parseLastJson(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf('\n{');
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function makeArtifactRoot(workspaceRoot, kind, name) {
  const dir = join(workspaceRoot, 'squad-artifacts', kind, `${safeName(name)}-${timestamp()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fileEntry(path, label, role = 'supporting') {
  return { path, label: label || basename(path), role };
}

function outputPayloadForStoryboard(result, title, workspaceRoot) {
  const files = [];
  if (result.html_path && isPathInside(workspaceRoot, result.html_path)) {
    files.push(fileEntry(result.html_path, 'Storyboard board', 'primary'));
  }
  if (result.json_path && isPathInside(workspaceRoot, result.json_path)) {
    files.push(fileEntry(result.json_path, 'Storyboard JSON', 'supporting'));
  }
  return {
    title,
    kind: 'report',
    summary: result.ok
      ? 'Squad no-spend storyboard board for review.'
      : 'Squad no-spend storyboard board with findings to review before production.',
    files,
    receipts: [{
      provider: 'squad',
      action: 'storyboard-plan-board',
      status: result.html_path ? 'succeeded' : 'failed',
      displayText: result.provider_spend_enabled === false
        ? 'No provider spend. Storyboard/preflight review only.'
        : 'Storyboard generated.',
      metadata: {
        run_id: result.run_id,
        lane: result.lane,
        storyboard_ok: Boolean(result.ok),
        finding_count: Array.isArray(result.findings) ? result.findings.length : 0,
      },
    }],
    tags: ['squad', 'video-director', 'storyboard', 'no-spend'],
    showInCanvas: true,
  };
}

function outputPayloadForRun(summary, staged) {
  const files = [];
  if (staged.final_asset_path) files.push(fileEntry(staged.final_asset_path, basename(staged.final_asset_path), 'primary'));
  if (staged.review_path) files.push(fileEntry(staged.review_path, basename(staged.review_path), staged.final_asset_path ? 'supporting' : 'primary'));
  if (staged.manifest_path) files.push(fileEntry(staged.manifest_path, 'Squad manifest', 'supporting'));
  const rendered = Boolean(staged.final_asset_path);
  return {
    title: `Squad video ${summary.run_id || 'run'}`,
    kind: rendered ? 'video' : 'receipt',
    summary: rendered ? 'Squad video output staged for review.' : 'Squad run receipt staged for review.',
    files,
    receipts: [{
      provider: 'squad',
      action: 'creative-production-run',
      status: summary.final_status && !String(summary.final_status).toLowerCase().includes('fail') ? 'succeeded' : 'pending',
      displayText: rendered ? 'Playable video artifact created.' : 'No final video artifact found; inspect manifest/review packet.',
      metadata: {
        run_id: summary.run_id,
        final_status: summary.final_status,
        total_spend_usd: summary.total_spend_usd,
        video_attempt_count: summary.video_attempt_count,
        final_assembly_method: summary.final_assembly_method,
      },
    }],
    tags: ['squad', 'video-director', rendered ? 'video-output' : 'run-receipt'],
    showInCanvas: true,
  };
}

function stageFileIntoRunDir(sourcePath, runDir, preferredName) {
  if (!sourcePath || !existsSync(sourcePath)) return null;
  const stat = statSync(sourcePath);
  const target = join(runDir, preferredName || basename(sourcePath));
  if (stat.isDirectory()) {
    cpSync(sourcePath, target, { recursive: true });
    return target;
  }
  cpSync(sourcePath, target);
  return target;
}

function ensureDoctorOk(args) {
  const status = doctor(args);
  if (!status.ok) jsonOut(status, 1);
  return status;
}

function storyboard(args) {
  const status = ensureDoctorOk(args);
  const workspaceRoot = resolveWorkspaceRoot(args);
  const briefFile = resolveInputPath(args['brief-file'], workspaceRoot);
  if (!briefFile || !existsSync(briefFile)) {
    jsonOut({ ok: false, error: '--brief-file is required and must exist', brief_file: briefFile || null }, 1);
  }
  const name = String(args.name || basename(briefFile, extname(briefFile)));
  const outputDir = args['output-dir']
    ? resolveInputPath(String(args['output-dir']), workspaceRoot)
    : makeArtifactRoot(workspaceRoot, 'storyboards', name);
  if (!isPathInside(workspaceRoot, outputDir)) {
    jsonOut({
      ok: false,
      error: '--output-dir must resolve inside the Runner workspace so artifacts can be shown in the artifact window.',
      workspace_root: workspaceRoot,
      output_dir: outputDir,
    }, 1);
  }
  const scriptArgs = [
    '--brief-file', briefFile,
    '--output-dir', outputDir,
    '--video-quality', String(args['video-quality'] || 'budget'),
  ];
  if (args.name) scriptArgs.push('--name', String(args.name));
  if (args['run-id']) scriptArgs.push('--run-id', String(args['run-id']));
  for (const root of asArray(args['asset-root'])) {
    scriptArgs.push('--asset-root', resolveInputPath(String(root), workspaceRoot));
  }
  const child = runPython(status.squad_home, 'build_storyboard_plan_board.py', scriptArgs);
  const parsed = parseLastJson(child.stdout);
  const result = parsed || { ok: false, error: child.error || child.stderr || 'Squad storyboard command did not return JSON.' };
  const hasArtifact = Boolean(result.html_path && existsSync(result.html_path) && isPathInside(workspaceRoot, result.html_path));
  jsonOut({
    ok: hasArtifact,
    storyboard_ok: Boolean(result.ok),
    command: 'storyboard',
    squad_home: status.squad_home,
    workspace_root: workspaceRoot,
    exit_code: child.status,
    stdout: child.stdout.trim() || undefined,
    stderr: child.stderr.trim() || undefined,
    result,
    create_output: hasArtifact ? outputPayloadForStoryboard(result, `Squad storyboard ${result.run_id || name}`, workspaceRoot) : undefined,
  }, hasArtifact ? 0 : 1);
}

function preflight(args) {
  const status = ensureDoctorOk(args);
  const workspaceRoot = resolveWorkspaceRoot(args);
  const briefFile = resolveInputPath(args['brief-file'], workspaceRoot);
  if (!briefFile || !existsSync(briefFile)) {
    jsonOut({ ok: false, error: '--brief-file is required and must exist', brief_file: briefFile || null }, 1);
  }
  const scriptArgs = [
    '--brief-file', briefFile,
    '--video-quality', String(args['video-quality'] || 'budget'),
    '--budget-cap-usd', String(args['budget-cap-usd'] || '1.00'),
    '--preflight-only',
  ];
  for (const root of asArray(args['asset-root'])) {
    scriptArgs.push('--asset-root', resolveInputPath(String(root), workspaceRoot));
  }
  const child = runPython(status.squad_home, 'run_creative_production.py', scriptArgs);
  const parsed = parseLastJson(child.stdout);
  const preflightOk = child.status === 0 && parsed?.ok === true;
  jsonOut({
    ok: preflightOk,
    command: 'preflight',
    squad_home: status.squad_home,
    workspace_root: workspaceRoot,
    exit_code: child.status,
    stdout: child.stdout.trim() || undefined,
    stderr: child.stderr.trim() || undefined,
    result: parsed || {
      ok: false,
      error: 'Squad preflight did not return valid JSON with ok: true.',
    },
  }, preflightOk ? 0 : 1);
}

function runProduction(args) {
  if (!args.approved) {
    jsonOut({
      ok: false,
      error: 'Refusing paid/provider-capable Squad run without --approved. Run storyboard and preflight first, then ask the user for approval.',
    }, 1);
  }
  const status = ensureDoctorOk(args);
  const workspaceRoot = resolveWorkspaceRoot(args);
  const briefFile = resolveInputPath(args['brief-file'], workspaceRoot);
  if (!briefFile || !existsSync(briefFile)) {
    jsonOut({ ok: false, error: '--brief-file is required and must exist', brief_file: briefFile || null }, 1);
  }
  const scriptArgs = [
    '--brief-file', briefFile,
    '--video-quality', String(args['video-quality'] || 'budget'),
    '--budget-cap-usd', String(args['budget-cap-usd'] || '1.00'),
  ];
  for (const root of asArray(args['asset-root'])) {
    scriptArgs.push('--asset-root', resolveInputPath(String(root), workspaceRoot));
  }
  const child = runPython(status.squad_home, 'run_creative_production.py', scriptArgs);
  const parsedSummary = parseLastJson(child.stdout);
  const runOk = child.status === 0 && Boolean(parsedSummary);
  const summary = parsedSummary || { ok: false, error: 'Squad run did not return valid JSON.' };
  const runId = summary.run_id || basename(briefFile, extname(briefFile));
  const runDir = makeArtifactRoot(workspaceRoot, 'runs', runId);
  const staged = {
    final_asset_path: stageFileIntoRunDir(summary.final_asset_path, runDir, summary.final_asset_path ? `final${extname(summary.final_asset_path) || '.mp4'}` : undefined),
    manifest_path: stageFileIntoRunDir(summary.manifest_path, runDir, 'manifest.json'),
    review_path: stageFileIntoRunDir(summary.review_path, runDir, summary.review_path ? `review${extname(summary.review_path) || ''}` : undefined),
  };
  jsonOut({
    ok: runOk,
    command: 'run',
    squad_home: status.squad_home,
    workspace_root: workspaceRoot,
    artifact_dir: runDir,
    exit_code: child.status,
    stdout: child.stdout.trim() || undefined,
    stderr: child.stderr.trim() || undefined,
    result: summary,
    staged,
    create_output: outputPayloadForRun(summary, staged),
  }, runOk ? 0 : 1);
}

function inspectLatest(args) {
  const status = ensureDoctorOk(args);
  const scriptArgs = ['--latest'];
  const child = runPython(status.squad_home, 'show_creative_production_run.py', scriptArgs);
  jsonOut({
    ok: child.status === 0,
    command: 'inspect-latest',
    squad_home: status.squad_home,
    exit_code: child.status,
    stdout: child.stdout.trim() || undefined,
    stderr: child.stderr.trim() || undefined,
  }, child.status === 0 ? 0 : 1);
}

function help() {
  return {
    ok: true,
    commands: {
      doctor: 'node tools/squad/bin/squad.mjs doctor --json',
      storyboard: 'node tools/squad/bin/squad.mjs storyboard --brief-file brief.json --json',
      preflight: 'node tools/squad/bin/squad.mjs preflight --brief-file brief.json --json',
      run: 'node tools/squad/bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json',
      inspectLatest: 'node tools/squad/bin/squad.mjs inspect-latest --json',
    },
    note: 'Storyboard and run emit create_output payloads for Runner artifact-window display.',
  };
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'help';

if (command === 'doctor') jsonOut(doctor(args), doctor(args).ok ? 0 : 1);
if (command === 'storyboard') storyboard(args);
if (command === 'preflight') preflight(args);
if (command === 'run') runProduction(args);
if (command === 'inspect-latest') inspectLatest(args);
jsonOut(help(), 0);
