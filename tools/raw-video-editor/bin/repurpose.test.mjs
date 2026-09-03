import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  analyzeRepurposeSource,
  executeRepurpose,
  validateRepurposeBrief,
} from './repurpose.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function analysisFixture(duration = 30) {
  return {
    source: {
      path: '/tmp/source.mp4',
      file: 'source.mp4',
      sha256: 'a'.repeat(64),
      duration,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
  };
}

function validBrief(overrides = {}) {
  return {
    version: 1,
    source: { expectedSha256: 'a'.repeat(64), campaignId: 'campaign-1', releaseKitItemId: 'video-1' },
    rights: { confirmed: true, basis: 'owned' },
    variants: [{
      id: 'new-hook',
      title: 'New hook',
      destination: { platform: 'instagram', account: '@artist', mode: 'standard' },
      editorialIntent: 'Open on the emotional payoff, then reveal the setup.',
      hook: 'The line that changes the meaning of the scene.',
      aspect: '9:16',
      segments: [{ start: 8, end: 18 }, { start: 2, end: 7 }],
      overlay: { text: 'I heard the lyric differently this time', style: 'clean' },
      grade: 'warm',
    }],
    ...overrides,
  };
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
    && spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0;
}

function makeVideo() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-repurpose-'));
  tempDirs.push(dir);
  const source = join(dir, 'source.mp4');
  const child = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '5',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    source,
  ], { encoding: 'utf-8' });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  return { dir, source };
}

describe('social video repurposing', () => {
  test('refuses a cosmetic-only full-source copy', () => {
    const brief = validBrief({
      variants: [{
        id: 'new-filter',
        title: 'New filter',
        destination: { platform: 'instagram', account: '@fanpage', mode: 'fan-page' },
        editorialIntent: 'Change only the surface styling.',
        hook: 'Same opening.',
        aspect: '9:16',
        segments: [{ start: 0, end: 30 }],
        overlay: { text: 'New font', style: 'boxed' },
        grade: 'cool',
      }],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('cosmetic only');
  });

  test('refuses two variants that are effectively the same edit', () => {
    const first = validBrief().variants[0];
    const brief = validBrief({
      variants: [first, { ...first, id: 'duplicate', title: 'Duplicate', grade: 'cool' }],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('effectively the same edit');
  });

  test('refuses unsafe ids and unrendered framing claims as originality evidence', () => {
    const brief = validBrief({
      variants: [{
        ...validBrief().variants[0],
        id: '../outside',
        contextIntro: 'A new introduction the renderer does not implement yet.',
        segments: [{ start: 0, end: 30 }],
      }],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('lowercase letters, numbers, and hyphens');
    expect(result.errors.join(' ')).toContain('cosmetic only');
  });

  test('refuses a token trim that leaves nearly the entire source unchanged', () => {
    const brief = validBrief({
      variants: [{
        ...validBrief().variants[0],
        segments: [{ start: 0, end: 29 }],
      }],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('cosmetic only');
  });

  test('requires the brief to bind to the exact analyzed source hash', () => {
    const brief = validBrief({ source: { campaignId: 'campaign-1', releaseKitItemId: 'video-1' } });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('exact expected source SHA-256');
  });

  test('accepts structurally different account-native variants including an explicitly requested trial', () => {
    const first = validBrief().variants[0];
    const brief = validBrief({
      variants: [
        first,
        {
          ...first,
          id: 'trial-test',
          title: 'Trial opening test',
          editorialIntent: 'Test the chorus payoff with non-followers first.',
          hook: 'Chorus-first opening.',
          destination: { platform: 'instagram', account: '@artist', mode: 'trial', trialRequested: true },
          segments: [{ start: 18, end: 27 }],
        },
      ],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(true);
    expect(result.variants[1].destination.mode).toBe('trial');
    expect(result.variants[1].destination.trialRequested).toBe(true);
  });

  test('refuses Trial mode without an explicit request marker', () => {
    const first = validBrief().variants[0];
    const brief = validBrief({
      variants: [{ ...first, destination: { platform: 'instagram', account: '@artist', mode: 'trial' } }],
    });
    const result = validateRepurposeBrief(brief, analysisFixture());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('trialRequested');
  });

  test('analyzes, hashes, plans, and renders a reviewable variant with lineage', async () => {
    if (!hasFfmpeg()) return;
    const { dir, source } = makeVideo();
    const outDir = join(dir, 'variants');
    const analyzed = await analyzeRepurposeSource({ source, outDir });
    expect(analyzed.analysis.source.sha256).toHaveLength(64);
    expect(existsSync(join(outDir, 'analysis.json'))).toBe(true);
    expect(existsSync(analyzed.briefTemplatePath)).toBe(true);
    expect(analyzed.analysis.scenePreviews.length).toBeGreaterThan(0);
    expect(existsSync(analyzed.analysis.scenePreviews[0].path)).toBe(true);

    const brief = {
      version: 1,
      source: {
        expectedSha256: analyzed.analysis.source.sha256,
        campaignId: 'campaign-1',
        releaseKitItemId: 'video-1',
      },
      rights: { confirmed: true, basis: 'owned', note: 'Artist-owned campaign master.' },
      variants: [{
        id: 'chorus-first',
        title: 'Chorus first',
        destination: { platform: 'instagram', account: '@artist', mode: 'standard' },
        editorialIntent: 'Start later and remove the original setup.',
        hook: 'Immediate visual payoff.',
        aspect: '9:16',
        segments: [{ start: 1, end: 4.5 }],
        overlay: { text: "It's 50%, [listen]: now", style: 'boxed' },
        grade: 'contrast',
      }],
    };
    const briefPath = join(dir, 'brief.json');
    writeFileSync(briefPath, JSON.stringify(brief), 'utf-8');
    const result = await executeRepurpose({ source, outDir, briefPath, render: true });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('rendered-for-review');
    expect(result.variants).toHaveLength(1);
    expect(existsSync(result.variants[0].output.path)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
    expect(manifest.source.sha256).toBe(analyzed.analysis.source.sha256);
    expect(manifest.source.releaseKitItemId).toBe('video-1');
    expect(manifest.variants[0].approvalStatus).toBe('draft');
    expect(manifest.variants[0].meaningfulDifference).toBe('meaningfully-different');
    expect(manifest.variants[0].assessmentBasis).toBe('local-editorial-timeline-gate');
    expect(manifest.variants[0].output.sha256).toHaveLength(64);
  }, 30000);
});
