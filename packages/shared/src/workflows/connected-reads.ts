import { isDurableWebReadUrls } from '../protocol/durable-execution';

/** A host-fetched read supplied as frozen context before workflow agents run. */
export interface DurableWorkflowConnectedRead {
  sourceSlug: string;
  url: string;
}

/** Exact queryless HTTPS target. The host checks source boundaries and current GET policy. */
export function isDurableConnectedReadUrl(value: unknown): value is string {
  return typeof value === 'string' && isDurableWebReadUrls([value])
    && !value.includes('?') && !value.includes('#') && !/%(?:2f|5c|00)/i.test(new URL(value).pathname);
}

export function isDurableWorkflowConnectedReads(value: unknown): value is DurableWorkflowConnectedRead[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype
      || Object.keys(entry).length !== 2 || Object.keys(entry).some(key => key !== 'sourceSlug' && key !== 'url')
      || typeof entry.sourceSlug !== 'string' || entry.sourceSlug !== entry.sourceSlug.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.sourceSlug)
      || !isDurableConnectedReadUrl(entry.url)) return false;
    const identity = JSON.stringify([entry.sourceSlug, entry.url]);
    if (seen.has(identity)) return false;
    seen.add(identity);
  }
  return true;
}
