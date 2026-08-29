/**
 * Artist context — text-record doc factory
 *
 * Profile, Voice, and Branding are the same document shape: a flat record of
 * optional prose fields plus `version` and `updatedAt`, stored as a ```json
 * fence under a prose preamble. Each previously carried its own hand-written
 * copy of the parse/normalize/serialize/completion quartet.
 *
 * Docs with nested records (Spotify, Network, Calendar, Intel) do NOT belong
 * here — their per-field validation is real logic, not boilerplate.
 */
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { buildContextDocBody, extractJsonBlock } from './json-block.ts';
import { normalizeProseText } from './text.ts';

/** Fields every artist text record carries. */
export interface ArtistTextRecord {
  version: 1;
  updatedAt: string;
}

/** The optional prose fields of a record — everything but the envelope. */
export type ArtistTextField<T extends ArtistTextRecord> = Exclude<keyof T, 'version' | 'updatedAt'>;

/**
 * Parse outcome. `value` is always usable: on failure it is the empty record,
 * so callers can render a form without null-checking. `error` is user-facing.
 */
export type ArtistTextDocParse<T extends ArtistTextRecord> =
  | { ok: true; value: T }
  | { ok: false; value: T; error: string };

export interface ArtistTextDocDefinition<T extends ArtistTextRecord> {
  /** Context doc slug, e.g. 'artist-profile'. */
  slug: string;
  /** Display name used in metadata and in parse error messages. */
  label: string;
  description: string;
  routing: ContextDocMetadata['routing'];
  /** Fields normalized on read and write. */
  fields: readonly ArtistTextField<T>[];
  /** Fields counted toward completion. Defaults to `fields`. */
  completionFields?: readonly ArtistTextField<T>[];
  /** Prose lines written above the JSON fence, for the reading agent. */
  preamble: readonly string[];
  /**
   * Optional recovery for bodies with no JSON fence — e.g. a markdown intake
   * form the user filled in by hand. Returning null falls through to an error.
   */
  fallbackParse?: (body: string) => Partial<T> | null;
}

export interface ArtistTextDoc<T extends ArtistTextRecord> {
  slug: string;
  metadata: () => ContextDocMetadata;
  empty: () => T;
  normalize: (record: Partial<T>) => T;
  parse: (doc: Pick<LoadedContextDoc, 'body'> | undefined) => ArtistTextDocParse<T>;
  serialize: (record: T) => string;
  completion: (record: T) => number;
}

export function defineArtistTextDoc<T extends ArtistTextRecord>(
  definition: ArtistTextDocDefinition<T>,
): ArtistTextDoc<T> {
  const { slug, label, description, routing, fields, preamble, fallbackParse } = definition;
  const completionFields = definition.completionFields ?? fields;

  const metadata = (): ContextDocMetadata => ({
    name: label,
    description,
    routing,
    enabled: true,
  });

  const empty = (): T => ({ version: 1, updatedAt: new Date().toISOString() }) as T;

  const normalizeWithTimestamp = (record: Partial<T>, updatedAt: string): T => {
    // Key insertion order is load-bearing: it is the order fields appear in the
    // serialized doc on disk. `version` first, `updatedAt` last.
    const normalized: Record<string, unknown> = { version: 1 };
    for (const field of fields) {
      normalized[field as string] = normalizeProseText(record[field]);
    }
    normalized.updatedAt = updatedAt;
    return normalized as T;
  };

  const normalize = (record: Partial<T>): T => normalizeWithTimestamp(record, new Date().toISOString());

  const parse = (doc: Pick<LoadedContextDoc, 'body'> | undefined): ArtistTextDocParse<T> => {
    if (!doc?.body.trim()) return { ok: true, value: empty() };

    const json = extractJsonBlock(doc.body);
    if (!json) {
      const recovered = fallbackParse?.(doc.body);
      if (recovered) return { ok: true, value: normalize(recovered) };
      return {
        ok: false,
        value: empty(),
        error: `${label} exists, but no JSON block could be read.`,
      };
    }

    try {
      const parsed = JSON.parse(json) as Partial<T>;
      if (parsed.version !== 1) {
        return { ok: false, value: empty(), error: `${label} JSON has an unsupported shape.` };
      }
      if (!isIsoTimestamp(parsed.updatedAt)) {
        return { ok: false, value: empty(), error: `${label} updatedAt is missing or invalid.` };
      }
      return { ok: true, value: normalizeWithTimestamp(parsed, parsed.updatedAt) };
    } catch {
      return { ok: false, value: empty(), error: `${label} JSON is malformed.` };
    }
  };

  const serialize = (record: T): string => buildContextDocBody(preamble, normalize(record));

  const completion = (record: T): number => {
    const filled = completionFields.filter((field) => Boolean(normalizeProseText(record[field]))).length;
    return Math.round((filled / completionFields.length) * 100);
  };

  return { slug, metadata, empty, normalize, parse, serialize, completion };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}
