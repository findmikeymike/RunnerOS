import { createHash } from 'node:crypto';

interface AuthoredRecord { prompt?: unknown; input?: unknown; legacySkillReferences?: unknown; legacySkillPromptHash?: unknown }
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function mentions(text: string): string[] {
  const values = [...text.matchAll(/(?:^|[\s(])@([a-zA-Z][a-zA-Z0-9-]*)/g)].map(match => match[1]!.toLowerCase());
  for (const match of text.matchAll(/\[skill:(?:[^\]\n:]+:)?([\w-]+)\]/g)) values.push(match[1]!);
  return [...new Set(values)];
}
function authoredText(record: AuthoredRecord): string | null {
  return typeof record.prompt === 'string' ? record.prompt : typeof record.input === 'string' ? record.input : null;
}

/** Runtime accepts the frozen choice only while its exact authored template is unchanged. */
export function getLegacyAuthoredSkillReferences(record: AuthoredRecord): string[] {
  const text = authoredText(record);
  if (text === null || record.legacySkillPromptHash !== digest(text) || !Array.isArray(record.legacySkillReferences)) return [];
  const selected = new Set(mentions(text));
  return [...new Set(record.legacySkillReferences.filter((slug): slug is string => typeof slug === 'string' && selected.has(slug)))];
}

/** Pure startup transform. The caller supplies only frozen, unchanged historical records. */
export function markLegacyAuthoredSkillReferences<T>(value: T, affectedSlugs: ReadonlySet<string>): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const isPrompt = record.type === 'prompt' && typeof record.prompt === 'string';
    const isWorkflowStep = typeof record.id === 'string' && typeof record.agent === 'string' && typeof record.input === 'string';
    const output = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]));
    if (!isPrompt && !isWorkflowStep) return output;
    const text = authoredText(record)!;
    const currentHash = digest(text);
    // An edited template must never silently regain its old selection on another startup.
    if (record.legacySkillPromptHash !== undefined && record.legacySkillPromptHash !== currentHash) return output;
    const refs = [...new Set([...getLegacyAuthoredSkillReferences(record), ...mentions(text).filter(slug => affectedSlugs.has(slug))])];
    return refs.length ? { ...output, legacySkillReferences: refs, legacySkillPromptHash: currentHash } : output;
  };
  return visit(value) as T;
}

/** A fresh input's empty selection is durable: retries must not revive session-wide legacy defaults. */
export function resolveRunLegacySkillReferences(input: {
  explicit?: readonly string[];
  historical?: readonly string[];
  previousRunId?: string;
  previousRunReferences?: readonly string[];
  replayMessageId?: string;
  isRetry?: boolean;
}): string[] {
  if (input.explicit !== undefined) return [...input.explicit];
  if (input.isRetry || (input.replayMessageId && input.replayMessageId === input.previousRunId)) return [...(input.previousRunReferences ?? [])];
  if (input.replayMessageId) return [...(input.historical ?? [])];
  return [];
}
