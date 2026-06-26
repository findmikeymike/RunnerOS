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

  const blockedRun = spawnSync(process.execPath, ['bin/squad.mjs', 'run', '--brief-file', 'brief.json', '--workspace-root', workspace, '--json'], {
    cwd: new URL('.', import.meta.url).pathname,
    env,
    encoding: 'utf-8',
  });
  assert.equal(blockedRun.status, 1, blockedRun.stderr || blockedRun.stdout);
  assert.equal(JSON.parse(blockedRun.stdout).ok, false);
  assert.match(JSON.parse(blockedRun.stdout).error, /--approved/);
} finally {
  rmSync(root, { recursive: true, force: true });
}
