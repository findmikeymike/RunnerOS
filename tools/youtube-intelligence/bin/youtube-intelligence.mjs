#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const repoRoot = resolve(toolDir, '..', '..');

function usage() {
  return `Usage:
  youtube-intelligence doctor
  youtube-intelligence prepare --video <url-or-id> --out <dir> [--lang en] [--provider auto|supadata|local|file] [--transcript <file>] [--allow-paid] [--supadata-mode native|auto|generate]
  youtube-intelligence batch-prepare --input <targets.txt> --out <dir> [--channel <handle-or-url>] [--channels <channels.txt>] [--channel-limit 10] [--provider auto|supadata|local] [--allow-paid] [--max-videos 50] [--continue-on-failure]
  youtube-intelligence compile --cards <intel-cards.json> --out <report.md>

Purpose:
  Prepare timestamped transcript packets for high-signal extraction. This is not a summarizer.

Paid transcript calls:
  Supadata is never called unless --allow-paid is passed.
  Default Supadata mode is native, which avoids AI-generated transcript charges.`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        if (args[key] === undefined) {
          args[key] = next;
        } else if (Array.isArray(args[key])) {
          args[key].push(next);
        } else {
          args[key] = [args[key], next];
        }
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function argValues(value) {
  if (value === undefined || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function jsonOut(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function extractVideoId(input) {
  const value = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    // Fall through.
  }
  throw new Error(`Could not resolve YouTube video id from: ${value}`);
}

function youtubeUrlForVideoId(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function readTranscriptFile(file) {
  const raw = readFileSync(resolve(file), 'utf8');
  try {
    const parsed = JSON.parse(raw);
    const segments = findSegments(parsed);
    if (segments.length) return segments;
    const text = findText(parsed) || raw;
    return textToSegments(text);
  } catch {
    return textToSegments(raw);
  }
}

function readLines(file) {
  return readFileSync(resolve(file), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function textToSegments(text) {
  const cleaned = String(text || '').replace(/\r/g, '').trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units = paragraphs.length > 1 ? paragraphs : cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  let cursor = 0;
  return units.map((unit) => {
    const words = unit.split(/\s+/).filter(Boolean).length;
    const start = cursor;
    const duration = Math.max(6, Math.ceil(words / 2.6));
    cursor += duration;
    return { start, end: cursor, text: unit };
  });
}

function findText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(findText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    for (const key of ['transcript', 'text', 'full_text', 'fullText', 'content']) {
      if (typeof value[key] === 'string') return value[key];
    }
    return Object.values(value).map(findText).filter(Boolean).join('\n');
  }
  return '';
}

function findSegments(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    const direct = value
      .map(coerceSegment)
      .filter(Boolean);
    if (direct.length) return direct;
    return value.flatMap(findSegments);
  }
  if (typeof value === 'object') {
    for (const key of ['segments', 'transcript', 'content', 'items', 'captions', 'results']) {
      const found = findSegments(value[key]);
      if (found.length) return found;
    }
  }
  return [];
}

function coerceSegment(item) {
  if (!item || typeof item !== 'object') return null;
  const text = item.text ?? item.caption ?? item.content;
  if (typeof text !== 'string' || !text.trim()) return null;
  const offset = item.offset != null ? Number(item.offset) / 1000 : undefined;
  const tStart = item.tStartMs != null ? Number(item.tStartMs) / 1000 : undefined;
  const start = Number(item.start ?? item.start_seconds ?? offset ?? tStart ?? 0);
  const rawEnd = item.end ?? item.end_seconds;
  const rawDuration = item.duration ?? item.duration_seconds ?? item.dur ?? 0;
  const duration = item.duration != null && item.duration_seconds == null
    ? Number(rawDuration) / 1000
    : Number(rawDuration);
  const end = Number(rawEnd ?? (start + duration) ?? start);
  return { start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) && end > start ? end : start + 6, text: text.trim() };
}

function youtubeResearchPath() {
  if (process.env.YOUTUBE_RESEARCH_WRAPPER?.trim()) return resolve(process.env.YOUTUBE_RESEARCH_WRAPPER.trim());
  return firstExisting([
    join(repoRoot, 'tools', 'youtube-research', 'bin', 'youtube-research.mjs'),
    join(process.cwd(), 'tools', 'youtube-research', 'bin', 'youtube-research.mjs'),
  ]);
}

function safeName(value) {
  return String(value || 'item')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) || paths[0];
}

function defaultCacheDir() {
  const cacheRoot = process.env.CRAFT_INTEGRATION_CACHE_ROOT?.trim();
  if (!cacheRoot) {
    throw new Error('CRAFT_INTEGRATION_CACHE_ROOT or --cache-dir is required for transcript cache isolation');
  }
  return join(resolve(cacheRoot), 'youtube-intelligence', 'transcripts');
}

function cacheFileFor(videoId, lang, cacheDir) {
  return join(resolve(cacheDir || defaultCacheDir()), `${videoId}.${lang || 'en'}.json`);
}

function readCachedTranscript(videoId, lang, cacheDir) {
  const file = cacheFileFor(videoId, lang, cacheDir);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const segments = findSegments(parsed);
  if (!segments.length) return null;
  return {
    provider: parsed.provider || 'cache',
    cacheHit: true,
    cacheFile: file,
    raw: parsed.raw ?? parsed,
    segments,
  };
}

function writeCachedTranscript(videoId, lang, transcript, cacheDir) {
  const file = cacheFileFor(videoId, lang, cacheDir);
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify({
    videoId,
    lang: lang || 'en',
    provider: transcript.provider,
    cachedAt: new Date().toISOString(),
    segments: transcript.segments,
    raw: transcript.raw,
  }, null, 2) + '\n');
  return file;
}

function supadataApiKey() {
  if (process.env.SUPADATA_API_KEY?.trim()) return process.env.SUPADATA_API_KEY.trim();
  const cacheRoot = process.env.CRAFT_INTEGRATION_CACHE_ROOT?.trim();
  // Credential caches are product-owned. Without an explicit root, use no
  // cached credential rather than guessing another product's legacy path.
  if (!cacheRoot) return '';
  const cachePath = join(resolve(cacheRoot), 'youtube-intelligence', 'credentials.json');
  if (!existsSync(cachePath)) return '';
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return typeof parsed.supadataApiKey === 'string' ? parsed.supadataApiKey.trim() : '';
  } catch {
    return '';
  }
}

function requireTestOnlyMockEnv() {
  const mockFile = process.env.SUPADATA_MOCK_RESPONSE_FILE;
  if (!mockFile) return '';
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('SUPADATA_MOCK_RESPONSE_FILE is test-only and requires NODE_ENV=test');
  }
  return mockFile;
}

function parseTranscriptResponse(parsed, provider = 'supadata') {
  const segments = findSegments(parsed);
  if (segments.length) return { provider, raw: parsed, segments };
  const transcriptText = findText(parsed);
  if (transcriptText) return { provider, raw: parsed, segments: textToSegments(transcriptText) };
  return null;
}

function getJobId(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  for (const key of ['jobId', 'job_id', 'id']) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key].trim();
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchSupadataJson(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { content: text };
  }
  return {
    status: response.status,
    ok: response.ok,
    billableRequests: response.headers.get('x-billable-requests'),
    parsed,
    text,
  };
}

async function pollSupadataTranscriptJob(baseUrl, jobId, apiKey, options = {}) {
  const attempts = Number(options.attempts || 90);
  const intervalMs = Number(options.intervalMs || 1000);
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/transcript/${encodeURIComponent(jobId)}`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await fetchSupadataJson(url, apiKey);
    if (!result.ok) {
      throw new Error(`Supadata transcript job ${jobId} failed (${result.status}): ${result.text.slice(0, 500)}`);
    }
    const status = String(result.parsed.status || '').toLowerCase();
    if (status === 'failed') {
      throw new Error(`Supadata transcript job ${jobId} failed: ${String(result.parsed.error || 'unknown error')}`);
    }
    const transcript = parseTranscriptResponse(result.parsed);
    if (status === 'completed' && transcript) {
      return {
        ...transcript,
        raw: { jobId, job: result.parsed },
        billableRequests: result.billableRequests,
      };
    }
    if (!status && transcript) return transcript;
    if (!['queued', 'active', 'processing', 'pending', ''].includes(status)) {
      throw new Error(`Supadata transcript job ${jobId} returned unknown status: ${status}`);
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw new Error(`Supadata transcript job ${jobId} did not complete after ${attempts} polls`);
}

async function fetchSupadataTranscript(videoId, lang, options = {}) {
  const apiKey = supadataApiKey();
  if (!apiKey) throw new Error('SUPADATA_API_KEY is not configured');
  const mockFile = requireTestOnlyMockEnv();
  if (mockFile) {
    const parsed = JSON.parse(readFileSync(resolve(mockFile), 'utf8'));
    const transcript = parseTranscriptResponse(parsed);
    if (transcript) return transcript;
    throw new Error('Supadata mock returned no transcript text');
  }
  const baseUrl = process.env.SUPADATA_BASE_URL || 'https://api.supadata.ai/v1';
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/transcript`);
  url.searchParams.set('url', youtubeUrlForVideoId(videoId));
  if (lang) url.searchParams.set('lang', lang);
  url.searchParams.set('text', 'false');
  url.searchParams.set('mode', options.mode || 'native');
  const result = await fetchSupadataJson(url, apiKey);
  if (result.status === 202) {
    const jobId = getJobId(result.parsed);
    if (!jobId) throw new Error(`Supadata async transcript response did not include jobId: ${result.text.slice(0, 500)}`);
    const transcript = await pollSupadataTranscriptJob(baseUrl, jobId, apiKey, {
      attempts: options.pollAttempts,
      intervalMs: options.pollIntervalMs,
    });
    return {
      ...transcript,
      raw: { initial: result.parsed, job: transcript.raw },
      billableRequests: transcript.billableRequests || result.billableRequests,
    };
  }
  if (result.status === 206) {
    throw new Error(`Supadata transcript unavailable (${result.status}): ${result.text.slice(0, 500)}`);
  }
  if (!result.ok) {
    throw new Error(`Supadata transcript failed (${result.status}): ${result.text.slice(0, 500)}`);
  }
  const transcript = parseTranscriptResponse(result.parsed);
  if (transcript) return { ...transcript, billableRequests: result.billableRequests };
  throw new Error('Supadata returned no transcript text');
}

function fetchLocalTranscript(videoId, lang) {
  const wrapper = youtubeResearchPath();
  if (!existsSync(wrapper)) {
    throw new Error(`youtube-research wrapper not found at ${wrapper}`);
  }
  const result = spawnSync(process.execPath, [wrapper, 'youtube', 'videos-transcript', videoId, '--lang', lang || 'en', '--agent'], {
    cwd: dirname(dirname(wrapper)),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `youtube-research exited ${result.status}`).trim());
  }
  const raw = result.stdout.trim();
  try {
    const parsed = JSON.parse(raw);
    const segments = findSegments(parsed);
    if (segments.length) return { provider: 'youtube-research', raw: parsed, segments };
    const text = findText(parsed);
    if (text) return { provider: 'youtube-research', raw: parsed, segments: textToSegments(text) };
  } catch {
    const segments = textToSegments(raw);
    if (segments.length) return { provider: 'youtube-research', raw, segments };
  }
  throw new Error('youtube-research returned no transcript text');
}

async function fetchTranscript(videoId, lang, options = {}) {
  const provider = options.provider || 'auto';
  const errors = [];
  if (!options.noCache) {
    const cached = readCachedTranscript(videoId, lang, options.cacheDir);
    if (cached) return cached;
  }
  if (provider === 'file') {
    throw new Error('provider=file requires --transcript');
  }
  const allowPaid = Boolean(options.allowPaid);
  const order = provider === 'supadata'
    ? ['supadata']
    : provider === 'local'
      ? ['local']
      : allowPaid ? ['supadata', 'local'] : ['local'];
  for (const candidate of order) {
    try {
      if (candidate === 'supadata' && !allowPaid) {
        throw new Error('Supadata costs credits. Re-run with --allow-paid to permit this provider.');
      }
      const transcript = candidate === 'supadata'
        ? await fetchSupadataTranscript(videoId, lang, {
          mode: options.supadataMode,
          pollAttempts: options.supadataPollAttempts,
          pollIntervalMs: options.supadataPollIntervalMs,
        })
        : fetchLocalTranscript(videoId, lang);
      if (!options.noCache) {
        transcript.cacheFile = writeCachedTranscript(videoId, lang, transcript, options.cacheDir);
      }
      return transcript;
    } catch (error) {
      errors.push({ provider: candidate, error: error.message });
    }
  }
  const message = errors.map((err) => `${err.provider}: ${err.error}`).join(' | ');
  throw new Error(`All transcript providers failed: ${message}`);
}

function chunkSegments(segments, options = {}) {
  const maxWords = Number(options.maxWords || 1200);
  const chunks = [];
  let current = [];
  let words = 0;
  for (const segment of segments) {
    const count = segment.text.split(/\s+/).filter(Boolean).length;
    if (current.length && words + count > maxWords) {
      chunks.push(makeChunk(chunks.length + 1, current));
      current = [];
      words = 0;
    }
    current.push(segment);
    words += count;
  }
  if (current.length) chunks.push(makeChunk(chunks.length + 1, current));
  return chunks;
}

function makeChunk(index, segments) {
  return {
    id: `chunk_${String(index).padStart(3, '0')}`,
    start: segments[0]?.start ?? 0,
    end: segments[segments.length - 1]?.end ?? 0,
    text: segments.map((segment) => segment.text).join(' '),
    segmentCount: segments.length,
    wordCount: segments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0),
  };
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function extractorPrompt(videoId, chunks) {
  return `You are extracting high-signal intelligence from YouTube transcript chunks.

Do not summarize. Extract tactics, principles, frameworks, warnings, tools, contradictions, implementation steps, claims worth verifying, and agent-ready instructions.

Reject generic motivation, vague advice, repeated internet cliches, unsupported claims, and stories with no reusable mechanism.

Return strict JSON:
{
  "video_id": "${videoId}",
  "chunk_id": "chunk_001",
  "items": [
    {
      "type": "tactic | principle | claim | warning | tool | framework | workflow | mental_model | quote",
      "title": "specific non-generic title",
      "raw_claim": "what the speaker actually said",
      "why_it_matters": "why this is useful or non-obvious",
      "implementation": "how a builder, creator, operator, or agent would use it",
      "preconditions": "when this works or does not work",
      "evidence_quote": "short supporting quote",
      "timestamp_start": 0,
      "timestamp_end": 0,
      "novelty_score": 0,
      "actionability_score": 0,
      "evidence_score": 0,
      "confidence_score": 0,
      "tags": ["youtube", "growth"]
    }
  ],
  "rejected_fluff": [{"text": "generic advice", "reason": "no mechanism"}]
}

Chunks:
${chunks.map((chunk) => `\n## ${chunk.id} ${formatTime(chunk.start)}-${formatTime(chunk.end)}\n${chunk.text}`).join('\n')}`;
}

function reducerPrompt(videoId) {
  return `You are curating extracted intelligence from video ${videoId}.

Deduplicate overlapping items. Separate what the speaker explicitly said from inference and suggested experiments.

Rank by:
1. actionability
2. novelty
3. evidence strength
4. specificity
5. relevance to builders, agents, creators, and operators

Output strict JSON:
{
  "video_id": "${videoId}",
  "tier_1_agent_useful_alpha": [],
  "tier_2_useful_context": [],
  "tier_3_archive_only": [],
  "contradictions_or_claims_to_verify": [],
  "agent_memory_candidates": [],
  "experiments_to_run": []
}`;
}

function reportTemplate(videoId) {
  return `# Intelligence Dossier: ${videoId}

## 1. Executive Intelligence Brief

## 2. Core Principles

## 3. Unique Alpha

## 4. Playbooks

## 5. Agent Instructions

## 6. Contradictions / Debates

## 7. Experiments to Run

## 8. Source Index
`;
}

async function preparePacket(args) {
  if (!args.video) throw new Error('--video is required');
  if (!args.out) throw new Error('--out is required');
  const videoId = args.videoId || extractVideoId(args.video);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const lang = args.lang || 'en';
  const provider = args.transcript ? 'file' : String(args.provider || 'auto');
  const transcript = args.transcript
    ? { provider: 'file', raw: null, segments: readTranscriptFile(args.transcript) }
    : await fetchTranscript(videoId, lang, {
      provider,
      cacheDir: args['cache-dir'],
      noCache: Boolean(args['no-cache']),
      allowPaid: Boolean(args['allow-paid']),
      supadataMode: args['supadata-mode'] || 'native',
      supadataPollAttempts: args['supadata-poll-attempts'],
      supadataPollIntervalMs: args['supadata-poll-interval-ms'],
    });
  if (!transcript.segments.length) throw new Error('No transcript segments found');
  const chunks = chunkSegments(transcript.segments, { maxWords: args['max-words'] || 1200 });
  const packet = {
    videoId,
    source: String(args.video),
    transcriptProvider: transcript.provider,
    cacheHit: Boolean(transcript.cacheHit),
    cacheFile: transcript.cacheFile,
    createdAt: new Date().toISOString(),
    segmentCount: transcript.segments.length,
    chunkCount: chunks.length,
    files: {
      rawTranscript: 'raw-transcript.json',
      chunks: 'chunks.json',
      extractorPrompt: 'extractor-prompt.md',
      reducerPrompt: 'reducer-prompt.md',
      reportTemplate: 'report-template.md',
    },
  };
  writeFileSync(join(outDir, 'raw-transcript.json'), JSON.stringify({ videoId, provider: transcript.provider, segments: transcript.segments, raw: transcript.raw }, null, 2) + '\n');
  writeFileSync(join(outDir, 'chunks.json'), JSON.stringify(chunks, null, 2) + '\n');
  writeFileSync(join(outDir, 'extraction-packet.json'), JSON.stringify(packet, null, 2) + '\n');
  writeFileSync(join(outDir, 'extractor-prompt.md'), extractorPrompt(videoId, chunks) + '\n');
  writeFileSync(join(outDir, 'reducer-prompt.md'), reducerPrompt(videoId) + '\n');
  writeFileSync(join(outDir, 'report-template.md'), reportTemplate(videoId) + '\n');
  return { ok: true, ...packet, outDir };
}

async function prepare(args) {
  jsonOut(await preparePacket(args));
}

function parseBatchLine(line, index) {
  const parts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    let videoId;
    try {
      videoId = extractVideoId(parts[0]);
    } catch {
      videoId = safeName(parts[0]);
    }
    return { source: parts[0], transcript: parts[1], videoId };
  }
  if (existsSync(resolve(line))) {
    const stem = safeName(line.split('/').pop()?.replace(/\.[^.]+$/, '') || `transcript-${index}`);
    return { source: stem, transcript: line, videoId: stem };
  }
  return { source: line, videoId: extractVideoId(line) };
}

function looksLikeChannelTarget(value) {
  const line = String(value || '').trim();
  if (!line) return false;
  if (line.startsWith('@')) return true;
  try {
    const url = new URL(line);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!host.includes('youtube.com')) return false;
    if (url.searchParams.has('v') || path.includes('/shorts/')) return false;
    return path.includes('/@') || path.includes('/channel/') || path.includes('/c/') || path.includes('/user/');
  } catch {
    return false;
  }
}

function collectVideoIdsFromValue(value, out = new Set()) {
  if (!value) return out;
  if (typeof value === 'string') {
    try {
      out.add(extractVideoId(value));
    } catch {
      // Not every string in youtube-research output is a video id or URL.
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVideoIdsFromValue(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of ['videoId', 'video_id', 'id', 'url', 'videoUrl', 'video_url', 'webpage_url', 'href', 'link']) {
      if (value[key] != null) collectVideoIdsFromValue(value[key], out);
    }
    for (const nested of Object.values(value)) collectVideoIdsFromValue(nested, out);
  }
  return out;
}

function fetchChannelVideoRows(channel, limit) {
  const wrapper = youtubeResearchPath();
  if (!existsSync(wrapper)) throw new Error(`youtube-research wrapper not found at ${wrapper}`);
  const result = spawnSync(process.execPath, [wrapper, 'youtube', 'channel-uploads', channel, '--top', String(limit), '--agent'], {
    cwd: dirname(dirname(wrapper)),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `youtube-research channel-uploads exited ${result.status}`).trim());
  }
  const raw = result.stdout.trim();
  const ids = new Set();
  try {
    collectVideoIdsFromValue(JSON.parse(raw), ids);
  } catch {
    for (const line of raw.split(/\r?\n/)) collectVideoIdsFromValue(line, ids);
  }
  return [...ids].slice(0, limit).map((videoId) => ({
    source: youtubeUrlForVideoId(videoId),
    videoId,
    expandedFrom: channel,
  }));
}

function batchExtractorPrompt(manifest) {
  return `You are extracting high-signal intelligence from a batch of YouTube transcript packets.

Do not summarize. For each video, read its chunks and extractor prompt. Produce per-video intel cards, then a cross-video reducer pass.

Required outputs:
1. videos/<videoId>/intel-cards.json
2. cross-video-reducer.json
3. dossier.md
4. agent-context-pack.json

Reject generic motivation, repeated internet cliches, unsupported claims, and stories with no reusable mechanism.

Batch manifest:
${JSON.stringify(manifest, null, 2)}`;
}

function batchReducerPrompt(manifest) {
  return `You are reducing extracted intelligence across ${manifest.successfulCount} transcript packet(s).

Rank by actionability, novelty, evidence strength, specificity, and relevance to builders, creators, operators, and agents.

Output strict JSON:
{
  "run_id": "${manifest.runId}",
  "cross_video_patterns": [],
  "best_tactics": [],
  "contradictions_or_claims_to_verify": [],
  "agent_memory_candidates": [],
  "experiments_to_run": [],
  "source_index": []
}

Use timestamp evidence from the per-video chunks and intel cards.`;
}

function batchReportTemplate(manifest) {
  return `# YouTube Intelligence Batch Dossier

Run: ${manifest.runId}
Created: ${manifest.createdAt}

## 1. Executive Intelligence Brief

## 2. Cross-Video Patterns

## 3. Best Tactics

## 4. Contradictions / Claims To Verify

## 5. Agent Instructions

## 6. Experiments To Run

## 7. Source Index
${manifest.items.map((item) => `- ${item.videoId}: ${item.source} (${item.status})`).join('\n')}
`;
}

async function batchPrepare(args) {
  const explicitChannels = [
    ...argValues(args.channel).map(String),
    ...(args.channels ? readLines(args.channels) : []),
  ];
  if (!args.input && argValues(args.video).length === 0 && explicitChannels.length === 0) {
    throw new Error('--input, --video, --channel, or --channels is required');
  }
  if (!args.out) throw new Error('--out is required');
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const maxVideos = Number(args['max-videos'] || 50);
  if (!Number.isInteger(maxVideos) || maxVideos <= 0) throw new Error('--max-videos must be a positive integer');
  const channelLimit = Number(args['channel-limit'] || 10);
  if (!Number.isInteger(channelLimit) || channelLimit <= 0) throw new Error('--channel-limit must be a positive integer');
  const lines = [
    ...(args.input ? readLines(args.input) : []),
    ...argValues(args.video).map(String),
  ];
  const seen = new Set();
  const items = [];
  const expansionErrors = [];
  const addParsed = (parsed) => {
    if (seen.has(parsed.videoId)) return false;
    seen.add(parsed.videoId);
    items.push(parsed);
    return items.length >= maxVideos;
  };
  const expandChannel = (channel) => {
    try {
      for (const row of fetchChannelVideoRows(channel, channelLimit)) {
        if (addParsed(row)) return true;
      }
      return false;
    } catch (error) {
      expansionErrors.push({ channel, error: error.message });
      if (!args['continue-on-failure']) throw error;
      return false;
    }
  };
  for (const channel of explicitChannels) {
    if (expandChannel(channel)) break;
  }
  for (const line of lines) {
    if (items.length >= maxVideos) break;
    if (looksLikeChannelTarget(line)) {
      if (expandChannel(line)) break;
      continue;
    }
    let parsed;
    try {
      parsed = parseBatchLine(line, items.length + 1);
    } catch (error) {
      parsed = {
        source: line,
        videoId: safeName(line),
        status: 'failed',
        outDir: join(outDir, 'videos', safeName(line)),
        error: error.message,
      };
      if (!args['continue-on-failure']) throw error;
    }
    addParsed(parsed);
  }
  if (!items.length) throw new Error('No batch inputs found');

  const prepared = [];
  for (const item of items) {
    if (item.status === 'failed') {
      prepared.push(item);
      continue;
    }
    const itemOut = join(outDir, 'videos', item.videoId);
    try {
      const packet = await preparePacket({
        ...args,
        video: item.source,
        videoId: item.videoId,
        transcript: item.transcript,
        out: itemOut,
      });
      prepared.push({ ...item, status: 'ok', outDir: itemOut, packet });
    } catch (error) {
      const failure = { ...item, status: 'failed', outDir: itemOut, error: error.message };
      prepared.push(failure);
      if (!args['continue-on-failure']) {
        const manifest = makeBatchManifest(outDir, prepared);
        writeBatchOutputs(outDir, manifest);
        throw new Error(`Batch item failed (${item.source}): ${error.message}`);
      }
    }
  }

  const manifest = makeBatchManifest(outDir, prepared, expansionErrors);
  writeBatchOutputs(outDir, manifest);
  jsonOut({ ok: manifest.failedCount === 0, ...manifest, outDir });
}

function makeBatchManifest(outDir, prepared, expansionErrors = []) {
  const runId = safeName(`youtube-intel-${new Date().toISOString()}`);
  const items = prepared.map((item) => ({
    videoId: item.videoId,
    source: item.source,
    expandedFrom: item.expandedFrom,
    transcript: item.transcript,
    status: item.status,
    outDir: item.outDir,
    error: item.error,
    segmentCount: item.packet?.segmentCount,
    chunkCount: item.packet?.chunkCount,
    transcriptProvider: item.packet?.transcriptProvider,
    cacheHit: item.packet?.cacheHit,
  }));
  return {
    runId,
    createdAt: new Date().toISOString(),
    outDir,
    totalCount: items.length,
    successfulCount: items.filter((item) => item.status === 'ok').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    expansionErrors,
    items,
    files: {
      manifest: 'run-manifest.json',
      batchExtractorPrompt: 'batch-extractor-prompt.md',
      crossVideoReducerPrompt: 'cross-video-reducer-prompt.md',
      dossierTemplate: 'dossier-template.md',
      agentContextPackTemplate: 'agent-context-pack-template.json',
    },
  };
}

function writeBatchOutputs(outDir, manifest) {
  writeFileSync(join(outDir, 'run-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(outDir, 'batch-extractor-prompt.md'), batchExtractorPrompt(manifest) + '\n');
  writeFileSync(join(outDir, 'cross-video-reducer-prompt.md'), batchReducerPrompt(manifest) + '\n');
  writeFileSync(join(outDir, 'dossier-template.md'), batchReportTemplate(manifest) + '\n');
  writeFileSync(join(outDir, 'agent-context-pack-template.json'), JSON.stringify({
    run_id: manifest.runId,
    principles: [],
    playbooks: [],
    evidence: [],
    failure_modes: [],
    retrieval_notes: [],
    source_index: manifest.items.map((item) => ({ video_id: item.videoId, source: item.source, status: item.status })),
  }, null, 2) + '\n');
}

function compile(args) {
  if (!args.cards) throw new Error('--cards is required');
  if (!args.out) throw new Error('--out is required');
  const cards = JSON.parse(readFileSync(resolve(args.cards), 'utf8'));
  const items = Array.isArray(cards) ? cards : Object.values(cards).flatMap((value) => Array.isArray(value) ? value : []);
  const lines = ['# YouTube Intelligence Dossier', '', '## Highest Signal Items', ''];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = item.title || item.raw_claim || 'Untitled intel';
    lines.push(`### ${title}`);
    if (item.type) lines.push(`Type: ${item.type}`);
    if (item.timestamp_start != null) lines.push(`Evidence: ${formatTime(item.timestamp_start)}-${formatTime(item.timestamp_end ?? item.timestamp_start)}`);
    if (item.raw_claim) lines.push(`Claim: ${item.raw_claim}`);
    if (item.why_it_matters) lines.push(`Why it matters: ${item.why_it_matters}`);
    if (item.implementation) lines.push(`Implementation: ${item.implementation}`);
    if (item.evidence_quote) lines.push(`Quote: "${item.evidence_quote}"`);
    lines.push('');
  }
  writeFileSync(resolve(args.out), lines.join('\n'));
  jsonOut({ ok: true, out: resolve(args.out), itemCount: items.length });
}

function doctor() {
  const research = youtubeResearchPath();
  const supadataConfigured = Boolean(supadataApiKey());
  const integrationCacheRoot = process.env.CRAFT_INTEGRATION_CACHE_ROOT?.trim();
  jsonOut({
    ok: true,
    toolDir,
    cacheDir: integrationCacheRoot
      ? join(resolve(integrationCacheRoot), 'youtube-intelligence', 'transcripts')
      : null,
    supadata: {
      configured: supadataConfigured,
      env: Boolean(process.env.SUPADATA_API_KEY?.trim()),
      configPath: integrationCacheRoot
        ? join(resolve(integrationCacheRoot), 'youtube-intelligence', 'credentials.json')
        : null,
    },
    youtubeResearch: {
      path: research,
      exists: existsSync(research),
    },
    commands: ['prepare', 'batch-prepare', 'compile'],
  });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help' || args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (command === 'doctor') doctor();
  else if (command === 'prepare') await prepare(args);
  else if (command === 'batch-prepare') await batchPrepare(args);
  else if (command === 'compile') compile(args);
  else throw new Error(`Unknown command: ${command}\n\n${usage()}`);
} catch (error) {
  jsonOut({ ok: false, error: error.message }, 1);
}
