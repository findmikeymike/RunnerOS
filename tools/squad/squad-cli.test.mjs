import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = mkdtempSync(join(tmpdir(), 'runner-squad-tool-'));
const squadHome = join(root, 'Squad');
const workspace = join(root, 'workspace');
mkdirSync(join(squadHome, 'scripts'), { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(squadHome, 'SKILL.md'), '# Squad\n');

writeFileSync(join(squadHome, 'scripts', 'build_storyboard_plan_board.py'), `
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const out = args[args.indexOf('--output-dir') + 1];
mkdirSync(out, { recursive: true });
const html = join(out, 'storyboard-board.html');
const json = join(out, 'storyboard-board.json');
writeFileSync(html, '<!doctype html><title>Storyboard</title>');
writeFileSync(json, JSON.stringify({ ok: true }));
console.log(JSON.stringify({ ok: true, mode: 'storyboard_plan_board', run_id: 'storyboard-test', lane: 'ugc', html_path: html, json_path: json, provider_spend_enabled: false, findings: [] }));
`);

writeFileSync(join(squadHome, 'scripts', 'run_creative_production.py'), `
console.log(JSON.stringify({ ok: true, final_status: 'preflight_ok', run_id: 'preflight-test' }));
`);

writeFileSync(join(squadHome, 'scripts', 'show_creative_production_run.py'), `
console.log('latest run');
`);

writeFileSync(join(workspace, 'brief.json'), JSON.stringify({
  product_description: 'App',
  campaign_goal: 'Make a quick UGC ad',
  platform: 'tiktok',
  output_type: 'full_production',
  max_cost_usd: 1,
}));

try {
  const env = { ...process.env, SQUAD_HOME: squadHome, SQUAD_PYTHON: process.execPath };
  const doctor = spawnSync(process.execPath, ['bin/squad.mjs', 'doctor', '--json', '--workspace-root', workspace], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).ok, true);

  const storyboard = spawnSync(process.execPath, ['bin/squad.mjs', 'storyboard', '--brief-file', 'brief.json', '--workspace-root', workspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(storyboard.status, 0, storyboard.stderr || storyboard.stdout);
  const parsed = JSON.parse(storyboard.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.create_output.kind, 'report');
  assert.equal(parsed.create_output.showInCanvas, true);
  assert.equal(parsed.create_output.files[0].role, 'primary');
  assert.ok(parsed.create_output.files[0].path.startsWith(workspace));
  assert.equal(readFileSync(parsed.create_output.files[0].path, 'utf-8').includes('Storyboard'), true);

  const outsideWorkspace = join(root, 'outside-workspace');
  const outsideStoryboard = spawnSync(process.execPath, ['bin/squad.mjs', 'storyboard', '--brief-file', 'brief.json', '--workspace-root', workspace, '--output-dir', outsideWorkspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(outsideStoryboard.status, 1, outsideStoryboard.stderr || outsideStoryboard.stdout);
  assert.match(JSON.parse(outsideStoryboard.stdout).error, /inside the Runner workspace/);

  const preflight = spawnSync(process.execPath, ['bin/squad.mjs', 'preflight', '--brief-file', 'brief.json', '--workspace-root', workspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  assert.equal(JSON.parse(preflight.stdout).ok, true);

  writeFileSync(join(squadHome, 'scripts', 'run_creative_production.py'), `
console.log('not json');
`);
  const malformedPreflight = spawnSync(process.execPath, ['bin/squad.mjs', 'preflight', '--brief-file', 'brief.json', '--workspace-root', workspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(malformedPreflight.status, 1, malformedPreflight.stderr || malformedPreflight.stdout);
  assert.equal(JSON.parse(malformedPreflight.stdout).ok, false);
  assert.match(JSON.parse(malformedPreflight.stdout).result.error, /valid JSON/);

  writeFileSync(join(squadHome, 'scripts', 'run_creative_production.py'), `
console.log(JSON.stringify({ ok: false, final_status: 'failed', run_id: 'failed-run', error: 'provider failed' }));
`);
  const failedRun = spawnSync(process.execPath, ['bin/squad.mjs', 'run', '--brief-file', 'brief.json', '--workspace-root', workspace, '--approved', '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(failedRun.status, 1, failedRun.stderr || failedRun.stdout);
  const failedRunJson = JSON.parse(failedRun.stdout);
  assert.equal(failedRunJson.ok, false);
  assert.equal(failedRunJson.result.ok, false);
  assert.equal(failedRunJson.create_output.receipts[0].status, 'failed');

  const blockedRun = spawnSync(process.execPath, ['bin/squad.mjs', 'run', '--brief-file', 'brief.json', '--workspace-root', workspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(blockedRun.status, 1, blockedRun.stderr || blockedRun.stdout);
  assert.equal(JSON.parse(blockedRun.stdout).ok, false);
  assert.match(JSON.parse(blockedRun.stdout).error, /--approved/);

  const missingInspectHome = join(root, 'SquadMissingInspect');
  mkdirSync(join(missingInspectHome, 'scripts'), { recursive: true });
  writeFileSync(join(missingInspectHome, 'SKILL.md'), '# Squad\n');
  writeFileSync(join(missingInspectHome, 'scripts', 'build_storyboard_plan_board.py'), 'print("{}")\n');
  writeFileSync(join(missingInspectHome, 'scripts', 'run_creative_production.py'), 'print("{}")\n');
  const missingInspectDoctor = spawnSync(process.execPath, ['bin/squad.mjs', 'doctor', '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { ...env, SQUAD_HOME: missingInspectHome },
    encoding: 'utf-8',
  });
  assert.equal(missingInspectDoctor.status, 1, missingInspectDoctor.stderr || missingInspectDoctor.stdout);
  assert.equal(JSON.parse(missingInspectDoctor.stdout).inspect_script_exists, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
