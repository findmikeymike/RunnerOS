---
status: draft
owner: agent
last_verified: 2026-09-04
source_of_truth: true
---

# HQ / Campaign Scope Clarity — One Rule, Two Altitudes, Shared Workers

Revision 1. Written from a design review of the HQ ↔ Campaign overlap, grounded
in the tree at `f60348976`. Every "already holds" claim below was verified by
reading the cited symbol, not the spec that describes it.

## 1. Problem

Artist HQ and Campaign workspaces share a lot on purpose: Social Publisher,
Comms Agent, Shopify Agent, Print Agent, the fan list, the store, the brand
voice. That sharing is correct — a release needs the same accounts and the same
voice the career does. But the UI gives the artist no rule for **where to
stand** when they run shared work, and no way to see, from inside a campaign,
what HQ has already queued into the same week.

Concrete failure modes today:

- **Two spaces, no stated rule.** Social Publisher, Shopify Agent, and Print
  Agent appear in both HQ and Campaign worker lists (`BUILTIN_VISIBLE_AGENT_SLUGS`,
  `apps/electron/src/renderer/hooks/useAgents.ts:51`). Nothing in the product
  tells the artist whether "post about the single" belongs in HQ or in the
  single's campaign. They pick by habit, and habit varies by day.
- **Visibility is one-directional.** The unified timeline (spec 20,
  `packages/shared/src/hq-state/timeline.ts`) merges HQ events, every
  campaign's calendar, every scope's scheduled work, release dates, and goal
  deadlines. It is consumed only by HQ — `ArtistHQHome.tsx`,
  `artist-hq-home-feed.ts`, `hq-state/snapshot.ts`, and the HNIC's
  `manager-tools.ts`. The campaign side (`ScheduledWorkComposer.tsx` and the
  per-campaign `campaign-calendar` store) never sees HQ-owned or other-campaign
  work. HQ can see campaigns; campaigns cannot see HQ.
- **Nothing detects a channel collision.** Two `social-publish` orders to the
  same `platform` + `profileId` two hours apart — one from HQ, one from a
  campaign — are both valid, both scheduled, and both fire. The only
  `'conflict'` string in the relevant modules is external-calendar
  `syncStatus` (`campaign-calendar/index.ts:148`), unrelated.
- **Scope is chosen by navigation, not by intent.** The artist decides scope
  by which space they walk into before they type. There is no moment where the
  system notices "this request is clearly about *Campaign X*" and offers the
  handoff.

The temptation is a structural fix: a third "shared" space, or one merged
calendar, or forcing each shared agent to belong to one side. **All three are
wrong**, and §2 explains why: the storage model already has the right shape.
This spec fixes the wayfinding and the collision blind spot without touching
ownership.

## 2. What already holds (verified)

The following are true in the tree and this spec depends on them. None need to
change.

| Invariant | Where |
|---|---|
| Every executable order has exactly one owner: `owner: { scope: 'hq' \| 'campaign', workspaceId, campaignId? }` | `scheduled-work/index.ts:16`, `ScheduledWorkOrder.owner` |
| An order is bound to the calendar of its owner: `owner.scope === calendarLink.calendar` is a validity condition | `isScheduledWorkOrder`, `scheduled-work/index.ts:~933` |
| Campaign-scoped orders have `campaignId === workspaceId`; HQ orders have no `campaignId` | same guard |
| Finals carry the same split: `OutputFinalScope = 'hq' \| 'campaign'` | `outputs/types.ts:32` |
| One unified **read** across all dated stores, every entry with an `origin` pointing at its owner, dedup by explicit link only, never by title/date | `buildArtistTimeline`, `timeline.ts` |
| Server-side collector that enumerates HQ + every campaign workspace and builds the timeline | `collectArtistTimeline`, `server-core/src/hq-state/timeline-collector.ts:66` |
| Timeline already carries `tier: 'strategic' \| 'operational'` — the two altitudes HQ and Campaign actually need | `TimelineTier` |
| `social-publish` execution carries `platform` + `profileId` — a stable channel identity | `scheduled-work/index.ts:178-180` |
| Agent metadata has a routing hint channel: `routing.handsOffTo`, granting no authority | `agent-definitions/types.ts:69` |
| Spec 20 §2 principle 3 already states: *HQ never creates campaign day-work; an attempt routes into the owning campaign* | spec 20 |

Read together: **ownership belongs to the work, not the worker.** A shared
agent is one employee who can be handed a work order by the label (HQ) or by a
release project (campaign). The order records who handed it over. That is
correct and this spec keeps it.

## 3. The rule

One sentence the artist should be able to hold in their head. Every UI decision
in this spec follows from it, and the in-app guide (spec 27) should state it
verbatim.

> **HQ is the artist. A Campaign is a release.
> If the work is about a specific release, it lives in that campaign.
> Otherwise it lives in HQ.**

Corollaries, stated so implementers do not re-derive them differently:

- The **same worker** can take work from either side. Which side is a property
  of the *order*, never of the *agent*.
- **Career assets live in HQ.** The store, the fan list and its suppressions,
  the connected social accounts, the brand voice, the vault. A campaign
  references them; it does not own a copy.
- **Work orders originate wherever the intent lives.** A merch drop *for this
  release* is a campaign order against the HQ store. A newsletter *about this
  release* is a campaign order against the HQ list. An evergreen "new merch is
  up" post is an HQ order.
- **Receipts flow back to the asset.** Whichever scope ran the work, the
  durable receipt lands in the asset's history (existing behavior for
  outputs/finals and social approvals; extend the framing, not the code).

## 4. Principles

1. **No third space.** Two places with a clear rule beats three places with a
   fuzzy one. Shared surfaces get a home (HQ) and a rule, not a room.
2. **Separate writes, one read.** HQ events, campaign calendars, and the
   scheduled-work ledger remain separate stores. The timeline remains the only
   merge. This spec adds *consumers* and *derivations* of the timeline; it adds
   no store and no second merge.
3. **Show before you warn, warn before you block.** Slice A makes the overlap
   visible. Slice B names it. Nothing in this spec prevents the artist from
   scheduling two posts to one channel on one day — that is sometimes exactly
   what they want.
4. **Suggest scope at the moment of action, never move work silently.** An
   order's owner is set when it is created and does not change under it. A
   "move" is a new draft in the other scope plus a cancel here, and only for
   drafts (§8).
5. **Agents never gain authority from a hint.** `routing.handsOffTo` and the
   prompt rule in Slice C are wayfinding. Approval for any public action stays
   bound to the exact order, per the house rule.

## 5. Ownership of shared surfaces

This table is the product decision the fuzziness was really about. It should
be reflected in the guide and in each shared agent's prompt (Slice C).

| Surface | Canonical home | A campaign may… | Never |
|---|---|---|---|
| Store / product catalog (`shopify-agent`, `print-agent`) | HQ | create a *drop* or *bundle* scoped to the release; queue release-day store changes | fork the catalog |
| Fan list, suppressions, segments (`comms-agent`) | HQ | send a *message* about the release; define a release-scoped segment | maintain its own list |
| Social accounts, brand voice, persona docs (`social-publisher`, `persona-agent`) | HQ | queue *posts* for the release; use release-kit assets only (`releaseKitOnly` already enforced in the composer for campaign social work) | change account-level voice |
| Vault | HQ | promote into its Release Kit (spec 23) | — |
| Release kit, campaign assets, campaign calendar | Campaign | — | be read as career canon |

"Canonical home" means where the artist goes to *manage* the thing. It does
not restrict where *work against* the thing can be queued.

## 6. Slice A — Campaign calendar gets the cross-scope layer

**Goal.** From inside a campaign, the artist sees what HQ and other campaigns
have queued into the same window, rendered as a distinct "also happening"
layer they cannot edit from here.

**Read path.** Reuse the existing timeline. Two viable wirings; the first is
recommended:

- *Recommended:* expose `collectArtistTimeline` over the WebSocket JSON-RPC
  transport (it currently has no RPC — only `manager-tools.ts:293` calls it,
  server-side). The campaign calendar requests `{ from, to }` for its visible
  window. One collector, one enumeration of workspaces, no renderer-side
  cross-workspace reads.
- *Alternative:* build renderer-side with `buildArtistTimeline` the way
  `artist-hq-home-feed.ts:75` does. Rejected as primary because the campaign
  renderer would need every other workspace's stores, duplicating the
  collector's enumeration.

**Filtering.** Entries whose `origin.workspaceId === thisCampaign.workspaceId`
are the campaign's own and are already rendered by the campaign calendar; drop
them from the layer to avoid double-rendering. Everything else in the window
is the layer. Respect `tier`: the campaign's day view shows both tiers; a
week/month rollup may collapse other-scope operational items to a count using
`ArtistTimeline.rollups`.

**Rendering contract.**

- Layer entries are visually dimmed and non-interactive except for a single
  affordance: "Open in HQ" / "Open in *Campaign Y*" that navigates to the
  owner. No edit, no cancel, no drag from inside a campaign.
- Each layer entry shows its owner label (`'HQ'` or the campaign label from
  `TimelineCampaignWindow.label`) so the artist reads *whose* it is at a glance.
- `needsAttention` entries in the layer keep their attention styling. If HQ's
  Friday newsletter is blocked waiting on approval, the campaign should see
  that too.
- `stale` entries render with the same staleness treatment HQ home uses.

**Composer integration.** `ScheduledWorkComposer.tsx` already knows
`entry.owner`. When open in a campaign, it receives the same window of layer
entries so Slice B can check the draft against them inline.

**Explicitly not in scope.** HQ's calendar does not change; it already has the
full timeline. The campaign's *own* calendar rendering does not change.

## 7. Slice B — Channel collision detection

**Goal.** Two publishes to the same channel, close in time, from different
owners, are named as a collision — on the timeline, in HQ's attention list,
and inline in the composer. Never blocked.

**Data.** `TimelineEntry` gains one optional field, populated only for
`scheduled-work` origins whose execution is `social-publish`:

```ts
export interface TimelineEntry {
  // ...existing fields
  /** Present for social-publish orders. Stable channel identity. */
  channel?: { platform: string; profileId: string };
}
```

Source: `order.execution.platform` / `order.execution.profileId`
(`scheduled-work/index.ts:178-180`). Orders with `platform` but no `profileId`
do not get a `channel` and are never flagged (an unresolved profile is a
`needs-setup` problem, already surfaced elsewhere).

**Derivation.** `ArtistTimeline` gains `collisions: TimelineCollision[]`,
computed inside `buildArtistTimeline` after the sort and before the limit, over
the *unlimited* entry set so a collision is not hidden by `limit`.

```ts
export interface TimelineCollision {
  kind: 'channel-collision';
  channel: { platform: string; profileId: string };
  /** Exactly two entry ids, in chronological order. */
  entryIds: [string, string];
  owners: [TimelineOrigin, TimelineOrigin];
  /** Minutes between the two sortKeys. */
  gapMinutes: number;
}
```

Rule — a pair `(a, b)` is a collision iff **all** of:

1. both have `channel` and `a.channel` deep-equals `b.channel`;
2. `a.origin.workspaceId !== b.origin.workspaceId` — **cross-owner only.**
   Two posts from the same owner close together are treated as a deliberate
   thread or sequence and are not flagged;
3. neither entry's `status` is `'done'` or `'canceled'`;
4. `|sortKey(a) − sortKey(b)| ≤ CHANNEL_COLLISION_WINDOW_MINUTES`.

`CHANNEL_COLLISION_WINDOW_MINUTES` is a named constant in `timeline.ts`,
initial value **240** (4 h). It is a product knob, not a user setting, until
real use says otherwise (§11).

Pairwise is fine: entries are already sorted, so a single forward scan per
channel bounded by the window is O(n) in practice. Do not pre-bucket by day —
a 23:30 / 00:30 pair across midnight is exactly the case a day bucket misses.

**Surfaces.**

1. **Timeline / calendar.** Both entries in a collision get a collision
   marker. In the campaign layer (Slice A) this is the first thing the artist
   sees when their draft lands next to an HQ post.
2. **HQ Needs attention.** `buildAttention` in `hq-state/composer.ts` emits one
   `HqStateAttentionItem` per collision:
   `{ kind: 'channel-collision', text: '<Owner A> and <Owner B> both post to <platform> within <gap> on <date>', source: 'timeline' }`.
   It competes for the existing top-3 slice like everything else; a collision
   involving an entry that already `needsAttention` should rank above one that
   does not.
3. **Composer, inline.** When a `social-publish` draft's `platform`,
   `profileId`, and `startAt` would collide with a layer entry, the composer
   shows a non-blocking notice naming the other owner and time, with "Open"
   to view it. The artist can still schedule. This check runs on the draft
   before it is an order, so it needs the same rule as a pure function —
   export `findChannelCollisions(entries, candidate)` from `timeline.ts` and
   reuse it rather than duplicating the rule in the renderer.

**Warnings, not entries.** A collision is a derived fact about two real
entries. It is never itself an entry, never merges the two, and never changes
either order's status.

## 8. Slice C — Scope handoff at the moment of action

**Goal.** When the artist is clearly filing work in the wrong scope, the
system says so once and offers the move. It never moves work on its own.

Ship this last, after A and B have been observed (§11). Visibility may remove
most of the confusion on its own, and an over-eager redirect is worse than none.

**C1 — Composer "File in…".** The composer gains an owner affordance that
defaults to the current space. For a **draft** (`status: 'draft'`, no
approvals, no runs), choosing the other scope re-files: create an equivalent
draft under the new `owner` + matching `calendarLink.calendar`, cancel the
original. This respects the validity guard (`owner.scope === calendarLink.calendar`)
by never mutating `owner` in place. Orders past draft do not move — an
approval is bound to the exact order it approved, and a moved order is a
different order.

The choice list is: `HQ`, plus each campaign with an active
`TimelineCampaignWindow` (start ≤ today ≤ finish, or no finish yet). Campaigns
outside their window are not offered; if the artist needs one, they go there.

**C2 — Shared-agent prompt rule.** The four shared-surface personas —
`social-publisher`, `comms-agent`, `shopify-agent`, `print-agent` — get a
short, identical rule appended to their system prompt, written in the artist's
language per house style, roughly:

> You can be asked to do this from HQ or from a release campaign. If you're in
> HQ and the request is clearly about one specific release that has its own
> campaign, say so in one line and offer to file it there instead — then do
> what the artist says. If you're in a campaign and the request is evergreen
> (not about this release), you can mention it belongs in HQ, but don't hold
> the work up over it. Never move anything yourself.

The agent needs two facts to apply it: which scope it is running in, and the
labels + release dates of active campaigns. The first is already in the
composed prompt (workspace kind). The second is already available to the HNIC
via the timeline's `campaignWindows`; extend the same small block into
`agent-prompt/compose.ts` for these four slugs only. **Check `SessionManager.ts`
too** — prompt assembly is duplicated there (known drift), and a rule that
lands in one path and not the other will look flaky.

Add `routing.handsOffTo` entries pointing each of the four at the campaign
side's owner personas where one exists (e.g. `social-publisher` ↔
`release-manager`), as the declarative counterpart to the prompt rule. Hint
only.

**C3 — Guide.** Spec 27's in-app guide gets a short "Where do I do this?"
entry that states §3's rule and reproduces the §5 table.

## 9. Non-goals

- A merged or shared "content" space. See principle 1.
- A separate calendar system for either side. The stores are already
  separate; the read is already unified.
- Making any shared agent HQ-only or campaign-only.
- Auto-resolving collisions (re-timing one post). The artist decides.
- Detecting collisions across *different* profiles on the same platform. Two
  accounts posting at once is not a collision.
- External calendar sync. Still deferred per spec 12.

## 10. Verification

Tests live beside the existing ones; do not create a new test tree.

- `packages/shared/src/hq-state/__tests__/timeline.test.ts`
  - `channel` populated for social-publish orders, absent otherwise, absent
    when `profileId` missing.
  - Collision rule: cross-owner within window → flagged; same owner within
    window → not; cross-owner outside window → not; done/canceled → not;
    midnight-straddling pair → flagged; collision still reported when `limit`
    would have cut one entry.
  - `findChannelCollisions` returns the same result for a candidate as the
    full build does once the candidate is an entry.
- `packages/shared/src/hq-state/__tests__/composer.test.ts`
  - Collision emits one attention item with `kind: 'channel-collision'`; a
    collision involving a `needsAttention` entry ranks above one that does not.
- `packages/server-core/src/hq-state/timeline-collector.isolated.ts`
  - Collector output over the RPC path equals direct `collectArtistTimeline`
    for the same window (Slice A).
- `packages/shared/src/scheduled-work/` tests
  - C1 re-file produces a valid order under the new scope (passes
    `isScheduledWorkOrder`), cancels the original, and refuses for any
    non-draft status.
- Manual, in the app with `CRAFT_PRODUCT_VARIANT=artist-os`:
  - Queue an HQ post to a profile at 10:00; open a campaign, draft a post to
    the same profile at 12:00 → layer shows the HQ post, composer shows the
    collision notice, HQ Needs attention lists it. Schedule anyway → both
    remain scheduled; nothing blocked.
  - Same at 10:00 and 15:00 → no collision.
  - Same profile, both from HQ, 10:00 and 11:00 → no collision.

Run `bun run test:product-isolation` after Slice A's RPC addition; a new RPC
must not leak across variants.

## 11. Open decisions

1. **Window size.** 240 min is a guess. Measure how often real artists queue
   two channels-worth of posts within 4 h across owners before making it a
   setting.
2. **Should same-owner collisions ever flag?** Current answer: no. Revisit if
   HQ automations (Weekly Spotify Snapshot, YouTube Intel Pulse) start queuing
   social work that collides with the artist's own HQ posts.
3. **Ship C at all?** Decide after A and B have been in the artist's hands for
   a couple of campaigns. If the confusion is gone, C2 in particular should
   stay unshipped — a rule an agent recites every session costs attention.
4. **Slice A transport.** RPC is recommended; if the renderer already has
   every campaign's stores loaded for another reason by the time this is
   built, the renderer-side builder is acceptable.

## 12. Relationship to other specs

- **20 Artist Timeline** — this spec is a consumer and a small extension
  (`channel`, `collisions`). Its four principles are inherited unchanged.
- **13 Scheduled Work Composer** — C1 lives here; the order validity guard is
  the reason moves are create-and-cancel.
- **25 Release Kit Asset Use And Social Scheduling** — `releaseKitOnly` for
  campaign social work is the existing enforcement of §5's "use release-kit
  assets only."
- **27 In-App User Guide** — C3.
- **09 / 14 State Of Play** — Slice B's attention item flows through the
  existing `buildAttention` path.
