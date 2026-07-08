import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type MediaProvider = 'fal' | 'replicate' | 'wavespeed';
export type MediaRequestMethod = 'GET' | 'POST';

export interface MediaProviderRequestInput {
  provider: MediaProvider;
  path: string;
  method?: MediaRequestMethod;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  downloadMedia?: boolean;
  outputDir?: string;
  fileNamePrefix?: string;
}

interface ProviderConfig {
  label: string;
  envNames: string[];
  authScheme: 'Key' | 'Bearer';
  baseUrl: string;
}

interface DownloadedAsset {
  url: string;
  path: string;
  contentType: string;
}

const PROVIDERS: Record<MediaProvider, ProviderConfig> = {
  fal: {
    label: 'Fal',
    envNames: ['FAL_API_KEY', 'SQUAD_FAL_API_KEY'],
    authScheme: 'Key',
    baseUrl: 'https://queue.fal.run',
  },
  replicate: {
    label: 'Replicate',
    envNames: ['REPLICATE_API_TOKEN'],
    authScheme: 'Bearer',
    baseUrl: 'https://api.replicate.com/v1',
  },
  wavespeed: {
    label: 'WaveSpeed',
    envNames: ['WAVESPEED_API_KEY', 'SQUAD_WAVESPEED_API_KEY'],
    authScheme: 'Bearer',
    baseUrl: 'https://api.wavespeed.ai/api/v3',
  },
};

function baseDir(ctx: SessionToolContext): string {
  return ctx.workingDirectory || ctx.workspacePath;
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveInside(base: string, pathValue: string): string | null {
  const resolved = isAbsolute(pathValue) ? resolve(pathValue) : resolve(base, pathValue);
  return isInside(base, resolved) ? resolved : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'media';
}

function getProviderKey(config: ProviderConfig): string | null {
  for (const name of config.envNames) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function isAllowedHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function resolveUrl(provider: MediaProvider, pathValue: string): string | null {
  try {
    if (/^https?:\/\//i.test(pathValue)) {
      const url = new URL(pathValue);
      const host = url.hostname.toLowerCase();
      if (provider === 'fal' && !isAllowedHost(host, 'fal.run') && !isAllowedHost(host, 'fal.ai')) return null;
      if (provider === 'replicate' && !isAllowedHost(host, 'replicate.com')) return null;
      if (provider === 'wavespeed' && !isAllowedHost(host, 'wavespeed.ai')) return null;
      return url.toString();
    }

    const clean = pathValue.replace(/^\/+/, '');
    if (!clean) return null;
    const base = PROVIDERS[provider].baseUrl.replace(/\/+$/, '');
    return `${base}/${clean}`;
  } catch {
    return null;
  }
}

function looksLikeMediaUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a)(?:$|\?)/.test(pathname)
      || /image|video|audio|file|asset|output|result|download/.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function collectMediaUrls(value: unknown, urls: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (looksLikeMediaUrl(value)) urls.add(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, urls);
    return urls;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectMediaUrls(item, urls);
  }
  return urls;
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('mp4')) return '.mp4';
  if (contentType.includes('quicktime')) return '.mov';
  if (contentType.includes('webm')) return '.webm';
  if (contentType.includes('mpeg')) return '.mp3';
  if (contentType.includes('wav')) return '.wav';
  return '.bin';
}

function extensionFromUrl(urlValue: string, contentType: string): string {
  try {
    const ext = extname(new URL(urlValue).pathname);
    if (ext && ext.length <= 8) return ext;
  } catch {
    // Fall through to content type.
  }
  return extensionFromContentType(contentType);
}

async function downloadAsset(url: string, outputDir: string, prefix: string, index: number): Promise<DownloadedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromUrl(url, contentType);
  const filePath = join(outputDir, `${prefix}-${String(index + 1).padStart(2, '0')}${ext}`);
  writeFileSync(filePath, buffer);
  return { url, path: filePath, contentType };
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 8000);
}

export async function handleMediaProviderRequest(ctx: SessionToolContext, args: MediaProviderRequestInput): Promise<ToolResult> {
  const providerConfig = PROVIDERS[args.provider];
  if (!providerConfig) return errorResponse('Unsupported media provider.');

  const key = getProviderKey(providerConfig);
  if (!key) {
    return errorResponse(`Missing ${providerConfig.label} key. Save one of: ${providerConfig.envNames.join(', ')}.`);
  }

  const url = resolveUrl(args.provider, args.path);
  if (!url) return errorResponse('Invalid provider path or URL.');

  const method = args.method || 'POST';
  const headers: Record<string, string> = {
    Authorization: `${providerConfig.authScheme} ${key}`,
    Accept: 'application/json',
    ...(args.headers || {}),
  };
  const init: RequestInit = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    init.body = JSON.stringify(args.body || {});
  }

  let parsed: unknown;
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      return errorResponse(`${providerConfig.label} request failed: HTTP ${response.status}\n${jsonPreview(parsed)}`);
    }
  } catch (error) {
    return errorResponse(`${providerConfig.label} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const mediaUrls = [...collectMediaUrls(parsed)];
  const downloaded: DownloadedAsset[] = [];
  if (args.downloadMedia !== false && mediaUrls.length > 0) {
    const root = baseDir(ctx);
    const outputDir = resolveInside(
      root,
      args.outputDir || join('.artifacts', 'media-generation', args.provider, randomUUID().slice(0, 8)),
    );
    if (!outputDir) return errorResponse('outputDir must stay inside the session working directory.');
    mkdirSync(outputDir, { recursive: true });
    const prefix = slugify(args.fileNamePrefix || basename(args.path) || args.provider);
    try {
      for (let index = 0; index < mediaUrls.length; index += 1) {
        downloaded.push(await downloadAsset(mediaUrls[index]!, outputDir, prefix, index));
      }
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error));
    }
  }

  const result = {
    provider: args.provider,
    url,
    mediaUrls,
    downloaded,
    response: parsed,
  };

  return {
    content: [{
      type: 'text',
      text: [
        `${providerConfig.label} request succeeded.`,
        downloaded.length ? `Downloaded files:\n${downloaded.map(asset => `- ${asset.path}`).join('\n')}` : 'No media files downloaded.',
        '',
        'Response:',
        jsonPreview(parsed),
      ].join('\n'),
    }],
    structuredContent: result,
    isError: false,
  };
}
