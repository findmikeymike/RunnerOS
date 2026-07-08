#!/usr/bin/env bun
import { $ } from 'bun';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type Platform = 'darwin' | 'win32' | 'linux';
type Arch = 'x64' | 'arm64';

const ROOT_DIR = resolve(import.meta.dir, '..');
const TOOL_DIR = join(ROOT_DIR, 'tools', 'lyrics-transcriber');

function arg(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  if (index === -1 || index + 1 >= Bun.argv.length) return undefined;
  return Bun.argv[index + 1];
}

function flag(name: string): boolean {
  return Bun.argv.includes(name);
}

function platform(): Platform {
  const value = arg('--platform') ?? process.platform;
  if (value === 'darwin' || value === 'win32' || value === 'linux') return value;
  throw new Error(`Unsupported platform: ${value}`);
}

function arch(): Arch {
  const value = arg('--arch') ?? process.arch;
  if (value === 'x64' || value === 'arm64') return value;
  throw new Error(`Unsupported arch: ${value}`);
}

function exeName(name: string, targetPlatform: Platform): string {
  return targetPlatform === 'win32' ? `${name}.exe` : name;
}

function targetDir(targetPlatform: Platform, targetArch: Arch): string {
  return join(TOOL_DIR, 'bin', targetPlatform, targetArch);
}

function targetPath(name: string, targetPlatform: Platform, targetArch: Arch): string {
  return join(targetDir(targetPlatform, targetArch), exeName(name, targetPlatform));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function commandPath(command: string): string | null {
  const result = Bun.spawnSync({
    cmd: [process.platform === 'win32' ? 'where' : 'which', command],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) return null;
  return Buffer.from(result.stdout).toString('utf-8').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function darwinHomebrewDeps(path: string): Promise<string[]> {
  if (process.platform !== 'darwin' || !existsSync(path)) return [];
  const result = Bun.spawnSync({ cmd: ['otool', '-L', path], stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) return [];
  return Buffer.from(result.stdout).toString('utf-8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((dep) => !dep.endsWith(':'))
    .filter((dep) => dep.startsWith('/opt/homebrew') || dep.startsWith('/usr/local/Cellar') || dep.startsWith('/usr/local/opt'));
}

async function copyRuntimeBinary(options: {
  name: 'whisper-cli' | 'ffmpeg';
  sourcePath: string;
  targetPlatform: Platform;
  targetArch: Arch;
  license: string;
  source: string;
  allowNonPortable: boolean;
}): Promise<void> {
  const sourcePath = resolve(options.sourcePath);
  if (!existsSync(sourcePath)) throw new Error(`${options.name} source not found: ${sourcePath}`);

  const deps = await darwinHomebrewDeps(sourcePath);
  if (deps.length && !options.allowNonPortable) {
    throw new Error([
      `${options.name} is not portable for a clean packaged app: ${sourcePath}`,
      'It links to Homebrew/local libraries:',
      ...deps.slice(0, 12).map((dep) => `  - ${dep}`),
      deps.length > 12 ? `  ... ${deps.length - 12} more` : '',
      'Use a self-contained or correctly bundled binary, or pass --allow-nonportable only for local dev artifacts.',
    ].filter(Boolean).join('\n'));
  }

  const destination = targetPath(options.name, options.targetPlatform, options.targetArch);
  mkdirSync(targetDir(options.targetPlatform, options.targetArch), { recursive: true });
  copyFileSync(sourcePath, destination);
  if (options.targetPlatform !== 'win32') {
    await $`chmod +x ${destination}`.quiet();
  }

  writeFileSync(`${destination}.provenance.json`, `${JSON.stringify({
    name: options.name,
    source: options.source,
    sourcePath,
    license: options.license,
    targetPlatform: options.targetPlatform,
    targetArch: options.targetArch,
    sizeBytes: statSync(destination).size,
    sha256: sha256(destination),
    portableCheck: deps.length ? 'nonportable-override' : 'passed',
    copiedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8');
}

async function commandCopy(): Promise<void> {
  const targetPlatform = platform();
  const targetArch = arch();
  const allowNonPortable = flag('--allow-nonportable');
  const whisperSource = arg('--whisper-cli') ?? process.env.RUNNEROS_WHISPER_CPP_CLI_SOURCE ?? commandPath('whisper-cli');
  const ffmpegSource = arg('--ffmpeg') ?? process.env.RUNNEROS_FFMPEG_SOURCE ?? commandPath('ffmpeg');

  if (!whisperSource) throw new Error('No whisper-cli source found. Pass --whisper-cli /path/to/whisper-cli.');
  if (!ffmpegSource) throw new Error('No ffmpeg source found. Pass --ffmpeg /path/to/ffmpeg.');

  await copyRuntimeBinary({
    name: 'whisper-cli',
    sourcePath: whisperSource,
    targetPlatform,
    targetArch,
    source: arg('--whisper-source') ?? 'local source path',
    license: arg('--whisper-license') ?? 'whisper.cpp MIT; verify bundled binary provenance',
    allowNonPortable,
  });
  await copyRuntimeBinary({
    name: 'ffmpeg',
    sourcePath: ffmpegSource,
    targetPlatform,
    targetArch,
    source: arg('--ffmpeg-source') ?? 'local source path',
    license: arg('--ffmpeg-license') ?? 'FFmpeg license must be LGPL-safe or product-approved before release',
    allowNonPortable,
  });

  console.log(`Lyrics runtime copied to ${targetDir(targetPlatform, targetArch)}`);
}

async function commandCopyWhisper(): Promise<void> {
  const targetPlatform = platform();
  const targetArch = arch();
  const whisperSource = arg('--whisper-cli') ?? process.env.RUNNEROS_WHISPER_CPP_CLI_SOURCE ?? commandPath('whisper-cli');
  if (!whisperSource) throw new Error('No whisper-cli source found. Pass --whisper-cli /path/to/whisper-cli.');
  await copyRuntimeBinary({
    name: 'whisper-cli',
    sourcePath: whisperSource,
    targetPlatform,
    targetArch,
    source: arg('--whisper-source') ?? 'local source path',
    license: arg('--whisper-license') ?? 'whisper.cpp MIT; verify bundled binary provenance',
    allowNonPortable: flag('--allow-nonportable'),
  });
  console.log(`Whisper runtime copied to ${targetPath('whisper-cli', targetPlatform, targetArch)}`);
}

async function commandCopyFfmpeg(): Promise<void> {
  const targetPlatform = platform();
  const targetArch = arch();
  const ffmpegSource = arg('--ffmpeg') ?? process.env.RUNNEROS_FFMPEG_SOURCE ?? commandPath('ffmpeg');
  if (!ffmpegSource) throw new Error('No ffmpeg source found. Pass --ffmpeg /path/to/ffmpeg.');
  await copyRuntimeBinary({
    name: 'ffmpeg',
    sourcePath: ffmpegSource,
    targetPlatform,
    targetArch,
    source: arg('--ffmpeg-source') ?? 'local source path',
    license: arg('--ffmpeg-license') ?? 'FFmpeg license must be LGPL-safe or product-approved before release',
    allowNonPortable: flag('--allow-nonportable'),
  });
  console.log(`FFmpeg runtime copied to ${targetPath('ffmpeg', targetPlatform, targetArch)}`);
}

function commandClean(): void {
  const targetPlatform = platform();
  const targetArch = arch();
  rmSync(targetDir(targetPlatform, targetArch), { recursive: true, force: true });
  console.log(`Removed ${targetDir(targetPlatform, targetArch)}`);
}

function commandDoctor(): void {
  const targetPlatform = platform();
  const targetArch = arch();
  const expected = [
    targetPath('whisper-cli', targetPlatform, targetArch),
    `${targetPath('whisper-cli', targetPlatform, targetArch)}.provenance.json`,
    targetPath('ffmpeg', targetPlatform, targetArch),
    `${targetPath('ffmpeg', targetPlatform, targetArch)}.provenance.json`,
  ];
  const missing = expected.filter((path) => !existsSync(path));
  const payload = {
    ok: missing.length === 0,
    targetPlatform,
    targetArch,
    runtimeDir: targetDir(targetPlatform, targetArch),
    expected,
    missing,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (missing.length) process.exit(1);
}

function commandGate(): void {
  if (process.env.RUNNEROS_SKIP_LYRICS_RUNTIME_CHECK === '1') {
    console.warn('Skipping lyrics runtime bundle gate because RUNNEROS_SKIP_LYRICS_RUNTIME_CHECK=1.');
    return;
  }
  commandDoctor();
}

function usage(): void {
  console.log([
    'prepare-lyrics-runtime',
    '',
    'Commands:',
    '  doctor [--platform darwin|win32|linux] [--arch arm64|x64]',
    '  gate [--platform darwin|win32|linux] [--arch arm64|x64]',
    '  copy --whisper-cli <path> --ffmpeg <path> [--allow-nonportable]',
    '  copy-whisper --whisper-cli <path> [--allow-nonportable]',
    '  copy-ffmpeg --ffmpeg <path> [--allow-nonportable]',
    '  clean [--platform ...] [--arch ...]',
    '',
    'Notes:',
    '  - Refuses Homebrew-linked macOS binaries by default.',
    '  - Writes .provenance.json files required by packaged-mode doctor.',
  ].join('\n'));
}

const command = Bun.argv[2] ?? 'help';
try {
  if (command === 'copy') await commandCopy();
  else if (command === 'copy-whisper') await commandCopyWhisper();
  else if (command === 'copy-ffmpeg') await commandCopyFfmpeg();
  else if (command === 'doctor') commandDoctor();
  else if (command === 'gate') commandGate();
  else if (command === 'clean') commandClean();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
