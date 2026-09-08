import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { resolveRuntimeIdentity } from '../config/runtime-identity.ts';
import { getManagedSkill, getManagedSkillManifest, skillDigest, type ManagedSkillStorageOptions } from './managed.ts';
import type { PersonalInstruction, PersonalInstructionScope, SkillDescriptor } from './types.ts';

export const MAX_PERSONAL_INSTRUCTION_BYTES = 16 * 1024;
function validateSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) throw new Error('Invalid skill identity');
}
function recordPath(workspaceRoot: string, slug: string, scope: PersonalInstructionScope, options: ManagedSkillStorageOptions): string {
  validateSlug(slug);
  if (scope !== 'shared' && scope !== 'workspace') throw new Error('Invalid personal instruction scope');
  return join(scope === 'shared' ? options.globalSkillsDir ?? resolveRuntimeIdentity().skillsDir : join(workspaceRoot, 'skills'), '.personal-instructions', `${slug}.json`);
}
function readRecord(workspaceRoot: string, slug: string, scope: PersonalInstructionScope, options: ManagedSkillStorageOptions): PersonalInstruction | null {
  const path = recordPath(workspaceRoot, slug, scope, options);
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8')) as PersonalInstruction;
  if (value.parentManagedId !== `artist-os:skill:${slug}` || value.scope !== scope || typeof value.text !== 'string'
    || typeof value.id !== 'string' || typeof value.enabled !== 'boolean'
    || Buffer.byteLength(value.text, 'utf8') > MAX_PERSONAL_INSTRUCTION_BYTES
    || (scope === 'workspace' && value.workspaceRoot !== resolve(workspaceRoot))) throw new Error('Personal instructions need recovery before editing');
  return value;
}

/** Shared first, workspace second. Missing parents retain text but cannot run. */
export function getPersonalInstructions(workspaceRoot: string, slug: string, options: ManagedSkillStorageOptions = {}): PersonalInstruction[] {
  const available = getManagedSkillManifest().has(slug);
  return (['shared', 'workspace'] as const).flatMap(scope => {
    const record = readRecord(workspaceRoot, slug, scope, options);
    return record ? [{ ...record, enabled: available && record.enabled }] : [];
  });
}

/** Keep missing parents discoverable without exposing retained text in the catalog. */
export function getOrphanedPersonalSkillDescriptors(workspaceRoot: string, options: ManagedSkillStorageOptions = {}): SkillDescriptor[] {
  const candidates = new Set<string>();
  const roots = [options.globalSkillsDir ?? resolveRuntimeIdentity().skillsDir, join(workspaceRoot, 'skills')];
  for (const root of roots) {
    const directory = join(root, '.personal-instructions');
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-z0-9][a-z0-9-]{0,127}\.json$/.test(entry.name)) continue;
      const slug = entry.name.slice(0, -5);
      if (!getManagedSkillManifest().has(slug)) candidates.add(slug);
    }
  }
  return [...candidates].sort().flatMap(slug => {
    const records = getPersonalInstructions(workspaceRoot, slug, options);
    if (!records.length) return [];
    return [{ id: `artist-os:skill:${slug}`, slug, available: false as const,
      metadata: { name: slug, description: `Requires ${slug}. Your personal instructions are saved.` },
      source: records.some(record => record.scope === 'shared') ? 'global' as const : 'workspace' as const,
      origin: 'managed' as const,
      capabilities: { canRead: false, canEdit: false, canExport: false, canDelete: false, canListFiles: false },
    }];
  });
}

export function savePersonalInstruction(workspaceRoot: string, slug: string, input: { scope: PersonalInstructionScope; text: string; enabled?: boolean }, options: ManagedSkillStorageOptions = {}): PersonalInstruction | null {
  const entry = getManagedSkillManifest().get(slug);
  if (!entry) throw new Error('This built-in skill is unavailable; personal instructions were not changed');
  if (typeof input.text !== 'string') throw new Error('Personal instructions must be text');
  if (Buffer.byteLength(input.text, 'utf8') > MAX_PERSONAL_INSTRUCTION_BYTES) throw new Error('Personal instructions must be 16 KB or less');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Enabled must be true or false');
  if (!input.text.trim()) { deletePersonalInstruction(workspaceRoot, slug, input.scope, options); return null; }
  const prior = readRecord(workspaceRoot, slug, input.scope, options);
  const record: PersonalInstruction = {
    id: prior?.id ?? randomUUID(), parentManagedId: entry.id, scope: input.scope,
    ...(input.scope === 'workspace' ? { workspaceRoot: resolve(workspaceRoot) } : {}),
    text: input.text, enabled: input.enabled ?? prior?.enabled ?? true,
    updatedAt: new Date().toISOString(), reviewedCoreRevision: entry.revision,
  };
  const path = recordPath(workspaceRoot, slug, input.scope, options);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify(record, null, 2) + '\n');
  return record;
}

export function deletePersonalInstruction(workspaceRoot: string, slug: string, scope: PersonalInstructionScope, options: ManagedSkillStorageOptions = {}): void {
  rmSync(recordPath(workspaceRoot, slug, scope, options), { force: true });
}

export function exportPersonalInstruction(record: PersonalInstruction): { parentManagedId: string; text: string } {
  return { parentManagedId: record.parentManagedId, text: record.text };
}

export function importPersonalInstruction(workspaceRoot: string, input: { parentManagedId: string; text: string }, scope: PersonalInstructionScope, options: ManagedSkillStorageOptions = {}): PersonalInstruction | null {
  if (!input || typeof input.text !== 'string' || !input.text.trim()) throw new Error('Imported personal instructions must contain text');
  const slug = input.parentManagedId?.replace(/^artist-os:skill:/, '');
  if (!slug || input.parentManagedId !== `artist-os:skill:${slug}`) throw new Error('Invalid parent skill identity');
  validateSlug(slug);
  if (getManagedSkillManifest().has(slug)) return savePersonalInstruction(workspaceRoot, slug, { scope, text: input.text }, options);
  if (typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > MAX_PERSONAL_INSTRUCTION_BYTES) throw new Error('Personal instructions must be 16 KB or less');
  if (!input.text.trim()) return null;
  const prior = readRecord(workspaceRoot, slug, scope, options);
  const record: PersonalInstruction = { id: prior?.id ?? randomUUID(), parentManagedId: input.parentManagedId, scope,
    ...(scope === 'workspace' ? { workspaceRoot: resolve(workspaceRoot) } : {}), text: input.text, enabled: false, updatedAt: new Date().toISOString(), reviewedCoreRevision: prior?.reviewedCoreRevision ?? '' };
  const path = recordPath(workspaceRoot, slug, scope, options);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** Private on-demand runtime payload. Never return this over renderer RPC. */
export function resolveManagedSkillInstructions(workspaceRoot: string, slug: string, options: ManagedSkillStorageOptions = {}) {
  const skill = getManagedSkill(slug, options);
  const entry = getManagedSkillManifest().get(slug);
  if (!skill || !entry) return null;
  const personalInstructions = getPersonalInstructions(workspaceRoot, slug, options).filter(record => record.enabled);
  return { ...skill, id: entry.id, revision: entry.revision, files: entry.files, personalInstructions,
    personalRevision: skillDigest(JSON.stringify(personalInstructions.map(record => [record.id, record.text, record.updatedAt, record.reviewedCoreRevision]))) };
}
