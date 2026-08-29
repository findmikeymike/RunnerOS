/**
 * Artist context — text normalizers
 *
 * Three distinct normalizers, deliberately kept separate. The renderer modules
 * these were lifted from each carried a private `clean()` with subtly different
 * behavior, and collapsing them into one would silently change what gets stored
 * in agent-facing context docs:
 *
 *   - prose  keeps paragraph breaks (multi-line bios, voice examples)
 *   - inline flattens everything to a single line (names, cities, labels)
 *   - trim   only trims (values that must survive byte-for-byte otherwise)
 *
 * Non-strings normalize to `undefined` rather than throwing, so a malformed
 * context doc degrades field-by-field instead of failing the whole parse.
 */

/**
 * Collapses runs of spaces/tabs and caps consecutive blank lines at one,
 * but preserves single newlines. Use for multi-line prose fields.
 */
export function normalizeProseText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return trimmed || undefined;
}

/**
 * Collapses all whitespace (including newlines) to single spaces.
 * Use for values that must render on one line.
 */
export function normalizeInlineText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

/**
 * Trims only. Use where interior whitespace is meaningful.
 */
export function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Finite numbers only — discards NaN, Infinity, and non-numbers. */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/** Finite and >= 0. For counts that cannot meaningfully go negative. */
export function toNonNegativeNumber(value: unknown): number | undefined {
  const number = toFiniteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

/** Finite, integral, and > 0. For window sizes and similar. */
export function toPositiveInteger(value: unknown): number | undefined {
  const number = toFiniteNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Calendar-date shape check (YYYY-MM-DD). Does not validate the date itself. */
export function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
