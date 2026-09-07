import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOutputAssetPath, getOutputDir, type OutputManifest } from '@craft-agent/shared/outputs';
import { SignalBriefingAudio, SIGNAL_AUDIO_LIMITS, SIGNAL_AUDIO_MODEL } from './SignalBriefingAudio';
import { signalWorkflowFor, type SignalMode, type SignalTrack, type SignalReportMetadata } from '@craft-agent/shared/shared-intel';
import { hash, readSignals, saveEvidence, writeSignals, type SignalRequest } from '../signals/storage';
import type { SignalFinalReportRun } from '../signals/final-report';

const workspaceId = 'signal-audio-test';
const outputId = '11111111-1111-4111-8111-111111111111';
const briefing = `${Array(111).fill('Insight').join(' ')} The full report has the details and sources.`;
const report = `# Weekly Signal Brief\n\n## Your Briefing\n\n${briefing}\n\n## Details\nPrivate details are not spoken.`;
// Two complete MPEG1 Layer III 128 kbps / 44.1 kHz frames.
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x00]);
const mp3 = Buffer.concat([frame, frame]);
const response = () => Response.json({ audioContent: mp3.toString('base64') });
let root: string;
let workspace: { id: string; rootPath: string; remoteServer?: unknown };
let output: OutputManifest;
let reportPath: string;
let cacheDir: string;
let request: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>;
let permission: ReturnType<typeof mock<(root: string) => void>>;
let secret: ReturnType<typeof mock<(name: string) => Promise<string | null>>>;
let safePath: ReturnType<typeof mock<(workspaceId: string, outputId: string) => Promise<string>>>;
let getOutput: ReturnType<typeof mock<() => OutputManifest | null>>;

function service(extra: Partial<ConstructorParameters<typeof SignalBriefingAudio>[0]> = {}) {
  return new SignalBriefingAudio({
    getWorkspace: (id) => id === workspaceId ? workspace : null,
    getOutput, getRun: () => ({ id: 'run-1', workspaceId, workflowSlug: 'weekly-signal-scan', state: 'succeeded', finalOutputId: outputId }),
    safeOutputPath: safePath, assertPermission: permission,
    loadSecret: secret, environment: {}, cacheDir, fetch: request, ...extra,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'signal-briefing-audio-'));
  workspace = { id: workspaceId, rootPath: join(root, 'workspace') };
  cacheDir = join(root, 'cache');
  const dir = getOutputDir(workspace.rootPath, outputId);
  await mkdir(dir, { recursive: true });
  reportPath = join(dir, 'report.md');
  await writeFile(reportPath, report);
  output = {
    schemaVersion: 1, id: outputId, workspaceId, title: 'Weekly Signal Brief', slug: 'signal', kind: 'report', status: 'published',
    summary: '', createdAt: '', updatedAt: '', origin: { source: 'workflow', workflowSlug: 'weekly-signal-scan', workflowRunId: 'run-1', stepId: 'synthesize' },
    primary: { id: 'primary', label: 'Report', role: 'primary', path: 'report.md', mimeType: 'text/markdown' }, assets: [], receipts: [], links: [],
  };
  request = mock(async () => response());
  permission = mock(() => {});
  secret = mock(async (name) => name === 'INWORLD_API_KEY' ? 'private-key' : null);
  safePath = mock(async () => assertOutputAssetPath(workspace.rootPath, outputId, output.primary!.path));
  getOutput = mock(() => output);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function newReport(track: SignalTrack = 'your-world', mode: SignalMode = 'scan') {
  const state = readSignals(workspace.rootPath, workspaceId);
  const workflowSlug = signalWorkflowFor(track, mode);
  output.origin.workflowSlug = workflowSlug;
  output.title = 'Renamed report';
  output.createdAt = '2026-09-07T12:00:00.000Z';
  const identity = { version: 1 as const, hqWorkspaceId: workspaceId, track, mode, runId: 'request-1', workflowRunId: 'run-1', configRevision: 'initial', requestedVideoIds: mode === 'links' ? ['abcdefghijk'] : [] };
  const metadata: SignalReportMetadata = { version: 1, identity, outputId, contentHash: hash(report), createdAt: output.createdAt, coverageStatus: 'complete', sources: [], findings: [], ideas: [], warnings: [], indexingStatus: 'ready' };
  const entry: SignalRequest = { runId: identity.runId, identity, track, mode, status: 'report', workflowRunId: 'run-1', orderIds: [], outputId, createdAt: output.createdAt, updatedAt: output.createdAt,
    idempotencyKey: 'key', requestHash: 'hash', config: state.tracks[track], coverage: [], selected: [], packets: [], websites: [], collectionComplete: true, workflowDigest: 'digest', outputHash: hash(report) };
  state.requests.push(entry);
  const run: SignalFinalReportRun = { id: 'run-1', workspaceId, workflowSlug, state: 'succeeded', finalOutputId: outputId,
    trigger: { type: 'manual', firedAt: output.createdAt, inputs: { signalContract: 'signals-v1', signalRequestId: identity.runId, track, mode } } };
  const persist = () => { entry.reportMetadataHash = hash(metadata); saveEvidence(workspace.rootPath, entry.reportMetadataHash, metadata); writeSignals(workspace.rootPath, state); };
  persist();
  return { state, entry, metadata, run, persist, audio: service({ getRun: () => run }) };
}

describe('new-contract audio host proof', () => {
  for (const track of ['industry', 'your-world'] as const) for (const mode of ['scan', 'links'] as const) {
    test(`accepts validated renamed ${track} ${mode} and reuses cache`, async () => {
      const fixture = newReport(track, mode);
      await fixture.audio.read(workspaceId, outputId, briefing);
      await fixture.audio.read(workspaceId, outputId, briefing);
      expect(request).toHaveBeenCalledTimes(1);
      expect(JSON.parse(request.mock.calls[0]![1].body as string).text).toBe(briefing);
    });
  }
  test('permits partial and index-failed readable reports with exact current retry identity', async () => {
    const f = newReport();
    f.entry.status = 'partial'; f.metadata.coverageStatus = 'partial'; f.metadata.indexingStatus = 'failed';
    f.entry.workflowRunId = f.run.id = output.origin.workflowRunId = 'retry-2';
    f.entry.attempts = [{ fromRunId: 'run-1', runId: 'retry-2' }];
    f.metadata.identity = { ...f.metadata.identity, workflowRunId: 'retry-2' };
    f.persist();
    await f.audio.read(workspaceId, outputId, briefing);
    expect(request).toHaveBeenCalledTimes(1);
  });
  for (const field of ['hq', 'track', 'mode', 'config', 'attempt', 'output', 'trigger', 'final', 'state', 'sidecar-identity', 'sidecar-output', 'sidecar-hash', 'sidecar-date'] as const) {
    test(`rejects ${field} mismatch before report IO or provider access`, async () => {
      const f = newReport();
      switch (field) {
        case 'hq': f.entry.identity.hqWorkspaceId = 'other'; break;
        case 'track': f.entry.track = 'industry'; break;
        case 'mode': f.entry.mode = 'links'; break;
        case 'config': f.entry.config.revision = 'changed'; break;
        case 'attempt': f.entry.workflowRunId = 'other'; break;
        case 'output': f.entry.outputId = 'other'; break;
        case 'trigger': f.run.trigger!.inputs.signalRequestId = 'other'; break;
        case 'final': f.run.finalOutputId = 'other'; break;
        case 'state': f.run.state = 'failed'; break;
        case 'sidecar-identity': f.metadata.identity = { ...f.metadata.identity, runId: 'other' }; break;
        case 'sidecar-output': f.metadata.outputId = 'other'; break;
        case 'sidecar-hash': f.metadata.contentHash = hash('other'); break;
        case 'sidecar-date': f.metadata.createdAt = '2025-01-01T00:00:00Z'; break;
      }
      f.persist();
      await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
      expect(safePath).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    });
  }
  for (const status of ['queued', 'running', 'failed', 'cancelled', 'no-change'] as const) {
    test(`rejects journal ${status} even with succeeded run`, async () => {
      const f = newReport(); f.entry.status = status; f.persist();
      await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
      expect(safePath).not.toHaveBeenCalled();
    });
  }
  test('requires a unique journal mapping and intact persisted sidecar', async () => {
    const f = newReport();
    f.state.requests.push(structuredClone(f.entry)); f.persist();
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    f.state.requests.pop(); f.persist();
    const path = join(workspace.rootPath, 'signals', 'packets', `${f.entry.reportMetadataHash}.json`);
    await writeFile(path, '{private corrupted JSON');
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    await rm(path);
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    expect(safePath).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  test('rejects an unadmitted retry despite matching run, output and sidecar', async () => {
    const f = newReport();
    f.entry.workflowRunId = f.run.id = output.origin.workflowRunId = 'unadmitted';
    f.metadata.identity = { ...f.metadata.identity, workflowRunId: 'unadmitted' };
    f.entry.refusedAttempts = [{ fromRunId: 'run-1', runId: 'unadmitted' }]; f.persist();
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    expect(safePath).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  test('never substitutes tags for missing journal or sidecar proof', async () => {
    const f = newReport(); output.tags = ['signals-v1', 'signal-track:your-world'];
    f.entry.reportMetadataHash = undefined; writeSignals(workspace.rootPath, f.state);
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    f.state.requests = []; writeSignals(workspace.rootPath, f.state);
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    expect(safePath).not.toHaveBeenCalled(); expect(secret).not.toHaveBeenCalled();
  });
  test('does not serve cached audio after unvalidated detail edits, even with matching visible briefing', async () => {
    const f = newReport(); await f.audio.read(workspaceId, outputId, briefing); secret.mockClear();
    await writeFile(reportPath, `${report}\nUnvalidated changed detail`);
    await expect(f.audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_CHANGED' });
    expect(request).toHaveBeenCalledTimes(1); expect(secret).not.toHaveBeenCalled();
  });
});

describe('saved Signals audio', () => {
  test('uses official HTTP casing, encrypted-secret resolver and Dennis; sends only saved parsed briefing', async () => {
    const audio = service();
    expect(request).not.toHaveBeenCalled();
    expect(await audio.read(workspaceId, outputId, briefing)).toEqual({ audioDataUrl: `data:audio/mpeg;base64,${mp3.toString('base64')}` });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://api.inworld.ai/tts/v1/voice');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ Authorization: 'Basic private-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ text: briefing, voiceId: 'Dennis', modelId: SIGNAL_AUDIO_MODEL, audioConfig: { audioEncoding: 'MP3' } });
    expect(init.body).not.toContain('Private details');
    expect(permission).toHaveBeenCalledWith(workspace.rootPath);
    expect(secret).toHaveBeenCalledWith('INWORLD_API_KEY');
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.mp3$/);
    expect((await stat(join(cacheDir, files[0]!))).mode & 0o777).toBe(0o600);
  });

  test('deduplicates concurrent requests and reuses disk cache across service instances', async () => {
    const audio = service();
    const results = await Promise.all(Array.from({ length: 8 }, () => audio.read(workspaceId, outputId, briefing)));
    expect(new Set(results.map((r) => r.audioDataUrl)).size).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    await service().read(workspaceId, outputId, briefing);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('invalidates cache when saved voice or full report content changes', async () => {
    const audio = service();
    await audio.read(workspaceId, outputId, briefing);
    secret.mockImplementation(async (name) => name === 'INWORLD_API_KEY' ? 'private-key' : name === 'INWORLD_VOICE_ID' ? 'Ashley' : null);
    await audio.read(workspaceId, outputId, briefing);
    expect(JSON.parse(request.mock.calls[1]![1].body as string).voiceId).toBe('Ashley');
    await writeFile(reportPath, `${report}\nUpdated detail`);
    await audio.read(workspaceId, outputId, briefing);
    expect(request).toHaveBeenCalledTimes(3);
  });

  test('rejects stale renderer text before secrets/network even with warm cache', async () => {
    const audio = service();
    await audio.read(workspaceId, outputId, briefing);
    secret.mockClear();
    await writeFile(reportPath, report.replace('Insight', 'Changed'));
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_CHANGED', message: 'The Signals report changed. Reload the report before playing audio.' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(secret).not.toHaveBeenCalled();
  });

  test('remote and unknown workspaces fail before permissions, output loading or credentials', async () => {
    workspace.remoteServer = { url: 'https://remote.invalid' };
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('remote workspaces');
    await expect(service().read('unknown', outputId, briefing)).rejects.toThrow('not found');
    expect(permission).not.toHaveBeenCalled();
    expect(getOutput).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('permission denial precedes output/report reads and never leaks permission errors', async () => {
    permission.mockImplementation(() => { throw new Error('private membership at /secret/path'); });
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('Workspace owner permission');
    expect(getOutput).not.toHaveBeenCalled();
    expect(safePath).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
  });

  test('validates output ownership, report identity, completion and primary before reading', async () => {
    const valid = structuredClone(output);
    for (const patch of [{ workspaceId: 'other' }, { id: 'other' }, { kind: 'audio' }, { status: 'draft' },
      { origin: { ...valid.origin, stepId: 'collector' } }, { tags: ['signal-source-packet'] }, { primary: undefined }]) {
      output = { ...valid, ...patch } as OutputManifest;
      await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('saved final Signals report');
    }
    expect(safePath).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('authoritative run must own the final report and have succeeded', async () => {
    const run = { id: 'run-1', workspaceId, workflowSlug: 'weekly-signal-scan', state: 'succeeded' as const, finalOutputId: outputId };
    for (const patch of [{ id: 'other' }, { workspaceId: 'other' }, { workflowSlug: 'other' },
      { state: 'running' }, { state: 'failed' }, { state: 'cancelled' }, { finalOutputId: 'other' }, { finalOutputId: undefined }]) {
      const getRun = () => ({ ...run, ...patch }) as ReturnType<NonNullable<ConstructorParameters<typeof SignalBriefingAudio>[0]['getRun']>>;
      await expect(service({ getRun }).read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'REPORT_NOT_FINAL' });
    }
    await expect(service({ getRun: () => null }).read(workspaceId, outputId, briefing)).rejects.toThrow('completed Signals run');
    expect(safePath).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    output.title = 'My renamed report';
    await expect(service().read(workspaceId, outputId, briefing)).resolves.toHaveProperty('audioDataUrl');
  });

  test('rejects unknown output and malformed identifiers before report reads', async () => {
    getOutput.mockImplementation(() => null);
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('saved final');
    getOutput.mockClear();
    for (const id of ['../secret', 'x/../../secret', '', 'x'.repeat(201)]) {
      await expect(service().read(workspaceId, id, briefing)).rejects.toThrow();
    }
    expect(getOutput).not.toHaveBeenCalled();
    expect(safePath).not.toHaveBeenCalled();
  });

  test('refuses traversal, external absolute files and symlink escapes without network', async () => {
    for (const path of ['../../../secret.md', join(root, 'secret.md')]) {
      output.primary!.path = path;
      await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow();
    }
    output.primary!.path = 'report.md';
    const outside = join(root, 'secret.md');
    await writeFile(outside, report);
    await rm(reportPath);
    await symlink(outside, reportPath);
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('path is not allowed');
    expect(secret).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('rejects oversized or absent briefings and report files', async () => {
    await expect(service().read(workspaceId, outputId, 'x'.repeat(2001))).rejects.toThrow('2,000');
    expect(safePath).not.toHaveBeenCalled();
    await writeFile(reportPath, 'x'.repeat(SIGNAL_AUDIO_LIMITS.reportBytes + 1));
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('size');
    await writeFile(reportPath, '# Old report without a briefing');
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('no audio briefing');
    expect(secret).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test('rejects an in-workspace cache including a symlinked cache', async () => {
    await expect(service({ cacheDir: join(workspace.rootPath, 'cache') }).read(workspaceId, outputId, briefing)).rejects.toThrow('outside the workspace');
    await symlink(workspace.rootPath, cacheDir);
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('outside the workspace');
    expect(request).not.toHaveBeenCalled();
  });

  test('missing key is actionable, and cached playback does not need a key', async () => {
    secret.mockImplementation(async () => null);
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'MISSING_KEY', message: 'Add your Inworld API key in Connections > Services to play Signals audio.' });
    expect(request).not.toHaveBeenCalled();
    secret.mockImplementation(async (name) => name === 'INWORLD_API_KEY' ? 'key' : null);
    await service().read(workspaceId, outputId, briefing);
    secret.mockImplementation(async () => null);
    await service().read(workspaceId, outputId, briefing);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('uses legacy encrypted credential aliases and normalizes Basic auth', async () => {
    secret.mockImplementation(async (name) => name === 'INWORLD_RUNTIME_KEY' ? 'Basic legacy-key' : name === 'INWORLD_TTS_VOICE_ID' ? 'Clive' : null);
    await service().read(workspaceId, outputId, briefing);
    expect(request.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Basic legacy-key' });
    expect(JSON.parse(request.mock.calls[0]![1].body as string).voiceId).toBe('Clive');
  });

  test('bounds/redacts provider, credential, filesystem and malformed JSON errors', async () => {
    const audio = service();
    for (const status of [400, 401, 403, 429, 500]) {
      request.mockImplementation(async () => new Response('secret provider report private-key', { status }));
      try { await audio.read(workspaceId, outputId, briefing); throw new Error('Expected rejection'); }
      catch (error) {
        expect((error as Error).message.length).toBeLessThan(180);
        expect((error as Error).message).not.toContain('secret provider');
        expect((error as Error).message).not.toContain('private-key');
      }
    }
    request.mockImplementation(async () => new Response('bad JSON private-key'));
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toThrow('could not be prepared');
    request.mockImplementation(async () => { throw new Error('secret network error'); });
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toThrow('could not be prepared');
    secret.mockImplementation(async () => { throw new Error('secret vault error'); });
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toThrow('could not be prepared');
    expect(await readdir(cacheDir)).toEqual([]);
  });

  test('invalid audio signatures/base64 never enter cache and a later request can retry', async () => {
    const audio = service();
    for (const invalid of ['', '%%%', 'c2VjcmV0', Buffer.from('ID3random bytes').toString('base64'), frame.subarray(0, 12).toString('base64')]) {
      request.mockImplementation(async () => Response.json({ audioContent: invalid }));
      await expect(audio.read(workspaceId, outputId, briefing)).rejects.toThrow('invalid audio');
      expect(await readdir(cacheDir)).toEqual([]);
    }
    request.mockImplementation(async () => response());
    await expect(audio.read(workspaceId, outputId, briefing)).resolves.toHaveProperty('audioDataUrl');
  });

  test('corrupt and oversized caches regenerate once and leave no temp files', async () => {
    const audio = service();
    await audio.read(workspaceId, outputId, briefing);
    const cached = join(cacheDir, (await readdir(cacheDir))[0]!);
    for (const bytes of [Buffer.from('corruption'), Buffer.alloc(SIGNAL_AUDIO_LIMITS.audioBytes + 1)]) {
      await writeFile(cached, bytes);
      await Promise.all([audio.read(workspaceId, outputId, briefing), audio.read(workspaceId, outputId, briefing)]);
      expect(await readFile(cached)).toEqual(mp3);
      expect(await readdir(cacheDir)).toHaveLength(1);
    }
    expect(request).toHaveBeenCalledTimes(3);
  });

  test('bounds provider response/audio size before caching', async () => {
    request.mockImplementation(async () => Response.json({ audioContent: Buffer.alloc(SIGNAL_AUDIO_LIMITS.audioBytes + 1).toString('base64') }));
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('invalid audio');
    request.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(SIGNAL_AUDIO_LIMITS.responseBytes + 1)); controller.close(); } })));
    await expect(service().read(workspaceId, outputId, briefing)).rejects.toThrow('supported size');
    expect(await readdir(cacheDir)).toEqual([]);
  });

  test('times out hanging network and response bodies, aborts, and clears dedup for retry', async () => {
    const audio = service({ timeoutMs: 20 });
    request.mockImplementation(async () => new Promise<Response>(() => {}));
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(request.mock.calls[0]![1].signal!.aborted).toBe(true);
    request.mockImplementation(async () => new Response(new ReadableStream({ start() {} })));
    await expect(audio.read(workspaceId, outputId, briefing)).rejects.toMatchObject({ code: 'TIMEOUT' });
    request.mockImplementation(async () => response());
    await expect(audio.read(workspaceId, outputId, briefing)).resolves.toHaveProperty('audioDataUrl');
    expect(await readdir(cacheDir)).toHaveLength(1);
  });
});
