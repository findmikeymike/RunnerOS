/**
 * Artist context — JSON block extraction
 *
 * Artist context docs are markdown: prose guidance for the agent, followed by a
 * ```json fence holding the structured record. This pulls the fence back out.
 */

/**
 * Returns the raw JSON text from a context doc body, or null when none is found.
 *
 * Prefers a ```json fence. Falls back to the first `{` through the last `}`,
 * which is lenient by design: several shipped docs predate the fence convention.
 * The fallback can pick up braces that appear in prose, so callers must treat a
 * successful extraction as "candidate text", not "valid record", and validate
 * the parsed result before trusting it.
 */
export function extractJsonBlock(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return body.slice(firstBrace, lastBrace + 1);
}

/** Wraps a record in the prose + ```json fence layout used by every artist context doc. */
export function buildContextDocBody(preamble: readonly string[], record: unknown): string {
  return [...preamble, '', '```json', JSON.stringify(record, null, 2), '```'].join('\n');
}
