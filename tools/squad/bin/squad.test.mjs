import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = new URL('./squad.mjs', import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args, '--json'], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
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
    const result = run(['storyboard', '--brief-file', briefFile()]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.create_output.kind, 'report');
    assert.equal(payload.create_output.showInCanvas, true);
    assert.equal(payload.create_output.files[0].role, 'primary');
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
