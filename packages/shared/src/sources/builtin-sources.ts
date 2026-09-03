/**
 * Built-in Sources
 *
 * Project-level sources that ship with RunnerOS.
 */

import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { join, resolve } from 'node:path';
import type { LoadedSource, FolderSourceConfig } from './types.ts';
import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';

const COMPUTER_USE_SLUG = 'computer-use';
const FIELD_THEORY_SLUG = 'field-theory';
const PRINTING_PRESS_SOCIAL_SLUG = 'printing-press-social';
const HYPERMOTION_SLUG = 'hypermotion';
const LOTTIE_SLUG = 'lottie';
const VIDEO_STUDIO_SLUG = 'video-studio';
const RAW_VIDEO_EDITOR_SLUG = 'raw-video-editor';
const SQUAD_SLUG = 'squad';
const GENESIS_LYRIC_SLUG = 'genesis-lyric';
const LYRICS_TRANSCRIBER_SLUG = 'lyrics-transcriber';
const GOOGLE_ADS_SLUG = 'google-ads';
const ADS_OPERATOR_SLUG = 'ads-operator';
const GOOGLE_CALENDAR_SLUG = 'google-calendar';
const GMAIL_SLUG = 'gmail';
const GOOGLE_DRIVE_SLUG = 'google-drive';
const META_ADS_SLUG = 'meta-ads';
const TRYPOST_SLUG = 'trypost';
const POSTIZ_SLUG = 'postiz';
const NOTEBOOKLM_SLUG = 'notebooklm';
const YOUTUBE_RESEARCH_SLUG = 'youtube-research';
const YOUTUBE_INTELLIGENCE_SLUG = 'youtube-intelligence';
const OPEN_SLIDE_SLUG = 'open-slide';
const ZERO_SLUG = 'zero';
const SHOPIFY_SLUG = 'shopify';
const PRINTIFY_SLUG = 'printify';
const MEDIA_GENERATION_SLUG = 'media-generation';

function firstExistingPath(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return resolve(candidate);
  }
  return resolve(candidates.find(Boolean) ?? fallback);
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, 'tools'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(startDir);
}

const REPO_ROOT = findRepoRoot(process.cwd());

function getResourceScriptPath(scriptName: string): string {
  const scriptsRoot = process.env.CRAFT_SCRIPTS;
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      scriptsRoot ? join(scriptsRoot, scriptName) : '',
      resourcesBase ? join(resourcesBase, 'resources', 'scripts', scriptName) : '',
      join(appRoot, 'apps', 'electron', 'resources', 'scripts', scriptName),
      join(appRoot, 'resources', 'scripts', scriptName),
      join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', scriptName),
    ],
    join('apps', 'electron', 'resources', 'scripts', scriptName)
  );
}

function getComputerUseScriptPath(): string {
  return getResourceScriptPath('background-computer-use-mcp.ts');
}

function getCopilotComputerUseMcpPath(): string | null {
  const platformArch = `${process.platform}-${process.arch}`;
  const executable = process.platform === 'win32' ? 'computer-use-mcp.exe' : 'computer-use-mcp';
  const candidates = [
    process.env.CRAFT_COPILOT_COMPUTER_USE_MCP ?? '',
    join(process.cwd(), 'node_modules', `@github/copilot-${platformArch}`, 'prebuilds', platformArch, executable),
    join(REPO_ROOT, 'node_modules', `@github/copilot-${platformArch}`, 'prebuilds', platformArch, executable),
    join(process.env.CRAFT_APP_ROOT || '', 'node_modules', `@github/copilot-${platformArch}`, 'prebuilds', platformArch, executable),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function getCuaDriverMcpPath(): string | null {
  const executable = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const override = process.env.CRAFT_CUA_DRIVER_MCP?.trim();
  if (override) {
    return isRunnableFile(override) ? override : null;
  }

  const candidates = [
    join(homedir(), '.local', 'bin', executable),
    ...(process.platform === 'darwin'
      ? [join('/Applications', 'CuaDriver.app', 'Contents', 'MacOS', 'cua-driver')]
      : []),
    findExecutableOnPath(executable) ?? '',
  ].filter(Boolean);

  return candidates.find((candidate) => isRunnableFile(candidate)) ?? null;
}

const CUA_DRIVER_STARTUP_PROBE_TTL_MS = 30_000;
let cuaDriverStartupProbeCache: {
  candidate: string;
  checkedAt: number;
  startable: boolean;
} | null = null;

function canStartCuaDriver(candidate: string): boolean {
  const now = Date.now();
  if (
    cuaDriverStartupProbeCache?.candidate === candidate
    && now - cuaDriverStartupProbeCache.checkedAt < CUA_DRIVER_STARTUP_PROBE_TTL_MS
  ) {
    return cuaDriverStartupProbeCache.startable;
  }

  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 2_000,
  });
  const startable = result.status === 0 && !result.error;
  cuaDriverStartupProbeCache = { candidate, checkedAt: now, startable };
  return startable;
}

export const CUA_DRIVER_GUIDE_TOOL_NAMES = [
  'health_report',
  'list_apps',
  'list_windows',
  'get_window_state',
  'click',
  'type_text',
  'set_value',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
  'invoke_menu',
  'set_window_frame',
  'verify_state',
] as const;

export type ComputerUseProvider =
  | 'cua-driver'
  | 'copilot-computer-use'
  | 'background-computer-use';

export interface ComputerUseProviderSelection {
  provider: ComputerUseProvider;
  command: string;
  args: string[];
  available: boolean;
  reason: string;
}

export function selectComputerUseProvider(input: {
  cuaDriverPath: string | null;
  cuaDriverStartable: boolean;
  copilotPath: string | null;
  vendoredScriptPath: string | null;
  bunCommand?: string;
  cuaDriverFromOverride?: boolean;
}): ComputerUseProviderSelection {
  const rejectedCuaReason = input.cuaDriverFromOverride && !input.cuaDriverPath
    ? 'the explicit CRAFT_CUA_DRIVER_MCP override was missing or not executable; '
    : input.cuaDriverPath && !input.cuaDriverStartable
      ? 'cua-driver was found but failed its startup probe; '
      : '';

  if (input.cuaDriverPath && input.cuaDriverStartable) {
    return {
      provider: 'cua-driver',
      command: input.cuaDriverPath,
      args: ['mcp'],
      available: true,
      reason: input.cuaDriverFromOverride
        ? 'selected the explicit CRAFT_CUA_DRIVER_MCP override'
        : 'selected the installed maintained cua-driver',
    };
  }

  if (input.copilotPath) {
    return {
      provider: 'copilot-computer-use',
      command: input.copilotPath,
      args: [],
      available: true,
      reason: `${rejectedCuaReason}selected the installed Copilot computer-use MCP`,
    };
  }

  if (input.vendoredScriptPath) {
    return {
      provider: 'background-computer-use',
      command: input.bunCommand || 'bun',
      args: ['run', input.vendoredScriptPath],
      available: true,
      reason: `${rejectedCuaReason}selected the bundled BackgroundComputerUse fallback`,
    };
  }

  return {
    provider: 'background-computer-use',
    command: input.bunCommand || 'bun',
    args: [],
    available: false,
    reason: `${rejectedCuaReason}no runnable computer-use provider was found`,
  };
}

function getFieldTheoryScriptPath(): string {
  return getResourceScriptPath('field-theory-mcp.ts');
}

function getPrintingPressSocialPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'printing-press-social') : '',
      join(appRoot, 'tools', 'printing-press-social'),
      join(REPO_ROOT, 'tools', 'printing-press-social'),
      join(process.cwd(), 'tools', 'printing-press-social'),
    ],
    join('tools', 'printing-press-social')
  );
}

function getOpenSlideExportPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'open-slide-export') : '',
      join(appRoot, 'tools', 'open-slide-export'),
      join(REPO_ROOT, 'tools', 'open-slide-export'),
      join(process.cwd(), 'tools', 'open-slide-export'),
    ],
    join('tools', 'open-slide-export')
  );
}

function findExecutableOnPath(command: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function getZeroCliPath(): string {
  return process.env.ZERO_CLI_PATH || findExecutableOnPath('zero') || 'zero';
}

function getHypermotionPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'hypermotion') : '',
      join(appRoot, 'tools', 'hypermotion'),
      join(REPO_ROOT, 'tools', 'hypermotion'),
      join(process.cwd(), 'tools', 'hypermotion'),
    ],
    join('tools', 'hypermotion')
  );
}

function getLottiePath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'lottie') : '',
      join(appRoot, 'tools', 'lottie'),
      join(REPO_ROOT, 'tools', 'lottie'),
      join(process.cwd(), 'tools', 'lottie'),
    ],
    join('tools', 'lottie')
  );
}

function getVideoStudioPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'video-studio') : '',
      join(appRoot, 'tools', 'video-studio'),
      join(REPO_ROOT, 'tools', 'video-studio'),
      join(process.cwd(), 'tools', 'video-studio'),
    ],
    join('tools', 'video-studio')
  );
}

function getRawVideoEditorPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'raw-video-editor') : '',
      join(appRoot, 'tools', 'raw-video-editor'),
      join(REPO_ROOT, 'tools', 'raw-video-editor'),
      join(process.cwd(), 'tools', 'raw-video-editor'),
    ],
    join('tools', 'raw-video-editor')
  );
}

function getSquadPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'squad') : '',
      join(appRoot, 'tools', 'squad'),
      join(REPO_ROOT, 'tools', 'squad'),
      join(process.cwd(), 'tools', 'squad'),
    ],
    join('tools', 'squad')
  );
}

function getGenesisLyricPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'genesis-lyric') : '',
      join(appRoot, 'tools', 'genesis-lyric'),
      join(REPO_ROOT, 'tools', 'genesis-lyric'),
      join(process.cwd(), 'tools', 'genesis-lyric'),
    ],
    join('tools', 'genesis-lyric')
  );
}

function getLyricsTranscriberPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'lyrics-transcriber') : '',
      join(appRoot, 'tools', 'lyrics-transcriber'),
      join(REPO_ROOT, 'tools', 'lyrics-transcriber'),
      join(process.cwd(), 'tools', 'lyrics-transcriber'),
    ],
    join('tools', 'lyrics-transcriber')
  );
}

function getGoogleAdsPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'google-ads') : '',
      join(appRoot, 'tools', 'google-ads'),
      join(REPO_ROOT, 'tools', 'google-ads'),
      join(process.cwd(), 'tools', 'google-ads'),
    ],
    join('tools', 'google-ads')
  );
}

function getAdsOperatorPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'ads-operator') : '',
      join(appRoot, 'tools', 'ads-operator'),
      join(REPO_ROOT, 'tools', 'ads-operator'),
      join(process.cwd(), 'tools', 'ads-operator'),
    ],
    join('tools', 'ads-operator')
  );
}

function getYouTubeResearchPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'youtube-research') : '',
      join(appRoot, 'tools', 'youtube-research'),
      join(REPO_ROOT, 'tools', 'youtube-research'),
      join(process.cwd(), 'tools', 'youtube-research'),
    ],
    join('tools', 'youtube-research')
  );
}

function getYouTubeIntelligencePath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'youtube-intelligence') : '',
      join(appRoot, 'tools', 'youtube-intelligence'),
      join(REPO_ROOT, 'tools', 'youtube-intelligence'),
      join(process.cwd(), 'tools', 'youtube-intelligence'),
    ],
    join('tools', 'youtube-intelligence')
  );
}

function getShopifyPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'shopify') : '',
      join(appRoot, 'tools', 'shopify'),
      join(REPO_ROOT, 'tools', 'shopify'),
      join(process.cwd(), 'tools', 'shopify'),
    ],
    join('tools', 'shopify')
  );
}

function getPrintifyPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'printify') : '',
      join(appRoot, 'tools', 'printify'),
      join(REPO_ROOT, 'tools', 'printify'),
      join(process.cwd(), 'tools', 'printify'),
    ],
    join('tools', 'printify')
  );
}

function getGoogleAdsCachedAuthState(): { configured: boolean; expired: boolean } {
  const cachePath = join(RUNTIME_IDENTITY.integrationCacheRoot, 'google-ads', 'credentials.json');
  if (!existsSync(cachePath)) return { configured: false, expired: false };

  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    const configured = Boolean(
      typeof parsed.accessToken === 'string' && parsed.accessToken.trim()
      && typeof parsed.developerToken === 'string' && parsed.developerToken.trim()
    );
    const expired = typeof parsed.expiresAt === 'number' && Date.now() > parsed.expiresAt;
    return { configured, expired };
  } catch {
    return { configured: false, expired: false };
  }
}

function getYouTubeResearchCachedAuthState(): { configured: boolean } {
  const cachePath = join(RUNTIME_IDENTITY.integrationCacheRoot, 'youtube-research', 'credentials.json');
  if (!existsSync(cachePath)) return { configured: false };

  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    return {
      configured: Boolean(typeof parsed.apiKey === 'string' && parsed.apiKey.trim()),
    };
  } catch {
    return { configured: false };
  }
}

function getShopifyAuthState(): { configured: boolean; shopConfigured: boolean; tokenConfigured: boolean } {
  const shopConfigured = Boolean((process.env.SHOPIFY_SHOP || process.env.SHOPIFY_STORE_DOMAIN)?.trim());
  const tokenConfigured = Boolean(process.env.SHOPIFY_ACCESS_TOKEN?.trim());
  return { configured: shopConfigured && tokenConfigured, shopConfigured, tokenConfigured };
}

function getPrintifyAuthState(): { configured: boolean } {
  return { configured: Boolean(process.env.PRINTIFY_API_TOKEN?.trim()) };
}

function getPrintifyBinaryPath(toolPath: string): string | null {
  const platformDir = `${process.platform}-${process.arch}`;
  const binaryName = process.platform === 'win32' ? 'printify-pp-cli.exe' : 'printify-pp-cli';
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const candidates = [
    process.env.PRINTIFY_PP_CLI ?? '',
    resourcesBase ? join(resourcesBase, 'resources', 'bin', platformDir, binaryName) : '',
    resourcesPath ? join(resourcesPath, 'app', 'resources', 'bin', platformDir, binaryName) : '',
    ...(process.env.RUNNEROS_DISABLE_PRINTIFY_BUNDLED_CLI === '1' ? [] : [
      join(toolPath, 'bin', platformDir, binaryName),
      join(REPO_ROOT, 'apps', 'electron', 'resources', 'bin', platformDir, binaryName),
      join(REPO_ROOT, 'resources', 'bin', platformDir, binaryName),
      join(REPO_ROOT, 'bin', platformDir, binaryName),
    ]),
    join(homedir(), '.local', 'bin', binaryName),
    ...((process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, binaryName))),
  ];

  for (const candidate of candidates) {
    if (candidate && isRunnableFile(candidate)) return candidate;
  }
  return null;
}

function isRunnableFile(candidate: string): boolean {
  if (!existsSync(candidate)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

type MediaProviderPreference = 'auto' | 'fal' | 'replicate' | 'wavespeed';
type MediaProviderStrategy = 'balanced' | 'speed' | 'quality' | 'cost';

function getMediaProviderPreference(name: string): MediaProviderPreference {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === 'fal' || value === 'replicate' || value === 'wavespeed') return value;
  return 'auto';
}

function getMediaProviderStrategy(): MediaProviderStrategy {
  const value = process.env.MEDIA_PROVIDER_STRATEGY?.trim().toLowerCase();
  if (value === 'speed' || value === 'quality' || value === 'cost') return value;
  return 'balanced';
}

function getMediaGenerationAuthState(): {
  configured: boolean;
  providers: string[];
  preferences: {
    imageProvider: MediaProviderPreference;
    videoProvider: MediaProviderPreference;
    strategy: MediaProviderStrategy;
  };
} {
  const providers: string[] = [];
  if ((process.env.FAL_API_KEY || process.env.SQUAD_FAL_API_KEY)?.trim()) providers.push('Fal');
  if ((process.env.WAVESPEED_API_KEY || process.env.SQUAD_WAVESPEED_API_KEY)?.trim()) providers.push('WaveSpeed');
  if (process.env.REPLICATE_API_TOKEN?.trim()) providers.push('Replicate');
  if ((process.env.HEYGEN_API_KEY || process.env.SQUAD_HEYGEN_API_KEY)?.trim()) providers.push('HeyGen');
  if (process.env.MUAPI_API_KEY?.trim()) providers.push('MuAPI');
  if (process.env.RUNPOD_API_KEY?.trim()) providers.push('RunPod');
  return {
    configured: providers.length > 0,
    providers,
    preferences: {
      imageProvider: getMediaProviderPreference('MEDIA_IMAGE_PROVIDER'),
      videoProvider: getMediaProviderPreference('MEDIA_VIDEO_PROVIDER'),
      strategy: getMediaProviderStrategy(),
    },
  };
}

/**
 * Get all built-in sources for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns Built-in project-tier sources
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  return [
    getComputerUseSource(workspaceId, workspaceRootPath),
    getFieldTheorySource(workspaceId, workspaceRootPath),
    getPrintingPressSocialSource(workspaceId, workspaceRootPath),
    getHypermotionSource(workspaceId, workspaceRootPath),
    getLottieSource(workspaceId, workspaceRootPath),
    getVideoStudioSource(workspaceId, workspaceRootPath),
    getRawVideoEditorSource(workspaceId, workspaceRootPath),
    getSquadSource(workspaceId, workspaceRootPath),
    getGenesisLyricSource(workspaceId, workspaceRootPath),
    getLyricsTranscriberSource(workspaceId, workspaceRootPath),
    getGoogleAdsSource(workspaceId, workspaceRootPath),
    getAdsOperatorSource(workspaceId, workspaceRootPath),
    getGoogleCalendarSource(workspaceId, workspaceRootPath),
    getGmailSource(workspaceId, workspaceRootPath),
    getGoogleDriveSource(workspaceId, workspaceRootPath),
    getMetaAdsSource(workspaceId, workspaceRootPath),
    getTryPostSource(workspaceId, workspaceRootPath),
    getPostizSource(workspaceId, workspaceRootPath),
    getNotebookLmSource(workspaceId, workspaceRootPath),
    getYouTubeResearchSource(workspaceId, workspaceRootPath),
    getYouTubeIntelligenceSource(workspaceId, workspaceRootPath),
    getOpenSlideSource(workspaceId, workspaceRootPath),
    getZeroSource(workspaceId, workspaceRootPath),
    getMediaGenerationSource(workspaceId, workspaceRootPath),
    getShopifySource(workspaceId, workspaceRootPath),
    getPrintifySource(workspaceId, workspaceRootPath),
  ];
}

/**
 * Built-in source for the local BackgroundComputerUse runtime.
 *
 * It is globally available as a project source, but it only becomes part of a
 * session when an agent/session explicitly enables the `computer-use` source.
 */
export function getComputerUseSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const cuaDriverPath = getCuaDriverMcpPath();
  const copilotComputerUsePath = getCopilotComputerUseMcpPath();
  const computerUseScriptPath = getComputerUseScriptPath();
  const selection = selectComputerUseProvider({
    cuaDriverPath,
    cuaDriverStartable: Boolean(cuaDriverPath && canStartCuaDriver(cuaDriverPath)),
    cuaDriverFromOverride: Boolean(process.env.CRAFT_CUA_DRIVER_MCP?.trim()),
    copilotPath: copilotComputerUsePath,
    vendoredScriptPath: existsSync(computerUseScriptPath) ? computerUseScriptPath : null,
    bunCommand: process.env.CRAFT_BUN || 'bun',
  });
  console.info(`[Computer Use] provider=${selection.provider}; ${selection.reason}`);
  const workflowGuide = getComputerUseWorkflowGuide(selection.provider);
  const config: FolderSourceConfig = {
    id: 'builtin-computer-use',
    name: 'Computer Use',
    slug: COMPUTER_USE_SLUG,
    enabled: true,
    provider: selection.provider,
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: selection.command,
      args: selection.args,
      authType: 'none',
    },
    tagline: 'Inspect and control local macOS app windows with screenshot-backed tools.',
    icon: '🖥️',
    isAuthenticated: selection.available,
    connectionStatus: selection.available ? 'connected' : 'failed',
    connectionError: selection.available
      ? undefined
      : 'No runnable computer-use provider was found. Install cua-driver or repair the bundled runtime.',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Computer Use',
        '',
        'Use this source when the user explicitly wants a local desktop app controlled or inspected.',
        '',
        ...workflowGuide,
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

export function getComputerUseWorkflowGuide(
  provider: ComputerUseProvider,
): string[] {
  if (provider === 'cua-driver') {
    return [
      'Workflow:',
      '1. Call `health_report` first. Proceed only when Accessibility, Screen Recording, accessibility capability, and screen-capture capability pass; otherwise relay the reported remedy and stop.',
      '2. Call `list_apps` and `list_windows` to resolve the exact target process and window.',
      '3. Call `get_window_state` before every meaningful UI action and ground on both its structured elements and screenshot.',
      '4. Prefer the observed `element_token`. Use `click`, `type_text`, `set_value`, `press_key`, `hotkey`, `scroll`, `drag`, `invoke_menu`, or `set_window_frame` only when the observed state supports it.',
      '5. Ask the user before submit, send, purchase, delete, credential entry, system settings changes, or any irreversible action.',
      '6. After an action, use `verify_state` when the expected result is expressible; otherwise call `get_window_state` again. If success was reported but the expected change did not happen, stop and tell the user — do not retry the same action.',
      '7. The MCP transport owns an implicit lifecycle session. Do not create extra sessions for ordinary work.',
    ];
  }

  return provider === 'copilot-computer-use'
    ? [
        'Workflow:',
        '1. Call `list_apps` to confirm the target app is available.',
        '2. Call `get_window_state` before every meaningful UI action.',
        '3. Prefer element indexes from the observed accessibility tree. Use coordinates only when needed.',
        '4. Use `click`, `set_text`, `insert_text`, `type_chars`, `key_chord`, `scroll`, `drag`, `select_option`, or `secondary_action` based on the observed state.',
        '5. Ask the user before submit, send, purchase, delete, credential entry, system settings changes, or any irreversible action.',
        '6. After an action, call `get_window_state` again. If the action reported success but the expected change did not happen, stop and tell the user — do not retry the same action.',
      ]
    : [
        'Workflow:',
        '1. Call `computer_use_status` first. Only proceed when it reports state "ready". If it reports "degraded" or "unavailable", relay its remedy to the user and stop — a degraded runtime can accept actions and silently do nothing.',
        '2. Call `computer_use_list_apps` and `computer_use_list_windows` to find the target.',
        '3. Call `computer_use_observe_window` before every meaningful UI action.',
        '4. Prefer semantic targets from the observed accessibility tree. Use coordinates only when needed.',
        '5. Ask the user before submit, send, purchase, delete, credential entry, or any irreversible action.',
        '6. After an action, observe again. If the action reported success but the expected change did not happen, stop and tell the user — do not retry the same action.',
      ];
}

/**
 * Built-in source for Field Theory local X/Twitter bookmarks and Library notes.
 *
 * This source intentionally exposes read/search tools only. Sync, auth,
 * mutation, and Library write operations stay out of the agent tool surface.
 */
export function getFieldTheorySource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-field-theory',
    name: 'Field Theory',
    slug: FIELD_THEORY_SLUG,
    enabled: true,
    provider: 'field-theory',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: process.env.CRAFT_BUN || 'bun',
      args: ['run', getFieldTheoryScriptPath()],
      authType: 'none',
    },
    tagline: 'Search local X/Twitter bookmarks, Library notes, and portable commands.',
    icon: '🔖',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Field Theory',
        '',
        'Use this source when the user mentions Field Theory, X/Twitter bookmarks, saved tweets, Library notes, or portable commands.',
        '',
        'Use read-only tools only:',
        '- `field_theory_status` and `field_theory_stats` for setup and archive overview.',
        '- `field_theory_search_bookmarks`, `field_theory_list_bookmarks`, and `field_theory_show_bookmark` for saved X/Twitter posts.',
        '- `field_theory_search_library` and `field_theory_show_library_page` for durable local notes.',
        '- `field_theory_list_commands` and `field_theory_show_command` for portable command context.',
        '',
        'Do not dump raw results. Summarize findings and connect them to the user’s current task.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for bundled direct-browser social media CLIs.
 *
 * This is intentionally a local CLI source, not MCP/API. Live account setup
 * still belongs to the user because Instagram/TikTok/X/YouTube sessions cannot
 * be pre-shipped.
 */
export function getPrintingPressSocialSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getPrintingPressSocialPath();
  const config: FolderSourceConfig = {
    id: 'builtin-printing-press-social',
    name: 'Printing Press Social',
    slug: PRINTING_PRESS_SOCIAL_SLUG,
    enabled: true,
    provider: 'printing-press-clis',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Direct-browser CLIs for Instagram, TikTok, X, YouTube, and Spotify for Artists analytics.',
    icon: '📣',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Printing Press Social tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Printing Press Social',
        '',
        'Use this source for agent-operated social channel work through the bundled local CLI harness.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node src/social.mjs catalog --json` before channel work to resolve account sets and exact `platform/profile` refs.',
        '3. Run `node src/social.mjs doctor --live --json` before claiming a profile is ready.',
        '4. For Spotify analytics, resolve the exact profile, run `node src/social.mjs profile status spotify --profile <profile> --live --json`, then run `node src/social.mjs snapshot spotify --profile <profile> --json` and complete its read-only Spotify for Artists browser plan.',
        '5. Resolve the exact account first. Users can name account sets like `MikeyReal` or profiles as `platform/profile`, such as `instagram/brand-main`; do not guess when multiple profiles exist.',
        '6. If campaign folders are involved, list assets with `node src/social.mjs assets --asset-root <dir> --platform <platform> --json` and text with `node src/social.mjs content --content-root <dir> --json`.',
        '7. Default engine is `runner-cdp`: save dry-run JSON as the action contract, then run `node src/social.mjs execute --action-file <dry-run-result.json> --expected-action-id <act_...> --confirm yes --json` after explicit approval. Spotify playlist dry-runs also require their exact `--expected-action-digest <sha256:...>`.',
        '8. Treat `browserPlan.accountVerification` as mandatory before submit; `social execute` rejects handoffs without a known expected handle or account URL.',
        '9. Dry-run posts, comments, DMs, and Spotify playlist creation with the selected profile and exact payload before live execution. Use `playlist spotify create` for Spotify; never treat a delegated browser plan as completion.',
        '10. Use the returned `RUNNER_CDP_DELEGATED` browser plan with Runner native browser tools. If the visible account and draft match the approved dry-run, submit without asking again; stop only on mismatch, ambiguity, unexpected platform choices, or upload/UI failure. After Spotify visibly creates a playlist, finalize `playlist spotify receipt` with its observed URL and fresh matching-account evidence.',
        '',
        'Supported platforms: instagram, tiktok, x, youtube, spotify. Spotify includes read-only Spotify for Artists analytics snapshots plus approval-gated playlist work.',
        'Do not use Computer Use for these flows unless the user explicitly asks. Prefer Runner browser/CDP tools; Playwright is fallback-only.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the managed Hypermotion wrapper.
 *
 * This is a local CLI source that gives agents a portable path to the bundled
 * HyperFrames/Remotion toolchain in dev and packaged Electron builds.
 */
export function getHypermotionSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getHypermotionPath();
  const config: FolderSourceConfig = {
    id: 'builtin-hypermotion',
    name: 'Hypermotion',
    slug: HYPERMOTION_SLUG,
    enabled: true,
    provider: 'hypermotion',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Managed HyperFrames and Remotion CLI wrapper for motion/video artifacts.',
    icon: '🎬',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Hypermotion tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Hypermotion',
        '',
        'Use this source for motion graphics, HyperFrames HTML/GSAP compositions, Remotion/React video, and Canvas-ready MP4 artifacts.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the tool directory.',
        '2. Run `node bin/hypermotion.mjs doctor` before production work.',
        '3. Create isolated project folders with `node bin/hypermotion.mjs init <workspace-local-dir> --engine hyperframes|remotion`.',
        '4. Render with `node bin/hypermotion.mjs render <dir> --engine hyperframes|remotion --out out/<name>.mp4`.',
        '5. Publish generated HTML previews, poster frames, MP4s, and receipts as Canvas-visible outputs when useful.',
        '',
        'Do not claim a render succeeded until the output file exists. Confirm before paid API/provider calls or long renders.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the managed Lottie animation wrapper.
 *
 * This is a local CLI source that gives agents a portable path to the bundled
 * diffusionstudio/lottie player harness in dev and packaged Electron builds.
 */
export function getLottieSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getLottiePath();
  const config: FolderSourceConfig = {
    id: 'builtin-lottie',
    name: 'Lottie',
    slug: LOTTIE_SLUG,
    enabled: true,
    provider: 'diffusionstudio-lottie',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Bundled local CLI wrapper for official diffusionstudio/lottie Skia player projects.',
    icon: '🎞️',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Lottie tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Lottie',
        '',
        'Use this source to create, preview, and validate production-ready Lottie JSON animations through the official diffusionstudio/lottie Skia player harness.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the tool directory.',
        '2. Run `node bin/lottie.mjs doctor` before production work.',
        '3. Create isolated player projects with `node bin/lottie.mjs init <workspace-local-dir>`.',
        '4. Write the animation to `<project-dir>/public/lottie.json` and optional controls to `<project-dir>/public/controls.json`.',
        '5. Validate with `node bin/lottie.mjs validate <project-dir>`.',
        '6. Preview with `node bin/lottie.mjs dev <project-dir> -- --host 127.0.0.1 --port 5173`.',
        '',
        'Do not hand-roll a custom viewer or switch to lottie-web as the verification source of truth. No API key is required.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the RunnerOS Video Studio project/renderer wrapper.
 *
 * This is a local CLI source that gives agents a portable path to the bundled
 * Video Studio project tools in dev and packaged Electron builds.
 */
export function getVideoStudioSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getVideoStudioPath();
  const config: FolderSourceConfig = {
    id: 'builtin-video-studio',
    name: 'Video Studio',
    slug: VIDEO_STUDIO_SLUG,
    enabled: true,
    provider: 'runner-video-studio',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Bundled local CLI wrapper for RunnerOS video projects and simple MP4 exports.',
    icon: '🎞️',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Video Studio tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Video Studio',
        '',
        'Use this source for native RunnerOS video project files, media registration, timeline JSON edits, validation, simple MP4 exports, and placeholder receipts.',
        '',
        'Workflow:',
        '1. Use session tools like `video_project_create`, `video_media_import`, `video_clip_add`, and `video_export` for agent edits.',
        '2. Use the displayed local path as the CLI tool directory when direct doctor/validation commands are needed.',
        '3. Run `node bin/video-studio.mjs doctor --json` before production work.',
        '4. Run `node bin/video-studio.mjs validate <project-path> --json` before claiming a project is structurally sound.',
        '5. Run `node bin/video-studio.mjs inspect <project-path> --json` to catch gaps, overlaps, missing files, and simple-render limits.',
        '6. Run `node bin/video-studio.mjs dry-run <project-path> --json` before export when the user expects a real MP4.',
        '7. Use `node bin/video-studio.mjs edit <project-path> --action pack|split|delete|duplicate ... --json` for deterministic timeline edits.',
        '8. `node bin/video-studio.mjs export` can render video, image, audio, and text clips. SVG/Lottie/HTML clips fail loudly until the fuller renderer lands.',
        '',
        'Do not use Computer Use to click a video editor UI unless the user explicitly asks. The project JSON is the source of truth.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for deterministic raw footage editing.
 */
export function getRawVideoEditorSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getRawVideoEditorPath();
  const config: FolderSourceConfig = {
    id: 'builtin-raw-video-editor',
    name: 'Raw Video Editor',
    slug: RAW_VIDEO_EDITOR_SLUG,
    enabled: true,
    provider: 'runner-raw-video-editor',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Bundled local CLI for editing footage and creating rights-cleared social variants.',
    icon: '🎞️',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Raw Video Editor tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Raw Video Editor',
        '',
        'Use this source for editing existing raw footage into rendered MP4 cuts. Do not use it for AI-generated video production.',
        '',
        'Workflow:',
        '1. Run `node bin/raw-video-editor.mjs doctor --json` to verify FFmpeg readiness.',
        '2. Run `node bin/raw-video-editor.mjs inspect <footage-dir> --json` to write `edit/inventory.json` and `edit/takes_packed.md`.',
        '3. Run `node bin/raw-video-editor.mjs transcribe <footage-dir> --model base --json` when speech-accurate cuts matter.',
        '4. Run `node bin/raw-video-editor.mjs plan <footage-dir> --max-duration 45 --aspect 9:16 --json` to write `edit/edl.json`.',
        '5. Run `node bin/raw-video-editor.mjs render <footage-dir> --out <footage-dir>/edit/preview.mp4 --json` to render a preview.',
        '6. For performance footage with faint song playback, run `node bin/raw-video-editor.mjs sync-master <camera-video> <master-audio> --analyze-only --json`, then render only when the confidence gate passes.',
        '7. For an approved final, run `node bin/raw-video-editor.mjs repurpose <source-video> --out-dir <working-output-dir> --json`, discuss the generated plans, then validate an approved brief before adding `--render`.',
        '8. Reject cosmetic-only variants. Trial is only a destination mode when explicitly requested; this tool never publishes.',
        '9. Review `edit/render-report.json`, the master-sync report, or `variant-manifest.json` before claiming the edit is done.',
        '',
        'The tool preserves source media. All generated files live under `<footage-dir>/edit/`.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the RunnerOS-owned Squad video workflow fork.
 */
export function getSquadSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getSquadPath();
  const config: FolderSourceConfig = {
    id: 'builtin-squad',
    name: 'Squad',
    slug: SQUAD_SLUG,
    enabled: true,
    provider: 'runneros-squad',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Bundled app-owned fork of Squad storyboarding and modular video production workflows.',
    icon: '🎥',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Squad tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Squad',
        '',
        'Use this source for no-spend storyboards, recipe recommendations, production preflight, and approval-gated video planning through RunnerOS’s bundled Squad fork.',
        '',
        'Core commands:',
        '1. `node bin/squad.mjs doctor --json` to verify the bundled fork, Python runtime, and provider state. `storyboard_ready`, `modular_orchestration_ready`, and `native_production_ready` are separate capabilities.',
        '2. `node bin/squad.mjs recipe --brief-file <brief.json> --json` to pick the best workflow lane.',
        '3. `node bin/squad.mjs storyboard --brief-file <brief.json> --json` for a no-spend board.',
        '4. `node bin/squad.mjs preflight --brief-file <brief.json> --provider-mode auto --json` before any production run.',
        '5. `node bin/squad.mjs run --brief-file <brief.json> --approved --budget-cap-usd 1.00 --provider-mode auto --json` only after explicit approval.',
        '',
        'Provider modes:',
        '- `auto`: use normal Squad/OpenAI director workflows when configured; otherwise route through modular provider planning.',
        '- `openai`: require the upstream OpenAI director path.',
        '- `modular`: create an orchestration plan for agents to inject shot plans, prompts, generated stills/clips, or selected providers such as WaveSpeed, Fal, Replicate, Zero, HeyGen, MuAPI, or RunPod. It does not claim the wrapper generated those assets.',
        '- `external`: require user/agent supplied assets before final assembly/review.',
        '',
        'This fork keeps Squad workflows available without mutating the external `/Users/michaelb.williams/CAS4/Squad` project.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the RunnerOS-owned Genesis lyric-video engine fork.
 */
export function getGenesisLyricSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getGenesisLyricPath();
  const config: FolderSourceConfig = {
    id: 'builtin-genesis-lyric',
    name: 'Genesis Lyric',
    slug: GENESIS_LYRIC_SLUG,
    enabled: true,
    provider: 'runneros-genesis-lyric',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Bundled single-video lyric clip engine from Genesis: storyboard planning, audio, lyrics, image refs, captions, and FFmpeg assembly.',
    icon: '🎙️',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Genesis lyric tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Genesis Lyric',
        '',
        'Use this source for one-off lyric videos, captioned song teasers, TikTok/Reels/Shorts lyric clips, and lyric-first audio-drop videos from existing or generated visuals.',
        '',
        'Core commands:',
        '1. `node bin/genesis-lyric.mjs doctor --json` to verify FFmpeg, the vendored Genesis engine, and Creative Director assets.',
        '2. `node bin/genesis-lyric.mjs storyboard --brief-file <brief.json> --json` for no-spend Genesis Creative Director asset stack plus Motion Director shot planning.',
        '3. `node bin/genesis-lyric.mjs plan --brief-file <brief.json> --json` to normalize lyrics into a single-video plan.',
        '4. `node bin/genesis-lyric.mjs preflight --brief-file <brief.json> --json` before rendering.',
        '5. `node bin/genesis-lyric.mjs render --brief-file <brief.json> --approved --json` only after explicit approval.',
        '',
        '`storyboard` can run before a visual exists. It applies vendored Genesis Creative Director prompt doctrine, seed primitives, knowledge libraries, negative prompts, and motion compiler modules without provider spend. Rendering must provide `lyrics` or timed `lyric_lines`, plus one visual source as `video_file` or `image_file`. The visual can be user footage, user artwork, or an asset generated by another tool from the storyboard prompts. Supported aspect ratios: `9:16`, `1:1`, `16:9`.',
        '',
        'Silent Spotify Canvas loops without lyric text belong in the Spotify Canvas/Hypermotion lane, not this source.',
        '',
        'This source is single-video only. Do not use it for Genesis campaign planning, 20-day content batches, worker loops, portal/API operations, or auto-posting.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for local song/master audio transcription.
 */
export function getLyricsTranscriberSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getLyricsTranscriberPath();
  const config: FolderSourceConfig = {
    id: 'builtin-lyrics-transcriber',
    name: 'Lyrics Transcriber',
    slug: LYRICS_TRANSCRIBER_SLUG,
    enabled: true,
    provider: 'runneros-lyrics-transcriber',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Local whisper.cpp wrapper for song audio transcription, timed lyrics, and Vault/Lyric Video handoff.',
    icon: '📝',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled lyrics transcriber tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Lyrics Transcriber',
        '',
        'Use this source to transcribe song/master audio into review-needed `lyrics_text` and `lyric_lines` for Vault and Lyric Video workflows.',
        '',
        'Core commands:',
        '1. `node bin/lyrics-transcriber.mjs doctor --json` to verify `whisper-cli`, FFmpeg, and the selected model.',
        '2. `node bin/lyrics-transcriber.mjs install-model --model base.en --json` to download a whisper.cpp model into `~/.runneros/whisper/models`.',
        '3. `node bin/lyrics-transcriber.mjs transcribe --audio-file <audio> --model base.en --out-dir <dir> --json` to write `transcript.json` and `lyrics.txt`.',
        '',
        'The transcriber accepts common song/master audio files, converts them through FFmpeg, and returns timed lyric lines. Sung lyrics can be misheard, so keep `review_required` true until the user confirms the transcript.',
        '',
        'When the user has a master audio file stored in Vault and does not provide another audio file, use that master audio as the default transcription source.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

export function getGoogleCalendarSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-google-calendar',
    name: 'Google Calendar',
    slug: GOOGLE_CALENDAR_SLUG,
    enabled: true,
    provider: 'google',
    type: 'api',
    api: {
      baseUrl: 'https://www.googleapis.com/calendar/v3',
      authType: 'oauth',
      googleService: 'calendar',
      googleScopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      testEndpoint: {
        method: 'GET',
        path: '/calendars/primary/events?maxResults=1',
      },
    },
    tagline: 'Sync Artist HQ dates, deadlines, meetings, releases, and reminders to Google Calendar.',
    icon: '📅',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Google Calendar',
        '',
        'Use this source for Artist HQ calendar sync and approval-gated calendar event updates.',
        '',
        'Rules:',
        '- Calendar writes must come from explicit user actions like Sync Google Calendar.',
        '- Use calendar.events scope, not full calendar access.',
        '- Store returned Google event IDs back on the Artist Calendar context doc.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

export function getGmailSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-gmail',
    name: 'Gmail',
    slug: GMAIL_SLUG,
    enabled: true,
    provider: 'google',
    type: 'api',
    api: {
      baseUrl: 'https://gmail.googleapis.com/gmail/v1',
      authType: 'oauth',
      googleService: 'gmail',
      googleScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
      ],
    },
    tagline: 'Draft artist outreach, inspect requested threads, and prepare approval-gated fan or partner emails.',
    icon: '✉️',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Gmail',
        '',
        'Use this source for drafting emails and reading specific user-requested threads.',
        '',
        'Rules:',
        '- Do not send email without explicit approval.',
        '- Prefer drafts over sends.',
        '- Read only messages or threads the user deliberately requests.',
        '- Message/thread lists require _intent and maxResults from 1 to 25; bulk inbox crawling is disabled.',
        '- Sending always triggers a host approval for the exact recipient and message, even in Execute mode.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

export function getGoogleDriveSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-google-drive',
    name: 'Google Drive',
    slug: GOOGLE_DRIVE_SLUG,
    enabled: true,
    provider: 'google',
    type: 'api',
    api: {
      baseUrl: 'https://www.googleapis.com/drive/v3',
      authType: 'oauth',
      googleService: 'drive',
      googleScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      testEndpoint: {
        method: 'GET',
        path: '/files?pageSize=1&fields=files(id,name,mimeType)',
      },
    },
    tagline: 'Attach selected Drive files and folders as workspace context without granting full-drive access.',
    icon: '🗂️',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Google Drive',
        '',
        'Use this source for selected Drive file and folder context.',
        '',
        'Rules:',
        '- Prefer file picker / selected files over broad Drive scans.',
        '- Use drive.file and metadata scopes first.',
        '- Do not treat Drive as a default raw dump for agents.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the bundled Google Ads CLI wrapper.
 *
 * The wrapper resolves the packaged google-ads-pp-cli binary from app
 * resources, so agents do not depend on a developer-machine global install.
 */
export function getGoogleAdsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getGoogleAdsPath();
  const authState = getGoogleAdsCachedAuthState();
  const isAuthenticated = authState.configured && !authState.expired;
  const config: FolderSourceConfig = {
    id: 'builtin-google-ads',
    name: 'Google Ads',
    slug: GOOGLE_ADS_SLUG,
    enabled: true,
    provider: 'google',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://googleads.googleapis.com',
      authType: 'oauth',
      googleScopes: [
        'https://www.googleapis.com/auth/adwords',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    },
    tagline: 'Bundled Google Ads CLI for account discovery, GAQL reporting, diagnostics, and approval-gated operations.',
    icon: 'G',
    isAuthenticated,
    connectionStatus: !existsSync(toolPath) ? 'failed' : isAuthenticated ? 'connected' : 'needs_auth',
    connectionError: !existsSync(toolPath)
      ? 'Bundled Google Ads tool folder not found'
      : authState.expired
        ? 'Google Ads OAuth token is expired. Reconnect Google Ads.'
        : undefined,
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Google Ads',
        '',
        'Use this source for Google Ads account discovery, GAQL reporting, field lookup, diagnostics, and planning through the bundled local CLI wrapper.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node bin/google-ads.mjs doctor --agent` before account work.',
        '3. Run `node bin/google-ads.mjs auth status --agent` to check auth.',
        '4. Use read-only commands first: `customers list-accessible-customers`, `google-ads-fields search`, and `customers-google-ads search`.',
        '5. Use real hyphenated command names. Convert any upstream underscore examples to hyphen form before executing.',
        '6. Ask for explicit approval before any live mutation to campaigns, budgets, keywords, audiences, conversions, billing, or status.',
        '',
        'Google Ads API auth is separate from Meta Ads auth. Configure API/OAuth access in Settings > Services. For browser fallback, run `browser_tool accounts` and attach the exact saved Google dashboard profile from Settings > Ad Accounts with `browser_tool account google-ads <profile>`.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the local Ads Operator helper.
 *
 * This is intentionally read-only. It normalizes exports, plans routes, and
 * creates approval packets, but it never applies ad-account changes.
 */
export function getAdsOperatorSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getAdsOperatorPath();
  const isReady = existsSync(toolPath);
  const config: FolderSourceConfig = {
    id: 'builtin-ads-operator',
    name: 'Ads Operator',
    slug: ADS_OPERATOR_SLUG,
    enabled: true,
    provider: 'runneros',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Read-only paid ads helper for CSV normalization, route planning, and approval packets.',
    icon: 'A',
    isAuthenticated: isReady,
    connectionStatus: isReady ? 'connected' : 'failed',
    connectionError: isReady ? undefined : 'Bundled Ads Operator tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Ads Operator',
        '',
        'Use this source for paid ads export normalization, local route planning, and approval packet creation.',
        '',
        'Workflow:',
        '1. Run `node tools/ads-operator/bin/ads-operator.mjs doctor --json` from the repo/workspace root before operator work.',
        '2. Use `accounts`, `campaigns`, `export-plan`, `audit`, `campaign-plan`, and `setup-plan` for read-only planning.',
        '3. Use `import <file.csv> --platform meta|google|spotify --level campaign|adset|adgroup|ad|keyword --json` to normalize user exports.',
        '4. Use `audit <file.csv|import.json> --platform meta|google|spotify --level ... --goal ... --json` after import to identify obvious waste and cleanup candidates.',
        '5. Use `campaign-plan --platform meta|google|spotify --goal ... --artist-context <file> --territories "..." --budget "..." --json` to draft campaign structure from artist context before any live creation.',
        '6. Use `setup-plan --platform meta|spotify --goal ... --artist-context <file> --territories "..." --budget "..." --campaign-name "..." --json` before browser-guided Meta or Spotify Ads Manager draft setup.',
        '7. Use `packet create --platform meta|google|spotify --type publish|budget|status|targeting|creative --out packet.json --json` before final publish/spend or any live change.',
        '8. Use `receipt create --packet packet.json --status approved|rejected|skipped --out receipt.json --json` to record the approval outcome.',
        '9. Treat packets and receipts as artifacts only. This tool must not publish, pause, change budgets, update targeting, upload creative, or apply recommendations.',
        '10. For Meta or Google dashboard work, run `browser_tool accounts` and attach the exact saved profile from Settings > Ad Accounts. For Spotify, attach the exact saved Spotify profile from Settings > Spotify before navigation.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for Meta's hosted Ads MCP beta.
 */
export function getMetaAdsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-meta-ads',
    name: 'Meta Ads',
    slug: META_ADS_SLUG,
    enabled: true,
    provider: 'meta',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://mcp.facebook.com/ads',
      authType: 'oauth',
    },
    tagline: "Manage and inspect Meta Ads accounts through Meta's official Ads MCP beta.",
    icon: '📣',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Meta Ads',
        '',
        "This source connects RunnerOS to Meta's hosted Ads MCP beta at `https://mcp.facebook.com/ads`.",
        '',
        'Use it for Meta account discovery, campaign/ad set/ad inspection, reporting, insights, diagnostics, previews, and supported operations.',
        '',
        'Rules:',
        '- Start with read-only discovery.',
        '- Treat campaign, budget, catalog, creative, and status changes as externally visible ad-account actions.',
        '- Before any write action, show the exact planned change and ask for explicit confirmation.',
        '- If Meta returns an eligibility or rollout error, report that Meta has not enabled Ads MCP for that Business yet.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for TryPost's official hosted social-publishing MCP.
 */
export function getTryPostSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-trypost',
    name: 'TryPost',
    slug: TRYPOST_SLUG,
    enabled: true,
    provider: 'trypost',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://app.trypost.it/mcp/trypost',
      authType: 'bearer',
    },
    tagline: "Draft, schedule, and publish social posts across 14 platform connections through TryPost's official MCP.",
    icon: '📮',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# TryPost',
        '',
        "This source connects RunnerOS to TryPost's official hosted MCP at `https://app.trypost.it/mcp/trypost`.",
        '',
        'Auth:',
        '- Connect the source and paste a TryPost Personal Access Token (create one in TryPost Settings > API Keys). RunnerOS stores it per source and sends it as `Authorization: Bearer`; the same token works for the REST API.',
        '- Enter the token on the TryPost source connection dialog, not the global Secrets page. RunnerOS keeps it in the source credential store and reuses it across every session — the user connects once.',
        '- TryPost Cloud accounts need an active trial or subscription (HTTP 402 means no active plan). Self-hosted instances skip this check.',
        '',
        'Tools cover: posts (list, get, create, update, publish, delete, attach media from URL or upload, preview, get metrics), platforms (list content types and per-platform limits), signatures, labels, social accounts (list, toggle), workspace, and API keys.',
        '',
        'Rules:',
        '- Start read-only: list connected social accounts and existing posts before creating anything.',
        '- Build a draft first, then use Preview to check per-platform length and format.',
        '- Treat create-with-publish, update-that-publishes, publish, and delete as live, externally visible actions that require explicit user approval in the current chat.',
        '- Never publish or schedule on an account the user did not name. Stop on any account or platform mismatch.',
        '- Do not claim a post published unless a TryPost tool receipt (post id and status) proves it.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/** Built-in source for Postiz's official hosted MCP. */
export function getPostizSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-postiz',
    name: 'Postiz',
    slug: POSTIZ_SLUG,
    enabled: true,
    provider: 'postiz',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://api.postiz.com/mcp',
      authType: 'bearer',
    },
    tagline: 'Draft, schedule, and publish through connected Postiz channels using the official MCP.',
    icon: '📬',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Postiz',
        '',
        "This source connects RunnerOS to Postiz's official hosted MCP at `https://api.postiz.com/mcp`.",
        '',
        'Auth:',
        '- Create an API key in Postiz Settings > Developers > Public API, then connect this source and paste the key. RunnerOS sends it as a Bearer token.',
        '- For self-hosted Postiz, create a custom MCP source pointed at `https://<your-backend>/mcp`; do not put a custom URL or key in workspace files.',
        '',
        'Tools cover connected integration discovery, platform-specific posting schemas, dynamic integration helpers, and draft/schedule/publish operations. Postiz MCP does not currently read or reply to comments or DMs.',
        '',
        'Rules:',
        '- Call integrationList first and resolve the exact connected account. Never guess an integration ID.',
        '- Call integrationSchema for every target platform before building the post. Reject unsupported media or missing required settings before any write.',
        '- Create a draft by default. Schedule, publish-now, delete, and media-generation actions require explicit user approval of the exact account, content, media, settings, and timing.',
        '- Do not claim success without the returned Postiz post ID/integration receipt.',
        '- Route comments and DMs to Social Publisher; Postiz MCP has no comment-reply tools.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the local NotebookLM MCP server.
 */
export function getNotebookLmSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-notebooklm',
    name: 'NotebookLM',
    slug: NOTEBOOKLM_SLUG,
    enabled: true,
    provider: 'notebooklm',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'notebooklm-mcp@2.0.0'],
      authType: 'none',
    },
    tagline: 'Query and manage Google NotebookLM notebooks through a local MCP browser automation server.',
    icon: '📓',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# NotebookLM',
        '',
        'Runs the local `notebooklm-mcp` server with `npx -y notebooklm-mcp@2.0.0`.',
        '',
        'Use this source for grounded NotebookLM queries against notebooks and uploaded sources.',
        '',
        'If Google authentication is missing or expired, run `nlm login` from the terminal and retry.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the bundled YouTube Research CLI wrapper.
 */
export function getYouTubeResearchSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getYouTubeResearchPath();
  const authState = getYouTubeResearchCachedAuthState();
  const config: FolderSourceConfig = {
    id: 'builtin-youtube-research',
    name: 'YouTube Research',
    slug: YOUTUBE_RESEARCH_SLUG,
    enabled: true,
    provider: 'youtube-data-api',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://www.googleapis.com/youtube/v3',
      authType: 'header',
      headerName: 'X-Goog-Api-Key',
    },
    tagline: 'Read-only YouTube search, transcripts, embeds, comments, related videos, and channel uploads.',
    icon: 'Y',
    isAuthenticated: authState.configured,
    connectionStatus: !existsSync(toolPath) ? 'failed' : authState.configured ? 'untested' : 'needs_auth',
    connectionError: existsSync(toolPath)
      ? authState.configured
        ? 'YouTube Data API key is saved but not validated. Run `node bin/youtube-research.mjs doctor` before research.'
        : undefined
      : 'Bundled YouTube Research tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# YouTube Research',
        '',
        'Use this source for read-only YouTube discovery and analysis through the bundled youtube-pp-cli wrapper.',
        '',
        'Workflow:',
        '1. Open Tools -> YouTube Research and save a YouTube Data API key.',
        '2. Run `node bin/youtube-research.mjs doctor` before research work.',
        '3. Use `--agent` for compact JSON and `--select` to keep output tight.',
        '4. Use Social Publisher instead for uploads, posting, or live comments.',
        '',
        'Core commands:',
        '- `node bin/youtube-research.mjs youtube search-list --q "<query>" --max-results 5 --agent`',
        '- `node bin/youtube-research.mjs youtube search-bulk "<query one>" "<query two>" --top 3 --agent`',
        '- `node bin/youtube-research.mjs youtube videos-transcript <videoId> --lang en --agent`',
        '- `node bin/youtube-research.mjs youtube videos-embed <videoId> --format markdown`',
        '- `node bin/youtube-research.mjs youtube videos-comments <videoId> --top 10 --agent`',
        '- `node bin/youtube-research.mjs youtube channel-uploads @handle --top 10 --agent`',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/** Built-in transcript packet and intelligence extraction pipeline. */
export function getYouTubeIntelligenceSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getYouTubeIntelligencePath();
  const researchPath = getYouTubeResearchPath();
  const toolReady = existsSync(toolPath);
  const transcriptProviderReady = existsSync(researchPath);
  const config: FolderSourceConfig = {
    id: 'builtin-youtube-intelligence',
    name: 'YouTube Intelligence',
    slug: YOUTUBE_INTELLIGENCE_SLUG,
    enabled: true,
    provider: 'runneros-youtube-intelligence',
    type: 'local',
    local: { path: toolPath, format: 'cli-tool' },
    tagline: 'Turns YouTube transcripts into timestamped intel, weekly reports, and agent context.',
    icon: 'Y',
    isAuthenticated: transcriptProviderReady,
    connectionStatus: !toolReady ? 'failed' : transcriptProviderReady ? 'untested' : 'needs_auth',
    connectionError: !toolReady
      ? 'Bundled YouTube Intelligence tool folder not found.'
      : transcriptProviderReady
        ? 'Uses the YouTube Data API key saved on YouTube Research. Run doctor before research.'
        : 'YouTube Intelligence needs the bundled YouTube Research source for transcript fetches.',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# YouTube Intelligence',
        '',
        'Turns trusted YouTube channels and transcripts into source-backed intelligence.',
        '',
        'This source reuses the YouTube Data API key saved on YouTube Research.',
        'Run `node bin/youtube-intelligence.mjs doctor` before research.',
        'Use `batch-prepare` for configured channel scans and `prepare` for one video.',
        'Default transcript order is cache first, then local YouTube Research.',
        'Never pass `--allow-paid` unless the user explicitly approves paid transcript credits.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the open-slide deck framework.
 *
 * Each workspace gets its own decks folder at `<workspaceRoot>/decks/`.
 * Decks are scaffolded on demand via `npx @open-slide/cli init <deck-id>`.
 * Once installed (per deck), the `open-slide` bin handles dev, build, and preview.
 *
 * No credentials, no API keys, no external services — entirely local OSS (MIT).
 */
export function getOpenSlideSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const decksPath = workspaceRootPath ? join(workspaceRootPath, 'decks') : 'decks';
  const exportToolPath = getOpenSlideExportPath();
  const exportToolReady = existsSync(exportToolPath);
  const config: FolderSourceConfig = {
    id: 'builtin-open-slide',
    name: 'Open Slide',
    slug: OPEN_SLIDE_SLUG,
    enabled: true,
    provider: 'open-slide',
    type: 'local',
    local: {
      path: decksPath,
      format: 'cli-tool',
    },
    tagline: 'React-based slide decks authored by the agent and exported to in-app HTML/PDF/PNG.',
    icon: '🎞️',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  const exportBin = join(exportToolPath, 'bin', 'export.mjs');

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: decksPath,
    config,
    guide: {
      raw: [
        '# Open Slide',
        '',
        'Use this source to create, edit, and export React-based slide decks (open-slide framework).',
        'Decks live per-workspace at `<workspace>/decks/<deck-id>/`. No API keys; pure local CLI.',
        '',
        '## Bundled export tool',
        '',
        `- Tool path: \`${exportToolPath}\``,
        `- Status: ${exportToolReady ? 'ready' : 'NOT FOUND — falling back to manual `open-slide build` only'}`,
        `- Health check: \`node "${exportBin}" doctor\``,
        '',
        'Always health-check before exporting:',
        '',
        '```bash',
        `node "${exportBin}" doctor`,
        '```',
        '',
        '## First-run setup (per deck)',
        '',
        '1. From `<workspace>/decks/`, scaffold a deck: `npx -y @open-slide/cli@latest init <deck-id> --name <deck-id>`.',
        '2. `cd <deck-id>` and install deps: `pnpm install` (or `npm install` if pnpm is unavailable).',
        '3. The deck is ready. Author slides at `slides/<page-id>/index.tsx`.',
        '',
        '## CLI inside a deck',
        '',
        '- `npx open-slide dev` — start the local dev server (default :5173).',
        '- `npx open-slide build --out-dir dist` — build a static site to `dist/`.',
        '- `npx open-slide preview` — preview the production build.',
        '',
        '## Export pipeline (canonical)',
        '',
        '1. `npx open-slide build --out-dir dist` (inside the deck folder).',
        `2. \`node "${exportBin}" export <deck-path> --format html|pdf|png\``,
        '   - `html` — returns `<deck>/dist/index.html` (already produced by `open-slide build`). Best for live in-app preview.',
        '   - `pdf` — produces `<deck>/dist/slides.pdf` (multi-page, 1920×1080) using bundled Playwright. Best for sharing.',
        '   - `png` — produces `<deck>/dist/png/slide-NNN.png` per slide. Best for thumbnails or social.',
        '3. Each command prints a JSON receipt with the absolute output path(s). Pass that path into `create_output` with `showInCanvas: true` to render in the Visual sidecar.',
        '',
        'PDF/PNG export requires Playwright and Chromium. If `doctor` reports playwright missing, the user must install it: `npm i -D playwright && npx playwright install chromium` (per deck).',
        '',
        '## Authoring rules (1920x1080 canvas)',
        '',
        '- Slides are `Page` components, default-exported as an array from `slides/<id>/index.tsx`.',
        '- Each slide renders into a fixed 1920x1080 canvas; the framework scales for the viewport.',
        '- Read the scaffolded `.claude/skills/slide-authoring/` reference before writing slide layouts.',
        '',
        '## In-app preview',
        '',
        'After every meaningful edit, run the export pipeline (`html` for fast iteration, `pdf` when finalizing) and publish the resulting file as a workspace Output with `showInCanvas: true`. The Visual sidecar renders HTML and PDF outputs inline. Re-export and re-publish to refresh the preview.',
        '',
        'For interactive editing, start `npx open-slide dev` and load `http://localhost:5173` in a browser surface; stop the dev server when authoring ends.',
        '',
        '## Hard rules',
        '',
        '- Never commit secrets, API keys, or analytics IDs into a deck.',
        '- Do not deploy/publish to external hosts (Vercel, Netlify, etc.) without explicit user approval of the target.',
        '- Keep deck folders flat under `<workspace>/decks/`; do not nest decks.',
        '- Never claim a build or export succeeded until the actual file exists on disk.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the Zero CLI capability marketplace.
 *
 * Zero is intentionally modeled as a local CLI source. Its live capability
 * catalog, payment rails, and schemas churn, so agents must search and inspect
 * at run time rather than relying on baked-in endpoint lists.
 */
export function getZeroSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const cliPath = getZeroCliPath();
  const cliInstalled = existsSync(cliPath);
  const config: FolderSourceConfig = {
    id: 'builtin-zero',
    name: 'Zero',
    slug: ZERO_SLUG,
    enabled: true,
    provider: 'zero',
    type: 'local',
    local: {
      path: cliPath,
      format: 'cli-tool',
    },
    tagline: 'Discover and call paid external API capabilities through the Zero CLI marketplace.',
    icon: '0',
    isAuthenticated: cliInstalled,
    connectionStatus: cliInstalled ? 'untested' : 'failed',
    connectionError: cliInstalled ? undefined : 'Zero CLI not found. Install with `npm i -g @zeroxyz/cli` or run the Zero install script.',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Zero',
        '',
        'Use this source when the user wants an external capability that RunnerOS does not provide natively: paid APIs, image generation, translation, weather/location data, audio/video processing, web scraping, enrichment, geolocation, restaurant/business lookup, currency conversion, market data, or other real-world retrieval.',
        '',
        'Canonical loop:',
        '1. Check setup: `command -v zero && zero --version`.',
        '2. If missing, ask the user before installing. Recommended install: `npm i -g @zeroxyz/cli`.',
        '3. Search narrowly every time: `zero search "<capability>" --agent anything-agent --limit 5 --status healthy --json`.',
        '4. Inspect finalists by exact slug: `zero get <exact-capability-slug> --agent anything-agent --formatted`.',
        '5. Skip results with `bodySchema: null`; do not invent parameters.',
        '6. Check the weekly allowance: `node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs status --json`.',
        '7. Fetch routine read-like results only through the guard: `node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs fetch --capability <exact-slug> --max-pay <usd> --read-only --json`.',
        '8. Review paid calls with `zero review <runId> --accuracy N --value N --reliability N --content "<specific observation>"`.',
        '',
        'Hard rules:',
        '- Never reuse stale capability URLs, schemas, or prices from memory.',
        '- Always inspect the exact capability slug before a paid call.',
        '- Never bypass the weekly guard during automatic work or retry a paid failure automatically.',
        '- A weekly allowance covers routine retrieval/generation only; external mutations still require exact current approval.',
        '- Use `--no-open` for funding URLs inside agents; hand the URL to the user.',
        '- Ask before funding wallets, installing CLIs, setting/changing the weekly allowance, or making external write/mutation calls.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for shared AI media generation providers.
 *
 * This is intentionally a provider-routing guide/source, not a Squad-only
 * connection. Art Director, Content Genius, Video Director, and future visual
 * agents can all use the same user-saved keys.
 */
export function getMediaGenerationSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const authState = getMediaGenerationAuthState();
  const config: FolderSourceConfig = {
    id: 'builtin-media-generation',
    name: 'Media Generation',
    slug: MEDIA_GENERATION_SLUG,
    enabled: true,
    provider: 'media-generation',
    type: 'local',
    local: {
      path: workspaceRootPath,
      format: 'provider-router',
    },
    tagline: 'Shared image, video, avatar, and render provider keys for creative agents.',
    icon: '✦',
    isAuthenticated: authState.configured,
    connectionStatus: authState.configured ? 'connected' : 'needs_auth',
    connectionError: authState.configured
      ? undefined
      : 'Add at least one media provider key in Settings: Fal, WaveSpeed, Replicate, HeyGen, MuAPI, or RunPod.',
  };

  const connected = authState.providers.length ? authState.providers.join(', ') : 'none';
  const { imageProvider, videoProvider, strategy } = authState.preferences;

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Media Generation',
        '',
        `Connected providers: ${connected}.`,
        `Default image provider: ${imageProvider}.`,
        `Default video provider: ${videoProvider}.`,
        `Generation priority: ${strategy}.`,
        '',
        'Use this source for AI image, video, avatar, and render generation after the user approves the creative brief and any spend.',
        '',
        'Environment keys used by this app:',
        '- `FAL_API_KEY` for Fal. Legacy alias: `SQUAD_FAL_API_KEY`.',
        '- `WAVESPEED_API_KEY` for WaveSpeed. Legacy alias: `SQUAD_WAVESPEED_API_KEY`.',
        '- `REPLICATE_API_TOKEN` for Replicate.',
        '- `HEYGEN_API_KEY` for HeyGen. Legacy alias: `SQUAD_HEYGEN_API_KEY`.',
        '- `MUAPI_API_KEY` for MuAPI.',
        '- `RUNPOD_API_KEY` and optional `RUNPOD_LTX_ENDPOINT_ID` for RunPod.',
        '- Optional routing preferences: `MEDIA_IMAGE_PROVIDER`, `MEDIA_VIDEO_PROVIDER`, and `MEDIA_PROVIDER_STRATEGY`.',
        '',
        'Provider auth facts:',
        '- Fal uses `Authorization: Key $FAL_API_KEY`.',
        '- Replicate uses `Authorization: Bearer $REPLICATE_API_TOKEN`.',
        '- WaveSpeed uses `Authorization: Bearer $WAVESPEED_API_KEY`.',
        '',
        'Routing rules:',
        '1. If the user names a provider, use that provider when it is connected and fit for the job.',
        '2. Otherwise use `MEDIA_IMAGE_PROVIDER` for image work and `MEDIA_VIDEO_PROVIDER` for video work when the selected provider is connected.',
        '3. If the selected default is `auto`, missing, or wrong for the job, choose by job fit and `MEDIA_PROVIDER_STRATEGY`: speed, quality, cost, or balanced.',
        '4. Do not spend or call paid generation until the user approves the exact brief.',
        '5. Never put secret values in chat, files, outputs, or logs. Reference env vars in commands.',
        '6. Use `media_provider_request` for approved Fal, Replicate, or WaveSpeed calls. Pass the provider path/model endpoint and exact JSON body.',
        '7. Save generated files locally, then publish user-facing results with `create_output` and `showInCanvas: true` when available.',
        '8. For artwork with typography, generate base art first, then finish layout/type through `artwork_compose`.',
        '9. If no connected provider fits the job, return a production-ready prompt/spec and name the missing key.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for Shopify Admin GraphQL operations.
 *
 * Reads can execute directly. Writes are routed through the bundled local
 * wrapper, which emits an approval packet unless `--confirm` is present.
 */
export function getShopifySource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getShopifyPath();
  const authState = getShopifyAuthState();
  const config: FolderSourceConfig = {
    id: 'builtin-shopify',
    name: 'Shopify',
    slug: SHOPIFY_SLUG,
    enabled: true,
    provider: 'shopify',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://admin.shopify.com',
      authType: 'header',
      headerName: 'X-Shopify-Access-Token',
    },
    tagline: 'Shopify Admin GraphQL reads and approval-gated product/store mutations.',
    icon: 'S',
    isAuthenticated: authState.configured,
    connectionStatus: !existsSync(toolPath) ? 'failed' : authState.configured ? 'untested' : 'needs_auth',
    connectionError: !existsSync(toolPath)
      ? 'Bundled Shopify tool folder not found'
      : authState.configured
        ? 'Shopify credentials are saved but not validated. Run `node bin/shopify.mjs doctor --agent` before store work.'
        : undefined,
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Shopify',
        '',
        'Use this source for Shopify store inspection, product work, inventory checks, order/customer read workflows, and approval-gated store mutations through the bundled local Admin GraphQL wrapper.',
        '',
        'Setup:',
        '1. Open Settings -> Secrets.',
        '2. Save `SHOPIFY_SHOP` or `SHOPIFY_STORE_DOMAIN`.',
        '3. Save `SHOPIFY_ACCESS_TOKEN` from a Shopify custom app.',
        '4. Optional: save `SHOPIFY_API_VERSION`; default is `2026-04`.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node bin/shopify.mjs doctor --agent` before store work.',
        '3. Start read-only: `products list`, `products get`, or a GraphQL query.',
        '4. Draft writes without `--confirm`; the wrapper returns an approval packet and makes no change.',
        '5. Only rerun with `--confirm` after explicit approval in the current conversation.',
        '',
        'Core commands:',
        '- `node bin/shopify.mjs products list --first 20 --agent`',
        '- `node bin/shopify.mjs products get <productId> --agent`',
        '- `node bin/shopify.mjs orders list --first 10 --agent`',
        '- `node bin/shopify.mjs collections list --first 20 --agent`',
        '- `node bin/shopify.mjs locations list --agent`',
        '- `node bin/shopify.mjs inventory items --query "sku:ABC" --agent`',
        '- `node bin/shopify.mjs products create --input <json-or-file> --agent`',
        '- `node bin/shopify.mjs products update <productId> --input <json-or-file> --agent`',
        '- `node bin/shopify.mjs collections create --input <json-or-file> --agent`',
        '- `node bin/shopify.mjs inventory adjust --input <json-or-file> --receipt <file> --agent`',
        '- `node bin/shopify.mjs graphql --query-file <file> --variables <json-or-file> --write --agent`',
        '',
        'Hard rules:',
        '- Never publish, delete, refund, fulfill, cancel, change inventory, or edit live products without explicit approval.',
        '- Product creation defaults to `DRAFT` unless the user explicitly approves another status.',
        '- For inventory changes on API `2026-04`, keep the approval packet idempotency key when rerunning with `--confirm`.',
        '- For proposed changes, show object id/name, current value, proposed value, reason, risk, and exact approval command.',
        '- Do not print access tokens or store secrets.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for Printify POD operations through Printing Press.
 *
 * The local wrapper resolves `printify-pp-cli`, injects RunnerOS secrets, and
 * permits only bounded private draft creation without approval; all other
 * writes must be dry-run previews or explicitly confirmed through RunnerOS.
 */
export function getPrintifySource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getPrintifyPath();
  const authState = getPrintifyAuthState();
  const toolFolderExists = existsSync(toolPath);
  const binaryPath = toolFolderExists ? getPrintifyBinaryPath(toolPath) : null;
  const config: FolderSourceConfig = {
    id: 'builtin-printify',
    name: 'Printify',
    slug: PRINTIFY_SLUG,
    enabled: true,
    provider: 'printify',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://api.printify.com/v1',
      authType: 'bearer',
    },
    tagline: 'Printing Press Printify CLI for catalog, private drafts, product proofing, and approval-gated public or consequential POD operations.',
    icon: 'P',
    isAuthenticated: authState.configured,
    connectionStatus: !toolFolderExists || !binaryPath ? 'failed' : authState.configured ? 'untested' : 'needs_auth',
    connectionError: !toolFolderExists
      ? 'Bundled Printify tool folder not found'
      : !binaryPath
        ? 'printify-pp-cli binary not found or not executable. Run `npx -y @mvanhorn/printing-press-library install printify --cli-only` or set PRINTIFY_PP_CLI.'
        : authState.configured
        ? 'Printify token is saved but not validated. Run `node bin/printify.mjs doctor --agent` before store work.'
        : undefined,
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Printify',
        '',
        'Use this source for Printify print-on-demand catalog research, artwork uploads, private product drafts, placement proofing, personalization audits, order checks, fulfillment risk, and guarded writes.',
        '',
        'Setup:',
        '1. Open Settings -> Secrets.',
        '2. Save `PRINTIFY_API_TOKEN` from Printify Connections / API settings.',
        '3. Install or bundle `printify-pp-cli` when missing: `npx -y @mvanhorn/printing-press-library install printify --cli-only`. RunnerOS also checks `~/.local/bin/printify-pp-cli` and `PRINTIFY_PP_CLI`.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node bin/printify.mjs doctor --agent` before account work.',
        '3. List shops first: `node bin/printify.mjs shops-json --agent --select id,title`.',
        '4. Use catalog, margin, placement, personalization, drift, and risk commands before writes.',
        '5. Use `--private-draft` only for accepted artwork uploads and one unpublished product creation.',
        '6. Use `--dry-run` for other write-capable provider previews.',
        '7. Only rerun with `--confirm-runner` after exact approval in the current conversation.',
        '',
        'Core commands:',
        '- `node bin/printify.mjs shops-json --agent --select id,title`',
        '- `node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent --select id,title`',
        '- `node bin/printify.mjs personalization-batch --template <template.json> --csv <rows.csv> --out <dir> --agent`',
        '- `node bin/printify.mjs placement-matrix --product-file <product.json> --uploads-file <uploads.json> --agent`',
        '- `node bin/printify.mjs product-drift --product-file <current.json> --manifest <manifest.json> --agent`',
        '- `node bin/printify.mjs fulfillment-risk --orders-file <orders.json> --products-file <products.json> --agent`',
        '- `node bin/printify.mjs uploads an-image ... --private-draft --agent`',
        '- `node bin/printify.mjs shops products-json create-anew-product ... --private-draft --agent`',
        '- `node bin/printify.mjs <write-command> --dry-run --agent`',
        '- `node bin/printify.mjs <write-command> --confirm-runner --agent`',
        '',
        'Hard rules:',
        '- Accepted artwork uploads and one unpublished product draft may run with `--private-draft`.',
        '- Never update, publish, sync, archive, or delete products; submit orders; purchase assets; manage shops; or manage webhooks without exact approval.',
        '- `--private-draft` never authorizes publishing or another mutation.',
        '- Prefer manifest-driven product creation and proofing commands over raw endpoint calls.',
        '- Use `--select` to keep large Printify responses tight.',
        '- Do not print access tokens, customer PII, or raw order exports unless needed.',
        '- Publish product plans, placement matrices, drift reports, fulfillment risk reports, and receipts as Canvas outputs when useful.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Get the built-in Runner docs source.
 *
 * @deprecated docs are now provided by an optional configured MCP server
 * configured directly in craft-agent.ts. This function is kept for
 * backwards compatibility but returns a placeholder.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-runner-docs',
    name: 'Runner Docs',
    slug: 'runner-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: process.env.RUNNER_DOCS_MCP_URL?.trim() || '',
      authType: 'none',
    },
    tagline: 'Search Runner documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

/**
 * Check if a source slug is a built-in source.
 *
 * @param slug - Source slug to check
 * @returns true when the slug is reserved by a built-in source
 */
export function isBuiltinSource(slug: string): boolean {
  return slug === COMPUTER_USE_SLUG
    || slug === FIELD_THEORY_SLUG
    || slug === PRINTING_PRESS_SOCIAL_SLUG
    || slug === HYPERMOTION_SLUG
    || slug === LOTTIE_SLUG
    || slug === VIDEO_STUDIO_SLUG
    || slug === RAW_VIDEO_EDITOR_SLUG
    || slug === SQUAD_SLUG
    || slug === GENESIS_LYRIC_SLUG
    || slug === LYRICS_TRANSCRIBER_SLUG
    || slug === GOOGLE_ADS_SLUG
    || slug === ADS_OPERATOR_SLUG
    || slug === GOOGLE_CALENDAR_SLUG
    || slug === GMAIL_SLUG
    || slug === GOOGLE_DRIVE_SLUG
    || slug === META_ADS_SLUG
    || slug === TRYPOST_SLUG
    || slug === POSTIZ_SLUG
    || slug === NOTEBOOKLM_SLUG
    || slug === YOUTUBE_RESEARCH_SLUG
    || slug === YOUTUBE_INTELLIGENCE_SLUG
    || slug === OPEN_SLIDE_SLUG
    || slug === ZERO_SLUG
    || slug === MEDIA_GENERATION_SLUG
    || slug === SHOPIFY_SLUG
    || slug === PRINTIFY_SLUG;
}
