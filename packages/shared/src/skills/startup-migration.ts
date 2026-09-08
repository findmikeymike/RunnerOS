import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { matter, stringifyFrontmatter } from '../config/frontmatter.ts';
import { resolveRuntimeIdentity, type RuntimeProductVariant } from '../config/runtime-identity.ts';
import { atomicWriteFileSync } from '../utils/files.ts';
import { expandPath } from '../utils/paths.ts';
import { getManagedSkillsRoot, skillDigest, type ManagedSkillStorageOptions } from './managed.ts';
import { migrateManagedSkillScope, rewriteLegacySkillAssignments } from './migration.ts';
import { invalidateSkillsCache } from './storage.ts';
import { markLegacyAuthoredSkillReferences } from './authored-reference-migration.ts';

interface StartupState { version: 1; startedAt: number; completedScopes: string[]; eligibleRecords?: Record<string, string>; pending?: { scopes: string[]; agents: string[]; sessions: string[]; authored?: string[] } }
export interface ManagedSkillStartupOptions extends ManagedSkillStorageOptions { workspaceRoots: string[]; projectRoots?: string[]; agentsDir?: string; workflowsDir?: string; runtimeVariant?: RuntimeProductVariant }
function childFiles(root: string, filename: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, entry.name, filename)).filter(existsSync);
}
function header(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw.slice(0, raw.indexOf('\n') < 0 ? undefined : raw.indexOf('\n')));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Session header needs recovery before skill migration');
  return parsed;
}

/** Run before starter metadata normalizers or session reads. Never launches providers. */
export function migrateManagedSkillsAtStartup(options: ManagedSkillStartupOptions): { migratedScopes: number; rewrittenFiles: number; startedAt: number } {
  const identity = resolveRuntimeIdentity();
  if ((options.runtimeVariant ?? identity.variant) !== 'artist-os') return { migratedScopes: 0, rewrittenFiles: 0, startedAt: 0 };
  if (options.runtimeVariant && (!options.globalSkillsDir || !options.agentsDir)) throw new Error('Injected migration identity requires explicit isolated storage roots');
  const globalSkillsDir = options.globalSkillsDir ?? identity.skillsDir;
  const managedRoot = getManagedSkillsRoot({ globalSkillsDir });
  const statePath = join(managedRoot, '.startup-migration.json');
  mkdirSync(managedRoot, { recursive: true });
  const firstMigration = !existsSync(statePath);
  const state: StartupState = !firstMigration ? JSON.parse(readFileSync(statePath, 'utf8')) : { version: 1, startedAt: Date.now(), completedScopes: [] };
  if (state.version !== 1 || !Number.isFinite(state.startedAt) || !Array.isArray(state.completedScopes)
    || state.completedScopes.some(path => typeof path !== 'string')) throw new Error('Managed skill startup journal needs recovery');
  const saveState = () => atomicWriteFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  const workspaces = [...new Set(options.workspaceRoots.map(root => resolve(root)))];
  const sessionFiles = workspaces.flatMap(root => childFiles(join(root, 'sessions'), 'session.jsonl'));
  const agentFiles = childFiles(options.agentsDir ?? identity.agentsDir, 'AGENT.md');
  const workflowRoot = options.workflowsDir ?? (options.runtimeVariant ? join(dirname(globalSkillsDir), 'workflows') : identity.workflowsDir);
  const authoredFiles = [...workspaces.map(root => join(root, 'automations.json')).filter(existsSync), ...childFiles(workflowRoot, 'WORKFLOW.md'),
    ...workspaces.flatMap(root => childFiles(join(root, 'runs'), 'run.json'))];
  if (firstMigration) state.eligibleRecords = Object.fromEntries([...agentFiles, ...sessionFiles, ...authoredFiles].map(path => [path, skillDigest(readFileSync(path, 'utf8'))]));
  const unchangedLegacyRecord = (path: string) => state.eligibleRecords?.[path] === skillDigest(readFileSync(path, 'utf8'));
  const projectRoots = new Set((options.projectRoots ?? []).map(root => resolve(root)));
  for (const path of sessionFiles) {
    const workingDirectory = header(path).workingDirectory;
    if (typeof workingDirectory === 'string' && workingDirectory && !workingDirectory.includes('{{')) projectRoots.add(resolve(expandPath(workingDirectory)));
  }
  const roots = [...new Set([resolve(globalSkillsDir), ...workspaces.map(root => join(root, 'skills')), ...Array.from(projectRoots, root => join(root, '.agents', 'skills'))])];
  const newScopes = roots.filter(root => !state.completedScopes.includes(root));
  if (!state.pending && newScopes.length) {
    state.pending = { scopes: newScopes, agents: agentFiles.filter(unchangedLegacyRecord), sessions: sessionFiles.filter(unchangedLegacyRecord), authored: authoredFiles.filter(unchangedLegacyRecord) };
    saveState();
  }
  if (!state.pending) return { migratedScopes: 0, rewrittenFiles: 0, startedAt: state.startedAt };
  const batch = state.pending;
  if (![batch.scopes, batch.agents, batch.sessions, batch.authored ?? []].every(paths => Array.isArray(paths) && paths.every(path => typeof path === 'string' && resolve(path) === path))) throw new Error('Managed skill startup journal needs recovery');
  const affected = new Set<string>();
  // Every original remains present until all mutable references are durable.
  for (const scope of batch.scopes) {
    const prepared = migrateManagedSkillScope(scope, { globalSkillsDir, retireOriginals: false });
    for (const slug of Object.keys(prepared.aliases)) affected.add(slug);
  }
  let rewrittenFiles = 0;
  const replace = (path: string, original: string, updated: string) => {
    if (original === updated) return;
    if (lstatSync(path).isSymbolicLink()) throw new Error('Skill migration cannot rewrite linked records');
    const backup = join(managedRoot, '.record-backups', skillDigest(path), skillDigest(original));
    mkdirSync(dirname(backup), { recursive: true });
    if (!existsSync(backup)) atomicWriteFileSync(backup, original);
    if (readFileSync(backup, 'utf8') !== original || readFileSync(path, 'utf8') !== original) throw new Error('Record changed during skill migration; original was retained');
    atomicWriteFileSync(path, updated);
    if (state.eligibleRecords?.[path]) state.eligibleRecords[path] = skillDigest(updated);
    saveState();
    rewrittenFiles++;
  };
  if (affected.size) {
    for (const path of batch.agents) {
      if (!existsSync(path)) continue;
      if (!unchangedLegacyRecord(path)) continue;
      const original = readFileSync(path, 'utf8');
      const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(original);
      if (!match) throw new Error('Agent frontmatter needs recovery before skill migration');
      const data = matter(original).data;
      const updated = rewriteLegacySkillAssignments(data, affected);
      const serialized = stringifyFrontmatter('', updated);
      const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(serialized)![0];
      if (JSON.stringify(data) !== JSON.stringify(updated)) replace(path, original, frontmatter + original.slice(match[0].length));
    }
    for (const path of batch.sessions) {
      if (!existsSync(path)) continue;
      if (!unchangedLegacyRecord(path)) continue;
      const original = readFileSync(path, 'utf8');
      const newline = original.indexOf('\n');
      const current = header(path);
      const updated = rewriteLegacySkillAssignments(current, affected);
      updated.legacySkillReferences = [...new Set([...(Array.isArray(current.legacySkillReferences) ? current.legacySkillReferences.filter((value): value is string => typeof value === 'string') : []), ...affected])];
      replace(path, original, JSON.stringify(updated) + (newline < 0 ? '' : original.slice(newline)));
    }
    for (const path of batch.authored ?? []) {
      if (!existsSync(path) || !unchangedLegacyRecord(path)) continue;
      const original = readFileSync(path, 'utf8');
      if (path.endsWith('.json')) {
        const current = JSON.parse(original);
        // Frozen run snapshots are reused by rerunFromStep; execution receipts remain untouched.
        const updated = path.endsWith('/run.json')
          ? { ...current, workflowSnapshot: markLegacyAuthoredSkillReferences(current.workflowSnapshot, affected) }
          : markLegacyAuthoredSkillReferences(current, affected);
        if (JSON.stringify(current) !== JSON.stringify(updated)) replace(path, original, JSON.stringify(updated, null, 2) + '\n');
      } else {
        const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(original);
        if (!match) throw new Error('Workflow frontmatter needs recovery before skill migration');
        const current = matter(original).data;
        const updated = markLegacyAuthoredSkillReferences(current, affected);
        if (JSON.stringify(current) !== JSON.stringify(updated)) {
          const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(stringifyFrontmatter('', updated))![0];
          replace(path, original, frontmatter + original.slice(match[0].length));
        }
      }
    }
  }
  for (const scope of batch.scopes) migrateManagedSkillScope(scope, { globalSkillsDir });
  state.completedScopes = [...new Set([...state.completedScopes, ...batch.scopes])];
  delete state.pending;
  saveState();
  invalidateSkillsCache();
  return { migratedScopes: batch.scopes.length, rewrittenFiles, startedAt: state.startedAt };
}
