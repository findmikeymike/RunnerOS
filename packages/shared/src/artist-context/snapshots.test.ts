import { describe, expect, test } from 'bun:test';
import {
  artistInstagramSnapshotMetadata,
  buildArtistInstagramGrowthHistory,
  buildArtistInstagramMonthlyFollowers,
  parseArtistInstagramSnapshotDocResult,
  parseArtistInstagramSnapshotJsonResult,
  serializeArtistInstagramSnapshotBody,
  type ArtistInstagramSnapshot,
} from './instagram.ts';
import {
  artistSpotifySnapshotMetadata,
  buildArtistSpotifyMonthlyListeners,
  buildArtistSpotifyMonthlyStreams,
  buildArtistSpotifyStreamHistory,
  calculateArtistSpotifyGrowth,
  parseArtistSpotifySnapshotDocResult,
  parseArtistSpotifySnapshotJsonResult,
  serializeArtistSpotifySnapshotBody,
  type ArtistSpotifySnapshot,
} from './spotify.ts';

const json = (record: unknown) => JSON.stringify(record);

describe('spotify snapshot', () => {
  test('broadcasts to every agent', () => {
    expect(artistSpotifySnapshotMetadata().routing).toEqual({ mode: 'broadcast' });
  });

  test('an absent doc is null rather than an empty snapshot', () => {
    expect(parseArtistSpotifySnapshotDocResult(undefined)).toEqual({ ok: true, snapshot: null });
    expect(parseArtistSpotifySnapshotDocResult({ body: '  ' })).toEqual({ ok: true, snapshot: null });
  });

  test('requires a snapshot date and a metrics object', () => {
    const noDate = parseArtistSpotifySnapshotJsonResult(json({ version: 1, metrics: { streams: 1 } }));
    expect(noDate.ok).toBe(false);
    expect(noDate.ok === false && noDate.error).toBe('Spotify Snapshot JSON has an unsupported shape.');

    const noMetrics = parseArtistSpotifySnapshotJsonResult(json({ snapshotDate: '2026-08-01' }));
    expect(noMetrics.ok).toBe(false);
  });

  test('distinguishes malformed json from a missing block', () => {
    expect(parseArtistSpotifySnapshotJsonResult('{not json').ok).toBe(false);
    const missing = parseArtistSpotifySnapshotJsonResult('prose only');
    expect(missing.ok === false && missing.error).toBe(
      'Spotify Snapshot exists, but no JSON block could be read.',
    );
  });

  test('maps the pre-rename spotify-for-artists data source', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({ snapshotDate: '2026-07-01', dataSource: 'spotify-for-artists', metrics: {} }),
    );
    expect(result.snapshot?.dataSource).toBe('spotify-for-artists-browser');
  });

  test('drops an unrecognized data source rather than trusting it', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({ snapshotDate: '2026-07-01', dataSource: 'carrier-pigeon', metrics: {} }),
    );
    expect(result.snapshot?.dataSource).toBeUndefined();
  });

  test('drops unnamed tracks, cities, and playlists', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        metrics: {},
        tracks: [{ name: 'Keep' }, { name: '   ' }],
        geo: { topCities: [{ city: 'Tulsa' }, { city: '' }] },
        playlistsDriving: [{ name: 'Keep' }, { name: '' }],
      }),
    );
    expect(result.snapshot?.tracks).toHaveLength(1);
    expect(result.snapshot?.geo?.topCities).toHaveLength(1);
    expect(result.snapshot?.playlistsDriving).toHaveLength(1);
  });

  test('daily streams are deduplicated by date, sorted, and screened', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        metrics: {},
        dailyStreams: [
          { date: '2026-08-02', streams: 20 },
          { date: '2026-08-01', streams: 10 },
          { date: '2026-08-01', streams: 15 },
          { date: 'not-a-date', streams: 5 },
          { date: '2026-08-03', streams: -2 },
          'junk',
        ],
      }),
    );
    expect(result.snapshot?.dailyStreams).toEqual([
      { date: '2026-08-01', streams: 15 },
      { date: '2026-08-02', streams: 20 },
    ]);
  });

  test('monthly Spotify history is normalized and available from one snapshot', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({
        snapshotDate: '2026-09-09',
        metrics: {},
        monthlyStreams: [
          { month: '2026-08', streams: 1200 },
          { month: '2026-07', streams: 900 },
          { month: '2026-08', streams: 1250 },
          { month: '2026-09', streams: 9999 },
          { month: '2026-13', streams: 9999 },
        ],
        monthlyListeners: [
          { month: '2026-07', listeners: 400 },
          { month: '2026-08', listeners: 550 },
          { month: '2026-09', listeners: 9999 },
          { month: 'bad', listeners: 9999 },
        ],
      }),
    );

    expect(buildArtistSpotifyMonthlyStreams(result.snapshot, new Date('2026-09-09T12:00:00Z'))).toEqual([
      { month: '2026-07', streams: 900 },
      { month: '2026-08', streams: 1250 },
    ]);
    expect(buildArtistSpotifyMonthlyListeners(result.snapshot, new Date('2026-09-09T12:00:00Z'))).toEqual([
      { month: '2026-07', listeners: 400 },
      { month: '2026-08', listeners: 550 },
    ]);
  });

  test('monthly streams can be derived immediately from captured daily history', () => {
    const snapshot = parseArtistSpotifySnapshotJsonResult(
      json({
        snapshotDate: '2026-09-09',
        metrics: {},
        dailyStreams: [
          { date: '2026-07-30', streams: 10 },
          { date: '2026-07-31', streams: 20 },
          { date: '2026-08-01', streams: 30 },
          { date: '2026-09-01', streams: 999 },
        ],
      }),
    ).snapshot;

    expect(buildArtistSpotifyMonthlyStreams(snapshot, new Date('2026-09-09T12:00:00Z'))).toEqual([
      { month: '2026-07', streams: 30 },
      { month: '2026-08', streams: 30 },
    ]);
  });

  test('non-array collections degrade to undefined instead of throwing', () => {
    const result = parseArtistSpotifySnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        metrics: { streams: null, listeners: 'many' },
        geo: 'nope',
        tracks: 'nope',
        playlistsDriving: 'nope',
        dailyStreams: 'nope',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.snapshot?.metrics.streams).toBeUndefined();
    expect(result.snapshot?.metrics.listeners).toBeUndefined();
    expect(result.snapshot?.geo).toBeUndefined();
    expect(result.snapshot?.tracks).toBeUndefined();
  });

  test('round-trips through serialize', () => {
    const body = serializeArtistSpotifySnapshotBody({
      snapshotDate: '2026-08-01',
      artist: { name: 'Mercy Lane' },
      metrics: { streams: 1000 },
    } as Omit<ArtistSpotifySnapshot, 'version' | 'updatedAt'>);
    expect(body).toContain('```json');
    const parsed = parseArtistSpotifySnapshotDocResult({ body });
    expect(parsed.snapshot?.metrics.streams).toBe(1000);
    expect(parsed.snapshot?.artist.name).toBe('Mercy Lane');
  });

  test('stream history only compares like-for-like windows', () => {
    const make = (date: string, streams: number, windowDays = 28): ArtistSpotifySnapshot => ({
      version: 1,
      snapshotDate: date,
      dataSource: 'spotify-web-api',
      windowDays,
      artist: {},
      metrics: { streams, listeners: streams / 2 },
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const history = buildArtistSpotifyStreamHistory([
      make('2026-08-01', 300),
      make('2026-07-01', 100),
      make('2026-07-15', 9999, 7),
    ]);

    expect(history.map((point) => point.date)).toEqual(['2026-07-01', '2026-08-01']);
  });

  test('growth needs two points and guards divide-by-zero', () => {
    expect(calculateArtistSpotifyGrowth([])).toBeNull();
    expect(calculateArtistSpotifyGrowth([{ date: '2026-08-01', streams: 5 }])).toBeNull();

    const growth = calculateArtistSpotifyGrowth([
      { date: '2026-07-01', streams: 100, listeners: 50 },
      { date: '2026-08-01', streams: 150, listeners: 75 },
    ]);
    expect(growth).toEqual({
      comparisonDate: '2026-07-01',
      streamsDelta: 50,
      streamsPercent: 50,
      listenersDelta: 25,
      listenersPercent: 50,
    });

    const fromZero = calculateArtistSpotifyGrowth([
      { date: '2026-07-01', streams: 0 },
      { date: '2026-08-01', streams: 10 },
    ]);
    expect(fromZero?.streamsDelta).toBe(10);
    expect(fromZero?.streamsPercent).toBeUndefined();
  });
});

describe('instagram snapshot', () => {
  test('an absent doc is null rather than an empty snapshot', () => {
    expect(parseArtistInstagramSnapshotDocResult(undefined)).toEqual({ ok: true, snapshot: null });
  });

  test('requires an ISO date and a profile id', () => {
    expect(
      parseArtistInstagramSnapshotJsonResult(
        json({ snapshotDate: '08/01/2026', profile: { profile: 'a' }, metrics: {} }),
      ).ok,
    ).toBe(false);
    expect(
      parseArtistInstagramSnapshotJsonResult(
        json({ snapshotDate: '2026-08-01', profile: {}, metrics: {} }),
      ).ok,
    ).toBe(false);
  });

  test('rejects negative counts but keeps negative follower deltas', () => {
    const result = parseArtistInstagramSnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        profile: { profile: 'acct-1' },
        metrics: { likes: -1, followers: 100, followerDelta: -5 },
      }),
    );
    expect(result.snapshot?.metrics.likes).toBeUndefined();
    expect(result.snapshot?.metrics.followers).toBe(100);
    expect(result.snapshot?.metrics.followerDelta).toBe(-5);
  });

  test('windowDays must be a positive integer', () => {
    const parse = (windowDays: unknown) =>
      parseArtistInstagramSnapshotJsonResult(
        json({ snapshotDate: '2026-08-01', windowDays, profile: { profile: 'a' }, metrics: {} }),
      ).snapshot?.windowDays;

    expect(parse(30)).toBe(30);
    expect(parse(7.5)).toBeUndefined();
    expect(parse(0)).toBeUndefined();
    expect(parse(-7)).toBeUndefined();
  });

  test('always reports the browser data source', () => {
    const result = parseArtistInstagramSnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        dataSource: 'something-else',
        profile: { profile: 'a' },
        metrics: {},
      }),
    );
    expect(result.snapshot?.dataSource).toBe('instagram-insights-browser');
  });

  test('round-trips through serialize', () => {
    const snapshot = parseArtistInstagramSnapshotJsonResult(
      json({
        snapshotDate: '2026-08-01',
        profile: { profile: 'acct-1', handle: '@mercy' },
        metrics: { followers: 100 },
      }),
    ).snapshot!;
    const reparsed = parseArtistInstagramSnapshotDocResult({
      body: serializeArtistInstagramSnapshotBody(snapshot),
    });
    expect(reparsed.snapshot?.profile.handle).toBe('@mercy');
    expect(reparsed.snapshot?.metrics.followers).toBe(100);
  });

  test('growth history isolates one profile and window', () => {
    const make = (
      date: string,
      followerDelta: number,
      profile = 'a',
      windowDays = 30,
    ): ArtistInstagramSnapshot => ({
      version: 1,
      dataSource: 'instagram-insights-browser',
      snapshotDate: date,
      windowDays,
      profile: { profile },
      metrics: { followerDelta },
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const history = buildArtistInstagramGrowthHistory([
      make('2026-08-01', 10),
      make('2026-07-01', 4),
      make('2026-07-20', 99, 'other-account'),
      make('2026-07-25', 55, 'a', 7),
    ]);

    expect(history).toEqual([
      { date: '2026-07-01', followerDelta: 4 },
      { date: '2026-08-01', followerDelta: 10 },
    ]);
  });

  test('monthly Instagram history works on first capture and derives totals', () => {
    const snapshot = parseArtistInstagramSnapshotJsonResult(
      json({
        snapshotDate: '2026-09-09',
        profile: { profile: 'a' },
        metrics: { followers: 1100 },
        monthlyFollowers: [
          { month: '2026-06', net: 20 },
          { month: '2026-07', net: -5 },
          { month: '2026-08', net: 35 },
          { month: '2026-08', net: 40 },
          { month: '2026-09', net: 999 },
          { month: 'bad', net: 999 },
        ],
      }),
    ).snapshot!;

    expect(buildArtistInstagramMonthlyFollowers(
      [snapshot],
      new Date('2026-09-09T12:00:00Z'),
    )).toEqual([
      { month: '2026-06', followers: 1065, net: 20 },
      { month: '2026-07', followers: 1060, net: -5 },
      { month: '2026-08', followers: 1100, net: 40 },
    ]);
  });

  test('monthly Instagram net movement derives from month-end totals', () => {
    const snapshot = parseArtistInstagramSnapshotJsonResult(
      json({
        snapshotDate: '2026-09-09',
        profile: { profile: 'a' },
        metrics: { followers: 120 },
        monthlyFollowers: [
          { month: '2026-07', followers: 100 },
          { month: '2026-08', followers: 120 },
        ],
      }),
    ).snapshot!;

    expect(buildArtistInstagramMonthlyFollowers(
      [snapshot],
      new Date('2026-09-09T12:00:00Z'),
    )).toEqual([
      { month: '2026-07', followers: 100, net: undefined },
      { month: '2026-08', followers: 120, net: 20 },
    ]);
  });
});
