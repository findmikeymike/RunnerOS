/**
 * Artist context — analytics snapshot envelope
 *
 * Spotify and Instagram snapshots share a parse envelope but not their
 * validation: each decides for itself which fields make a record usable. This
 * holds only the envelope — locating the JSON, classifying failures, and the
 * three user-facing error strings.
 *
 * Snapshots differ from text docs in two ways worth remembering:
 *   - an absent doc is `null`, not an empty record. There is no meaningful
 *     "empty snapshot"; callers must render "no data yet" instead.
 *   - `version` is not the validity check. A snapshot is judged on whether it
 *     carries a date and metrics, because these docs are written by scrapers
 *     and skills rather than by a form.
 */
import { extractJsonBlock } from './json-block.ts';

export type ArtistSnapshotParse<T> =
  | { ok: true; snapshot: T | null }
  | { ok: false; snapshot: null; error: string };

/**
 * Runs `build` over the JSON record in `body`. `build` returns null when the
 * record is unusable, which becomes the "unsupported shape" error. Anything
 * thrown inside `build` is reported as malformed, matching a parse failure.
 */
export function parseArtistSnapshotBody<TParsed, T>(
  label: string,
  body: string,
  build: (parsed: TParsed) => T | null,
): ArtistSnapshotParse<T> {
  const json = extractJsonBlock(body);
  if (!json) {
    return { ok: false, snapshot: null, error: `${label} exists, but no JSON block could be read.` };
  }
  try {
    const built = build(JSON.parse(json) as TParsed);
    if (!built) {
      return { ok: false, snapshot: null, error: `${label} JSON has an unsupported shape.` };
    }
    return { ok: true, snapshot: built };
  } catch {
    return { ok: false, snapshot: null, error: `${label} JSON is malformed.` };
  }
}
