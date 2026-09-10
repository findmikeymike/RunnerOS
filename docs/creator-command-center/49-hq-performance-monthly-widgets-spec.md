---
status: partially-implemented
owner: agent
last_verified: 2026-09-09
source_of_truth: true
related: ./47-signals-your-world-spec.md
---

# HQ Performance Widgets: Useful Monthly Growth on First Run

## Product decision

Artist HQ gives the artist an immediate, big-picture view of Spotify and
Instagram growth over months. It is a glance surface, not an analytics suite.

Keep the existing four-tile layout:

1. **Spotify Streams** — newest completed month's streams, month-over-month
   change, and a compact monthly chart.
2. **Spotify Listeners** — newest completed month's listeners,
   month-over-month change, and a compact monthly chart.
3. **Instagram Followers** — current followers and the available month-end
   follower trend.
4. **Instagram Growth** — newest completed month's net follower change and a
   signed monthly chart.

Clicking any tile opens the existing provider modal. The modal owns exact
monthly values, larger/detail views, top tracks, reach, engagement, and other
secondary metrics.

## Non-negotiable first-run behavior

One successful provider read must produce the useful history the provider
already exposes. Local weekly snapshots extend that history; they are not a
prerequisite for drawing it.

- Spotify capture requests up to 12 completed calendar months of streams and
  monthly listeners from Spotify for Artists.
- Instagram capture requests every completed month of follower totals or net
  follower movement that Insights exposes.
- Render whatever honest history is available. Twelve months is ideal; three
  months is still useful. Never wait for another local run before showing
  captured history.
- Values read or reasonably approximated from provider charts are acceptable
  for this directional HQ view. Never invent a month the provider did not show.
- The current partial month is excluded from month-over-month comparison.
- If fewer than two real monthly points exist, show the current number and the
  available point without claiming growth.

## Snapshot contract

The existing version-1 snapshots gain optional history arrays. Old snapshots
remain valid.

```jsonc
// Spotify snapshot
{
  "monthlyStreams": [
    { "month": "2026-06", "streams": 4200 },
    { "month": "2026-07", "streams": 4700 }
  ],
  "monthlyListeners": [
    { "month": "2026-06", "listeners": 1800 },
    { "month": "2026-07", "listeners": 2100 }
  ]
}

// Instagram snapshot
{
  "monthlyFollowers": [
    { "month": "2026-06", "followers": 1205, "net": 12 },
    { "month": "2026-07", "followers": 1231, "net": 26 }
  ]
}
```

For Instagram, `followers` or `net` may be absent when the surface exposes only
one. When current followers plus monthly net values exist, month-end totals may
be back-calculated for the directional chart.

Normalization rules are deliberately small:

- month keys use `YYYY-MM`;
- counts are finite and non-negative; `net` may be signed;
- duplicate months keep the newest captured value;
- points sort oldest to newest;
- the renderer uses at most the newest 12 completed months.

## Display contract

HQ tiles show:

- one large value;
- `up/down X% vs previous month` when two comparable points exist;
- a compact chart using up to 12 monthly points;
- a short range label such as `6 months · through Aug`.

The Instagram growth chart uses a zero baseline so gains and losses read
correctly. Missing months are omitted, not filled with zero.

Provider modals add monthly rows for streams, listeners, follower totals, and
net follower growth while retaining their current detailed metrics.

## Data flow

1. The Spotify and Instagram capture instructions request visible historical
   month values on every run.
2. Existing normalizers preserve those optional arrays in immutable snapshots
   and the workspace context payload.
3. Shared helpers sanitize, combine, trim, and calculate monthly histories.
4. Artist HQ uses monthly history first and the old snapshot trend only as a
   migration fallback.

No new database, scheduler, API, or storage system is required.

## Acceptance

- One fixture snapshot renders Spotify streams/listeners monthly charts without
  requiring earlier files.
- One fixture snapshot renders Instagram monthly growth without requiring
  earlier files.
- Unsorted, duplicated, malformed, current-month, and signed values are handled
  without breaking the widgets.
- The pop-out modals show the captured monthly values.
- Old snapshot documents still parse and retain their existing fallback view.
- Shared tests, renderer tests, Electron typecheck, and renderer build pass.
- Live provider capture and visual smoke remain a separate real-account gate;
  do not claim them from fixtures.

## Non-goals

- Career totals, cumulative overlays, exact accounting, forecasts, or a fixed
  promise of 12 months.
- Per-track charts on the HQ tiles.
- Waiting weeks for Artist OS to accumulate enough local snapshots.
- Fabricated data for provider history that is not visible.

## Amendments

I am Agent Two, and I believe this is the best path and the right correction to
the earlier plan: make the HQ view immediately useful, keep the calculation
simple, and move depth into the pop-out instead of turning the home screen into
an analytics product.
