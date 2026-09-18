export type DurableSourceWriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Explicit workflow scope; each actual write still requires its exact payload approval. */
export interface DurableWorkflowSourceWrite {
  sourceSlug: string;
  methods: DurableSourceWriteMethod[];
}

export function isDurableWorkflowSourceWrites(value: unknown): value is DurableWorkflowSourceWrite[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return false;
  const sources = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype
      || Object.keys(entry).length !== 2 || Object.keys(entry).some(key => key !== 'sourceSlug' && key !== 'methods')
      || typeof entry.sourceSlug !== 'string' || entry.sourceSlug !== entry.sourceSlug.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.sourceSlug)
      || sources.has(entry.sourceSlug) || !Array.isArray(entry.methods) || entry.methods.length < 1 || entry.methods.length > 4
      || [...entry.methods].some((method: unknown) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method as string))
      || new Set(entry.methods).size !== entry.methods.length) return false;
    sources.add(entry.sourceSlug);
  }
  return true;
}
