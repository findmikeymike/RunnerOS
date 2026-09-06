import { describe, expect, test } from 'bun:test';
import { stemToken, stemmedWordSet } from './stem.ts';

describe('stemToken', () => {
  test('collapses the inflections that made recall return nothing', () => {
    expect(stemToken('playlists')).toBe(stemToken('playlist'));
    expect(stemToken('releases')).toBe(stemToken('release'));
    expect(stemToken('placements')).toBe(stemToken('placement'));
    expect(stemToken('shipping')).toBe(stemToken('ships'));
    expect(stemToken('shipped')).toBe(stemToken('ship'));
    expect(stemToken('studies')).toBe(stemToken('study'));
    expect(stemToken('matches')).toBe(stemToken('match'));
  });

  test('leaves words that merely end in s alone', () => {
    for (const word of ['class', 'status', 'analysis', 'press', 'business', 'address', 'focus', 'wellness']) {
      expect(stemToken(word)).toBe(word);
    }
  });

  test('leaves short words alone rather than mangling them', () => {
    for (const word of ['bio', 'the', 'ads', 'ep']) {
      expect(stemToken(word)).toBe(word);
    }
  });

  test('never returns an empty stem', () => {
    for (const word of ['ing', 'ed', 'sses', 'ies', 'ss', 'aaa', 'running', 'seeded']) {
      expect(stemToken(word).length).toBeGreaterThan(0);
    }
  });

  /**
   * The property that actually matters. A stem may be an ugly non-word
   * ("series" → "sery") without hurting recall, because both the query and the
   * stored text pass through the same function. What would hurt is asymmetry:
   * a word stemming differently depending on which side it appears on.
   */
  test('is idempotent, so a stem never drifts on a second pass', () => {
    const words = ['playlists', 'releases', 'shipping', 'series', 'always', 'studies', 'matches', 'class', 'campaigns'];
    for (const word of words) {
      expect(stemToken(stemToken(word))).toBe(stemToken(word));
    }
  });

  test('collapses tenses of one verb, which is the point', () => {
    expect(stemToken('mixing')).toBe(stemToken('mixed'));
    expect(stemToken('mixed')).toBe(stemToken('mix'));
  });

  test('does not collapse words that mean different things', () => {
    // Over-stemming is the failure mode that costs precision: a query for one
    // word surfacing notes about an unrelated one.
    expect(stemToken('artist')).not.toBe(stemToken('art'));
    expect(stemToken('release')).not.toBe(stemToken('relate'));
    expect(stemToken('single')).not.toBe(stemToken('sing'));
    expect(stemToken('master')).not.toBe(stemToken('mast'));
    expect(stemToken('branding')).not.toBe(stemToken('bran'));
  });
});

describe('stemmedWordSet', () => {
  test('splits on punctuation and stems each word', () => {
    const set = stemmedWordSet('Playlist-strategy: editorial placements!');
    expect(set.has(stemToken('playlists'))).toBe(true);
    expect(set.has(stemToken('strategy'))).toBe(true);
    expect(set.has(stemToken('placement'))).toBe(true);
  });

  test('drops single characters that carry no meaning', () => {
    expect(stemmedWordSet('a b playlist').has('a')).toBe(false);
  });
});
