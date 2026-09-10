/**
 * Agent Definitions — storage
 *
 * CRUD over the global agent library (`~/.agents/agents/<slug>/AGENT.md`)
 * plus the per-workspace activation manifest.
 *
 * Architecture:
 *   - One canonical store: the global library. No tier-precedence games.
 *   - Each workspace has an `activated-agents.json` listing the slugs that
 *     are visible/usable from that workspace.
 *   - Creating an agent always writes to the global library and (by default)
 *     auto-activates it in the calling workspace.
 *
 * Why global by default (vs. skills which are per-workspace today): an
 * agent is a substantial bundle of curated config; users want to reuse them
 * everywhere. Per-workspace storage forces re-creation. Activation gives the
 * "visible subset per workspace" UX without duplicating files.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { matter, stringifyFrontmatter, type GrayMatterFile } from '../config/frontmatter';
import { atomicWriteFileSync } from '../utils/files.ts';
import { SIGNAL_BRIEFING_INSTRUCTIONS } from '../shared-intel/briefing.ts';
import { isPreviousSignalTrackPrompt } from './signal-track-prompts.ts';
import type { PermissionMode } from '../agent/mode-types.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import { normalizeThinkingLevel, THINKING_LEVEL_IDS } from '../agent/thinking-levels.ts';
import {
  AGENT_SLUG_REGEX,
  type ActivatedAgentsManifest,
  type AgentDefinitionSource,
  type AgentMetadata,
  type AgentParseWarning,
  type AgentTaskModeDefinition,
  type LoadedAgent,
} from './types.ts';
import { getActivatedAgentsManifestPath } from '../workspaces/storage.ts';
import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';
import { buildTaskModeSkillInventory } from './task-modes.ts';

// ============================================================================
// Paths
// ============================================================================

/** Global agent library directory: ~/.agents/agents/ */
export const GLOBAL_AGENTS_DIR = RUNTIME_IDENTITY.agentsDir;

/** AGENT.md filename inside each agent directory. */
export const AGENT_FILE = 'AGENT.md';

const DELETED_AGENTS_FILE = '.deleted-agents.json';

export interface AgentStorageOptions {
  /** Test-only escape hatch; production callers should use the default global library. */
  globalAgentsDir?: string;
}

function getGlobalAgentsDir(options?: AgentStorageOptions): string {
  return options?.globalAgentsDir ?? GLOBAL_AGENTS_DIR;
}

/** Get the directory for a given slug inside the global library. */
export function getGlobalAgentDir(slug: string, options?: AgentStorageOptions): string {
  return join(getGlobalAgentsDir(options), slug);
}

/** Get the absolute path to an agent's AGENT.md file in the global library. */
export function getGlobalAgentFile(slug: string, options?: AgentStorageOptions): string {
  return join(getGlobalAgentDir(slug, options), AGENT_FILE);
}

// ============================================================================
// Slug validation
// ============================================================================

export function isValidAgentSlug(slug: string): boolean {
  return AGENT_SLUG_REGEX.test(slug);
}

function getDeletedAgentsFile(options?: AgentStorageOptions): string {
  return join(getGlobalAgentsDir(options), DELETED_AGENTS_FILE);
}

function readDeletedAgentSlugs(options?: AgentStorageOptions): Set<string> {
  const file = getDeletedAgentsFile(options);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { deleted?: unknown };
    if (!Array.isArray(parsed.deleted)) return new Set();
    return new Set(parsed.deleted.filter((slug): slug is string => typeof slug === 'string' && isValidAgentSlug(slug)));
  } catch {
    return new Set();
  }
}

function rememberDeletedAgent(slug: string, options?: AgentStorageOptions): void {
  const deleted = readDeletedAgentSlugs(options);
  deleted.add(slug);
  writeFileSync(
    getDeletedAgentsFile(options),
    JSON.stringify({ version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}

function forgetDeletedAgent(slug: string, options?: AgentStorageOptions): void {
  const deleted = readDeletedAgentSlugs(options);
  if (!deleted.delete(slug)) return;
  writeFileSync(
    getDeletedAgentsFile(options),
    JSON.stringify({ version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}

// ============================================================================
// Parsing
// ============================================================================

const VALID_PERMISSION_MODES: ReadonlyArray<PermissionMode> = ['safe', 'ask', 'allow-all'];

function warning(field: keyof AgentMetadata, code: AgentParseWarning['code'], message: string): AgentParseWarning {
  return { field, code, message };
}

function coerceStringArray(
  value: unknown,
  field: 'skills' | 'sources' | 'optionalSources' | 'trustedWorkerTools',
  warnings: AgentParseWarning[],
): string[] | undefined {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(warning(field, field === 'optionalSources' ? 'invalid-optional-sources' : field === 'trustedWorkerTools' ? 'invalid-trusted-worker-tools' : `invalid-${field}`, `${field} must be a string or an array of strings.`));
    return undefined;
  }
  const invalidCount = value.filter((entry) => typeof entry !== 'string').length;
  if (invalidCount > 0) {
    warnings.push(warning(field, field === 'optionalSources' ? 'invalid-optional-sources' : field === 'trustedWorkerTools' ? 'invalid-trusted-worker-tools' : `invalid-${field}`, `${field} contains ${invalidCount} non-string entr${invalidCount === 1 ? 'y' : 'ies'} that were ignored.`));
  }
  const cleaned = Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function coercePermissionMode(value: unknown, warnings: AgentParseWarning[]): PermissionMode | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !(VALID_PERMISSION_MODES as ReadonlyArray<string>).includes(value)) {
    warnings.push(warning('permissionMode', 'invalid-permission-mode', `permissionMode must be one of: ${VALID_PERMISSION_MODES.join(', ')}.`));
    return undefined;
  }
  return value as PermissionMode;
}

function coerceThinkingLevel(value: unknown, warnings: AgentParseWarning[]): ThinkingLevel | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    warnings.push(warning('thinkingLevel', 'invalid-thinking-level', `thinkingLevel must be one of: ${THINKING_LEVEL_IDS.join(', ')}.`));
    return undefined;
  }
  if (!(THINKING_LEVEL_IDS as ReadonlyArray<string>).includes(value) && value !== 'think') {
    warnings.push(warning('thinkingLevel', 'invalid-thinking-level', `thinkingLevel must be one of: ${THINKING_LEVEL_IDS.join(', ')}.`));
    return undefined;
  }
  return normalizeThinkingLevel(value as ThinkingLevel | 'think');
}

/** Free-text routing lines. Bounded so a bad definition cannot bloat every prompt. */
const ROUTING_MAX_ENTRIES = 6;
const ROUTING_MAX_LENGTH = 160;

/**
 * Structured routing hints. Malformed entries are dropped with a warning rather
 * than failing the whole agent — a bad hint should degrade routing, not make
 * the worker unloadable.
 */
function coerceRouting(
  value: unknown,
  warnings: AgentParseWarning[],
): AgentMetadata['routing'] {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(warning('routing', 'invalid-routing', 'routing must be an object.'));
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const out: NonNullable<AgentMetadata['routing']> = {};
  let dropped = 0;
  for (const key of ['bestFor', 'notFor', 'handsOffTo'] as const) {
    const list = raw[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warnings.push(warning('routing', 'invalid-routing', `routing.${key} must be an array of strings.`));
      continue;
    }
    const clean = list
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= ROUTING_MAX_LENGTH);
    dropped += list.length - clean.length;
    if (clean.length > 0) out[key] = clean.slice(0, ROUTING_MAX_ENTRIES);
  }
  if (dropped > 0) {
    warnings.push(warning('routing', 'invalid-routing', `routing dropped ${dropped} empty or over-long entr${dropped === 1 ? 'y' : 'ies'}.`));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Slug rules for capability tags: short, lowercase, hyphenable. Matches @-mention shape. */
const TAG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const TAG_MAX_COUNT = 8;

function coerceTags(value: unknown, warnings: AgentParseWarning[]): string[] | undefined {
  if (value == null) return undefined;
  // Accept a comma-separated string for hand-written AGENT.md ergonomics.
  const candidates: unknown[] = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value)
      ? value
      : [];
  if (typeof value !== 'string' && !Array.isArray(value)) {
    warnings.push(warning('tags', 'invalid-tags', 'tags must be an array of short lowercase strings.'));
    return undefined;
  }
  let droppedShape = 0;
  const cleaned = Array.from(
    new Set(
      candidates
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : null))
        .filter((entry): entry is string => {
          if (!entry) return false;
          if (TAG_REGEX.test(entry)) return true;
          droppedShape += 1;
          return false;
        }),
    ),
  );
  if (droppedShape > 0) {
    warnings.push(warning('tags', 'invalid-tags', `tags ignored ${droppedShape} entr${droppedShape === 1 ? 'y' : 'ies'} that didn't match the lowercase-hyphen shape.`));
  }
  if (cleaned.length === 0) return undefined;
  if (cleaned.length > TAG_MAX_COUNT) {
    warnings.push(warning('tags', 'invalid-tags', `tags trimmed to the first ${TAG_MAX_COUNT}.`));
    return cleaned.slice(0, TAG_MAX_COUNT);
  }
  return cleaned;
}

const TASK_MODE_MAX_COUNT = 12;
const TASK_MODE_TEXT_MAX = 240;
const TASK_MODE_EXPANSIONS = new Set(['same-session', 'new-session', 'delegate']);

function cleanTaskModeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)));
}

function coerceTaskModes(
  value: unknown,
  inventory: Pick<AgentMetadata, 'skills' | 'sources' | 'optionalSources'>,
  warnings: AgentParseWarning[],
): AgentTaskModeDefinition[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(warning('taskModes', 'invalid-task-modes', 'taskModes must be an array of focused launch recipes.'));
    return undefined;
  }
  const skills = buildTaskModeSkillInventory(inventory.skills ?? []);
  const sources = new Set([...(inventory.sources ?? []), ...(inventory.optionalSources ?? [])]);
  const seen = new Set<string>();
  const modes: AgentTaskModeDefinition[] = [];
  let dropped = 0;
  for (const candidate of value.slice(0, TASK_MODE_MAX_COUNT)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      dropped += 1;
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
    const kind = raw.kind === 'bundle' ? 'bundle' : raw.kind === 'focus' ? 'focus' : null;
    const primarySkillSlugs = cleanTaskModeStrings(raw.primarySkillSlugs);
    if (!AGENT_SLUG_REGEX.test(id) || seen.has(id) || !label || label.length > 80
      || !description || description.length > TASK_MODE_TEXT_MAX || !kind
      || primarySkillSlugs.length === 0 || primarySkillSlugs.some((slug) => !skills.has(slug))) {
      dropped += 1;
      continue;
    }
    if ((primarySkillSlugs.length > 1 || raw.fullMode === true) && kind !== 'bundle') {
      dropped += 1;
      continue;
    }

    const primarySet = new Set(primarySkillSlugs);
    const adjacentSkills = Array.isArray(raw.adjacentSkills)
      ? raw.adjacentSkills.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const adjacent = entry as Record<string, unknown>;
          const slug = typeof adjacent.slug === 'string' ? adjacent.slug.trim() : '';
          const when = typeof adjacent.when === 'string' ? adjacent.when.trim() : '';
          const expansion = typeof adjacent.expansion === 'string' ? adjacent.expansion : '';
          if (!skills.has(slug) || primarySet.has(slug) || !when || when.length > TASK_MODE_TEXT_MAX
            || !TASK_MODE_EXPANSIONS.has(expansion)) return [];
          return [{ slug, when, expansion: expansion as NonNullable<AgentTaskModeDefinition['adjacentSkills']>[number]['expansion'] }];
        })
      : [];
    const requiredSourceSlugs = cleanTaskModeStrings(raw.requiredSourceSlugs);
    const optionalSourceSlugs = cleanTaskModeStrings(raw.optionalSourceSlugs);
    if ([...requiredSourceSlugs, ...optionalSourceSlugs].some((slug) => !sources.has(slug))) {
      dropped += 1;
      continue;
    }

    let context: AgentTaskModeDefinition['context'];
    if (raw.context && typeof raw.context === 'object' && !Array.isArray(raw.context)) {
      const contextRaw = raw.context as Record<string, unknown>;
      const preloadTopics = cleanTaskModeStrings(contextRaw.preloadTopics);
      const retrieveOnDemandTopics = cleanTaskModeStrings(contextRaw.retrieveOnDemandTopics);
      const maxPreloadChars = typeof contextRaw.maxPreloadChars === 'number' && Number.isFinite(contextRaw.maxPreloadChars)
        ? Math.max(1_000, Math.min(24_000, Math.floor(contextRaw.maxPreloadChars)))
        : undefined;
      if (Array.isArray(contextRaw.preloadTopics)) {
        context = {
          preloadTopics,
          ...(retrieveOnDemandTopics.length > 0 ? { retrieveOnDemandTopics } : {}),
          ...(maxPreloadChars ? { maxPreloadChars } : {}),
        };
      }
    }

    seen.add(id);
    modes.push({
      id,
      label,
      description,
      ...(typeof raw.helpText === 'string' && raw.helpText.trim().length <= TASK_MODE_TEXT_MAX ? { helpText: raw.helpText.trim() } : {}),
      ...(typeof raw.icon === 'string' && AGENT_SLUG_REGEX.test(raw.icon) ? { icon: raw.icon } : {}),
      kind,
      primarySkillSlugs,
      ...(adjacentSkills.length > 0 ? { adjacentSkills } : {}),
      ...(requiredSourceSlugs.length > 0 ? { requiredSourceSlugs } : {}),
      ...(optionalSourceSlugs.length > 0 ? { optionalSourceSlugs } : {}),
      ...(context ? { context } : {}),
      ...(raw.fullMode === true ? { fullMode: true } : {}),
      ...(typeof raw.recommendedThinkingLevel === 'string'
        && (THINKING_LEVEL_IDS as ReadonlyArray<string>).includes(raw.recommendedThinkingLevel)
        ? { recommendedThinkingLevel: normalizeThinkingLevel(raw.recommendedThinkingLevel as ThinkingLevel) }
        : {}),
    });
  }
  dropped += Math.max(0, value.length - TASK_MODE_MAX_COUNT);
  if (dropped > 0) {
    warnings.push(warning('taskModes', 'invalid-task-modes', `taskModes ignored ${dropped} invalid or excess entr${dropped === 1 ? 'y' : 'ies'}.`));
  }
  return modes.length > 0 ? modes : undefined;
}

/**
 * Parse an AGENT.md file's contents. Returns null if the file is malformed
 * or missing required fields. Callers should treat null as "skip this entry"
 * rather than throwing — bad agents shouldn't crash the whole library load.
 */
export function parseAgentFile(content: string): { metadata: AgentMetadata; systemPrompt: string; warnings: AgentParseWarning[] } | null {
  let parsed: GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;

  // Required: name, description
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;

  const warnings: AgentParseWarning[] = [];

  // Avatar: single emoji-ish string. We don't strictly enforce one grapheme
  // here — UI is forgiving. Strip whitespace.
  const avatar = typeof data.avatar === 'string' ? data.avatar.trim() : undefined;

  const permissionMode = coercePermissionMode(data.permissionMode, warnings);
  const thinkingLevel = coerceThinkingLevel(data.thinkingLevel, warnings);
  const skills = coerceStringArray(data.skills, 'skills', warnings);
  const sources = coerceStringArray(data.sources, 'sources', warnings);
  const optionalSources = coerceStringArray(data.optionalSources, 'optionalSources', warnings);
  const metadata: AgentMetadata = {
    name,
    description,
    avatar: avatar || undefined,
    llmConnection: typeof data.llmConnection === 'string' ? data.llmConnection.trim() || undefined : undefined,
    model: typeof data.model === 'string' ? data.model.trim() || undefined : undefined,
    permissionMode,
    thinkingLevel,
    skills,
    taskModes: coerceTaskModes(data.taskModes, { skills, sources, optionalSources }, warnings),
    sources,
    optionalSources,
    trustedWorkerTools: coerceStringArray(data.trustedWorkerTools, 'trustedWorkerTools', warnings),
    visualAgent: data.visualAgent === true ? true : undefined,
    greeting: typeof data.greeting === 'string' ? data.greeting.trim() || undefined : undefined,
    inputs: typeof data.inputs === 'string' ? data.inputs.trim() || undefined : undefined,
    outputs: typeof data.outputs === 'string' ? data.outputs.trim() || undefined : undefined,
    tags: coerceTags(data.tags, warnings),
    routing: coerceRouting(data.routing, warnings),
  };

  return {
    metadata,
    systemPrompt: parsed.content.trim(),
    warnings,
  };
}

// ============================================================================
// Load
// ============================================================================

/**
 * Load a single agent from a directory. Returns null if missing or malformed.
 */
function loadAgentFromDir(dir: string, slug: string, source: AgentDefinitionSource): LoadedAgent | null {
  const agentFile = join(dir, AGENT_FILE);
  if (!existsSync(agentFile)) return null;

  let content: string;
  try {
    content = readFileSync(agentFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseAgentFile(content);
  if (!parsed) return null;

  return {
    slug,
    metadata: parsed.metadata,
    systemPrompt: parsed.systemPrompt,
    path: dir,
    source,
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

/** Load every agent in the global library. */
export function loadAllGlobalAgents(options?: AgentStorageOptions): LoadedAgent[] {
  const globalAgentsDir = getGlobalAgentsDir(options);
  if (!existsSync(globalAgentsDir)) return [];

  const out: LoadedAgent[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(globalAgentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidAgentSlug(entry.name)) continue;
    const agent = loadAgentFromDir(join(globalAgentsDir, entry.name), entry.name, 'global');
    if (agent) out.push(agent);
  }
  return out;
}

/** Load a single agent by slug from the global library. O(1) — only opens the slug's directory. */
export function loadGlobalAgent(slug: string, options?: AgentStorageOptions): LoadedAgent | null {
  if (!isValidAgentSlug(slug)) return null;
  return loadAgentFromDir(getGlobalAgentDir(slug, options), slug, 'global');
}

// ============================================================================
// Activation manifest
// ============================================================================

/**
 * Read a workspace's activation manifest. Returns an empty manifest if the
 * file is missing or malformed — never throws.
 */
export function readActivatedAgents(workspaceRootPath: string): ActivatedAgentsManifest {
  const path = getActivatedAgentsManifestPath(workspaceRootPath);
  if (!existsSync(path)) {
    return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ActivatedAgentsManifest>;
    const deactivated = normalizeActivationSlugs(parsed.deactivated);
    // Explicit off wins if an edited or older manifest contains both states.
    const active = normalizeActivationSlugs(parsed.active).filter(slug => !deactivated.includes(slug));
    return {
      version: 1,
      active,
      ...(deactivated.length > 0 ? { deactivated } : {}),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
  }
}

/** Retain valid entries even when another field or array entry is malformed. */
function normalizeActivationSlugs(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((slug): slug is string => typeof slug === 'string' && isValidAgentSlug(slug))))
    : [];
}

function persistActivatedAgents(workspaceRootPath: string, active: string[], deactivated: string[]): ActivatedAgentsManifest {
  const manifest: ActivatedAgentsManifest = {
    version: 1,
    active,
    ...(deactivated.length > 0 ? { deactivated } : {}),
    updatedAt: new Date().toISOString(),
  };
  const path = getActivatedAgentsManifestPath(workspaceRootPath);
  if (!existsSync(workspaceRootPath)) mkdirSync(workspaceRootPath, { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

/**
 * Replace active slugs, preserving explicit off choices for all other agents.
 * Including a slug is an explicit activation and clears its off marker.
 */
export function writeActivatedAgents(workspaceRootPath: string, slugs: string[]): ActivatedAgentsManifest {
  const active = normalizeActivationSlugs(slugs);
  const current = readActivatedAgents(workspaceRootPath);
  const deactivated = (current.deactivated ?? []).filter(slug => !active.includes(slug));
  return persistActivatedAgents(workspaceRootPath, active, deactivated);
}

/** Convenience: toggle a single slug's activation and persist explicit off choices. */
export function setAgentActive(workspaceRootPath: string, slug: string, active: boolean): ActivatedAgentsManifest {
  const current = readActivatedAgents(workspaceRootPath);
  if (!isValidAgentSlug(slug)) return current;
  const enabled = new Set(current.active);
  const deactivated = new Set(current.deactivated ?? []);
  if (active) {
    enabled.add(slug);
    deactivated.delete(slug);
  } else {
    enabled.delete(slug);
    deactivated.add(slug);
  }
  return persistActivatedAgents(workspaceRootPath, [...enabled], [...deactivated]);
}

/**
 * Load the agents that are currently activated in a workspace.
 * Skips slugs whose AGENT.md does not exist on this machine. The shared
 * activation manifest is never rewritten during reads: another teammate may
 * have a custom agent installed that is not present locally.
 */
export function loadActivatedAgents(workspaceRootPath: string, options?: AgentStorageOptions): LoadedAgent[] {
  const manifest = readActivatedAgents(workspaceRootPath);
  const out: LoadedAgent[] = [];
  for (const slug of manifest.active) {
    const agent = loadGlobalAgent(slug, options);
    if (agent) {
      out.push(agent);
    }
  }
  return out;
}

// ============================================================================
// Mutations on the global library
// ============================================================================

/**
 * Serialize an agent back to the AGENT.md format. Used by create/update.
 *
 * Field order in the YAML is intentional: identifying fields first, then
 * runtime config, then component bundles. Easier to read in raw form.
 */
export function serializeAgent(metadata: AgentMetadata, systemPrompt: string): string {
  const data: Record<string, unknown> = {
    name: metadata.name,
    description: metadata.description,
  };
  if (metadata.avatar) data.avatar = metadata.avatar;
  if (metadata.llmConnection) data.llmConnection = metadata.llmConnection;
  if (metadata.model) data.model = metadata.model;
  if (metadata.permissionMode) data.permissionMode = metadata.permissionMode;
  if (metadata.thinkingLevel) data.thinkingLevel = metadata.thinkingLevel;
  if (metadata.skills?.length) data.skills = metadata.skills;
  if (metadata.taskModes?.length) data.taskModes = metadata.taskModes;
  if (metadata.sources?.length) data.sources = metadata.sources;
  if (metadata.optionalSources?.length) data.optionalSources = metadata.optionalSources;
  if (metadata.trustedWorkerTools?.length) data.trustedWorkerTools = metadata.trustedWorkerTools;
  if (metadata.visualAgent) data.visualAgent = true;
  if (metadata.greeting) data.greeting = metadata.greeting;
  if (metadata.inputs) data.inputs = metadata.inputs;
  if (metadata.outputs) data.outputs = metadata.outputs;
  if (metadata.tags?.length) data.tags = metadata.tags;
  if (metadata.routing) {
    const routing: Record<string, string[]> = {};
    if (metadata.routing.bestFor?.length) routing.bestFor = metadata.routing.bestFor;
    if (metadata.routing.notFor?.length) routing.notFor = metadata.routing.notFor;
    if (metadata.routing.handsOffTo?.length) routing.handsOffTo = metadata.routing.handsOffTo;
    if (Object.keys(routing).length > 0) data.routing = routing;
  }

  return stringifyFrontmatter(systemPrompt.trimEnd() + '\n', data);
}

export interface CreateAgentInput {
  slug: string;
  metadata: AgentMetadata;
  systemPrompt: string;
}

/**
 * Create or overwrite an agent in the global library. Throws on invalid slug
 * or write failure. Returns the freshly-loaded agent.
 *
 * Caller is responsible for calling `setAgentActive(workspaceRoot, slug, true)`
 * if the new agent should immediately be visible in the calling workspace.
 */
export function writeGlobalAgent(input: CreateAgentInput, options?: AgentStorageOptions): LoadedAgent {
  if (!isValidAgentSlug(input.slug)) {
    throw new Error(`Invalid agent slug: "${input.slug}" (lowercase letters, digits, hyphens; 1-64 chars)`);
  }
  const dir = getGlobalAgentDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, AGENT_FILE);
  // Atomic: a crash mid-write must not leave a truncated AGENT.md, which
  // parses to nothing while still satisfying the reseed existence check.
  atomicWriteFileSync(file, serializeAgent(input.metadata, input.systemPrompt));
  forgetDeletedAgent(input.slug, options);

  const loaded = loadGlobalAgent(input.slug, options);
  if (!loaded) {
    // Should be unreachable — we just wrote a valid file.
    throw new Error(`Failed to re-load agent "${input.slug}" after write`);
  }
  return loaded;
}

const SERIALIZED_AGENT_METADATA_KEYS = [
  'name',
  'description',
  'avatar',
  'llmConnection',
  'model',
  'permissionMode',
  'thinkingLevel',
  'skills',
  'taskModes',
  'sources',
  'optionalSources',
  'trustedWorkerTools',
  'visualAgent',
  'greeting',
  'inputs',
  'outputs',
  'tags',
] as const;

/**
 * Built-in migrations must not erase frontmatter owned by another installed
 * version or a user's customization. Merge supported metadata into the
 * original document while retaining every unknown field.
 */
function writeBuiltInAgentMigration(
  input: CreateAgentInput,
  options?: AgentStorageOptions,
): LoadedAgent {
  const file = getGlobalAgentFile(input.slug, options);
  const original = matter(readFileSync(file, 'utf-8'));
  const supported = matter(serializeAgent(input.metadata, input.systemPrompt)).data as Record<string, unknown>;
  const data = { ...(original.data as Record<string, unknown>) };
  for (const key of SERIALIZED_AGENT_METADATA_KEYS) delete data[key];
  Object.assign(data, supported);
  // Preserve the original body's surrounding bytes. Metadata-only migrations
  // must not erase the customization evidence used by exact-prompt upgrades.
  const oldBody = original.content.trim();
  const body = original.content.replace(oldBody, () => input.systemPrompt);
  const header = stringifyFrontmatter('', data);
  writeFileSync(file, header.slice(0, header.length - matter(header).content.length) + body, 'utf-8');

  const loaded = loadGlobalAgent(input.slug, options);
  if (!loaded) throw new Error(`Failed to re-load migrated agent "${input.slug}"`);
  return loaded;
}

/**
 * Delete an agent from the global library AND from every workspace's
 * activation manifest. The caller passes the list of workspace root paths
 * (the storage layer doesn't know about the workspace registry).
 */
export function deleteGlobalAgent(slug: string, workspaceRootPaths: string[], options?: AgentStorageOptions): boolean {
  if (!isValidAgentSlug(slug)) return false;
  const dir = getGlobalAgentDir(slug, options);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  rememberDeletedAgent(slug, options);

  // Self-heal each workspace's activation list. Errors per-workspace are
  // swallowed — a stale slug is harmless because loadActivatedAgents
  // silently drops missing-library entries.
  for (const wsRoot of workspaceRootPaths) {
    try {
      setAgentActive(wsRoot, slug, false);
    } catch {
      // Ignore — non-existent workspace dir, etc.
    }
  }
  return true;
}

// ============================================================================
// First-run seeding
// ============================================================================

/**
 * Ensure a specific set of agent slugs exists in the global library, writing
 * any that are missing unless the user deleted that agent through the app.
 * Use this for "load-bearing" starter agents without making app deletes
 * temporary.
 *
 * Unlike seedGlobalLibraryIfEmpty, this runs on EVERY startup and ignores
 * the .seeded marker. Existing AGENT.md files are still never overwritten,
 * and app-deleted agents are remembered in `.deleted-agents.json` so they
 * are not recreated on the next startup.
 */
export function ensureRequiredAgents(
  required: ReadonlyArray<{ slug: string; metadata: AgentMetadata; systemPrompt: string }>,
  options?: AgentStorageOptions,
): { ensured: number } {
  const globalAgentsDir = getGlobalAgentsDir(options);
  mkdirSync(globalAgentsDir, { recursive: true });
  let ensured = 0;
  for (const a of required) {
    if (!isValidAgentSlug(a.slug)) continue;
    if (readDeletedAgentSlugs(options).has(a.slug)) continue;
    const dir = getGlobalAgentDir(a.slug, options);
    const file = join(dir, AGENT_FILE);
    // Presence alone is not health: a file truncated by a crash still exists
    // but parses to nothing, and a bare existence check would leave a
    // required agent (the Concierge among them) permanently broken. Reseed
    // when the file is missing OR unreadable.
    const existing = existsSync(file) ? loadGlobalAgent(a.slug, options) : null;
    if (existing) {
      // Keep installed workflows byte-identical: schedules pin their definition
      // digest, but resolve this agent prompt live when the synthesis step starts.
      const suffix = `\n\n${SIGNAL_BRIEFING_INSTRUCTIONS}`;
      if ((a.slug === 'signal-analyst-agent' && a.systemPrompt.endsWith(suffix)
        && existing.systemPrompt === a.systemPrompt.slice(0, -suffix.length))
        || isPreviousSignalTrackPrompt(a.slug, existing.systemPrompt, a.systemPrompt, suffix)) {
        // loadGlobalAgent trims the body; do not erase whitespace-only edits.
        if (matter(readFileSync(file, 'utf-8')).content !== `${existing.systemPrompt}\n`) continue;
        replaceBuiltInAgentPromptText(a.slug, existing.systemPrompt, a.systemPrompt, options);
      }
      continue;
    }
    mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(file, serializeAgent(a.metadata, a.systemPrompt));
    ensured += 1;
  }
  return { ensured };
}

/**
 * Seed the global library with starter agents on first run.
 *
 * Idempotent: existing AGENT.md files are NEVER overwritten. A user who
 * deletes a starter agent and doesn't want it back can simply leave it
 * deleted — the seeder won't recreate it.
 *
 * The "have we seeded?" marker is a hidden `.seeded` file inside the
 * library directory. Its presence prevents re-seeding even if the user
 * deletes every starter; lack of it triggers seeding once.
 */
export function seedGlobalLibraryIfEmpty(
  starters: ReadonlyArray<{ slug: string; metadata: AgentMetadata; systemPrompt: string }>,
  options?: AgentStorageOptions,
): { seeded: number } {
  const globalAgentsDir = getGlobalAgentsDir(options);
  mkdirSync(globalAgentsDir, { recursive: true });
  const marker = join(globalAgentsDir, '.seeded');
  if (existsSync(marker)) return { seeded: 0 };

  const deleted = readDeletedAgentSlugs(options);
  let seeded = 0;
  for (const starter of starters) {
    if (!isValidAgentSlug(starter.slug)) continue;
    if (deleted.has(starter.slug)) continue;
    const dir = getGlobalAgentDir(starter.slug, options);
    const file = join(dir, AGENT_FILE);
    if (existsSync(file)) continue; // never overwrite
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serializeAgent(starter.metadata, starter.systemPrompt), 'utf-8');
    seeded += 1;
  }

  // Always write the marker, even if seeded === 0. The intent is "we've
  // been here before"; a deleted starter shouldn't get re-created.
  try {
    writeFileSync(marker, new Date().toISOString(), 'utf-8');
  } catch {
    // Marker is a hint; failing to write it just means seed will run again.
  }
  return { seeded };
}

/**
 * Ensure core built-in agents have the given skill slugs
 * in their `skills:` frontmatter. Used for one-time silent migration when new
 * load-bearing skills ship — users with existing AGENT.md files (which the
 * seeder doesn't overwrite) still get the new bundle without manual edits.
 *
 * No-op for slugs already present. Only mutates approved built-in slugs by name.
 * User-customized agents are deliberately untouched.
 */
export function ensureBuiltInAgentSkills(
  requiredSkills: ReadonlyArray<string>,
  options?: AgentStorageOptions,
): { updated: number } {
  const builtIns = ['concierge', 'orchestrator'];
  let updated = 0;
  for (const slug of builtIns) {
    updated += ensureBuiltInAgentSkillsForSlug(slug, requiredSkills, options).updated ? 1 : 0;
  }
  return { updated };
}

export function ensureBuiltInAgentSkillsForSlug(
  slug: string,
  requiredSkills: ReadonlyArray<string>,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set(['anything-agent', 'concierge', 'orchestrator', 'industry-hunter', 'ads-agent', 'ads-strategist', 'ad-creative-agent', 'raw-video-editor', 'artist-os-release-manager']);
  if (!builtIns.has(slug)) return { updated: false };

  const loaded = loadGlobalAgent(slug, options);
  if (!loaded) return { updated: false };

  const current = new Set(loaded.metadata.skills ?? []);
  const missing = requiredSkills.filter((s) => !current.has(s) && !current.has(`legacy:${s}`));
  if (missing.length === 0) return { updated: false };

  const next: AgentMetadata = {
    ...loaded.metadata,
    skills: [...(loaded.metadata.skills ?? []), ...missing],
  };

  try {
    writeBuiltInAgentMigration({ slug, metadata: next, systemPrompt: loaded.systemPrompt }, options);
    return { updated: true };
  } catch {
    // Best-effort migration; loading must not fail because of a malformed write.
    return { updated: false };
  }
}

export function ensureBuiltInAgentMetadataSlugs(
  slug: string,
  required: Partial<Pick<AgentMetadata, 'skills' | 'sources' | 'optionalSources'>>,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set(['concierge', 'orchestrator', 'social-publisher', 'industry-hunter', 'ads-agent', 'ads-strategist', 'ad-creative-agent', 'video-director', 'spotify-playlist-creator', 'spotify-analyst', 'youtube-research-agent', 'youtube-intelligence-agent', 'trypost-agent', 'print-agent']);
  if (!builtIns.has(slug)) return { updated: false };

  const loaded = loadGlobalAgent(slug, options);
  if (!loaded) return { updated: false };

  let changed = false;
  const next: AgentMetadata = { ...loaded.metadata };
  for (const key of ['skills', 'sources', 'optionalSources'] as const) {
    const requiredValues = required[key] ?? [];
    if (requiredValues.length === 0) continue;
    const current = next[key] ?? [];
    const effectiveRequired = key === 'skills' ? requiredValues.map(value => current.includes(`legacy:${value}`) ? `legacy:${value}` : value) : requiredValues;
    const extras = current.filter((value) => !effectiveRequired.includes(value));
    const requiredFirst = [...effectiveRequired, ...extras];
    if (agentMetadataValueEquals(current, requiredFirst)) continue;
    next[key] = requiredFirst;
    changed = true;
  }
  const requiredSources = new Set(required.sources ?? []);
  const optionalSources = new Set(required.optionalSources ?? []);
  if (optionalSources.size > 0 && next.sources?.length) {
    const filteredSources = next.sources.filter((source) => !optionalSources.has(source) || requiredSources.has(source));
    if (filteredSources.length !== next.sources.length) {
      next.sources = filteredSources.length > 0 ? filteredSources : undefined;
      changed = true;
    }
  }
  if (requiredSources.size > 0 && next.optionalSources?.length) {
    const filteredOptionalSources = next.optionalSources.filter((source) => !requiredSources.has(source));
    if (filteredOptionalSources.length !== next.optionalSources.length) {
      next.optionalSources = filteredOptionalSources.length > 0 ? filteredOptionalSources : undefined;
      changed = true;
    }
  }
  if (!changed) return { updated: false };

  try {
    writeBuiltInAgentMigration({ slug, metadata: next, systemPrompt: loaded.systemPrompt }, options);
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

/**
 * Apply a narrow metadata migration to a built-in agent. This is intentionally
 * conservative: it only patches fields that still match old shipped values, so
 * user-customized built-ins are preserved.
 */
export function replaceBuiltInAgentMetadata(
  slug: string,
  replacements: Partial<Record<keyof AgentMetadata, { from: unknown; to: unknown }>>,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set([
    'anything-agent',
    'concierge',
    'orchestrator',
    'social-publisher',
    'ads-agent',
    'ads-strategist',
    'ad-creative-agent',
    'ig-trending-power-up',
    'influencer-campaign-power-up',
    'playlisting-power-up',
    'industry-hunter',
    'college-radio-agent',
    'outreach-agent',
    'branding-agent',
    'art-director',
    'spotify-playlist-creator',
    'spotify-analyst',
    'youtube-research-agent',
    'youtube-intelligence-agent',
    'trypost-agent',
    'content-director',
    'record-doctor',
    'x-editorial',
    'content-genius',
    'scriptwriter',
    'persona-agent',
    'world-builder',
    'video-director',
    'artist-os-release-manager',
    'print-agent',
    'raw-video-editor',
    'hypermotion-agent',
    'lyric-video-agent',
    'open-slide-agent',
    'site-builder',
    'website-agent',
    'setup-concierge',
  ]);
  if (!builtIns.has(slug)) return { updated: false };

  const loaded = loadGlobalAgent(slug, options);
  if (!loaded) return { updated: false };

  let changed = false;
  const next: AgentMetadata = { ...loaded.metadata };
  for (const [key, replacement] of Object.entries(replacements) as Array<[keyof AgentMetadata, { from: unknown; to: unknown }]>) {
    if (agentMetadataValueEquals(next[key], replacement.from)) {
      (next as unknown as Record<string, unknown>)[key] = replacement.to;
      changed = true;
    }
  }
  if (!changed) return { updated: false };

  try {
    writeBuiltInAgentMigration({ slug, metadata: next, systemPrompt: loaded.systemPrompt }, options);
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

function agentMetadataValueEquals(a: unknown, b: unknown): boolean {
  // Each load parses fresh objects, so nested recipes must compare by value.
  return isDeepStrictEqual(a, b);
}

/**
 * Apply an exact text migration to built-in agent prompt bodies. This preserves
 * user edits unless the old shipped paragraph is still present verbatim.
 */
export function replaceBuiltInAgentPromptText(
  slug: string,
  oldText: string,
  newText: string,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set(['anything-agent', 'concierge', 'orchestrator', 'social-publisher', 'industry-hunter', 'college-radio-agent', 'outreach-agent', 'record-doctor', 'x-editorial', 'ads-agent', 'ads-strategist', 'ad-creative-agent', 'lyric-video-agent', 'art-director', 'video-director', 'spotify-playlist-creator', 'spotify-analyst', 'youtube-research-agent', 'youtube-intelligence-agent', 'trypost-agent', 'content-director', 'content-genius', 'print-agent', 'signal-scout-agent', 'signal-analyst-agent', 'raw-video-editor']);
  if (!builtIns.has(slug)) return { updated: false };
  const loaded = loadGlobalAgent(slug, options);
  if (
    !loaded
    || oldText === newText
    || !loaded.systemPrompt.includes(oldText)
    || (newText.length > 0 && loaded.systemPrompt.includes(newText))
  ) return { updated: false };

  try {
    writeBuiltInAgentMigration(
      {
        slug,
        metadata: loaded.metadata,
        systemPrompt: loaded.systemPrompt.replace(oldText, newText),
      },
      options,
    );
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

/**
 * Remove accidental duplicate shipped prompt fragments while leaving all
 * surrounding user-authored text untouched. The first occurrence is retained.
 */
export function dedupeBuiltInAgentPromptText(
  slug: string,
  exactText: string,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set(['spotify-playlist-creator', 'ads-agent', 'ads-strategist']);
  if (!builtIns.has(slug) || !exactText) return { updated: false };

  const loaded = loadGlobalAgent(slug, options);
  if (!loaded) return { updated: false };

  const first = loaded.systemPrompt.indexOf(exactText);
  if (first < 0 || loaded.systemPrompt.indexOf(exactText, first + exactText.length) < 0) {
    return { updated: false };
  }

  const prefix = loaded.systemPrompt.slice(0, first + exactText.length);
  const suffix = loaded.systemPrompt
    .slice(first + exactText.length)
    .split(exactText)
    .join('')
    .replace(/\n{3,}/g, '\n\n');

  try {
    writeBuiltInAgentMigration(
      {
        slug,
        metadata: loaded.metadata,
        systemPrompt: `${prefix}${suffix}`,
      },
      options,
    );
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

/**
 * Regex variant for shipped prompt migrations where older installs may have
 * slightly different wrapping or punctuation around the same stale guidance.
 */
export function replaceBuiltInAgentPromptPattern(
  slug: string,
  pattern: RegExp,
  newText: string,
  options?: AgentStorageOptions,
): { updated: boolean } {
  const builtIns = new Set(['concierge', 'orchestrator', 'social-publisher', 'industry-hunter', 'ads-agent', 'ads-strategist', 'ad-creative-agent', 'art-director', 'spotify-analyst']);
  if (!builtIns.has(slug)) return { updated: false };
  const loaded = loadGlobalAgent(slug, options);
  if (!loaded || !pattern.test(loaded.systemPrompt)) return { updated: false };

  try {
    writeBuiltInAgentMigration(
      {
        slug,
        metadata: loaded.metadata,
        systemPrompt: loaded.systemPrompt.replace(pattern, newText),
      },
      options,
    );
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

/**
 * Remove skill slugs from built-in agents without touching their prompt bodies.
 * Used when a once-bundled skill becomes explicit opt-in instead.
 */
export function removeBuiltInAgentSkills(
  skillsToRemove: ReadonlyArray<string>,
  options?: AgentStorageOptions,
): { updated: number } {
  const builtIns = ['concierge', 'orchestrator'];
  const remove = new Set(skillsToRemove);
  let updated = 0;
  for (const slug of builtIns) {
    const loaded = loadGlobalAgent(slug, options);
    if (!loaded?.metadata.skills?.length) continue;
    const nextSkills = loaded.metadata.skills.filter((skill) => !remove.has(skill));
    if (nextSkills.length === loaded.metadata.skills.length) continue;
    const next: AgentMetadata = {
      ...loaded.metadata,
      skills: nextSkills.length > 0 ? nextSkills : undefined,
    };
    try {
      writeBuiltInAgentMigration({ slug, metadata: next, systemPrompt: loaded.systemPrompt }, options);
      updated += 1;
    } catch {
      // Best-effort migration; loading must not fail because of a malformed write.
    }
  }
  return { updated };
}

// Re-export for convenience
export { statSync as _internalStatSync };
