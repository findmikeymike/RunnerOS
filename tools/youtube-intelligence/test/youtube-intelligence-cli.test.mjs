import { spawnSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const cli = new URL('../bin/youtube-intelligence.mjs', import.meta.url).pathname;

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function runAsync(args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

test('prepare with transcript file writes timestamped packet files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-file-'));
  const transcript = join(dir, 'transcript.txt');
  const out = join(dir, 'out');
  spawnSync('sh', ['-c', `printf 'One concrete tactic.\\n\\nSecond timestamped tactic.' > "${transcript}"`]);

  const result = run(['prepare', '--video', 'dQw4w9WgXcQ', '--transcript', transcript, '--out', out]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(readFileSync(join(out, 'extraction-packet.json'), 'utf8'));
  const chunks = JSON.parse(readFileSync(join(out, 'chunks.json'), 'utf8'));
  assert.equal(packet.transcriptProvider, 'file');
  assert.equal(packet.segmentCount, 2);
  assert.equal(chunks.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('supadata provider normalizes millisecond offsets and writes cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-supadata-'));
  const out = join(dir, 'out');
  const cache = join(dir, 'cache');
  const mock = join(dir, 'supadata.json');
  spawnSync('sh', ['-c', `cat > "${mock}" <<'JSON'
{"content":[{"text":"Timestamped alpha one.","offset":8150,"duration":1200,"lang":"en"},{"text":"Timestamped alpha two.","offset":10000,"duration":2400,"lang":"en"}],"lang":"en","availableLangs":["en"]}
JSON`]);

  const env = {
    NODE_ENV: 'test',
    SUPADATA_API_KEY: 'test-key',
    SUPADATA_MOCK_RESPONSE_FILE: mock,
  };
  const result = run(['prepare', '--video', 'dQw4w9WgXcQ', '--provider', 'supadata', '--allow-paid', '--cache-dir', cache, '--out', out], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = JSON.parse(readFileSync(join(out, 'raw-transcript.json'), 'utf8'));
  assert.equal(raw.provider, 'supadata');
  assert.equal(raw.segments[0].start, 8.15);
  assert.equal(raw.segments[0].end, 9.35);

  const cachedOut = join(dir, 'cached-out');
  const cached = run(['prepare', '--video', 'dQw4w9WgXcQ', '--provider', 'supadata', '--cache-dir', cache, '--out', cachedOut], { env: { SUPADATA_API_KEY: 'test-key' } });
  assert.equal(cached.status, 0, cached.stderr || cached.stdout);
  const packet = JSON.parse(readFileSync(join(cachedOut, 'extraction-packet.json'), 'utf8'));
  assert.equal(packet.cacheHit, true);

  rmSync(dir, { recursive: true, force: true });
});

test('supadata provider requires explicit paid approval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-paid-'));
  const out = join(dir, 'out');
  const result = run(['prepare', '--video', 'dQw4w9WgXcQ', '--provider', 'supadata', '--cache-dir', join(dir, 'cache'), '--out', out], {
    env: { SUPADATA_API_KEY: 'test-key' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /--allow-paid/);
  rmSync(dir, { recursive: true, force: true });
});

test('mock response fixture is test-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-mock-gate-'));
  const out = join(dir, 'out');
  const mock = join(dir, 'supadata.json');
  spawnSync('sh', ['-c', `printf '{"content":"hello"}' > "${mock}"`]);
  const result = run(['prepare', '--video', 'dQw4w9WgXcQ', '--provider', 'supadata', '--allow-paid', '--cache-dir', join(dir, 'cache'), '--out', out], {
    env: { NODE_ENV: 'production', SUPADATA_API_KEY: 'test-key', SUPADATA_MOCK_RESPONSE_FILE: mock },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /test-only/);
  rmSync(dir, { recursive: true, force: true });
});

test('supadata async job response is polled to completion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-job-'));
  const out = join(dir, 'out');
  let pollCount = 0;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/transcript/job-123')) {
      pollCount += 1;
      if (pollCount === 1) {
        res.end(JSON.stringify({ status: 'active' }));
      } else {
        res.end(JSON.stringify({
          status: 'completed',
          content: [{ text: 'Async timestamped alpha.', offset: 2000, duration: 3000, lang: 'en' }],
          lang: 'en',
        }));
      }
      return;
    }
    if (req.url?.startsWith('/transcript')) {
      res.statusCode = 202;
      res.end(JSON.stringify({ jobId: 'job-123' }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();

  try {
    const result = await runAsync([
      'prepare',
      '--video', 'dQw4w9WgXcQ',
      '--provider', 'supadata',
      '--allow-paid',
      '--cache-dir', join(dir, 'cache'),
      '--supadata-poll-interval-ms', '1',
      '--out', out,
    ], {
      env: {
        SUPADATA_API_KEY: 'test-key',
        SUPADATA_BASE_URL: `http://127.0.0.1:${port}`,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const raw = JSON.parse(readFileSync(join(out, 'raw-transcript.json'), 'utf8'));
    assert.equal(raw.segments[0].start, 2);
    assert.equal(raw.segments[0].end, 5);
    assert.equal(pollCount, 2);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('batch-prepare writes per-video packets and batch prompts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-batch-'));
  const input = join(dir, 'links.tsv');
  const transcriptA = join(dir, 'a.txt');
  const transcriptB = join(dir, 'b.txt');
  const out = join(dir, 'out');
  spawnSync('sh', ['-c', `printf 'First concrete tactic.\\n\\nSecond concrete tactic.' > "${transcriptA}"`]);
  spawnSync('sh', ['-c', `printf 'Another useful mechanism.\\n\\nSpecific implementation note.' > "${transcriptB}"`]);
  spawnSync('sh', ['-c', `cat > "${input}" <<EOF
https://www.youtube.com/watch?v=dQw4w9WgXcQ	${transcriptA}
https://youtu.be/9bZkp7q19f0	${transcriptB}
EOF`]);

  const result = run(['batch-prepare', '--input', input, '--out', out]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(readFileSync(join(out, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.totalCount, 2);
  assert.equal(manifest.successfulCount, 2);
  assert.equal(manifest.failedCount, 0);
  assert.equal(manifest.items[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(manifest.items[1].videoId, '9bZkp7q19f0');
  assert.ok(readFileSync(join(out, 'batch-extractor-prompt.md'), 'utf8').includes('intel-cards.json'));
  assert.ok(readFileSync(join(out, 'cross-video-reducer-prompt.md'), 'utf8').includes('cross_video_patterns'));
  assert.ok(readFileSync(join(out, 'videos', 'dQw4w9WgXcQ', 'chunks.json'), 'utf8').includes('First concrete tactic'));

  rmSync(dir, { recursive: true, force: true });
});

test('batch-prepare expands channel targets through youtube-research', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-channel-'));
  const fakeWrapper = join(dir, 'fake-youtube-research.mjs');
  const out = join(dir, 'out');
  writeFileSync(fakeWrapper, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('channel-uploads')) {
  console.log(JSON.stringify({ items: [
    { videoId: 'dQw4w9WgXcQ' },
    { url: 'https://youtu.be/9bZkp7q19f0' }
  ] }));
  process.exit(0);
}
if (args.includes('videos-transcript')) {
  console.log(JSON.stringify({ content: [
    { text: 'Channel transcript tactic one.', offset: 0, duration: 2000 },
    { text: 'Channel transcript tactic two.', offset: 3000, duration: 2000 }
  ] }));
  process.exit(0);
}
console.error('unexpected args: ' + args.join(' '));
process.exit(1);
`);
  chmodSync(fakeWrapper, 0o755);

  const result = run(['batch-prepare', '--channel', '@demo', '--channel-limit', '2', '--provider', 'local', '--cache-dir', join(dir, 'cache'), '--out', out], {
    env: { YOUTUBE_RESEARCH_WRAPPER: fakeWrapper },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(readFileSync(join(out, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.totalCount, 2);
  assert.equal(manifest.successfulCount, 2);
  assert.equal(manifest.items[0].expandedFrom, '@demo');
  assert.equal(manifest.items[0].videoId, 'dQw4w9WgXcQ');
  assert.ok(readFileSync(join(out, 'videos', '9bZkp7q19f0', 'chunks.json'), 'utf8').includes('Channel transcript tactic'));

  rmSync(dir, { recursive: true, force: true });
});

test('batch-prepare can continue on failed rows and preserve manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-intel-batch-fail-'));
  const input = join(dir, 'links.tsv');
  const transcript = join(dir, 'ok.txt');
  const out = join(dir, 'out');
  spawnSync('sh', ['-c', `printf 'Working transcript.' > "${transcript}"`]);
  spawnSync('sh', ['-c', `cat > "${input}" <<EOF
dQw4w9WgXcQ	${transcript}
bad-video-input
EOF`]);

  const result = run(['batch-prepare', '--input', input, '--out', out, '--continue-on-failure']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(readFileSync(join(out, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.totalCount, 2);
  assert.equal(manifest.successfulCount, 1);
  assert.equal(manifest.failedCount, 1);
  assert.equal(manifest.items[1].status, 'failed');

  rmSync(dir, { recursive: true, force: true });
});
