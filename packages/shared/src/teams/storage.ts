/**
 * Teams — storage
 *
 * CRUD over the global team library (`~/.agents/teams/<slug>/TEAM.md`).
 * V1 intentionally skips per-workspace activation; teams are globally reusable
 * until the UI proves a need for workspace-specific visibility.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseTeamFile, serializeTeam } from './parser.ts';
import {
  TEAM_FILE,
  TEAM_SLUG_REGEX,
  type LoadedTeam,
  type TeamMetadata,
} from './types.ts';

export { parseTeamFile, serializeTeam } from './parser.ts';

export const GLOBAL_TEAMS_DIR = join(homedir(), '.agents', 'teams');

export interface TeamStorageOptions {
  /** Test-only escape hatch; production callers should use the default. */
  globalTeamsDir?: string;
}

function getGlobalTeamsDir(options?: TeamStorageOptions): string {
  return options?.globalTeamsDir ?? GLOBAL_TEAMS_DIR;
}

export function getGlobalTeamDir(slug: string, options?: TeamStorageOptions): string {
  return join(getGlobalTeamsDir(options), slug);
}

export function getGlobalTeamFile(slug: string, options?: TeamStorageOptions): string {
  return join(getGlobalTeamDir(slug, options), TEAM_FILE);
}

export function isValidTeamSlug(slug: string): boolean {
  return TEAM_SLUG_REGEX.test(slug);
}

function loadTeamFromDir(dir: string, slug: string): LoadedTeam | null {
  const file = join(dir, TEAM_FILE);
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseTeamFile(raw);
  if (!parsed) return null;
  return {
    slug,
    metadata: parsed.metadata,
    body: parsed.body,
    path: dir,
    source: 'global',
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

export function loadAllGlobalTeams(options?: TeamStorageOptions): LoadedTeam[] {
  const root = getGlobalTeamsDir(options);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LoadedTeam[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidTeamSlug(entry.name)) continue;
    const team = loadTeamFromDir(join(root, entry.name), entry.name);
    if (team) out.push(team);
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function loadGlobalTeam(slug: string, options?: TeamStorageOptions): LoadedTeam | null {
  if (!isValidTeamSlug(slug)) return null;
  return loadTeamFromDir(getGlobalTeamDir(slug, options), slug);
}

export interface CreateTeamInput {
  slug: string;
  metadata: TeamMetadata;
  body: string;
}

export function writeGlobalTeam(input: CreateTeamInput, options?: TeamStorageOptions): LoadedTeam {
  if (!isValidTeamSlug(input.slug)) {
    throw new Error(`Invalid team slug: "${input.slug}" (lowercase letters, digits, hyphens; 1-64 chars)`);
  }
  const serialized = serializeTeam(input.metadata, input.body);
  if (!parseTeamFile(serialized)) {
    throw new Error(`Invalid team metadata for "${input.slug}"`);
  }
  const dir = getGlobalTeamDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TEAM_FILE), serialized, 'utf-8');

  const loaded = loadGlobalTeam(input.slug, options);
  if (!loaded) {
    throw new Error(`Failed to re-load team "${input.slug}" after write — likely failed validation`);
  }
  return loaded;
}

export function deleteGlobalTeam(slug: string, options?: TeamStorageOptions): boolean {
  if (!isValidTeamSlug(slug)) return false;
  const dir = getGlobalTeamDir(slug, options);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function seedGlobalTeamLibraryIfEmpty(
  starters: ReadonlyArray<CreateTeamInput>,
  options?: TeamStorageOptions,
): { seeded: number } {
  const root = getGlobalTeamsDir(options);
  mkdirSync(root, { recursive: true });
  const marker = join(root, '.seeded');
  if (existsSync(marker)) return { seeded: 0 };

  let seeded = 0;
  for (const starter of starters) {
    if (!isValidTeamSlug(starter.slug)) continue;
    const file = getGlobalTeamFile(starter.slug, options);
    if (existsSync(file)) continue;
    const serialized = serializeTeam(starter.metadata, starter.body);
    if (!parseTeamFile(serialized)) continue;
    mkdirSync(getGlobalTeamDir(starter.slug, options), { recursive: true });
    writeFileSync(file, serialized, 'utf-8');
    seeded += 1;
  }

  try {
    writeFileSync(marker, new Date().toISOString(), 'utf-8');
  } catch {
    // Marker is best-effort.
  }
  return { seeded };
}

