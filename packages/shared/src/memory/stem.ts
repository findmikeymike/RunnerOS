/**
 * Light English stemming for lexical recall.
 *
 * Recall matched on raw tokens, so an inflected query returned *nothing* —
 * `scoreEntry` drops an entry with no token or phrase hit, so "playlists"
 * against a note about a "playlist" produced zero results rather than a worse
 * ranking. An artist does not phrase a question the way they phrased the note.
 *
 * This is deliberately not a full Porter implementation. Porter's later steps
 * exist to collapse derivational forms for document ranking (`relational` →
 * `relate`) and are wrong here: memory entries are short, and over-stemming
 * costs precision on a store of a few hundred facts. What follows handles the
 * inflections that actually appear in the failures — plurals and the common
 * verb endings — and leaves everything else alone.
 *
 * When SQLite FTS5 lands (spec 07 Slice E step 2) its `porter` tokenizer takes
 * over and this becomes the fallback for in-memory ranking.
 */

/** Ends in a double consonant that a suffix strip should collapse: `shipp` → `ship`. */
function collapseDoubleConsonant(value: string): string {
  const last = value.at(-1);
  const prev = value.at(-2);
  if (!last || !prev || last !== prev) return value;
  // `ll`, `ss`, `zz`, `ff` are real word endings, not artifacts of stripping.
  if ('lszf'.includes(last)) return value;
  if ('aeiou'.includes(last)) return value;
  return value.slice(0, -1);
}

function stemPlural(token: string): string | null {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('sses')) return token.slice(0, -2);
  // `matches` → `match`, `boxes` → `box`. Only where the bare `s` rule would
  // leave a stem that no longer matches the singular.
  if (token.length > 4 && token.endsWith('es')) {
    const stem = token.slice(0, -2);
    if (/(ch|sh|ss|x|z)$/.test(stem)) return stem;
  }
  if (token.length > 3 && token.endsWith('s')) {
    // `class`, `status`, `analysis`, `press` are not plurals.
    if (/(ss|us|is)$/.test(token)) return null;
    return token.slice(0, -1);
  }
  return null;
}

function stemVerb(token: string): string | null {
  if (token.length > 5 && token.endsWith('ing')) {
    const stem = collapseDoubleConsonant(token.slice(0, -3));
    return stem.length >= 3 ? stem : null;
  }
  if (token.length > 4 && token.endsWith('ed')) {
    const stem = collapseDoubleConsonant(token.slice(0, -2));
    return stem.length >= 3 ? stem : null;
  }
  return null;
}

/**
 * Reduce one lowercase token to its stem. Returns the token unchanged when no
 * rule applies — never returns empty.
 *
 * Plural rules run before verb rules: a token is normally one or the other, and
 * trying both compounds errors (`ships` → `ship`, not `sh`).
 */
export function stemToken(token: string): string {
  if (token.length <= 3) return token;
  const plural = stemPlural(token);
  if (plural && plural.length >= 3) return plural;
  const verb = stemVerb(token);
  if (verb) return verb;
  return token;
}

/** Lowercase word tokens, stemmed, for word-level comparison. */
export function stemmedWordSet(value: string): Set<string> {
  const out = new Set<string>();
  for (const raw of value.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (raw.length >= 2) out.add(stemToken(raw));
  }
  return out;
}
