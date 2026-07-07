import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
export const TEXT_EXTENSIONS = new Set(['.txt', '.md']);
export const SUPPORTED_PLATFORMS = new Set(['instagram', 'tiktok', 'x', 'youtube']);

export function resolveText(flags = {}) {
  if (flags.title) {
    return {
      text: String(flags.title),
      source: { type: 'inline' },
    };
  }

  if (flags.text) {
    return {
      text: String(flags.text),
      source: { type: 'inline' },
    };
  }

  const textFile = flags['title-file'] || flags['text-file'] || flags['content-file'] || flags.caption;
  if (!textFile) return { text: '', source: null };

  const resolvedPath = resolveContentPath(textFile, flags);
  return {
    text: readTextFile(resolvedPath).trim(),
    source: {
      type: 'file',
      path: resolvedPath,
      root: resolveRoot(flags['content-root'] || process.env.SOCIAL_CONTENT_ROOT),
    },
  };
}

export function resolveDescription(flags = {}) {
  if (flags.description) return { text: String(flags.description), source: { type: 'inline' } };
  if (!flags['description-file']) return { text: '', source: null };

  const resolvedPath = resolveContentPath(flags['description-file'], flags);
  return {
    text: readTextFile(resolvedPath).trim(),
    source: {
      type: 'file',
      path: resolvedPath,
      root: resolveRoot(flags['content-root'] || process.env.SOCIAL_CONTENT_ROOT),
    },
  };
}

export function resolveMediaList(value, flags = {}) {
  const media = normalizeList(value).map((item) => resolveAssetPath(item, flags));
  return media;
}

export function buildContentContext(flags = {}, extras = {}) {
  return pruneNullish({
    assetRoot: resolveRoot(flags['asset-root'] || process.env.SOCIAL_ASSET_ROOT),
    contentRoot: resolveRoot(flags['content-root'] || process.env.SOCIAL_CONTENT_ROOT),
    textSource: extras.textSource || null,
    descriptionSource: extras.descriptionSource || null,
  });
}

export function listAssets({ assetRoot, platform } = {}) {
  const root = requireExistingDirectory(assetRoot || process.env.SOCIAL_ASSET_ROOT, 'asset root');
  const normalizedPlatform = normalizePlatform(platform);
  return walkFiles(root)
    .filter((filePath) => isMediaPath(filePath))
    .map((filePath) => ({
      path: filePath,
      relativePath: path.relative(root, filePath),
      kind: mediaKind(filePath),
      platforms: compatiblePlatforms(filePath),
    }))
    .filter((item) => !normalizedPlatform || item.platforms.includes(normalizedPlatform));
}

export function listContent({ contentRoot } = {}) {
  const root = requireExistingDirectory(contentRoot || process.env.SOCIAL_CONTENT_ROOT, 'content root');
  return walkFiles(root)
    .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({
      path: filePath,
      relativePath: path.relative(root, filePath),
      kind: 'text',
    }));
}

export function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveAssetPath(input, flags = {}) {
  return resolvePathWithinOptionalRoot(input, flags['asset-root'] || process.env.SOCIAL_ASSET_ROOT, 'asset');
}

function resolveContentPath(input, flags = {}) {
  return resolvePathWithinOptionalRoot(input, flags['content-root'] || process.env.SOCIAL_CONTENT_ROOT, 'content');
}

function resolvePathWithinOptionalRoot(input, rootValue, label) {
  const raw = String(input);
  const root = resolveRoot(rootValue);
  const resolvedPath = root
    ? (path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw))
    : path.resolve(raw);

  if (root && !isInside(root, resolvedPath)) {
    throw Object.assign(
      new Error(`Refusing ${label} path outside root: ${raw}`),
      { code: `${label.toUpperCase()}_PATH_OUTSIDE_ROOT` }
    );
  }
  return resolvedPath;
}

function readTextFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw Object.assign(
      new Error(`Content file not found: ${filePath}`),
      { code: 'CONTENT_FILE_NOT_FOUND' }
    );
  }

  try {
    if (!fs.statSync(filePath).isFile()) {
      throw Object.assign(
        new Error(`Content path is not a file: ${filePath}`),
        { code: 'CONTENT_PATH_NOT_FILE' }
      );
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'CONTENT_PATH_NOT_FILE') throw error;
    throw Object.assign(
      new Error(`Could not read content file: ${filePath}`),
      { code: 'CONTENT_FILE_READ_FAILED' }
    );
  }
}

function normalizePlatform(platform) {
  if (!platform) return null;
  const normalized = String(platform).toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(normalized)) {
    throw Object.assign(
      new Error(`Unsupported platform: ${platform}`),
      { code: 'UNSUPPORTED_PLATFORM' }
    );
  }
  return normalized;
}

function requireExistingDirectory(value, label) {
  const root = resolveRoot(value);
  if (!root) {
    throw Object.assign(
      new Error(`Missing --${label.replaceAll(' ', '-')} or matching SOCIAL_${label.toUpperCase().replaceAll(' ', '_')}`),
      { code: `MISSING_${label.toUpperCase().replaceAll(' ', '_')}` }
    );
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw Object.assign(
      new Error(`${label} not found or not a directory: ${root}`),
      { code: `INVALID_${label.toUpperCase().replaceAll(' ', '_')}` }
    );
  }
  return root;
}

function resolveRoot(value) {
  if (!value || value === true) return null;
  return path.resolve(String(value));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  return out.sort();
}

function isMediaPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

function mediaKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'unknown';
}

function compatiblePlatforms(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const platforms = [];
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) platforms.push('instagram', 'x');
  if (ext === '.gif') platforms.push('x');
  if (VIDEO_EXTENSIONS.has(ext)) platforms.push('instagram', 'tiktok', 'x', 'youtube');
  return platforms;
}

function pruneNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}
