import { constants } from 'node:fs';
import { mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import { CONFIG_DIR } from '@craft-agent/shared/config/paths';
import { buildInworldBasicAuthorization, getCredentialManager, resolveInworldApiKey, resolveInworldVoiceId } from '@craft-agent/shared/credentials';
import type { OutputManifest } from '@craft-agent/shared/outputs';
import { isFinalSignalReport, parseSignalBriefing } from '@craft-agent/shared/shared-intel';
import { assertTeamPermission } from '@craft-agent/shared/workspaces';
import { readRun } from '@craft-agent/shared/workflows';
import { SignalFinalReportError, validateSignalFinalReport, validateSignalFinalReportContent, type SignalFinalReportRun } from '../signals/final-report';

export const SIGNAL_AUDIO_MODEL = 'inworld-tts-2-flash';
export const SIGNAL_AUDIO_LIMITS = { reportBytes: 1024 * 1024, textCharacters: 2000, audioBytes: 4 * 1024 * 1024, responseBytes: 6 * 1024 * 1024, timeoutMs: 45_000, concurrent: 4 } as const;
const ENDPOINT = 'https://api.inworld.ai/tts/v1/voice';
export class SignalBriefingAudioError extends Error {
  constructor(message: string, readonly code = 'AUDIO_UNAVAILABLE') { super(message); }
}
function fail(message: string, code?: string): never { throw new SignalBriefingAudioError(message, code); }

interface SignalBriefingAudioDeps {
  getWorkspace(id: string): { id: string; rootPath: string; remoteServer?: unknown } | null | undefined;
  getOutput(workspaceId: string, outputId: string): OutputManifest | null;
  getRun?: (rootPath: string, runId: string) => SignalFinalReportRun | null;
  safeOutputPath(workspaceId: string, outputId: string): Promise<string>;
  assertPermission?: (rootPath: string) => void;
  loadSecret?: (name: string) => Promise<string | null | undefined>;
  environment?: Readonly<Record<string, string | undefined>>;
  cacheDir?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../');
}

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) fail('Signals audio file exceeds the supported size or is not a regular file.');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) fail('Signals audio file exceeds the supported size.');
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}

async function responseBody(response: Response): Promise<unknown> {
  if (!response.body) fail('Inworld returned no audio.');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SIGNAL_AUDIO_LIMITS.responseBytes) fail('Inworld audio exceeds the supported size.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

function decodeAudio(value: unknown): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(SIGNAL_AUDIO_LIMITS.audioBytes / 3) * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('Inworld returned invalid audio.');
  const audio = Buffer.from(value, 'base64');
  if (!audio.length || audio.length > SIGNAL_AUDIO_LIMITS.audioBytes || audio.toString('base64') !== value || !isMp3(audio)) fail('Inworld returned invalid audio.', 'INVALID_AUDIO');
  return audio;
}

// Require two complete consecutive Layer III frames, not just an ID3 label or
// a coincidental sync byte. This is format validation, not a playback decoder.
function isMp3(audio: Buffer): boolean {
  let offset = 0;
  if (audio.subarray(0, 3).toString('ascii') === 'ID3') {
    if (audio.length < 10 || ![2, 3, 4].includes(audio[3]!) || audio.subarray(6, 10).some((byte) => byte > 127)) return false;
    offset = 10 + (audio[6]! << 21) + (audio[7]! << 14) + (audio[8]! << 7) + audio[9]!;
    if (audio[3] === 4 && (audio[5]! & 0x10)) offset += 10;
  }
  let frames = 0;
  while (frames < 2) {
    if (offset + 4 > audio.length || audio[offset] !== 255 || (audio[offset + 1]! & 0xe0) !== 0xe0) return false;
    const version = (audio[offset + 1]! >> 3) & 3;
    const layer = (audio[offset + 1]! >> 1) & 3;
    const bitrateIndex = audio[offset + 2]! >> 4;
    const sampleIndex = (audio[offset + 2]! >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return false;
    const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]!;
    const sampleRate = [44100, 48000, 32000][sampleIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    offset += Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((audio[offset + 2]! >> 1) & 1);
    if (offset > audio.length) return false;
    frames++;
  }
  return true;
}

/** On-demand saved-report reader. No renderer-supplied text reaches the provider. */
export class SignalBriefingAudio {
  private readonly pending = new Map<string, Promise<{ audioDataUrl: string }>>();
  constructor(private readonly deps: SignalBriefingAudioDeps) {}

  async read(workspaceId: string, outputId: string, expectedBriefing: string): Promise<{ audioDataUrl: string }> {
    try {
      if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 200
        || typeof outputId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(outputId)
        || typeof expectedBriefing !== 'string' || !expectedBriefing || expectedBriefing.length > SIGNAL_AUDIO_LIMITS.textCharacters) {
        fail('Signals briefing is missing or exceeds 2,000 characters.');
      }
      const workspace = this.deps.getWorkspace(workspaceId);
      if (!workspace || workspace.id !== workspaceId) fail('Signals workspace not found.');
      if (workspace.remoteServer) fail('Signals audio is not available for remote workspaces.');
      try {
        (this.deps.assertPermission ?? ((root) => assertTeamPermission(root, 'automation.external.execute')))(workspace.rootPath);
      } catch { fail('Workspace owner permission is required to generate Signals audio.'); }
      const output = this.deps.getOutput(workspaceId, outputId);
      if (!output || output.id !== outputId || output.workspaceId !== workspaceId || !isFinalSignalReport(output)
        || output.status !== 'published' || !output.primary?.path || !/\.(md|markdown|txt)$/i.test(output.primary.path)) fail('Audio requires a saved final Signals report.');
      const run = (this.deps.getRun ?? readRun)(workspace.rootPath, output.origin.workflowRunId!);
      if (!run || run.id !== output.origin.workflowRunId || run.workspaceId !== workspaceId
        || run.workflowSlug !== output.origin.workflowSlug || run.state !== 'succeeded' || run.finalOutputId !== outputId) {
        fail('Audio requires the final report of a completed Signals run.', 'REPORT_NOT_FINAL');
      }
      const metadata = run.workflowSlug === 'weekly-signal-scan' ? null
        : validateSignalFinalReport(workspace.rootPath, workspaceId, output, run);
      const path = await this.deps.safeOutputPath(workspaceId, outputId);
      const root = await realpath(workspace.rootPath);
      if (!within(root, await realpath(path))) fail('Signals report path is not allowed.');
      const report = (await readBounded(path, SIGNAL_AUDIO_LIMITS.reportBytes)).toString('utf8');
      if (metadata) validateSignalFinalReportContent(metadata, report);
      const briefing = parseSignalBriefing(report);
      if (!briefing) fail('This report has no audio briefing.');
      if (briefing.length > SIGNAL_AUDIO_LIMITS.textCharacters) fail('Signals briefing exceeds 2,000 characters.');
      if (briefing !== expectedBriefing) fail('The Signals report changed. Reload the report before playing audio.', 'REPORT_CHANGED');

      const load = this.deps.loadSecret ?? ((name: string) => getCredentialManager().getUserSecret(name));
      const env = this.deps.environment ?? process.env;
      const voice = await resolveInworldVoiceId(load, env) || 'Dennis';
      if (voice.length > 200 || /[\u0000-\u001f\u007f]/.test(voice)) fail('Set a valid Inworld voice in Connections > Services.');
      const cacheDir = this.deps.cacheDir ?? join(CONFIG_DIR, 'cache', 'signals-audio');
      if (within(workspace.rootPath, cacheDir)) fail('Signals audio cache must be outside the workspace.');
      await mkdir(cacheDir, { recursive: true, mode: 0o700 });
      if (within(root, await realpath(cacheDir))) fail('Signals audio cache must be outside the workspace.');
      const key = createHash('sha256').update(JSON.stringify([workspaceId, outputId, report, briefing, voice, SIGNAL_AUDIO_MODEL, 'MP3-v1'])).digest('hex');
      const cachePath = join(cacheDir, `${key}.mp3`);
      const running = this.pending.get(key);
      if (running) return await running;
      if (this.pending.size >= SIGNAL_AUDIO_LIMITS.concurrent) fail('Signals audio is busy. Try again shortly.');
      const task = this.cachedOrGenerate(cachePath, briefing, voice, load, env);
      this.pending.set(key, task);
      try { return await task; } finally { this.pending.delete(key); }
    } catch (error) {
      if (error instanceof SignalFinalReportError) throw new SignalBriefingAudioError(error.message, error.code);
      if (error instanceof SignalBriefingAudioError) throw error;
      throw new SignalBriefingAudioError('Signals audio could not be prepared. Try again.');
    }
  }

  private async cachedOrGenerate(path: string, text: string, voiceId: string, load: NonNullable<SignalBriefingAudioDeps['loadSecret']>, env: Readonly<Record<string, string | undefined>>): Promise<{ audioDataUrl: string }> {
    try {
      const cached = await readBounded(path, SIGNAL_AUDIO_LIMITS.audioBytes);
      if (isMp3(cached)) return { audioDataUrl: `data:audio/mpeg;base64,${cached.toString('base64')}` };
      await rm(path, { force: true });
    } catch (error) {
      if (error instanceof SignalBriefingAudioError) await rm(path, { force: true });
      else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('Signals audio cache could not be read.');
    }
    const apiKey = await resolveInworldApiKey(load, env);
    if (!apiKey) fail('Add your Inworld API key in Connections > Services to play Signals audio.', 'MISSING_KEY');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const synthesis = async () => {
        const response = await (this.deps.fetch ?? globalThis.fetch)(ENDPOINT, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: buildInworldBasicAuthorization(apiKey), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId, modelId: SIGNAL_AUDIO_MODEL, audioConfig: { audioEncoding: 'MP3' } }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403) fail('Check your Inworld API key and access in Connections > Services.', 'PROVIDER_AUTH');
          if (response.status === 429) fail('Inworld is rate limited or out of credits. Check your Inworld account and try again.');
          fail('Inworld could not generate Signals audio. Try again.');
        }
        const result = await responseBody(response) as { audioContent?: unknown } | null;
        return decodeAudio(result?.audioContent);
      };
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new SignalBriefingAudioError('Signals audio timed out. Try again.', 'TIMEOUT')); controller.abort(); }, this.deps.timeoutMs ?? SIGNAL_AUDIO_LIMITS.timeoutMs);
      });
      const audio = await Promise.race([synthesis(), timeout]);
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, audio, { mode: 0o600, flag: 'wx' });
        await rename(temp, path);
      } finally { await rm(temp, { force: true }).catch(() => {}); }
      return { audioDataUrl: `data:audio/mpeg;base64,${audio.toString('base64')}` };
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
}
