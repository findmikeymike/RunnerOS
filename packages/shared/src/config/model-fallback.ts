import type {
  LlmConnectionWithStatus,
  ModelFallbackChain,
  ModelFallbackEntry,
} from './llm-connections.ts';

export const MAX_MODEL_FALLBACKS = 2;

export type ModelFallbackValidationIssue =
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

export function validateModelFallbackChain(
  chain: ModelFallbackChain,
  primary?: { connectionSlug: string; model?: string },
): ModelFallbackValidationIssue[] {
  const issues: ModelFallbackValidationIssue[] = [];
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

export function resolveModelFallbackChain(input: {
  primaryConnectionSlug: string;
  primaryModel: string;
  connections: LlmConnectionWithStatus[];
  globalChain?: ModelFallbackChain;
}): ModelFallbackResolution {
  const primary = input.connections.find((connection) => connection.slug === input.primaryConnectionSlug);
  const chain = primary?.fallbackChain ?? input.globalChain;
  if (!chain?.enabled || chain.entries.length === 0) return { candidates: [], skipped: [] };

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
