/**
 * Tests for the global-tier source loaders and activation manifest.
 * Phase 1 of the Global Sources feature — read path only.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import * as os from 'os';
import { tmpdir } from 'os';
import { join, resolve, sep } from 'path';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';

// Redirect ~/ to a temp directory before importing storage.ts so that
// GLOBAL_AGENT_SOURCES_DIR resolves into the sandbox.
const sandboxHome = mkdtempSync(join(tmpdir(), 'global-sources-home-'));
const sandboxHomeResolved = resolve(sandboxHome);
const realHomeSourcesDir = resolve(join(os.homedir(), '.agents', 'sources'));
const fakeCopilotComputerUseMcp = join(sandboxHome, 'computer-use-mcp');
writeFileSync(fakeCopilotComputerUseMcp, '');
process.env.CRAFT_COPILOT_COMPUTER_USE_MCP = fakeCopilotComputerUseMcp;
mock.module('os', () => ({
  ...os,
  homedir: () => sandboxHome,
}));

const storage = await import(`../storage.ts?global-sources-storage-test=${process.pid}-${Date.now()}`);
const {
  GLOBAL_AGENT_SOURCES_DIR,
  GLOBAL_WORKSPACE_ID,
  WORKSPACE_GLOBAL_SOURCES_MANIFEST,
  getGlobalSourcePath,
  getWorkspaceGlobalSourcesManifestPath,
  readGlobalSourcesManifest,
  isGlobalSourceActivatedInWorkspace,
  loadGlobalSource,
  loadGlobalSources,
  listGlobalSourceSlugs,
  loadAllSources,
  getSourcesBySlugs,
  isSourceUsable,
  loadSourceConfig,
  markLoadedSourceAuthenticated,
  markLoadedSourceNeedsReauth,
  writeGlobalSourcesManifest,
  activateGlobalSourceInWorkspace,
  deactivateGlobalSourceInWorkspace,
  mirrorSourceToGlobal,
} = storage;

afterAll(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function assertSandboxedGlobalSourcesDir(path = GLOBAL_AGENT_SOURCES_DIR): void {
  const resolvedPath = resolve(path);
  const isInsideSandboxHome = resolvedPath === sandboxHomeResolved
    || resolvedPath.startsWith(`${sandboxHomeResolved}${sep}`);

  if (
    !isInsideSandboxHome
    || resolvedPath === realHomeSourcesDir
    || !resolvedPath.endsWith(join('.agents', 'sources'))
  ) {
    throw new Error(`Refusing to touch non-sandboxed global sources dir: ${resolvedPath}`);
  }
}

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'global-sources-ws-'));
  mkdirSync(join(ws, 'sources'), { recursive: true });
  return ws;
}

function writeManifest(ws: string, body: string | object): void {
  const path = getWorkspaceGlobalSourcesManifestPath(ws);
  mkdirSync(join(ws, 'sources'), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

function writeGlobalSource(slug: string, partial: Partial<FolderSourceConfig> = {}): void {
  assertSandboxedGlobalSourcesDir();
  const dir = getGlobalSourcePath(slug);
  mkdirSync(dir, { recursive: true });
  const config: FolderSourceConfig = {
    id: `${slug}_test`,
    name: partial.name ?? slug,
    slug,
    enabled: partial.enabled ?? true,
    provider: partial.provider ?? 'custom',
    type: partial.type ?? 'mcp',
    mcp: partial.mcp ?? { transport: 'http', url: 'https://example.test/mcp', authType: 'none' },
    ...partial,
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
}

function writeWorkspaceSource(ws: string, slug: string, partial: Partial<FolderSourceConfig> = {}): void {
  const dir = join(ws, 'sources', slug);
  mkdirSync(dir, { recursive: true });
  const config: FolderSourceConfig = {
    id: `${slug}_ws`,
    name: partial.name ?? slug,
    slug,
    enabled: partial.enabled ?? true,
    provider: partial.provider ?? 'custom',
    type: partial.type ?? 'mcp',
    mcp: partial.mcp ?? { transport: 'http', url: 'https://workspace.test/mcp', authType: 'none' },
    ...partial,
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
}

beforeAll(() => {
  assertSandboxedGlobalSourcesDir();
  // Ensure the global sources dir is empty at the start.
  try {
    rmSync(GLOBAL_AGENT_SOURCES_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(GLOBAL_AGENT_SOURCES_DIR, { recursive: true });
});

describe('global tier paths', () => {
  test('GLOBAL_AGENT_SOURCES_DIR resolves under the sandboxed home', () => {
    expect(GLOBAL_AGENT_SOURCES_DIR.startsWith(sandboxHome)).toBe(true);
    expect(GLOBAL_AGENT_SOURCES_DIR.endsWith(join('.agents', 'sources'))).toBe(true);
  });

  test('destructive global test paths cannot target the real home sources dir', () => {
    const resolvedGlobalDir = resolve(GLOBAL_AGENT_SOURCES_DIR);
    expect(resolvedGlobalDir.startsWith(`${sandboxHomeResolved}${sep}`)).toBe(true);
    expect(resolvedGlobalDir).not.toBe(realHomeSourcesDir);
    expect(() => assertSandboxedGlobalSourcesDir(realHomeSourcesDir)).toThrow(/Refusing to touch/);
  });

  test('GLOBAL_WORKSPACE_ID is the documented sentinel', () => {
    expect(GLOBAL_WORKSPACE_ID).toBe('__global__');
  });

  test('manifest path lives inside <workspace>/sources/', () => {
    const ws = makeWorkspace();
    const path = getWorkspaceGlobalSourcesManifestPath(ws);
    expect(path).toBe(join(ws, 'sources', WORKSPACE_GLOBAL_SOURCES_MANIFEST));
  });
});

describe('workspace local source paths', () => {
  test('loadSourceConfig resolves relative local paths from the workspace root', () => {
    const ws = makeWorkspace();
    const dir = join(ws, 'sources', 'local-cli');
    mkdirSync(dir, { recursive: true });
    const config: FolderSourceConfig = {
      id: 'local-cli_test',
      name: 'Local CLI',
      slug: 'local-cli',
      enabled: true,
      provider: 'custom',
      type: 'local',
      local: { path: 'tools/local-cli', format: 'cli-tool' },
    };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));

    expect(loadSourceConfig(ws, 'local-cli')?.local?.path).toBe(join(ws, 'tools/local-cli'));
  });
});

describe('readGlobalSourcesManifest', () => {
  test('returns empty manifest when file is missing', () => {
    const ws = makeWorkspace();
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual([]);
    expect(m.version).toBe(1);
    expect(typeof m.lastModified).toBe('string');
  });

  test('tolerates malformed JSON without throwing', () => {
    const ws = makeWorkspace();
    writeManifest(ws, '{ this is not json');
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual([]);
    // The malformed file should have been moved aside as a backup.
    const entries = readdirSync(join(ws, 'sources'));
    expect(entries.some((e) => e.startsWith(`${WORKSPACE_GLOBAL_SOURCES_MANIFEST}.broken-`))).toBe(true);
  });

  test('dedupes duplicate slugs on read', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['notion', 'notion', 'github'], lastModified: 'x' });
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual(['notion', 'github']);
  });

  test('isGlobalSourceActivatedInWorkspace reflects the manifest', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['linear'], lastModified: 'x' });
    expect(isGlobalSourceActivatedInWorkspace(ws, 'linear')).toBe(true);
    expect(isGlobalSourceActivatedInWorkspace(ws, 'notion')).toBe(false);
  });
});

describe('loadGlobalSource', () => {
  test('returns null when the slug does not exist', () => {
    expect(loadGlobalSource('does-not-exist-' + Date.now())).toBeNull();
  });

  test('loads an existing global config with tier=global for global library listings', () => {
    const slug = 'notion-' + Date.now();
    writeGlobalSource(slug, { name: 'Notion' });
    const s = loadGlobalSource(slug);
    expect(s).not.toBeNull();
    expect(s!.config.slug).toBe(slug);
    expect(s!.config.name).toBe('Notion');
    expect(s!.tier).toBe('global');
    expect(s!.workspaceId).toBe(GLOBAL_WORKSPACE_ID);
  });

  test('loads activated global with active workspace runtime context', () => {
    const slug = 'runtime-global-' + Date.now();
    const ws = makeWorkspace();
    writeGlobalSource(slug, { name: 'Runtime Global' });

    const s = loadGlobalSource(slug, ws);
    expect(s).not.toBeNull();
    expect(s!.tier).toBe('global');
    expect(s!.workspaceRootPath).toBe(ws);
    expect(s!.workspaceId).toBe(ws.split('/').pop());
    expect(s!.folderPath).toBe(getGlobalSourcePath(slug));
  });
});

describe('global source auth state updates', () => {
  test('markLoadedSourceAuthenticated updates the global config, not a workspace ghost copy', () => {
    const slug = 'auth-global-' + Date.now();
    const ws = makeWorkspace();
    writeGlobalSource(slug, {
      name: 'Auth Global',
      mcp: { transport: 'http', url: 'https://example.test/mcp', authType: 'bearer' },
      isAuthenticated: false,
      connectionStatus: 'needs_auth',
      connectionError: 'missing token',
    });

    const source = loadGlobalSource(slug, ws);
    expect(source).not.toBeNull();
    expect(markLoadedSourceAuthenticated(source!)).toBe(true);

    const reloaded = loadGlobalSource(slug, ws);
    expect(isSourceUsable(reloaded!)).toBe(true);
    expect(reloaded!.config.connectionStatus).toBe('connected');
    expect(reloaded!.config.connectionError).toBeUndefined();
    expect(readdirSync(join(ws, 'sources'))).toEqual([]);
  });

  test('markLoadedSourceNeedsReauth updates the global config for activated globals', () => {
    const slug = 'reauth-global-' + Date.now();
    const ws = makeWorkspace();
    writeGlobalSource(slug, {
      name: 'Reauth Global',
      mcp: { transport: 'http', url: 'https://example.test/mcp', authType: 'bearer' },
      isAuthenticated: true,
      connectionStatus: 'connected',
    });

    const source = loadGlobalSource(slug, ws);
    expect(source).not.toBeNull();
    expect(markLoadedSourceNeedsReauth(source!, 'signed out')).toBe(true);

    const reloaded = loadGlobalSource(slug, ws);
    expect(isSourceUsable(reloaded!)).toBe(false);
    expect(reloaded!.config.connectionStatus).toBe('needs_auth');
    expect(reloaded!.config.connectionError).toBe('signed out');
    expect(readdirSync(join(ws, 'sources'))).toEqual([]);
  });
});

describe('loadAllSources', () => {
  test('includes activated globals listed in the manifest', () => {
    const slug = 'github-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === slug);
    expect(found).toBeDefined();
    expect(found!.tier).toBe('global');
    expect(found!.workspaceRootPath).toBe(ws);
    expect(found!.workspaceId).toBe(ws.split('/').pop());
  });

  test('excludes globals not listed in the manifest', () => {
    const slug = 'unlisted-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace(); // no manifest

    const all = loadAllSources(ws);
    expect(all.find((s: LoadedSource) => s.config.slug === slug)).toBeUndefined();
  });

  test('includeDormant: true surfaces unactivated globals as global-dormant', () => {
    const slug = 'dormant-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();

    const dormant = loadAllSources(ws, { includeDormant: true });
    const found = dormant.find((s: LoadedSource) => s.config.slug === slug);
    expect(found).toBeDefined();
    expect(found!.tier).toBe('global-dormant');
  });

  test('workspace tier wins over a same-slug activated global', () => {
    const slug = 'shared-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws);
    const matches = all.filter((s: LoadedSource) => s.config.slug === slug);
    expect(matches.length).toBe(1);
    expect(matches[0]!.tier).toBe('workspace');
    // Workspace MCP url, not the global one.
    expect(matches[0]!.config.mcp?.url).toBe('https://workspace.test/mcp');
  });

  test('activated slug pointing to a missing global is dropped without throwing', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['ghost-slug-xyz'], lastModified: 'x' });
    const all = loadAllSources(ws);
    expect(all.find((s: LoadedSource) => s.config.slug === 'ghost-slug-xyz')).toBeUndefined();
  });

  test('includeDormant skips globals already activated', () => {
    const slug = 'no-double-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws, { includeDormant: true });
    const matches = all.filter((s: LoadedSource) => s.config.slug === slug);
    expect(matches.length).toBe(1);
    expect(matches[0]!.tier).toBe('global');
  });

  test('includes computer-use as a project source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'computer-use');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('mcp');
    expect(found!.config.mcp?.transport).toBe('stdio');
    expect(found!.config.mcp?.authType).toBe('none');
    expect(found!.config.provider).toBe('copilot-computer-use');
    expect(found!.config.mcp?.args).toEqual([]);
    expect(found!.config.mcp?.command).toContain('computer-use-mcp');
    expect(found!.guide?.raw).toContain('get_window_state');
  });

  test('ignores stale workspace computer-use copies and keeps the built-in source authoritative', () => {
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, 'computer-use', {
      id: 'builtin-computer-use',
      provider: 'background-computer-use',
      mcp: {
        transport: 'stdio',
        command: 'bun',
        args: ['run', '/old/background-computer-use-mcp.ts'],
        authType: 'none',
      },
    });

    const all = loadAllSources(ws);
    const matches = all.filter((s: LoadedSource) => s.config.slug === 'computer-use');
    const bySlug = getSourcesBySlugs(ws, ['computer-use']);

    expect(matches.length).toBe(1);
    expect(matches[0]!.tier).toBe('project');
    expect(matches[0]!.config.mcp?.command).toContain('computer-use-mcp');
    expect(matches[0]!.config.mcp?.args).toEqual([]);
    expect(bySlug[0]!.tier).toBe('project');
    expect(bySlug[0]!.config.mcp?.command).toContain('computer-use-mcp');
  });

  test('includes field-theory as a project source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'field-theory');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('mcp');
    expect(found!.config.mcp?.transport).toBe('stdio');
    expect(found!.config.mcp?.authType).toBe('none');
  });

  test('includes printing-press-social as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'printing-press-social');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
    expect(found!.guide?.raw).toContain('execute --action-file');
  });

  test('printing-press-social source permissions include guarded execute handoff only', () => {
    const permissionsPath = resolve(import.meta.dir, '../../../../../sources/printing-press-social/permissions.json');
    const permissions = JSON.parse(readFileSync(permissionsPath, 'utf8')) as {
      allowedBashPatterns?: Array<{ pattern: string; comment?: string }>;
    };
    const executePattern = permissions.allowedBashPatterns?.find((entry) => entry.pattern.includes('social\\.mjs\\s+execute'));

    expect(executePattern).toBeDefined();
    expect(executePattern!.pattern).toContain('--action-file');
    expect(executePattern!.pattern).toContain('--confirm\\s+yes');
    expect(executePattern!.pattern).toContain('--json');
  });

  test('includes hypermotion as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'hypermotion');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
  });

  test('includes lottie as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'lottie');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
    expect(found!.config.local?.path).toContain('tools/lottie');
  });

  test('includes video-studio as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'video-studio');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
    expect(found!.config.local?.path).toContain('tools/video-studio');
  });

  test('includes raw-video-editor as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'raw-video-editor');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
    expect(found!.config.local?.path).toContain('tools/raw-video-editor');
  });

  test('includes shopify as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'shopify');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
  });

  test('includes printify as a project local source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'printify');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('cli-tool');
  });

  test('includes media-generation as a project provider-router source', () => {
    const ws = makeWorkspace();
    const all = loadAllSources(ws);
    const found = all.find((s: LoadedSource) => s.config.slug === 'media-generation');

    expect(found).toBeDefined();
    expect(found!.tier).toBe('project');
    expect(found!.config.type).toBe('local');
    expect(found!.config.local?.format).toBe('provider-router');
    expect(found!.guide?.raw).toContain('FAL_API_KEY');
    expect(found!.guide?.raw).toContain('REPLICATE_API_TOKEN');
    expect(found!.guide?.raw).toContain('WAVESPEED_API_KEY');
  });

  test('does not treat media-generation as usable until a provider key exists', () => {
    const saved = {
      fal: process.env.FAL_API_KEY,
      squadFal: process.env.SQUAD_FAL_API_KEY,
      wavespeed: process.env.WAVESPEED_API_KEY,
      squadWavespeed: process.env.SQUAD_WAVESPEED_API_KEY,
      replicate: process.env.REPLICATE_API_TOKEN,
      heygen: process.env.HEYGEN_API_KEY,
      squadHeygen: process.env.SQUAD_HEYGEN_API_KEY,
      muapi: process.env.MUAPI_API_KEY,
      runpod: process.env.RUNPOD_API_KEY,
    };

    delete process.env.FAL_API_KEY;
    delete process.env.SQUAD_FAL_API_KEY;
    delete process.env.WAVESPEED_API_KEY;
    delete process.env.SQUAD_WAVESPEED_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.HEYGEN_API_KEY;
    delete process.env.SQUAD_HEYGEN_API_KEY;
    delete process.env.MUAPI_API_KEY;
    delete process.env.RUNPOD_API_KEY;

    try {
      const disconnected = loadAllSources(makeWorkspace()).find((s: LoadedSource) => s.config.slug === 'media-generation');
      expect(disconnected).toBeDefined();
      expect(disconnected!.config.connectionStatus).toBe('needs_auth');
      expect(disconnected!.config.isAuthenticated).toBe(false);
      expect(isSourceUsable(disconnected!)).toBe(false);

      process.env.FAL_API_KEY = 'test-fal-key';
      const connected = loadAllSources(makeWorkspace()).find((s: LoadedSource) => s.config.slug === 'media-generation');
      expect(connected).toBeDefined();
      expect(connected!.config.connectionStatus).toBe('connected');
      expect(connected!.config.isAuthenticated).toBe(true);
      expect(isSourceUsable(connected!)).toBe(true);
    } finally {
      if (saved.fal === undefined) delete process.env.FAL_API_KEY; else process.env.FAL_API_KEY = saved.fal;
      if (saved.squadFal === undefined) delete process.env.SQUAD_FAL_API_KEY; else process.env.SQUAD_FAL_API_KEY = saved.squadFal;
      if (saved.wavespeed === undefined) delete process.env.WAVESPEED_API_KEY; else process.env.WAVESPEED_API_KEY = saved.wavespeed;
      if (saved.squadWavespeed === undefined) delete process.env.SQUAD_WAVESPEED_API_KEY; else process.env.SQUAD_WAVESPEED_API_KEY = saved.squadWavespeed;
      if (saved.replicate === undefined) delete process.env.REPLICATE_API_TOKEN; else process.env.REPLICATE_API_TOKEN = saved.replicate;
      if (saved.heygen === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = saved.heygen;
      if (saved.squadHeygen === undefined) delete process.env.SQUAD_HEYGEN_API_KEY; else process.env.SQUAD_HEYGEN_API_KEY = saved.squadHeygen;
      if (saved.muapi === undefined) delete process.env.MUAPI_API_KEY; else process.env.MUAPI_API_KEY = saved.muapi;
      if (saved.runpod === undefined) delete process.env.RUNPOD_API_KEY; else process.env.RUNPOD_API_KEY = saved.runpod;
    }
  });

  test('includes media-generation provider preferences in its guide', () => {
    const saved = {
      fal: process.env.FAL_API_KEY,
      imageProvider: process.env.MEDIA_IMAGE_PROVIDER,
      videoProvider: process.env.MEDIA_VIDEO_PROVIDER,
      strategy: process.env.MEDIA_PROVIDER_STRATEGY,
    };

    process.env.FAL_API_KEY = 'test-fal-key';
    process.env.MEDIA_IMAGE_PROVIDER = 'replicate';
    process.env.MEDIA_VIDEO_PROVIDER = 'wavespeed';
    process.env.MEDIA_PROVIDER_STRATEGY = 'speed';

    try {
      const found = loadAllSources(makeWorkspace()).find((s: LoadedSource) => s.config.slug === 'media-generation');
      expect(found).toBeDefined();
      expect(found!.guide?.raw).toContain('Default image provider: replicate.');
      expect(found!.guide?.raw).toContain('Default video provider: wavespeed.');
      expect(found!.guide?.raw).toContain('Generation priority: speed.');
      expect(found!.guide?.raw).toContain('If the user names a provider, use that provider');
    } finally {
      if (saved.fal === undefined) delete process.env.FAL_API_KEY; else process.env.FAL_API_KEY = saved.fal;
      if (saved.imageProvider === undefined) delete process.env.MEDIA_IMAGE_PROVIDER; else process.env.MEDIA_IMAGE_PROVIDER = saved.imageProvider;
      if (saved.videoProvider === undefined) delete process.env.MEDIA_VIDEO_PROVIDER; else process.env.MEDIA_VIDEO_PROVIDER = saved.videoProvider;
      if (saved.strategy === undefined) delete process.env.MEDIA_PROVIDER_STRATEGY; else process.env.MEDIA_PROVIDER_STRATEGY = saved.strategy;
    }
  });
});

describe('getSourcesBySlugs', () => {
  test('resolves activated globals by slug with workspace runtime context', () => {
    const slug = 'by-slug-global-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const sources = getSourcesBySlugs(ws, [slug]);
    expect(sources.length).toBe(1);
    expect(sources[0]!.config.slug).toBe(slug);
    expect(sources[0]!.tier).toBe('global');
    expect(sources[0]!.workspaceRootPath).toBe(ws);
    expect(sources[0]!.workspaceId).toBe(ws.split('/').pop());
  });

  test('uses workspace source over same-slug activated global', () => {
    const slug = 'by-slug-priority-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const sources = getSourcesBySlugs(ws, [slug]);
    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('workspace');
    expect(sources[0]!.config.mcp?.url).toBe('https://workspace.test/mcp');
  });

  test('resolves computer-use by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['computer-use']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('computer-use');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.mcp?.transport).toBe('stdio');
    expect(sources[0]!.config.mcp?.args).toEqual([]);
  });

  test('resolves field-theory by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['field-theory']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('field-theory');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.mcp?.transport).toBe('stdio');
  });

  test('resolves printing-press-social by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['printing-press-social']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('printing-press-social');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
  });

  test('resolves hypermotion by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['hypermotion']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('hypermotion');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
  });

  test('resolves lottie by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['lottie']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('lottie');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/lottie');
  });

  test('resolves video-studio by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['video-studio']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('video-studio');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/video-studio');
  });

  test('resolves raw-video-editor by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['raw-video-editor']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('raw-video-editor');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/raw-video-editor');
  });

  test('resolves google-ads by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['google-ads']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('google-ads');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/google-ads');
  });

  test('resolves ads-operator by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['ads-operator']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('ads-operator');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/ads-operator');
    expect(sources[0]!.config.connectionStatus).toBe('connected');
    expect(sources[0]!.guide?.raw).toContain('packet create');
    expect(sources[0]!.guide?.raw).toContain('audit');
    expect(sources[0]!.guide?.raw).toContain('campaign-plan');
    expect(sources[0]!.guide?.raw).toContain('receipt create');
  });

  test('resolves google-calendar by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['google-calendar']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('google-calendar');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('api');
    expect(sources[0]!.config.provider).toBe('google');
    expect(sources[0]!.config.api?.authType).toBe('oauth');
    expect(sources[0]!.config.api?.googleService).toBe('calendar');
    expect(sources[0]!.config.api?.baseUrl).toBe('https://www.googleapis.com/calendar/v3');
    expect(sources[0]!.config.api?.testEndpoint?.path).toBe('/calendars/primary/events?maxResults=1');
    expect(sources[0]!.config.api?.googleScopes).toContain('https://www.googleapis.com/auth/calendar.events');
  });

  test('normalizes stale workspace google calendar API host and test endpoint', () => {
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, 'google-calendar', {
      provider: 'google',
      type: 'api',
      api: {
        baseUrl: 'https://calendar.googleapis.com/calendar/v3',
        authType: 'oauth',
        googleService: 'calendar',
        googleScopes: ['https://www.googleapis.com/auth/calendar.events'],
      },
    });

    const sources = getSourcesBySlugs(ws, ['google-calendar']);

    expect(sources[0]!.tier).toBe('workspace');
    expect(sources[0]!.config.api?.baseUrl).toBe('https://www.googleapis.com/calendar/v3');
    expect(sources[0]!.config.api?.testEndpoint?.path).toBe('/calendars/primary/events?maxResults=1');
  });

  test('normalizes stale workspace google drive API host and test endpoint', () => {
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, 'google-drive', {
      provider: 'google',
      type: 'api',
      api: {
        baseUrl: 'https://drive.googleapis.com/drive/v3',
        authType: 'oauth',
        googleService: 'drive',
        googleScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
      },
    });

    const sources = getSourcesBySlugs(ws, ['google-drive']);

    expect(sources[0]!.tier).toBe('workspace');
    expect(sources[0]!.config.api?.baseUrl).toBe('https://www.googleapis.com/drive/v3');
    expect(sources[0]!.config.api?.testEndpoint?.path).toBe('/files?pageSize=1&fields=files(id,name,mimeType)');
  });

  test('resolves youtube-research by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['youtube-research']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('youtube-research');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/youtube-research');
  });

  test('resolves open-slide by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['open-slide']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('open-slide');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
  });

  test('resolves zero by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['zero']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('zero');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.format).toBe('cli-tool');
    expect(sources[0]!.guide?.raw).toContain('zero search');
  });

  test('resolves media-generation by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['media-generation']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('media-generation');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.format).toBe('provider-router');
    expect(sources[0]!.guide?.raw).toContain('Fal uses');
  });

  test('resolves shopify by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['shopify']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('shopify');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/shopify');
    expect(sources[0]!.guide?.raw).toContain('products list');
  });

  test('resolves meta-ads by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['meta-ads']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('meta-ads');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('mcp');
    expect(sources[0]!.config.mcp?.transport).toBe('http');
    expect(sources[0]!.config.connectionStatus).toBe('needs_auth');
  });

  test('resolves notebooklm by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['notebooklm']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('notebooklm');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('mcp');
    expect(sources[0]!.config.mcp?.transport).toBe('stdio');
    expect(sources[0]!.config.mcp?.command).toBe('npx');
  });

  test('resolves printify by slug without workspace activation', () => {
    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['printify']);

    expect(sources.length).toBe(1);
    expect(sources[0]!.tier).toBe('project');
    expect(sources[0]!.config.slug).toBe('printify');
    expect(sources[0]!.config.enabled).toBe(true);
    expect(sources[0]!.config.type).toBe('local');
    expect(sources[0]!.config.local?.path).toContain('tools/printify');
    expect(sources[0]!.guide?.raw).toContain('shops-json');
  });

  test('marks saved youtube-research key as untested until runtime validation', () => {
    const cacheDir = join(sandboxHome, '.config', 'runneros', 'youtube-research');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'credentials.json'), JSON.stringify({ apiKey: 'fake-key' }));

    const ws = makeWorkspace();
    const sources = getSourcesBySlugs(ws, ['youtube-research']);

    expect(sources[0]!.config.isAuthenticated).toBe(true);
    expect(sources[0]!.config.connectionStatus).toBe('untested');
    expect(sources[0]!.config.connectionError).toContain('not validated');
  });
});

describe('loadGlobalSources / listGlobalSourceSlugs', () => {
  test('listGlobalSourceSlugs lists slugs with a config.json', () => {
    const slug = 'listed-' + Date.now();
    writeGlobalSource(slug);
    expect(listGlobalSourceSlugs()).toContain(slug);
  });

  test('loadGlobalSources returns parsed configs only', () => {
    const slug = 'parsed-' + Date.now();
    writeGlobalSource(slug);
    const all = loadGlobalSources();
    expect(all.find((s: LoadedSource) => s.config.slug === slug)).toBeDefined();
  });
});

// ============================================================
// Phase 2 — write path
// ============================================================

describe('writeGlobalSourcesManifest', () => {
  test('writes valid JSON with version, activatedSlugs, lastModified', () => {
    const ws = makeWorkspace();
    writeGlobalSourcesManifest(ws, ['notion', 'linear']);

    const m = readGlobalSourcesManifest(ws);
    expect(m.version).toBe(1);
    expect(m.activatedSlugs).toEqual(['linear', 'notion']); // sorted
    expect(typeof m.lastModified).toBe('string');
    // ISO-ish timestamp
    expect(Number.isFinite(Date.parse(m.lastModified))).toBe(true);
  });

  test('dedupes and trims slugs on write', () => {
    const ws = makeWorkspace();
    writeGlobalSourcesManifest(ws, ['notion', '  notion  ', '', 'github']);
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual(['github', 'notion']);
  });

  test('concurrent writes do not corrupt the file (atomic rename)', async () => {
    const ws = makeWorkspace();
    // Race many writers. The final file must be valid JSON and contain a
    // subset of the inputs — we don't assert which writer wins, just that
    // we never observe a torn file.
    const inputs = Array.from({ length: 16 }, (_, i) => [`slug-${i}`]);
    await Promise.all(inputs.map((slugs) =>
      Promise.resolve().then(() => writeGlobalSourcesManifest(ws, slugs))
    ));

    const m = readGlobalSourcesManifest(ws);
    expect(m.version).toBe(1);
    expect(Array.isArray(m.activatedSlugs)).toBe(true);
    // Exactly one slug should win, and it should be one of the inputs.
    expect(m.activatedSlugs.length).toBe(1);
    expect(/^slug-\d+$/.test(m.activatedSlugs[0]!)).toBe(true);
  });
});

describe('activate / deactivate', () => {
  test('activate adds the slug to the manifest', () => {
    const ws = makeWorkspace();
    activateGlobalSourceInWorkspace(ws, 'notion');
    expect(readGlobalSourcesManifest(ws).activatedSlugs).toContain('notion');
  });

  test('double-activate is a no-op (idempotent)', () => {
    const ws = makeWorkspace();
    activateGlobalSourceInWorkspace(ws, 'notion');
    activateGlobalSourceInWorkspace(ws, 'notion');
    const slugs = readGlobalSourcesManifest(ws).activatedSlugs;
    expect(slugs.filter((s: string) => s === 'notion').length).toBe(1);
  });

  test('deactivate removes the slug', () => {
    const ws = makeWorkspace();
    activateGlobalSourceInWorkspace(ws, 'notion');
    activateGlobalSourceInWorkspace(ws, 'github');
    deactivateGlobalSourceInWorkspace(ws, 'notion');

    const slugs = readGlobalSourcesManifest(ws).activatedSlugs;
    expect(slugs).toContain('github');
    expect(slugs).not.toContain('notion');
  });

  test('deactivate is idempotent for an unknown slug', () => {
    const ws = makeWorkspace();
    deactivateGlobalSourceInWorkspace(ws, 'never-activated');
    expect(readGlobalSourcesManifest(ws).activatedSlugs).toEqual([]);
  });

  test('empty / whitespace slug is ignored', () => {
    const ws = makeWorkspace();
    activateGlobalSourceInWorkspace(ws, '  ');
    expect(readGlobalSourcesManifest(ws).activatedSlugs).toEqual([]);
  });
});

describe('mirrorSourceToGlobal', () => {
  test('with no existing global, creates the global and activates it', () => {
    const slug = 'promo-fresh-' + Date.now();
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);

    const result = mirrorSourceToGlobal(ws, slug);
    expect(result.mirrored).toBe(true);
    expect(result.path).toBe(getGlobalSourcePath(slug));
    expect(result.credentialsRequested).toBe(false);

    // Global exists.
    const g = loadGlobalSource(slug);
    expect(g).not.toBeNull();
    expect(g!.config.slug).toBe(slug);

    // Source workspace's manifest now lists the slug.
    expect(readGlobalSourcesManifest(ws).activatedSlugs).toContain(slug);
  });

  test('throws clearly on collision without overwrite', () => {
    const slug = 'promo-collide-' + Date.now();
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);
    writeGlobalSource(slug, { name: 'pre-existing' });

    expect(() => mirrorSourceToGlobal(ws, slug)).toThrow(/already exists/i);
  });

  test('with overwrite: true, replaces existing and moves displaced copy aside', () => {
    const slug = 'promo-overwrite-' + Date.now();
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);
    writeGlobalSource(slug, { name: 'old-global' });

    const result = mirrorSourceToGlobal(ws, slug, { overwrite: true });
    expect(result.mirrored).toBe(true);

    // The displaced .old-... directory should have been cleaned up.
    const stagingArtifacts = readdirSync(GLOBAL_AGENT_SOURCES_DIR)
      .filter((e) => e.startsWith(`.old-${slug}-`) || e.startsWith(`.tmp-${slug}-`));
    expect(stagingArtifacts.length).toBe(0);

    // New content is the workspace source's MCP url.
    const g = loadGlobalSource(slug);
    expect(g!.config.mcp?.url).toBe('https://workspace.test/mcp');
  });

  test('includeCredentials: false (default) does not touch credentials', () => {
    const slug = 'promo-nocreds-' + Date.now();
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);

    const result = mirrorSourceToGlobal(ws, slug);
    expect(result.credentialsRequested).toBe(false);

    // No credentials.json should appear in the global source dir.
    const globalEntries = readdirSync(getGlobalSourcePath(slug));
    expect(globalEntries.some((e) => e === 'credentials.json')).toBe(false);
  });

  test('includeCredentials: true propagates the flag without copying creds (Phase 3 work)', () => {
    const slug = 'promo-creds-flag-' + Date.now();
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);

    const result = mirrorSourceToGlobal(ws, slug, { includeCredentials: true });
    expect(result.credentialsRequested).toBe(true);

    // Phase 2 still does NOT copy creds — that's Lane C / Phase 3.
    const globalEntries = readdirSync(getGlobalSourcePath(slug));
    expect(globalEntries.some((e) => e === 'credentials.json')).toBe(false);
  });

  test('throws when workspace source is missing', () => {
    const ws = makeWorkspace();
    expect(() => mirrorSourceToGlobal(ws, 'does-not-exist-' + Date.now()))
      .toThrow(/workspace source not found/i);
  });
});
