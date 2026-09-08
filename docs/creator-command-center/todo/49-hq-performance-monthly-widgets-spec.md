---
status: approved
owner: agent
last_verified: 2026-09-07
source_of_truth: true
related: ../creator-command-center/47-signals-your-world-spec.md
---

# HQ Performance Widgets: 12-Month Monthly Views (Spotify + Instagram)

## Decision

Replace the run-accumulation model of the HQ Performance strip with
**month-bucketed 12-month visuals that are complete on the first capture**:

1. **Spotify — Total Streams tile**: headline is the artist's **career total
   streams** (every stream ever, when Spotify for Artists exposes it), with a
   combo chart of **streams per calendar month** for the last 12 full months
   (bars) plus a **cumulative line overlay** climbing across those bars.
2. **Spotify — Listeners tile**: **monthly listeners** for the last 12 full
   months, one bar per month, showing whether each month grew or shrank. No
   per-song listens on this tile.
3. **Instagram — Followers tile**: **net followers gained or lost per month**
   for the last 12 months, signed bars around a zero baseline (above = gained,
   below = lost).

The last bar on every chart is the **last full calendar month** (in September,
the last bar is August). The current partial month is excluded from bars — it
may optionally render ghosted, but never as a completed bar.

The cumulative overlay on the Total Streams tile is derived, not captured:
`line[month] = careerTotal − sum(all monthly bars after that month)`. Where it
lands today is the headline number.

## Current state (why this spec exists)

- Snapshots are written as dated files: `data/spotify/snapshots/YYYY-MM-DD
  (-s4a|-web-api).json` and `data/instagram/snapshots/YYYY-MM-DD-insights.json`
  (one file per capture run).
- `ArtistHQHome.tsx:770-844` loads the last 24 files and builds history
  **one point per snapshot file** (`buildArtistSpotifyStreamHistory`, limit 8;
  `buildArtistInstagramGrowthHistory`). Charts therefore only grow as weekly
  runs accumulate — an artist sees an empty or near-empty trend for months.
  This is the core problem the user wants gone.
- `SignalTile` (`ArtistHQHome.tsx:2945`) already supports `trendMode:
  'line' | 'bars'` (`Sparkline`, `SignalBars`) but only unsigned values, no
  month labels, no overlay, no 12-slot fixed axis.
- Schema (`packages/shared/src/artist-context/spotify.ts`): `metrics.streams`
  is window-scoped; `dailyStreams` exists (daily series from the capture);
  `monthlyListeners`/`monthlyStreams`/career totals do not exist.
- Instagram schema (`packages/shared/src/artist-context/instagram.ts`):
  `profile.followers` + 14-day insight windows; no monthly history.
- Publisher (`packages/server-core/src/pulses/spotify-snapshot-publisher.ts`)
  copies the latest snapshot file's raw JSON into the
  `artist-spotify-snapshot` context doc — new fields pass through without
  publisher changes.

## Data contract (capture side)

The Spotify Pulse capture (S4A browser session) must extend the snapshot JSON
it already writes with:

```jsonc
{
  "careerStreams": 1234567,          // all-time total; null if S4A did not expose it this run
  "careerStreamsAsOf": "2026-09-01", // date the total was true
  "monthlyStreams": [                // EXACTLY 12 full months, oldest → newest
    { "month": "2025-09", "streams": 4200 },  // month = 'YYYY-MM' calendar month
    ...
    { "month": "2026-08", "streams": 5100 }
  ],
  "monthlyListeners": [              // same 12-month shape, monthly listeners
    { "month": "2025-09", "listeners": 9800 },
    ...
  ]
}
```

Sources in S4A: the stats timeline offers a last-365-days daily series
(bucket per calendar month → `monthlyStreams`); the Audience tab shows the
monthly-listeners history (S4A exposes ~2 years; take the last 12 full
months); the all-time total comes from the profile/Music tab (sum of all-time
per-release streams, or the surface's own total if shown).

The Instagram Insights capture must extend its snapshot JSON with:

```jsonc
{
  "monthlyFollowers": [              // as many full months as Instagram exposes, oldest → newest
    { "month": "2026-06", "followers": 1205, "net": 12 },  // followers = month-end total; net = gain/loss vs prior month
    ...
  ]
}
```

**Known data limitation, stated honestly:** Instagram surfaces limited
follower history (roughly the last ~90 days on most surfaces). The IG chart
therefore renders however many months exist — three bars on day one, filling
toward twelve as our own weekly snapshots accumulate (net derived from
month-end totals when the platform history runs out). Do not fake the missing
months and do not label the tile "12 months" until twelve real months exist;
the foot line states the covered range (e.g. "3 months · Jun–Aug 2026").

## Schema and helpers (packages/shared/src/artist-context/)

**spotify.ts** — extend `ArtistSpotifySnapshot`:
- `careerStreams?: number`, `careerStreamsAsOf?: string`
- `monthlyStreams?: Array<{ month: string; streams: number }>`
- `monthlyListeners?: Array<{ month: string; listeners: number }>`
- Normalizers for all three (reuse `toFiniteNumber`, strict `'YYYY-MM'`
  validation, drop non-full months and duplicates keeping the last entry per
  month, sort ascending).

New pure helpers (unit-tested):
- `buildArtistSpotifyMonthlyStreams(snapshot, now)` →
  `{ bars: Array<{ month: string; streams: number }>, cumulative:
  Array<{ month: string; total: number }> | null, headlineTotal: number |
  null, headlineLabel: 'career' | 'trailing-12' }`. Drops the current partial
  month; derives the cumulative line as `careerTotal − suffixSums`; when
  `careerStreams` is missing, the headline falls back to the 12-month sum
  labeled **"Last 12 months"** — never present the trailing sum as career
  total.
- `buildArtistSpotifyMonthlyListeners(snapshot, now)` → last 12 full months
  of listener bars.

**instagram.ts** — extend `ArtistInstagramSnapshot`:
- `monthlyFollowers?: Array<{ month: string; followers: number; net?: number }>`
- `buildArtistInstagramMonthlyFollowers(snapshots, now)` → signed monthly
  net bars, deriving `net` from consecutive month-end follower totals when
  absent, using accumulated snapshot history for months the platform no
  longer reports.

Keep `buildArtistSpotifyStreamHistory` / `buildArtistInstagramGrowthHistory`
as fallbacks during migration; the tiles below use them only when the new
fields are absent.

## Renderer (ArtistHQHome SignalStrip)

- New `SignalMonthlyBars` component (beside `SignalTile`): fixed 12-slot
  month axis (Jan..Dec labels or compact `M` ticks), value bars, optional
  cumulative line overlay, **signed mode** for Instagram (zero baseline,
  gains above / losses below, red/green or single-hue with direction
  shading), and a "through {Month YYYY}" caption. It must handle 1–12 bars
  gracefully (IG's shorter history) without axis relabeling jumps.
- **Total Streams tile**: headline `formatMetric(headlineTotal)` with
  `headlineLabel` as the foot qualifier; bars + overlay from
  `buildArtistSpotifyMonthlyStreams`; foot shows the covered range and
  growth vs same month a year ago when 12 months exist.
- **Listeners tile**: headline = newest `monthlyListeners` value; bars from
  `buildArtistSpotifyMonthlyListeners`; **remove the per-track foot**
  (`topTrackFoot`) from this tile — per-song detail stays available in the
  detail drawer, not on the tile.
- **Followers tile**: headline = current follower count; signed bars from
  `buildArtistInstagramMonthlyFollowers`; foot states the covered range.
- Fallback chain per tile: new monthly fields → existing per-snapshot
  history (current behavior) → pending copy ("Run … to start"). One
  successful capture after this spec ships produces the full 12-month
  Spotify visual; IG fills progressively.

## Slices

1. **Schema + helpers + tests** (pure logic): spotify/instagram fields,
   normalizers, the three `build*` helpers including partial-month
   exclusion, cumulative derivation, trailing-12 fallback labeling, and
   net-derivation. No UI.
2. **Renderer tiles**: `SignalMonthlyBars` (+ signed mode), rewire the three
   tiles, fallback chain, month captions. Component tests for the tiles
   (mock snapshots; assert bars, labels, fallbacks).
3. **Capture contract + live verification**: extend the Spotify Pulse and
   Instagram Insights capture instructions/automation prompts to emit the
   new fields from the live S4A/IG surfaces, and prove them on the real
   accounts (gates below).

Slices 1 and 2 can ship and be verified with fixture snapshots; slice 3 is
what makes real accounts light up.

## Verification gates

- Unit: helpers (bucket edge cases — partial current month, duplicate
  months, unsorted input, missing careerStreams, IG net derivation from
  totals) and normalizers (malformed months dropped, not thrown).
- Component: tiles render 12 bars from one fixture snapshot; IG renders 3
  bars with honest caption; fallback path renders the old sparkline when
  fields are absent.
- Suite/typecheck/build: `PANGOCAIRO_BACKEND=fontconfig bun test
  --path-ignore-patterns='**/release-artist-os/**'
  --path-ignore-patterns='**/dist/**'`; `cd apps/electron && bun run tsc
  --noEmit && bun run build:renderer`.
- Live (slice 3): one real Spotify Pulse run produces a snapshot JSON
  containing `careerStreams`, 12 `monthlyStreams`, 12 `monthlyListeners`,
  verified against what the S4A UI shows; one Instagram run produces
  whatever follower history the account exposes; visual smoke in the app
  (`CRAFT_PRODUCT_VARIANT=artist-os CRAFT_CONFIG_DIR=$HOME/.artist-os-dev`)
  confirming all three tiles from the jump.

## Open questions (answer against the live account in slice 3)

- Does the connected S4A account expose a direct all-time total, or must we
  sum per-release all-time streams? If neither is reliable, the tile ships
  permanently on the "Last 12 months" labeled headline.
- Exact IG followers-history window on the connected account (90 days vs
  longer).
- Whether S4A's daily timeline yields full 365-day coverage (it caps at
  "last 365 days" — meaning the oldest month may be partial; if so, show 11
  full bars rather than an undercounted 12th).

## Non-goals

- No change to how snapshots are scheduled, stored, or published (weekly
  automation, dated files, context-doc publisher all stay).
- No per-song/per-track charts on the tiles; track detail remains in the
  pulse drawer.
- No Spotify Web API dependency — S4A browser session remains the source.
