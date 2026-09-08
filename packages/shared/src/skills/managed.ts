import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { matter } from '../config/frontmatter.ts';
import { resolveRuntimeIdentity, type RuntimeProductVariant } from '../config/runtime-identity.ts';
import { BUNDLED_STARTER_SKILLS } from './bundled.generated.ts';
import { STARTER_SKILLS } from './starter-templates.ts';
import { classifySkillCategory, normalizeSkillTags } from './categories.ts';
import type { LoadedSkill, SkillDescriptor, SkillMetadata } from './types.ts';

export interface ManagedSkillFile { path: string; content: string; sha256: string; kind: 'instruction' | 'helper' | 'asset' | 'notice' }
export interface ManagedSkillEntry { id: string; slug: string; revision: string; metadata: SkillMetadata; content: string; files: readonly ManagedSkillFile[] }
export interface ManagedSkillStorageOptions { globalSkillsDir?: string }
export function isManagedSkillFeatureEnabled(variant: RuntimeProductVariant = resolveRuntimeIdentity().variant): boolean {
  return variant === 'artist-os';
}
function resolvedPath(input: string): string {
  let ancestor = resolve(input);
  const suffix: string[] = [];
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    suffix.unshift(ancestor.slice(dirname(ancestor).length + 1));
    ancestor = dirname(ancestor);
  }
  return join(existsSync(ancestor) ? realpathSync(ancestor) : ancestor, ...suffix);
}
export const skillDigest = (value: string): string => createHash('sha256').update(value).digest('hex');
let manifest: ReadonlyMap<string, ManagedSkillEntry> | undefined;

export function getManagedSkillManifest(): ReadonlyMap<string, ManagedSkillEntry> {
  if (manifest) return manifest;
  const entries = new Map<string, ManagedSkillEntry>();
  for (const starter of [...STARTER_SKILLS, ...BUNDLED_STARTER_SKILLS]) {
    if (entries.has(starter.slug)) throw new Error(`Duplicate shipped skill identity: ${starter.slug}`);
    const files: ManagedSkillFile[] = starter.files.map(file => {
      if (isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) throw new Error('Invalid shipped skill reference');
      const kind: ManagedSkillFile['kind'] = /(^|\/)(license|notice|copying|attribution)(\.|$)/i.test(file.path) ? 'notice'
        : /\.(md|txt|ya?ml|json)$/i.test(file.path) ? 'instruction'
          : /\.(m?js|cjs|ts|py|sh|bash|swift)$/i.test(file.path) ? 'helper' : 'asset';
      return { ...file, sha256: skillDigest(file.content), kind };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const core = files.find(file => file.path === 'SKILL.md');
    if (!core) throw new Error(`Shipped skill missing instructions: ${starter.slug}`);
    const parsed = matter(core.content);
    const name = String(parsed.data.name ?? starter.slug);
    const description = String(parsed.data.description ?? '');
    const tags = normalizeSkillTags(parsed.data.tags);
    const required = parsed.data.requiredSources;
    const metadata: SkillMetadata = {
      name, description, tags,
      category: classifySkillCategory({ slug: starter.slug, name, description, tags, category: parsed.data.category }),
      ...(typeof parsed.data.icon === 'string' ? { icon: parsed.data.icon } : {}),
      ...(required ? { requiredSources: (Array.isArray(required) ? required : [required]).filter((value): value is string => typeof value === 'string') } : {}),
      ...(Array.isArray(parsed.data.alwaysAllow) ? { alwaysAllow: parsed.data.alwaysAllow.filter((value): value is string => typeof value === 'string') } : {}),
    };
    entries.set(starter.slug, { id: `artist-os:skill:${starter.slug}`, slug: starter.slug, revision: skillDigest(JSON.stringify(files.map(file => [file.path, file.sha256]))), metadata, content: parsed.content, files });
  }
  manifest = entries;
  return entries;
}

export function getManagedSkillsRoot(options: ManagedSkillStorageOptions = {}): string {
  return join(options.globalSkillsDir ?? resolveRuntimeIdentity().skillsDir, '.managed');
}

/** Materialize the trusted current bundle privately; never replace user directories. */
export function getManagedSkill(slug: string, options: ManagedSkillStorageOptions = {}): LoadedSkill | null {
  if (!options.globalSkillsDir && !isManagedSkillFeatureEnabled()) return null;
  const entry = getManagedSkillManifest().get(slug);
  if (!entry) return null;
  const path = join(getManagedSkillsRoot(options), slug, entry.revision);
  if (!existsSync(path)) {
    const staging = `${path}.pending-${randomUUID()}`;
    mkdirSync(staging, { recursive: true });
    try {
      for (const file of entry.files) {
        const destination = join(staging, file.path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, file.content, 'utf8');
      }
      renameSync(staging, path);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(path)) throw error;
    }
  }
  for (const file of entry.files) {
    const target = join(path, file.path);
    if (!existsSync(target) || skillDigest(readFileSync(target, 'utf8')) !== file.sha256) {
      throw new Error('Managed skill files need recovery before this skill can run');
    }
  }
  return { slug, metadata: entry.metadata, content: entry.content, path, source: 'global', managed: { id: entry.id, revision: entry.revision } };
}

/** Callers cannot manufacture managed ownership with SKILL.md frontmatter. */
export function isManagedSkill(skill: LoadedSkill): boolean {
  const entry = getManagedSkillManifest().get(skill.slug);
  return Boolean(entry && skill.managed?.id === entry.id && skill.managed.revision === entry.revision
    && skill.path.endsWith(`${sep}.managed${sep}${skill.slug}${sep}${entry.revision}`));
}

export function toSkillDescriptor(skill: LoadedSkill): SkillDescriptor {
  const managed = isManagedSkill(skill);
  const { name, description, category, tags, icon, requiredSources } = skill.metadata;
  return {
    id: managed ? skill.managed!.id : `user:skill:${skillDigest(resolve(skill.path))}`,
    slug: skill.slug, metadata: { name, description, category, tags, icon, requiredSources },
    source: skill.source, origin: managed ? 'managed' : 'user',
    ...(skill.aliases?.length ? { aliases: [...skill.aliases] } : {}),
    ...(managed ? { revision: skill.managed!.revision } : {}),
    capabilities: { canRead: !managed, canEdit: !managed, canExport: !managed, canDelete: !managed && skill.source === 'workspace', canListFiles: !managed },
  };
}
export function toSkillDescriptors(skills: readonly LoadedSkill[]): SkillDescriptor[] { return skills.map(toSkillDescriptor); }

/** Classify only real, inventoried files under the trusted managed directory. */
export function resolveManagedSkillPath(input: string, options: ManagedSkillStorageOptions = {}): (ManagedSkillFile & { id: string; revision: string; slug: string; absolutePath: string }) | null {
  const configuredRoot = resolve(getManagedSkillsRoot(options));
  const root = existsSync(configuredRoot) ? realpathSync(configuredRoot) : configuredRoot;
  let actual: string;
  try { actual = resolvedPath(input); } catch { actual = resolve(input); }
  const rel = relative(root, actual);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null;
  const [slug, revision, ...parts] = rel.split(sep);
  const entry = slug ? getManagedSkillManifest().get(slug) : undefined;
  if (!entry || revision !== entry.revision) return null;
  const file = entry.files.find(file => file.path === parts.join('/'));
  return file ? { ...file, id: entry.id, revision: entry.revision, slug: entry.slug, absolutePath: actual } : null;
}

export function isManagedSkillPath(path: string, options: ManagedSkillStorageOptions = {}): boolean {
  const configuredRoot = resolve(getManagedSkillsRoot(options));
  const root = existsSync(configuredRoot) ? realpathSync(configuredRoot) : configuredRoot;
  let actual: string;
  try { actual = resolvedPath(path); } catch { actual = resolve(path); }
  const rel = relative(root, actual);
  // Protect directories as well as source files; allowlisting helper execution
  // is a separate runtime decision using resolveManagedSkillPath().
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Required redistribution notices remain public; other references stay private. */
export function isPublicManagedSkillPath(path: string, options: ManagedSkillStorageOptions = {}): boolean {
  const file = resolveManagedSkillPath(path, options);
  return file?.kind === 'notice' || Boolean(file && /(^|\/)icon\.(svg|png|jpe?g|webp|ico)$/i.test(file.path));
}

export function getManagedSkillNotices(slug: string): Array<{ name: string; content: string }> {
  return getManagedSkillManifest().get(slug)?.files.filter(file => file.kind === 'notice').map(file => ({ name: file.path.split('/').pop()!, content: file.content })) ?? [];
}
