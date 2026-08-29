import { describe, expect, test } from 'bun:test';
import { artistBrandingDoc, type ArtistBranding } from './branding.ts';
import { parseArtistCalendarDocResult } from './calendar.ts';
import { extractJsonBlock } from './json-block.ts';
import { artistProfileDoc, type ArtistProfile } from './profile.ts';
import { normalizeInlineText, normalizeProseText, toFiniteNumber, trimText } from './text.ts';
import { ARTIST_VOICE_TARGET_AGENT_SLUGS, artistVoiceDoc, type ArtistVoice } from './voice.ts';

const doc = (body: string) => ({ body });

describe('text normalizers', () => {
  test('prose collapses spaces and tabs but keeps single newlines', () => {
    expect(normalizeProseText('a  \t b\nc')).toBe('a b\nc');
  });

  test('prose caps consecutive blank lines at one', () => {
    expect(normalizeProseText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  test('inline flattens newlines, unlike prose', () => {
    expect(normalizeInlineText('a\nb')).toBe('a b');
    expect(normalizeProseText('a\nb')).toBe('a\nb');
  });

  test('trim preserves interior whitespace', () => {
    expect(trimText('  a  b  ')).toBe('a  b');
  });

  test('non-strings and blank strings normalize to undefined', () => {
    for (const normalize of [normalizeProseText, normalizeInlineText, trimText]) {
      expect(normalize(undefined)).toBeUndefined();
      expect(normalize(null)).toBeUndefined();
      expect(normalize(42)).toBeUndefined();
      expect(normalize({})).toBeUndefined();
      expect(normalize('   ')).toBeUndefined();
    }
  });

  test('toFiniteNumber rejects NaN, Infinity, and non-numbers', () => {
    expect(toFiniteNumber(5)).toBe(5);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(Number.NaN)).toBeUndefined();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toFiniteNumber('5')).toBeUndefined();
  });
});

describe('extractJsonBlock', () => {
  test('prefers a fenced json block', () => {
    expect(extractJsonBlock('intro\n```json\n{"a":1}\n```\ntrailing {noise}')?.trim()).toBe('{"a":1}');
  });

  test('falls back to first-brace through last-brace when unfenced', () => {
    expect(extractJsonBlock('lead {"a":1} tail')).toBe('{"a":1}');
  });

  test('returns null when there is no brace pair', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
    expect(extractJsonBlock('} out of order {')).toBeNull();
  });
});

describe('artist text docs', () => {
  test('profile and branding broadcast; voice targets named agents', () => {
    expect(artistProfileDoc.metadata().routing).toEqual({ mode: 'broadcast' });
    expect(artistBrandingDoc.metadata().routing).toEqual({ mode: 'broadcast' });
    expect(artistVoiceDoc.metadata().routing).toEqual({
      mode: 'targeted',
      agents: [...ARTIST_VOICE_TARGET_AGENT_SLUGS],
    });
  });

  test('an absent or blank doc parses to an empty record without error', () => {
    for (const target of [artistProfileDoc, artistVoiceDoc, artistBrandingDoc]) {
      expect(target.parse(undefined).ok).toBe(true);
      const blank = target.parse(doc('   \n  '));
      expect(blank.ok).toBe(true);
      expect(blank.value.version).toBe(1);
    }
  });

  test('round-trips a record through serialize and parse', () => {
    const branding: ArtistBranding = {
      version: 1,
      creativeDna: 'Southern gothic, chrome textures.',
      tensions: 'spiritual x reckless',
      updatedAt: '2026-07-02T00:00:00.000Z',
    };
    const parsed = artistBrandingDoc.parse(doc(artistBrandingDoc.serialize(branding)));
    expect(parsed.ok).toBe(true);
    expect(parsed.value.creativeDna).toBe('Southern gothic, chrome textures.');
    expect(parsed.value.tensions).toBe('spiritual x reckless');
  });

  test('serialized bodies carry the prose preamble above a json fence', () => {
    const body = artistVoiceDoc.serialize(artistVoiceDoc.empty());
    expect(body.startsWith('This is the artist voice guide.')).toBe(true);
    expect(body).toContain('```json');
    expect(body.trimEnd().endsWith('```')).toBe(true);
  });

  test('reports an unsupported shape when version is not 1', () => {
    const result = artistVoiceDoc.parse(doc('```json\n{"version":2}\n```'));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('Artist Voice JSON has an unsupported shape.');
  });

  test('reports malformed json distinctly from a missing block', () => {
    const malformed = artistBrandingDoc.parse(doc('```json\n{not json\n```'));
    expect(malformed.ok === false && malformed.error).toBe('Artist Branding JSON is malformed.');

    const missing = artistBrandingDoc.parse(doc('prose only, no record'));
    expect(missing.ok === false && missing.error).toBe(
      'Artist Branding exists, but no JSON block could be read.',
    );
  });

  test('a failed parse still returns a usable empty record', () => {
    const result = artistVoiceDoc.parse(doc('```json\n{"version":9}\n```'));
    expect(result.value.version).toBe(1);
    expect(result.value.summary).toBeUndefined();
  });

  test('drops non-string field values instead of storing them', () => {
    const result = artistVoiceDoc.parse(doc('```json\n{"version":1,"summary":42,"avoid":null}\n```'));
    expect(result.ok).toBe(true);
    expect(result.value.summary).toBeUndefined();
    expect(result.value.avoid).toBeUndefined();
  });

  test('completion scores only the fields that count toward it', () => {
    expect(artistBrandingDoc.completion(artistBrandingDoc.empty())).toBe(0);

    // `notes` is stored but excluded from completion, so it must not move the score.
    const notesOnly: ArtistBranding = { ...artistBrandingDoc.empty(), notes: 'ignored' };
    expect(artistBrandingDoc.completion(notesOnly)).toBe(0);

    const oneOfSeven: ArtistBranding = { ...artistBrandingDoc.empty(), creativeDna: 'set' };
    expect(artistBrandingDoc.completion(oneOfSeven)).toBe(14);

    const voiceFull: ArtistVoice = {
      ...artistVoiceDoc.empty(),
      summary: 'a',
      speakingStyle: 'a',
      vocabulary: 'a',
      avoid: 'a',
      captionExamples: 'a',
      commentReplyExamples: 'a',
      postExamples: 'a',
      writingExcerpts: 'a',
    };
    expect(artistVoiceDoc.completion(voiceFull)).toBe(100);
  });

  test('profile recovers from the markdown intake form when no json is present', () => {
    const intake = [
      '## Basics',
      '- Artist name: Mercy Lane',
      '- Primary genre or lane: alt-country',
      '- One thing you refuse to be in your branding: a novelty act',
    ].join('\n');

    const result = artistProfileDoc.parse(doc(intake));
    expect(result.ok).toBe(true);
    expect(result.value.artistName).toBe('Mercy Lane');
    expect(result.value.sound).toBe('alt-country');
    expect(result.value.rules).toBe('a novelty act');
  });

  test('markdown recovery requires the intake markers, not just prose', () => {
    const result = artistProfileDoc.parse(doc('## Basics\nsome prose without the artist name line'));
    expect(result.ok).toBe(false);
  });

  test('profile stores fields excluded from completion', () => {
    const profile: ArtistProfile = { ...artistProfileDoc.empty(), team: 'manager: Dana' };
    const parsed = artistProfileDoc.parse(doc(artistProfileDoc.serialize(profile)));
    expect(parsed.value.team).toBe('manager: Dana');
    expect(artistProfileDoc.completion(profile)).toBe(0);
  });
});

describe('artist calendar freshness', () => {
  test('preserves persisted document timestamps and uses them for legacy event timestamps', () => {
    const result = parseArtistCalendarDocResult(doc([
      '```json',
      JSON.stringify({
        version: 1,
        events: [{ id: 'event-1', date: '2026-09-01', title: 'Release', workspaceLinks: [], relatedPersonIds: [] }],
        updatedAt: '2026-08-29T01:00:00.000Z',
      }),
      '```',
    ].join('\n')));

    expect(result.ok).toBe(true);
    expect(result.calendar.updatedAt).toBe('2026-08-29T01:00:00.000Z');
    expect(result.calendar.events[0]?.createdAt).toBe('2026-08-29T01:00:00.000Z');
    expect(result.calendar.events[0]?.updatedAt).toBe('2026-08-29T01:00:00.000Z');
  });

  test('does not make a persisted calendar look fresh when updatedAt is missing', () => {
    const result = parseArtistCalendarDocResult(doc('```json\n{"version":1,"events":[]}\n```'));
    expect(result.ok).toBe(false);
    expect(result.calendar.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});
