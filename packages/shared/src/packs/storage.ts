import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../utils/debug.ts';
import { parsePackFile, serializePack } from './parser.ts';
import {
  PACK_FILE,
  PACK_SLUG_REGEX,
  type ActivatedPacksManifest,
  type ActivatedPacksManifestEntry,
  type LoadedPack,
  type PackMetadata,
  type PackProfileSlug,
} from './types.ts';

export const GLOBAL_PACKS_DIR = join(homedir(), '.agents', 'packs');
export const WORKSPACE_PACKS_MANIFEST = '.runner-packs.json';
const SEEDED_PACKS_FILE = '.seeded-packs.json';

export interface PackStorageOptions {
  globalPacksDir?: string;
  /**
   * Starter slugs known to have been available before the seeded-slug manifest
   * existed. Used to avoid resurrecting deleted starters while still allowing
   * newly bundled starters to backfill into existing installs.
   */
  legacySeededSlugs?: readonly string[];
}

function getGlobalPacksDir(options?: PackStorageOptions): string {
  return options?.globalPacksDir ?? GLOBAL_PACKS_DIR;
}

export function isValidPackSlug(slug: string): boolean {
  return PACK_SLUG_REGEX.test(slug);
}

export function getGlobalPackDir(slug: string, options?: PackStorageOptions): string {
  return join(getGlobalPacksDir(options), slug);
}

export function getGlobalPackFile(slug: string, options?: PackStorageOptions): string {
  return join(getGlobalPackDir(slug, options), PACK_FILE);
}

export function getActivatedPacksManifestPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, WORKSPACE_PACKS_MANIFEST);
}

function getSeededPacksFile(options?: PackStorageOptions): string {
  return join(getGlobalPacksDir(options), SEEDED_PACKS_FILE);
}

function readSeededPackSlugs(options?: PackStorageOptions): Set<string> | null {
  const file = getSeededPacksFile(options);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { seeded?: unknown };
    if (!Array.isArray(parsed.seeded)) return new Set();
    return new Set(
      parsed.seeded.filter(
        (slug): slug is string => typeof slug === 'string' && isValidPackSlug(slug),
      ),
    );
  } catch {
    return new Set();
  }
}

function writeSeededPackSlugs(seeded: Set<string>, options?: PackStorageOptions): void {
  writeFileSync(
    getSeededPacksFile(options),
    JSON.stringify(
      { version: 1, seeded: [...seeded].sort(), updatedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

function emptyActivatedPacks(): ActivatedPacksManifest {
  return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
}

function normalizeProfile(profile?: PackProfileSlug): PackProfileSlug {
  return profile && profile.trim() ? profile.trim() : 'main';
}

function normalizeEntry(value: unknown): ActivatedPacksManifestEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.slug !== 'string' || !isValidPackSlug(raw.slug)) return null;
  const profile = typeof raw.profile === 'string' ? normalizeProfile(raw.profile) : 'main';
  const activatedAt = typeof raw.activatedAt === 'string' ? raw.activatedAt : new Date(0).toISOString();
  return { slug: raw.slug, profile, activatedAt };
}

function dedupeEntries(entries: ActivatedPacksManifestEntry[]): ActivatedPacksManifestEntry[] {
  const byKey = new Map<string, ActivatedPacksManifestEntry>();
  for (const entry of entries) {
    byKey.set(`${entry.slug}:${entry.profile}`, entry);
  }
  return [...byKey.values()].sort((a, b) => `${a.slug}:${a.profile}`.localeCompare(`${b.slug}:${b.profile}`));
}

export function readActivatedPacks(workspaceRootPath: string): ActivatedPacksManifest {
  const path = getActivatedPacksManifestPath(workspaceRootPath);
  if (!existsSync(path)) return emptyActivatedPacks();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ActivatedPacksManifest>;
    const active = Array.isArray(parsed.active)
      ? dedupeEntries(parsed.active.map(normalizeEntry).filter((entry): entry is ActivatedPacksManifestEntry => !!entry))
      : [];
    return {
      version: 1,
      active,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (error) {
    debug(`[readActivatedPacks] malformed activation manifest at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      renameSync(path, `${path}.broken-${Date.now()}`);
    } catch {
      // best-effort recovery only
    }
    return emptyActivatedPacks();
  }
}

export function writeActivatedPacks(
  workspaceRootPath: string,
  entries: ActivatedPacksManifestEntry[],
): ActivatedPacksManifest {
  const manifest: ActivatedPacksManifest = {
    version: 1,
    active: dedupeEntries(entries),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(workspaceRootPath, { recursive: true });
  const finalPath = getActivatedPacksManifestPath(workspaceRootPath);
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  try {
    renameSync(tmpPath, finalPath);
  } catch (error) {
    try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw error;
  }
  return manifest;
}

export function setPackActive(
  workspaceRootPath: string,
  slug: string,
  active: boolean,
  profile: PackProfileSlug = 'main',
): ActivatedPacksManifest {
  const normalizedProfile = normalizeProfile(profile);
  const current = readActivatedPacks(workspaceRootPath).active;
  const next = active
    ? [...current, { slug, profile: normalizedProfile, activatedAt: new Date().toISOString() }]
    : current.filter((entry) => !(entry.slug === slug && entry.profile === normalizedProfile));
  return writeActivatedPacks(workspaceRootPath, next);
}

function loadPackFromDir(dir: string, slug: string): LoadedPack | null {
  const file = join(dir, PACK_FILE);
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parsePackFile(raw);
  if (!parsed) return null;
  return {
    slug,
    metadata: parsed.metadata,
    body: parsed.body,
    path: dir,
    source: 'global',
    parseWarnings: parsed.warnings.length ? parsed.warnings : undefined,
  };
}

export function loadGlobalPack(slug: string, options?: PackStorageOptions): LoadedPack | null {
  if (!isValidPackSlug(slug)) return null;
  return loadPackFromDir(getGlobalPackDir(slug, options), slug);
}

export function loadAllGlobalPacks(options?: PackStorageOptions): LoadedPack[] {
  const root = getGlobalPacksDir(options);
  if (!existsSync(root)) return [];
  const out: LoadedPack[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidPackSlug(entry.name)) continue;
    const loaded = loadPackFromDir(join(root, entry.name), entry.name);
    if (loaded) out.push(loaded);
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function loadActivatedPacks(workspaceRootPath: string, options?: PackStorageOptions): LoadedPack[] {
  const manifest = readActivatedPacks(workspaceRootPath);
  const out: LoadedPack[] = [];
  const retained: ActivatedPacksManifestEntry[] = [];
  for (const entry of manifest.active) {
    const pack = loadGlobalPack(entry.slug, options);
    if (!pack) continue;
    out.push(pack);
    retained.push(entry);
  }
  if (retained.length !== manifest.active.length) {
    try {
      writeActivatedPacks(workspaceRootPath, retained);
    } catch {
      // stale entries are harmless and will be skipped again next load
    }
  }
  return out;
}

export interface WriteGlobalPackInput {
  slug: string;
  metadata: PackMetadata;
  body: string;
}

export function writeGlobalPack(input: WriteGlobalPackInput, options?: PackStorageOptions): LoadedPack {
  if (!isValidPackSlug(input.slug)) {
    throw new Error(`Invalid pack slug: "${input.slug}"`);
  }
  const serialized = serializePack(input.metadata, input.body);
  if (!parsePackFile(serialized)) {
    throw new Error(`Invalid pack metadata for "${input.slug}"`);
  }
  const dir = getGlobalPackDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PACK_FILE), serialized, 'utf-8');
  const loaded = loadGlobalPack(input.slug, options);
  if (!loaded) throw new Error(`Failed to re-load pack "${input.slug}" after write.`);
  return loaded;
}

export function ensureRequiredPacks(
  required: ReadonlyArray<WriteGlobalPackInput>,
  options?: PackStorageOptions,
): { ensured: number } {
  mkdirSync(getGlobalPacksDir(options), { recursive: true });
  let ensured = 0;
  for (const pack of required) {
    if (!isValidPackSlug(pack.slug)) continue;
    if (existsSync(getGlobalPackFile(pack.slug, options))) continue;
    writeGlobalPack(pack, options);
    ensured += 1;
  }
  return { ensured };
}

/**
 * Seed the global pack library on first run. Existing files are never
 * overwritten, and the marker prevents recreating user-deleted starter packs.
 */
export function seedGlobalPackLibraryIfEmpty(
  starters: ReadonlyArray<WriteGlobalPackInput>,
  options?: PackStorageOptions,
): { seeded: number } {
  const root = getGlobalPacksDir(options);
  mkdirSync(root, { recursive: true });
  const marker = join(root, '.seeded');
  const markerExists = existsSync(marker);
  const seededSlugs = readSeededPackSlugs(options)
    ?? new Set(markerExists ? (options?.legacySeededSlugs ?? []) : []);

  let seeded = 0;
  for (const pack of starters) {
    if (!isValidPackSlug(pack.slug)) continue;
    if (existsSync(getGlobalPackFile(pack.slug, options))) {
      seededSlugs.add(pack.slug);
      continue;
    }
    if (seededSlugs.has(pack.slug)) continue;
    writeGlobalPack(pack, options);
    seededSlugs.add(pack.slug);
    seeded += 1;
  }

  try {
    writeFileSync(marker, new Date().toISOString(), 'utf-8');
    writeSeededPackSlugs(seededSlugs, options);
  } catch {
    // Markers are best-effort; failure only means seeding may be retried.
  }
  return { seeded };
}
