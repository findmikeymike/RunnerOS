---
status: accepted
owner: agent
last_verified: 2026-08-29
source_of_truth: true
---

# Artist Timeline — Unified Calendar Read Model

Revision 2. Incorporates review feedback (dedup scope, ordering contract, warning
propagation, goal-doc eligibility, UI placement, staleness handling) and the
product decisions recorded in §13.

## 1. Problem

Dated information lives in five stores and no single read spans them.

- HQ owns global dates in the `artist-calendar` context doc.
- Each campaign owns its working schedule in `campaign-calendar`.
- Every executable item lives in the `scheduled-work` ledger, which already carries `owner.scope`.
- Campaign release dates live in each campaign's `mission-brief`.
- Month-level strategy lives in `artist-release-horizon`.

Consequences today:

- **The HQ Manager Brief has no day-level dates.** `buildManagerBrief` reads
  `artist-profile`, `artist-release-horizon`, the two growth snapshots, and
  shared intel — never `artist-calendar`, `campaign-calendar`, or
  `scheduled-work`. The *Campaign* brief does receive per-campaign
  `calendarHighlights` / `workHighlights` (`snapshot.ts:103-116`), but those are
  campaign-scoped and never reach HQ. The HQ manager cannot answer "what does
  the next six months look like" or "what needs me this week" beyond month
  headings.
- **The one real merge is renderer-only.** `buildHqThisWeekItems`
  (`apps/electron/src/renderer/lib/artist-hq-home-feed.ts:56`) unions HQ events
  with scheduled work, dedupes via `event.scheduledWorkId`, and windows to seven
  days. No server, tool, or prompt path can call it, and it ignores campaigns.
- **Schedule times are dropped at a boundary.** `HqOperationalItem`
  (`packages/shared/src/hq-state/types.ts:101`) carries `updatedAt`/`expiresAt`
  but no `startAt`/`dueAt`, so scheduled work reaches the HQ brief as an
  undated string.
- **Retrieval is not date-aware.** `get_artist_context topic:'calendar'`
  returns the first N events in document order — no range, no sort.

The product risk is the mirror image: a second maintained calendar in HQ would
mean two places holding the same dates. The user-facing rule this spec serves:
**there is exactly one big calendar surface per campaign, and HQ never grows a
competing one.**

## 2. Principles

1. **The timeline is a read, never a store.** No new persisted calendar. Every
   entry is derived and points back at its owner.
2. **Altitude rule.** An item appears at the altitude of its consequence.
   Releases, deadlines, milestones, and anything awaiting the artist surface in
   HQ. Day-of campaign execution rolls up as a count.
3. **Ownership rule.** Creation follows ownership. HQ never creates campaign
   day-work; an attempt routes into the owning campaign, matching the existing
   rule for review/social work.
4. **One logical item, one entry — by explicit link only.** A visible
   scheduled-work order and its paired calendar shell are the same thing.
   Nothing else is ever merged: no matching by title, date, or similarity.
   Two entries that look alike are two entries; hiding a real event is worse
   than showing an apparent near-duplicate.

These extend the invariant already in `HANDOFF.md`: *calendar shells are
visibility; Scheduled Work orders own execution state; one executable order has
one owning workspace.*

## 3. Sources

| Source | Module | Accessor | Default tier |
|---|---|---|---|
| HQ events | `artist-context/calendar.ts` | `parseArtistCalendarDocResult` | strategic |
| Campaign items | `campaign-calendar/index.ts` | `parseCampaignCalendar`, `activeCampaignCalendarItems` | operational |
| Execution orders | `scheduled-work/index.ts` | order list per workspace | derived (§6) |
| Release dates | `artist-context/mission-brief.ts` | **`missionReleaseDateKey(brief)`** | strategic |
| Goal deadlines | `workspace-context/types.ts` | goal docs only (below) | strategic |

**Goal-doc eligibility is explicit:** a context doc contributes a `goal` entry
iff `metadata.status` is set (i.e. the doc is a Pulse goal per
`docs/pulses/01-spec.md`), `metadata.status !== 'done'`, `metadata.enabled !==
false`, and `metadata.deadline` parses as strict `YYYY-MM-DD`. A bare
`deadline` on a non-goal doc is ignored. Generated state docs
(`hq-state-of-play`, `campaign-state-of-play`) and `shared-intel-*` docs are
excluded by slug.

`artist-release-horizon` is **not** a timeline source. It remains the editable
month-level year strategy the brief already renders as `### Release Horizon`;
the timeline supplies dated items beneath it (§9 explains how the two combine
in the brief).

Reuse `missionReleaseDateKey` (`releaseDate ?? timeline`, strict `YYYY-MM-DD`)
rather than re-deriving release dates. Campaign workspaces are enumerated via
the persisted `artistWorkspaceScope === 'campaign'`.

## 4. Entry shape

```ts
export type TimelineTier = 'strategic' | 'operational';

export type TimelineCategory =
  | 'release' | 'milestone' | 'deadline' | 'approval'
  | 'publish' | 'review' | 'task' | 'event';

export interface TimelineOrigin {
  kind: 'hq-event' | 'campaign-item' | 'scheduled-work' | 'release' | 'goal';
  workspaceId: string;
  campaignId?: string;
  /** Id within the owning store. Composite entry id is `${kind}:${sourceId}`. */
  sourceId: string;
}

export interface TimelineEntry {
  id: string;
  /** Calendar day in the reference timezone (YYYY-MM-DD). */
  date: string;
  time?: string;
  timezone: string;
  /** `${date}T${time ?? '00:00'}` in the reference timezone — the sort key. */
  sortKey: string;
  title: string;
  tier: TimelineTier;
  category: TimelineCategory;
  status?: string;
  /** True when blocked, failed, missed, or awaiting the artist. */
  needsAttention: boolean;
  /** Set when the entry's source doc failed its freshness window (§8a). */
  stale?: boolean;
  origin: TimelineOrigin;
}

export interface TimelineRollup {
  workspaceId: string;
  campaignId?: string;
  label: string;
  counts: { total: number; needsAttention: number };
}

export interface TimelineWarning {
  source: string;
  workspaceId?: string;
  reason: string;
}

export interface ArtistTimeline {
  from: string;
  to: string;
  timezone: string;
  entries: TimelineEntry[];
  /** Operational volume per campaign, for altitudes that do not list it. */
  rollups: TimelineRollup[];
  /**
   * Count of strategic entries beyond `to`, so a bounded window can still say
   * "2 more releases later this year" (§9).
   */
  beyondWindow: { strategic: number; nextDate?: string };
  /** Collector-supplied parse failures plus builder-detected inconsistencies. */
  warnings: TimelineWarning[];
}
```

`needsAttention` uses the existing status buckets from `collectionSummary`
(`snapshot.ts:145`): blocked = `failed | missed | needs-attention`; awaiting =
`needs-approval | awaiting-review`.

## 5. Deduplication

Explicit links only.

1. **Order wins over its shell.** If a `ScheduledWorkOrder` is visible, emit
   one entry from the order and suppress the shell it is paired with. Pairing
   is the existing bidirectional link (`calendarItem.scheduledWorkId ===
   order.id && order.calendarLink.itemId === calendarItem.id`, enforced at
   `handlers/rpc/scheduled-work.ts:318`). Take `title`/`time` from the shell
   when richer.
2. **A half-link emits once plus a warning.** Never twice, never zero.
3. **Hidden orders are omitted entirely.** `calendarVisibility === 'hidden'`
   means no shell exists by design (`AutomationWorkQueue.ts:79`); the timeline
   must not resurrect background automation into a user-facing calendar.
4. **Shells without orders are emitted as-is** — manual events and deadlines
   are legitimate standalone entries.
5. **Release entries always emit from `mission-brief`, and nothing is
   suppressed around them.** If the artist also logged an HQ event on release
   day, both appear. No heuristic matching by title or date, ever — a false
   merge hides a real event, which is strictly worse than a visible
   near-duplicate. (Revised from R1, which suppressed same-day items.)

`buildHqThisWeekItems` already implements rule 1 for the HQ half; promote that
logic rather than rewriting it.

## 6. Tier derivation

Derived, not stored — no schema change.

**Strategic** (surfaces in HQ):
- every `release` and `goal` entry
- every HQ-owned entry (`origin.kind === 'hq-event'`, or an order whose
  `owner.scope === 'hq'`)
- any entry with `needsAttention === true`, regardless of origin — an approval
  the artist owes must reach HQ even when the work lives in a campaign
- campaign items of kind `deadline` or `approval`

**Operational** (campaign surface only, rolled up in HQ): everything else.

No stored override in this phase. If one is ever needed, add an optional
`tier` to `CampaignCalendarItem`; do not build it until a real case appears.

## 7. Roll-up

At HQ altitude, operational entries are not listed. Per campaign, per requested
grain (month by default), emit one `TimelineRollup`: *"Summer EP — 6 scheduled,
1 needs approval."* Expanding a month or day returns the full entry list
including operational items, each badged with origin and deep-linkable to the
owning surface.

## 8. API

New module `packages/shared/src/hq-state/timeline.ts` (pure; callers supply
parsed inputs, matching `buildHqStateOfPlay`):

```ts
export function buildArtistTimeline(input: {
  now: Date;
  from: string;
  to: string;
  timezone: string;
  hqEvents: ArtistCalendarEvent[];
  hqOrders: ScheduledWorkOrder[];
  campaigns: Array<{
    workspaceId: string;
    campaignId?: string;
    label: string;
    releaseDate?: string;
    items: CampaignCalendarItem[];
    orders: ScheduledWorkOrder[];
    /** Source docs that failed freshness (§8a); marks derived entries stale. */
    staleSources?: string[];
  }>;
  goals: Array<{ slug: string; title: string; deadline: string; workspaceId: string }>;
  /**
   * Parse failures encountered while gathering inputs. The builder cannot see
   * them (it receives already-parsed data), so the collector MUST pass them in;
   * they are merged into `ArtistTimeline.warnings` alongside builder-detected
   * inconsistencies (half-links etc.). A campaign whose calendar failed to
   * parse contributes a warning, not an abort.
   */
  warnings?: TimelineWarning[];
  tiers?: TimelineTier[];   // filter; default both
  limit?: number;
}): ArtistTimeline;
```

**Ordering contract (revised from R1, which conflicted):** filter by `tiers`
first, sort strictly chronologically by `sortKey` (ties: origin kind, then id),
then apply `limit`. There is no "strategic first" reordering — a caller that
wants only strategic entries passes `tiers: ['strategic']`. `beyondWindow` is
computed before `limit` so truncation never hides the later-year count.

A server-side collector in `packages/server-core/src/hq-state/` gathers inputs,
reusing `buildManagerCampaignSnapshots` so campaign docs are read once, and is
responsible for converting each `ok:false` parse into a `TimelineWarning`.
Note `parseArtistCalendarDocResult` is now strict (missing top-level
`updatedAt` is a hard failure) — `ok:false` is a real signal and must be
surfaced, not swallowed.

### 8a. Staleness

Stale-but-valid entries are **shown, flagged, never silently dropped**. The
collector evaluates source freshness using the same windows the brief's
`sourceHealth()` uses; entries derived from a stale source get `stale: true`
and one aggregate warning per source. Consumers render them with a staleness
marker. Only unparseable sources produce warning-without-entries.

## 9. Consumers

**HQ Manager Brief.** Add a bounded `### Timeline` section: strategic entries
plus campaign roll-ups for the next **90 days**, followed by one synopsis line
built from `beyondWindow` + the existing trajectory months, e.g. *"Beyond: 2
releases later this year (next 2026-11-14)."* The manager stays aware of the
whole year without the whole year's items in budget. The existing `### Release
Horizon` section is unchanged — trajectory narrative and dated items are
complements, not competitors.

Budget interaction: `MANAGER_BRIEF_MAX_CHARS = 8000`, enforced on rendered
characters; `finalizeBudget()` (`manager-brief.ts:284`) pops in a fixed order.
Timeline degrades *internally* before being dropped whole:

1. drop operational roll-ups
2. drop strategic entries beyond 30 days, farthest first (the `beyondWindow`
   synopsis line absorbs them)
3. drop the section, immediately before `trajectory` in the popper order

Also fix the upstream loss: add `startAt`/`dueAt` to `HqOperationalItem` so
`activeWork` can render dated.

**Retrieval tools.** Extend, don't add surface:
- `get_artist_context topic:'timeline'` with `from` / `to` / `tier` / `limit`,
  inside the existing 12k `bounded()` cap.
- Give `topic:'calendar'` a `from`/`to` and a sort (first-N-in-doc-order is a
  bug in its own right).
- `get_campaign_context include:['calendar','work']` gains the same window/sort.

Adding a topic requires amending `artist-manager-operating-system/SKILL.md`
and its hash gate in `SessionManager.ts`.

**UI (revised R2.1 — one year view, month-box pop-out):**
- **HQ Year View is the single strategic surface.** The existing Release
  Horizon 12-month grid remains the editable year strategy. Clicking a month
  box opens its detail pop-out, which now renders that month's timeline:
  strategic entries, and — when a campaign is logged for that month — the
  campaign's roll-up, expandable to its schedule. Clicking any entry navigates
  to its owning surface. Read and navigate only; creating nuanced campaign
  work from here routes into that campaign.
- **HQ Home keeps the This Week card as its compact strip** — now a thin view
  over the shared timeline (7-day window). A dedicated 90-day Home strip is
  deferred: the 90-day picture lives in the Manager Brief's `### Timeline`
  section and the year view's month pop-outs, and a third Home surface was
  judged clutter until real use argues otherwise.
- **HQ global events stay narrow**: genuinely artist-wide items (meetings,
  live appearances). Campaign dates *surface* in HQ automatically via the
  timeline; they are never re-entered there.
- Campaign Calendar is unchanged: the single big working calendar, per
  campaign. The artist never chooses "which calendar" — HQ answers *where am I
  headed*, Campaign answers *what are we doing today*.

## 10. What does not change

- No store is added, merged, or migrated. HQ, campaign, and scheduled-work keep
  their files and their owners.
- Campaign Calendar keeps full day-level detail and remains where campaign work
  is created and executed.
- Approval, receipt, and execution rules are untouched. The timeline is
  read-only and must never mutate an order.
- **`hqCalendarEventId` on `CampaignCalendarItem` is deleted** (decision §13.4).
  It is declared and referenced nowhere; the altitude rule replaces the
  mirroring idea it hinted at. Remove the field and its (nonexistent) readers
  in the same change as Phase 1.

## 11. Duplication this absorbs

Each exists twice today; the timeline layer becomes the single home:

- `resolveHqCampaignFocus` — `manager-brief.ts:165` and
  `artist-hq-home-feed.ts:209`, same ≤45-day rule.
- Rolling-12-month windows — consolidated into `rollingMonthKeys`
  (`timeline.ts`); `isMonthInRollingWindow` and the year view's
  `buildRollingMonths` are thin views over it.
- Timezone/date-key helpers — currently renderer-only in
  `artist-hq-home-feed.ts` (`dateKeyInTimezone` :339, `timeKey` :372); lift to
  shared, do not write a third set.
- Known limitation: the renderer cannot read `UserPreferences.timezone`
  (server-side config), so renderer surfaces anchor to the orders' own
  timezone (uniform per user in practice) with system-timezone fallback, while
  the server brief and tools use the preference. Exposing the preference to
  the renderer would close the gap; until then a mixed-timezone order set
  renders in the first order's zone.
- `buildHqThisWeekItems` becomes a thin call with a 7-day window.

## 12. Phasing

1. **Shared timeline module** — entry shape, explicit-link dedup, tier
   derivation, roll-ups, `beyondWindow`, warning merge. Pure, fully
   unit-tested, no consumers. Delete `hqCalendarEventId` here.
2. **Server collector + tools** — `topic:'timeline'`, window/sort on the
   existing calendar topics, warning propagation, staleness flags.
3. **HQ Manager Brief `### Timeline`** with internal degrade order and the
   beyond-window synopsis; add `startAt`/`dueAt` to `HqOperationalItem`.
4. **UI** — enrich the existing HQ Release Horizon month pop-outs with the
   unified strategic lens and repoint This Week; keep campaign Plan as the
   detailed working calendar. A separate 90-day Home strip remains deferred.
5. **Consolidation** — remove the duplicate focus/rolling-month/date helpers.

Phases 1–2 are independently useful: the manager can answer timeline questions
before any UI ships.

## 13. Decisions (closed 2026-08-29)

1. **Reference timezone: the existing user preference** —
   `UserPreferences.timezone` (`packages/shared/src/config/preferences.ts:40`)
   already exists and is already surfaced in Settings; use it, falling back to
   system local when unset. No new setting. All grouping uses it; entries keep
   their own zone for display.
2. **Window: 90 days**, with the `beyondWindow` synopsis keeping the manager
   aware of later-year releases ("2 singles releasing in the last months of the
   year" stays visible as a one-liner).
3. **Simplicity is a requirement, not a preference.** One big calendar per
   campaign; HQ gets strategic dates through Release Horizon and the existing
   compact This Week strip — never a second maintained calendar. Any future feature that would create two
   overlapping full-calendar pages in one product area is out of bounds.
4. **`hqCalendarEventId`: delete** (agent's call, no product need identified).
5. **No backward look.** Forward-only; `from` defaults to today. Retrospective
   queries can pass an earlier `from` explicitly, but no UI or brief surface
   looks backward in this phase.
6. **UI placement per §9**: Release Horizon untouched, unified lens on Plan,
   compact strip on Home.

## 14. Test plan

- **Dedup**: order + paired shell → one entry; half-link → one entry + warning;
  hidden order → none; shell without order → one; release + same-day HQ event →
  **two entries** (explicit-link-only rule).
- **Tier**: campaign task awaiting approval → strategic; same task without
  approval → operational; release → always strategic.
- **Goal eligibility**: non-goal doc with a `deadline` → no entry; goal doc
  with `status:'done'` → no entry; malformed deadline → no entry + warning.
- **Ordering**: mixed-tier query returns strict chronological order; `limit`
  applies after sort; `beyondWindow` counts survive `limit`.
- **Roll-up**: counts match the expanded entry list for the same window.
- **Timezone**: a 23:30 entry does not appear in two months; grouping is stable
  in the reference zone.
- **Warnings**: a campaign whose calendar fails to parse yields a warning and
  does not abort; collector-passed warnings appear merged with builder
  warnings.
- **Staleness**: entries from a stale source carry `stale: true` and are
  present; only unparseable sources yield warning-without-entries.
- **Budget**: 50 strategic entries degrade in the specified order, the synopsis
  line survives step 2, and rendered size never exceeds
  `MANAGER_BRIEF_MAX_CHARS`.

## 15. Non-goals

- No new persisted calendar; no mirroring of campaign items into HQ.
- No change to execution, approval, or receipt semantics.
- No external calendar sync work; Google sync stays where it is.
- No editing of campaign items from HQ surfaces — read and navigate only.
- No backward-looking UI or brief section in this phase.
