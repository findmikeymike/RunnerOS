import type {
  LlmConnectionWithStatus,
  ModelFallbackChain,
  ModelFallbackEntry,
  ModelFallbackRole,
  ModelFallbackProfile,
} from './llm-connections.ts';

export const MAX_MODEL_FALLBACKS = 2;

export type ModelFallbackValidationIssue =
  | 'invalid-chain'
  | 'too-many-entries'
  | 'missing-connection'
  | 'missing-model'
  | 'duplicate-entry'
  | 'self-reference';

export interface ResolvedModelFallbackCandidate {
  connectionSlug: string;
  model: string;
  chainIndex: number;
}

export type ModelFallbackSkipReason =
  | 'deleted-connection'
  | 'unauthenticated-connection'
  | 'missing-model'
  | 'self-reference'
  | 'duplicate-entry';

export interface SkippedModelFallbackEntry {
  entry: ModelFallbackEntry;
  chainIndex: number;
  reason: ModelFallbackSkipReason;
}

export interface ModelFallbackResolution {
  candidates: ResolvedModelFallbackCandidate[];
  skipped: SkippedModelFallbackEntry[];
}

function normalizedEntry(entry: ModelFallbackEntry): ModelFallbackEntry {
  return {
    connectionSlug: entry.connectionSlug.trim(),
    ...(entry.model?.trim() ? { model: entry.model.trim() } : {}),
  };
}

function entryKey(connectionSlug: string, model: string): string {
  return `${connectionSlug}\u0000${model}`;
}

function connectionDefaultModel(connection: LlmConnectionWithStatus): string | undefined {
  if (connection.defaultModel?.trim()) return connection.defaultModel.trim();
  const first = connection.models?.[0];
  if (!first) return undefined;
  return (typeof first === 'string' ? first : first.id).trim() || undefined;
}

function validateProfile(
  chain: ModelFallbackProfile,
  primary?: { connectionSlug: string; model?: string },
): ModelFallbackValidationIssue[] {
  const issues: ModelFallbackValidationIssue[] = [];
  if (!validProfileShape(chain)) return ['invalid-chain'];
  if (chain.entries.length > MAX_MODEL_FALLBACKS) issues.push('too-many-entries');

  const seen = new Set<string>();
  for (const rawEntry of chain.entries) {
    const entry = normalizedEntry(rawEntry);
    if (!entry.connectionSlug) {
      issues.push('missing-connection');
      continue;
    }
    if (rawEntry.model !== undefined && !entry.model) issues.push('missing-model');

    const key = entryKey(entry.connectionSlug, entry.model ?? '');
    if (seen.has(key)) issues.push('duplicate-entry');
    seen.add(key);

    if (
      primary
      && entry.connectionSlug === primary.connectionSlug
      && (entry.model ?? primary.model ?? '') === (primary.model ?? entry.model ?? '')
    ) {
      issues.push('self-reference');
    }
  }

  return [...new Set(issues)];
}

function validProfileShape(value: unknown): value is ModelFallbackProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as ModelFallbackProfile;
  return typeof profile.enabled === 'boolean' && Array.isArray(profile.entries)
    && profile.entries.every(entry => entry && typeof entry === 'object'
      && typeof entry.connectionSlug === 'string'
      && (entry.model === undefined || typeof entry.model === 'string'));
}

export function validateModelFallbackChain(
  chain: ModelFallbackChain,
  primary?: { connectionSlug: string; model?: string },
): ModelFallbackValidationIssue[] {
  const issues = validateProfile(chain, primary);
  if (!chain || typeof chain !== 'object') return issues;
  if (chain.inheritGeneral !== undefined && chain.inheritGeneral !== true) issues.push('invalid-chain');
  if (chain.profiles !== undefined) {
    if (!chain.profiles || typeof chain.profiles !== 'object' || Array.isArray(chain.profiles)) {
      issues.push('invalid-chain');
    } else {
      for (const [role, profile] of Object.entries(chain.profiles)) {
        if (role !== 'reasoning' && role !== 'fast') issues.push('invalid-chain');
        else if (profile !== undefined) issues.push(...validateProfile(profile, primary));
      }
    }
  }
  return [...new Set(issues)];
}

/** Absence inherits only the matching role; an explicit disabled list blocks it. */
export function selectModelFallbackProfile(
  local: ModelFallbackChain | undefined,
  global: ModelFallbackChain | undefined,
  role?: ModelFallbackRole,
): ModelFallbackProfile | undefined {
  if (role !== undefined && role !== 'reasoning' && role !== 'fast') return undefined;
  if (local?.inheritGeneral !== undefined && local.inheritGeneral !== true) return undefined;
  let selected: ModelFallbackProfile | undefined;
  if (role) {
    const profiles = local?.profiles;
    if (profiles !== undefined && (!profiles || typeof profiles !== 'object' || Array.isArray(profiles))) return undefined;
    selected = profiles && Object.prototype.hasOwnProperty.call(profiles, role)
      && profiles[role] !== undefined ? profiles[role] : global?.profiles?.[role];
  } else {
    selected = local?.inheritGeneral ? global : (local ?? global);
  }
  return validProfileShape(selected) && selected.entries.length <= MAX_MODEL_FALLBACKS ? selected : undefined;
}

/** Change one Settings list without resetting the other work types. */
export function updateModelFallbackProfile(
  chain: ModelFallbackChain | undefined,
  role: ModelFallbackRole | undefined,
  profile: ModelFallbackProfile | undefined,
): ModelFallbackChain | undefined {
  if (!role) {
    if (profile) return { ...chain, enabled: profile.enabled, entries: profile.entries, inheritGeneral: undefined };
    if (!chain?.profiles || Object.keys(chain.profiles).length === 0) return undefined;
    return { ...chain, enabled: false, entries: [], inheritGeneral: true };
  }
  const next: ModelFallbackChain = chain
    ? { ...chain, profiles: { ...chain.profiles } }
    : { enabled: false, entries: [], inheritGeneral: true, profiles: {} };
  if (profile === undefined) delete next.profiles![role];
  else next.profiles![role] = { enabled: profile.enabled, entries: profile.entries };
  if (Object.keys(next.profiles!).length === 0) {
    delete next.profiles;
    if (next.inheritGeneral) return undefined;
  }
  return next;
}

export function resolveModelFallbackChain(input: {
  primaryConnectionSlug: string;
  primaryModel: string;
  connections: LlmConnectionWithStatus[];
  globalChain?: ModelFallbackChain;
  role?: ModelFallbackRole;
}): ModelFallbackResolution {
  const primary = input.connections.find((connection) => connection.slug === input.primaryConnectionSlug);
  const chain = selectModelFallbackProfile(primary?.fallbackChain, input.globalChain, input.role);
  if (!validProfileShape(chain) || !chain.enabled || chain.entries.length === 0 || chain.entries.length > MAX_MODEL_FALLBACKS) return { candidates: [], skipped: [] };

  const candidates: ResolvedModelFallbackCandidate[] = [];
  const skipped: SkippedModelFallbackEntry[] = [];
  const seen = new Set<string>([entryKey(input.primaryConnectionSlug, input.primaryModel)]);

  for (const [index, rawEntry] of chain.entries.slice(0, MAX_MODEL_FALLBACKS).entries()) {
    const entry = normalizedEntry(rawEntry);
    const chainIndex = index + 1;
    const connection = input.connections.find((candidate) => candidate.slug === entry.connectionSlug);
    if (!connection) {
      skipped.push({ entry, chainIndex, reason: 'deleted-connection' });
      continue;
    }
    if (!connection.isAuthenticated) {
      skipped.push({ entry, chainIndex, reason: 'unauthenticated-connection' });
      continue;
    }

    const model = entry.model ?? connectionDefaultModel(connection);
    if (!model) {
      skipped.push({ entry, chainIndex, reason: 'missing-model' });
      continue;
    }

    const key = entryKey(entry.connectionSlug, model);
    if (key === entryKey(input.primaryConnectionSlug, input.primaryModel)) {
      skipped.push({ entry, chainIndex, reason: 'self-reference' });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ entry, chainIndex, reason: 'duplicate-entry' });
      continue;
    }

    seen.add(key);
    candidates.push({ connectionSlug: entry.connectionSlug, model, chainIndex });
  }

  return { candidates, skipped };
}
