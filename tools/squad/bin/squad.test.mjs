import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `.pathname` leaves a path percent-encoded, so any directory with a space in
// it resolves to a module that does not exist — which is exactly what happens
// inside "Artist OS.app". fileURLToPath decodes it.
const BIN = fileURLToPath(new URL('./squad.mjs', import.meta.url));

function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'squad-runtime-fixture-'));
  const python = join(dir, 'python.mjs');
  writeFileSync(python, '#!/usr/bin/env node\nconsole.log("{}");\n');
  chmodSync(python, 0o755);
  const cleanEnv = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'SQUAD_OPENAI_API_KEY', 'WAVESPEED_API_KEY', 'SQUAD_WAVESPEED_API_KEY', 'FAL_API_KEY', 'SQUAD_FAL_API_KEY', 'REPLICATE_API_TOKEN', 'HEYGEN_API_KEY', 'SQUAD_HEYGEN_API_KEY', 'MUAPI_API_KEY', 'RUNPOD_API_KEY', 'ZERO_CLI_PATH']) delete cleanEnv[key];
  try {
    return spawnSync(process.execPath, [BIN, ...args, '--json'], {
      encoding: 'utf-8',
      env: { ...cleanEnv, SQUAD_PYTHON: python, CRAFT_UV: '', PYTHON: '', ...env },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function briefFile() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-squad-test-'));
  const file = join(dir, 'brief.json');
  writeFileSync(file, JSON.stringify({
    product_description: 'song called Watching Tornado Videos on Youtube',
    campaign_goal: 'create a 5 second silent Spotify Canvas loop',
    platform: 'spotify_canvas',
    output_type: 'full_production',
    max_cost_usd: 1,
  }));
  return file;
}

describe('runneros squad wrapper', () => {
  // Squad's vendored Python needs 3.11+; stock macOS ships 3.9. These lock the
  // runtime resolution so storyboard cannot regress to a bare `python3`.
  it('prefers the bundled uv runtime and never syncs the vendored project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runneros-squad-test-'));
    const fakeUv = join(dir, 'fake-uv.mjs');
    writeFileSync(fakeUv, [
      '#!/usr/bin/env node',
      'console.log(JSON.stringify({ mode: "fake_uv", argv: process.argv.slice(2) }))',
    ].join('\n'));
    chmodSync(fakeUv, 0o755);

    const result = run(['storyboard', '--brief-file', briefFile()], {
      CRAFT_UV: fakeUv,
      SQUAD_PYTHON: '',
      PYTHON: '',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'fake_uv');
    // --no-project is load-bearing: vendor/squad is an installable project, so
    // without it uv builds a 72 MB virtualenv on first run and fails offline.
    assert.deepEqual(payload.argv.slice(0, 4), ['run', '--no-project', '--python', '3.12']);
    assert.ok(payload.argv[4].endsWith('build_storyboard_plan_board.py'));
  });

  it('lets SQUAD_PYTHON override the bundled runtime', () => {
    // The escape hatch for anyone running a fully provisioned interpreter.
    const result = run(['doctor'], { SQUAD_PYTHON: '/tmp/runneros-squad-explicit-python', CRAFT_UV: '/tmp/runneros-squad-uv' });
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.python_runtime.source, 'squad_python');
    assert.equal(payload.python_runtime.command, '/tmp/runneros-squad-explicit-python');
  });

  it('doctor reports modular provider state', () => {
    const result = run(['doctor']);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'runneros_squad_doctor');
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.providers, 'object');
    assert.equal(typeof payload.python_runtime, 'object');
    assert.equal(typeof payload.storyboard_ready, 'boolean');
    assert.equal(typeof payload.modular_orchestration_ready, 'boolean');
    assert.equal(typeof payload.native_production_ready, 'boolean');
  });

  it('modular preflight does not require OpenAI when a non-OpenAI route is configured', () => {
    const result = run(['preflight', '--brief-file', briefFile(), '--provider-mode', 'modular'], {
      OPENAI_API_KEY: '',
      SQUAD_OPENAI_API_KEY: '',
      WAVESPEED_API_KEY: 'test-wavespeed-key',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider_mode, 'modular');
    assert.equal(payload.mode, 'runneros_squad_modular_preflight');
    assert.equal(payload.blockers.length, 0);
  });

  it('modular run stops without approval', () => {
    const result = run(['run', '--brief-file', briefFile(), '--provider-mode', 'modular'], {
      WAVESPEED_API_KEY: 'test-wavespeed-key',
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, 'approval_required');
  });

  it('storyboard returns a Canvas output payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squad-storyboard-fixture-'));
    const python = join(dir, 'python.mjs');
    const board = join(dir, 'board.html');
    writeFileSync(board, '<html>Storyboard fixture</html>');
    writeFileSync(python, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ ok: true, html_path: board }))});\n`);
    chmodSync(python, 0o755);
    try {
      const result = run(['storyboard', '--brief-file', briefFile()], { SQUAD_PYTHON: python });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.create_output.kind, 'report');
      assert.equal(payload.create_output.showInCanvas, true);
      assert.equal(payload.create_output.files[0].role, 'primary');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('approved modular run returns an honest pending receipt', () => {
    const result = run(['run', '--brief-file', briefFile(), '--provider-mode', 'modular', '--approved'], {
      WAVESPEED_API_KEY: 'test-wavespeed-key',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.final_status, 'planned_waiting_for_external_generation_or_assembly');
    assert.equal(payload.create_output.kind, 'receipt');
    assert.match(payload.create_output.summary, /not a finished video/i);
  });
});

describe('Python command outcome guards', () => {
  function fakeResult(command, stdout, status = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'squad-outcome-'));
    const fakeUv = join(dir, 'uv.mjs');
    writeFileSync(fakeUv, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});process.exit(${status});\n`);
    chmodSync(fakeUv, 0o755);
    try {
      return run([command, '--brief-file', briefFile(), '--provider-mode', 'openai', ...(command === 'run' ? ['--approved'] : [])], {
        CRAFT_UV: fakeUv, SQUAD_PYTHON: '', PYTHON: '', OPENAI_API_KEY: 'fixture-unused', SQUAD_OPENAI_API_KEY: 'fixture-unused',
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  for (const command of ['run', 'preflight']) {
    for (const stdout of ['not json', 'null', '[]', '{"ok":false}', '{"ok":true,"final_status":"failed"}']) {
      it(`${command} rejects exit-zero ${stdout}`, () => {
        const result = fakeResult(command, stdout);
        assert.notEqual(result.status, 0);
        assert.equal(JSON.parse(result.stdout).ok, false);
      });
    }
    it(`${command} rejects nonzero exits even when JSON claims success`, () => {
      const result = fakeResult(command, '{"ok":true}', 1);
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).ok, false);
    });
    it(`${command} accepts a valid success`, () => {
      const result = fakeResult(command, '{"ok":true,"final_status":"completed"}');
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(JSON.parse(result.stdout).ok, true);
    });
  }
  it('preflight requires explicit readiness', () => {
    const result = fakeResult('preflight', '{"mode":"preflight"}');
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, false);
  });
  it('preserves recipe output without an ok field', () => {
    const result = fakeResult('recipe', '{"recommendations":[]}');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), { recommendations: [] });
  });
});
