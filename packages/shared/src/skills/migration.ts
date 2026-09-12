import { closeSync, fsyncSync, openSync, writeFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getManagedSkillManifest, getManagedSkillsRoot, skillDigest, type ManagedSkillStorageOptions } from './managed.ts';
import monidBaselines from '../agent-definitions/__fixtures__/monid-routing-v1/baselines.json';
import helperBaselines from '../agent-definitions/__fixtures__/helper-guide-v1/baselines.json';

let startupMigrationDeferred = false;
export function setManagedSkillMigrationDeferred(value: boolean): void { startupMigrationDeferred = value; }
export function isManagedSkillMigrationDeferred(): boolean { return startupMigrationDeferred; }
export function hasUnreadableSkillMigrationJournal(skillsDir: string): boolean {
  try { readJournal(skillsDir); return false; } catch { return true; }
}

interface MigrationEntry { digest: string; copySlug: string | null; retired: boolean; retirement?: { name: string; dev: number; ino: number } }
interface MigrationJournal { version: 1; entries: Record<string, MigrationEntry> }
const JOURNAL = '.managed-skill-migration.json';
const legalSlug = (slug: string) => /^[a-z0-9][a-z0-9-]{0,180}$/.test(slug);
// Reuse the exact historical bytes already proven by the narrow routing migrations.
const knownCoreHashes: Readonly<Record<string, readonly string[]>> = {
  ...monidBaselines.skills,
  'artist-os-guide': helperBaselines.skills.map(version => version.sha256),
};

function readJournal(root: string): MigrationJournal {
  const path = join(root, JOURNAL);
  if (!existsSync(path)) return { version: 1, entries: {} };
  const journal = JSON.parse(readFileSync(path, 'utf8')) as MigrationJournal;
  if (journal.version !== 1 || !journal.entries || typeof journal.entries !== 'object') throw new Error('Skill migration journal needs recovery');
  for (const [slug, value] of Object.entries(journal.entries)) {
    if (!legalSlug(slug) || !value || !/^[a-f0-9]{64}$/.test(value.digest)
      || (value.copySlug !== null && (!legalSlug(value.copySlug) || value.copySlug === slug))
      || typeof value.retired !== 'boolean'
      || (value.retirement !== undefined && (!value.retirement || !new RegExp(`^\\.${slug}\\.retiring-[a-f0-9-]{36}$`).test(value.retirement.name) || !Number.isSafeInteger(value.retirement.dev) || !Number.isSafeInteger(value.retirement.ino)))) throw new Error('Skill migration journal needs recovery');
  }
  return journal;
}

/** Migration records must survive loss of the process after any committed rename. */
export function writeSkillMigrationFile(path: string, data: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally { rmSync(temporary, { force: true }); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncTree(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) syncTree(child);
    else { const fd = openSync(child, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  }
  syncDirectory(path);
}

/** Binary-safe inventory; refuse links/special files rather than copying outside the skill. */
function inventory(root: string): Array<[string, string]> {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Skill migration cannot follow symbolic links');
  const files: Array<[string, string]> = [];
  function visit(dir: string, prefix: string) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), relative = prefix + name, stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Skill migration cannot follow symbolic links');
      if (stat.isDirectory()) { files.push([relative + '/', 'directory']); visit(path, relative + '/'); }
      else if (stat.isFile()) files.push([relative, skillDigest(readFileSync(path).toString('base64'))]);
      else throw new Error('Skill migration cannot copy special files');
    }
  }
  visit(root, '');
  return files;
}
function digestDirectory(root: string) { return skillDigest(JSON.stringify(inventory(root))); }
function verifiedCopy(from: string, to: string, digest: string) {
  if (!existsSync(to)) {
    mkdirSync(dirname(to), { recursive: true });
    const pending = `${to}.pending-${randomUUID()}`;
    try {
      cpSync(from, pending, { recursive: true, errorOnExist: true, force: false });
      if (digestDirectory(pending) !== digest) throw new Error('Skill changed during preservation');
      syncTree(pending);
      renameSync(pending, to);
      syncDirectory(dirname(to));
    } finally { rmSync(pending, { recursive: true, force: true }); }
  }
  if (digestDirectory(to) !== digest) throw new Error('Preserved skill copy needs recovery; original was retained');
}

/** Prepare aliases and byte-identical copies before retiring any original. Safe to resume. */
export function migrateManagedSkillScope(skillsDir: string, options: ManagedSkillStorageOptions & { retireOriginals?: boolean } = {}): { aliases: Record<string, string>; retired: string[] } {
  if (!existsSync(skillsDir)) return { aliases: {}, retired: [] };
  const journal = readJournal(skillsDir);
  const save = () => writeSkillMigrationFile(join(skillsDir, JOURNAL), JSON.stringify(journal, null, 2) + '\n');
  const retired: string[] = [];
  for (const [slug, stock] of getManagedSkillManifest()) {
    const original = join(skillsDir, slug);
    let entry = journal.entries[slug];
    if (entry?.retirement) {
      const staged = join(skillsDir, entry.retirement.name);
      if (existsSync(staged)) {
        const identity = lstatSync(staged);
        if (!identity.isDirectory() || identity.isSymbolicLink() || identity.dev !== entry.retirement.dev || identity.ino !== entry.retirement.ino || existsSync(original)) throw new Error('Skill retirement folder needs recovery; nothing was removed');
        // A crash may leave only part of this owned staging directory. The
        // complete copies were verified before the original was renamed.
        const backup = join(getManagedSkillsRoot(options), '.legacy', skillDigest(resolve(skillsDir)), slug, entry.digest);
        if (digestDirectory(backup) !== entry.digest) throw new Error('Preserved skill copy needs recovery');
        if (entry.copySlug && digestDirectory(join(skillsDir, entry.copySlug)) !== entry.digest) throw new Error('Preserved personal skill needs recovery');
        rmSync(staged, { recursive: true });
        syncDirectory(skillsDir);
      }
      if (!existsSync(original)) {
        entry.retired = true;
        delete entry.retirement;
        save();
        retired.push(slug);
        continue;
      }
    }
    if (!existsSync(original)) continue;
    const digest = digestDirectory(original);
    if (entry && entry.digest !== digest) throw new Error(`Skill ${slug} changed during migration; original was retained`);
    if (!entry) {
      const actual = inventory(original);
      const actualFiles = actual.filter(([path]) => !path.endsWith('/'));
      const corePath = join(original, 'SKILL.md');
      const knownPreviousCore = existsSync(corePath) && (knownCoreHashes[slug] ?? []).includes(skillDigest(readFileSync(corePath, 'utf8')));
      const isStock = actualFiles.length === stock.files.length
        && actual.filter(([path]) => path.endsWith('/')).every(([directory]) => stock.files.some(file => file.path.startsWith(directory)))
        && actualFiles.every(([path, hash]) => stock.files.some(file => file.path === path
          && (skillDigest(Buffer.from(file.content).toString('base64')) === hash || (path === 'SKILL.md' && knownPreviousCore))));
      entry = { digest, copySlug: isStock ? null : `${slug}-personal-${digest.slice(0, 12)}`, retired: false };
      journal.entries[slug] = entry;
      // Journal identity first: an interrupted copy cannot be mistaken for a different customization.
      save();
    }
    const backup = join(getManagedSkillsRoot(options), '.legacy', skillDigest(resolve(skillsDir)), slug, digest);
    verifiedCopy(original, backup, digest);
    if (entry.copySlug) verifiedCopy(original, join(skillsDir, entry.copySlug), digest);
    // Durable aliases/copies now exist; readers can resolve legacy assignments after a crash.
    save();
    if (options.retireOriginals === false) continue;
    if (digestDirectory(original) !== digest) throw new Error(`Skill ${slug} changed during migration; original was retained`);
    const identity = lstatSync(original);
    entry.retirement ??= { name: `.${slug}.retiring-${randomUUID()}`, dev: identity.dev, ino: identity.ino };
    if (identity.dev !== entry.retirement.dev || identity.ino !== entry.retirement.ino) throw new Error('Skill changed before retirement; original was retained');
    save();
    const staged = join(skillsDir, entry.retirement.name);
    const current = lstatSync(original);
    if (current.isSymbolicLink() || current.dev !== entry.retirement.dev || current.ino !== entry.retirement.ino
      || existsSync(staged) || digestDirectory(original) !== digest) throw new Error('Skill changed before retirement; original was retained');
    renameSync(original, staged);
    syncDirectory(skillsDir);
    rmSync(staged, { recursive: true });
    syncDirectory(skillsDir);
    entry.retired = true;
    delete entry.retirement;
    save();
    retired.push(slug);
  }
  return { aliases: Object.fromEntries(Object.entries(journal.entries).filter(([, value]) => value.copySlug).map(([slug, value]) => [slug, value.copySlug!])), retired };
}

/** Scoped aliases only apply to explicit legacy references, never new bare stock selections. */
export function resolveLegacySkillAlias(skillsDir: string, slug: string): string | null {
  if (!legalSlug(slug)) return null;
  return getLegacySkillMigration(skillsDir, slug)?.copySlug ?? null;
}

export function getLegacySkillMigration(skillsDir: string, slug: string): MigrationEntry | null {
  if (!legalSlug(slug)) return null;
  try { return readJournal(skillsDir).entries[slug] ?? null; }
  catch (error) { if (startupMigrationDeferred) return null; throw error; }
}

/** Rewrite assignment fields, never historical text or arbitrary object strings. */
export function rewriteLegacySkillAssignments<T>(value: T, affectedSlugs: ReadonlySet<string>): T {
  const rewrite = (slug: unknown) => typeof slug === 'string' && affectedSlugs.has(slug) ? `legacy:${slug}` : slug;
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).map(([key, item]) => {
      if (['skills', 'agentSkillSlugs', 'primarySkillSlugs'].includes(key) && Array.isArray(item)) return [key, item.map(rewrite)];
      if (key === 'adjacentSkills' && Array.isArray(item)) return [key, item.map(adjacent => adjacent && typeof adjacent === 'object' ? { ...adjacent, slug: rewrite(adjacent.slug) } : adjacent)];
      return [key, walk(item)];
    }));
  };
  return walk(value) as T;
}
