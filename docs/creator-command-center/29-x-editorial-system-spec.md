---
status: implemented-v1
owner: agent
last_verified: 2026-08-31
source_of_truth: true
related: ./13-scheduled-work-composer-execution-spec.md, ./20-artist-timeline-unified-calendar-spec.md, ./25-release-kit-asset-use-social-scheduling-spec.md
---

# X Editorial System

## Decision

Artist OS will have one **X Editorial** worker and one artist-wide X slate.

The worker may be launched from HQ or a Campaign, but those are two doors into the same system. HQ owns the artist's worldview, voice, recurring editorial lanes, schedule, and history. A Campaign may add timely song context; it does not create a second X runner, schedule, approval queue, or posting strategy.

```text
Artist truth + current research + active campaign context
                         ↓
                 X Editorial worker
                         ↓
                 Daily X Slate Output
                         ↓
               exact artist approvals
                         ↓
        Scheduled Work + one Calendar event per post
                         ↓
                  Social Publisher
                         ↓
                  verified receipt
```

## Product Promise

An artist can ask X Editorial to build today's slate and receive a small, excellent set of posts that sound like them, express what they actually care about, and occasionally connect the active release when the connection is real.

The artist edits, approves, or skips each post in one place. Approval automatically places that exact post on the schedule. The artist does not copy text between screens or manually create Calendar jobs. Nothing posts without approval, and a later edit invalidates the old approval.

## Why This Is Not A Generic Social Scheduler

X Editorial is the **editorial brain**. Social Publisher is the **execution hand**.

- X Editorial researches, selects angles, writes, explains relevance, and proposes timing.
- The Daily X Slate is the review surface and durable creative record.
- Scheduled Work owns timing, retry state, idempotency, attention, and receipts.
- Social Publisher resolves the exact account and executes the exact approved payload.

Do not teach X Editorial to publish directly. Do not teach Social Publisher to invent the worldview strategy at execution time.

## One Brain, Two Context Doors

### Launched from HQ

Use the artist-wide truth and automatically consider the active or nearest relevant Campaign. Campaign influence is normally light. The slate remains HQ-owned.

### Launched from a Campaign

Pin that Campaign as the release context for the run. It may increase campaign-adjacent and direct-release candidates, but it must still preserve the artist's wider editorial identity. The slate remains part of the same X history and dedupe pool.

### Conflict rule

There is never an HQ X runner competing with a Campaign X runner. If another slate already covers the proposed time window, the worker revises the slate rather than creating overlapping posts.

The Campaign door switches into the HQ-owned worker session and injects only the selected Campaign's agent-visible brief, state, and Calendar context. Read-only Campaign/Release Kit tools accept that exact Campaign workspace ID. Mutation authority remains unchanged.

## Editorial Mix

The default daily target is five candidates, adjusted down when the material is not strong enough:

| Lane | Default | Job |
| --- | ---: | --- |
| Worldview | 3 | Earn attention through the artist's beliefs, tensions, observations, taste, humor, and lived perspective. |
| Campaign-adjacent | 1 | Connect a current topic or human truth to the active song's emotional territory without forcing promotion. |
| Direct release | 1 in an active release window | Use an approved song, lyric, clip, image, or link and clearly move people toward the release. |

Quality beats quota. A three-post slate is better than five pieces of filler.

## The Campaign Relevance Gate

A campaign-adjacent post is allowed only when all three are true:

1. The topic naturally intersects an established artist belief, tension, or recurring theme.
2. The song or Campaign genuinely occupies the same emotional territory.
3. The post remains worth reading even if the release title and link are removed.

If any part fails, keep the post in the worldview lane or discard it. No trend-jacking, lyric shoehorning, fake expertise, or "this reminds me of my new single" transitions.

## Research Standard

Deep Research is used to find current conversations, evidence, language, tensions, and cultural moments—not to replace the artist's point of view.

For every researched angle:

- prefer current, primary, or reputable sources;
- record source URL, title, date when known, and the specific claim used;
- distinguish a confirmed fact from an inference or editorial interpretation;
- reject topics the artist has no credible reason to speak on;
- avoid sensitive personal speculation and tragedy opportunism;
- never invent a trend, quote, statistic, or consensus.

The slate may also use the artist's own lyrics, notes, Spark Bank ideas, prior posts, and Campaign materials. These are inspiration sources, not permission to expose private text verbatim.

## Voice Standard

Every draft must survive four tests:

1. **Identity test** — could this only plausibly come from this artist?
2. **Truth test** — is there a real observation, belief, tension, story, or useful point?
3. **Speakability test** — would the artist actually say it this way?
4. **Need test** — does this deserve to exist, or is it feeding a posting quota?

The system may use strong hooks and clean X structure, but it must not manufacture controversy, fake vulnerability, generic inspiration, engagement bait, hashtag sludge, or creator-coach language.

### Edge is not a defect

X Editorial should deliberately surface the artist's real fault lines from HQ: convictions, standards, enemies, contradictions, unpopular tastes, humor, attitude, taboos, and documented boundary-pushing tendencies. It should draft the sharpest honest version rather than pre-softening ideas that may divide opinion. The artist's exact edit, skip, reject, and approval controls are the creative risk boundary.

Touchy, polarizing, confrontational, sensual, strange, or uncomfortable ideas are allowed when they are authentically the artist's. Invented beliefs, unsupported factual allegations, harassment, exploitation, and controversy manufactured only for attention remain disallowed. If HQ contains no meaningful edge, the worker should identify that context gap and return fewer candidates instead of generic safe copy.

## Daily X Slate Output

The worker creates one `collection` Output with:

- tag `artist-x-slate`;
- `application/json` content;
- `approval.state: pending`;
- HQ context, plus optional Campaign linkage inside the slate;
- `showInCanvas: true`.

### V1 schema

```json
{
  "schemaVersion": 1,
  "slateId": "xslate_...",
  "title": "Daily X Slate — Aug 31",
  "createdAt": "2026-08-31T17:00:00.000Z",
  "timezone": "America/Chicago",
  "profile": {
    "platform": "x",
    "profileId": "artist-main"
  },
  "context": {
    "scope": "hq",
    "campaignId": "optional-campaign-id",
    "campaignName": "optional campaign name",
    "campaignWeight": "none"
  },
  "research": {
    "summary": "What was researched and why it matters today.",
    "researchedAt": "2026-08-31T16:45:00.000Z",
    "sources": [
      {
        "id": "src_1",
        "title": "Source title",
        "url": "https://example.com/source",
        "publishedAt": "2026-08-31",
        "claim": "The exact fact or tension used."
      }
    ]
  },
  "candidates": [
    {
      "id": "post_1",
      "revision": 1,
      "lane": "worldview",
      "format": "post",
      "text": "Exact proposed X post.",
      "rationale": "Why this fits the artist and why now.",
      "researchBasis": "mixed",
      "sourceIds": ["src_1"],
      "campaignId": null,
      "scheduledFor": "2026-08-31T19:00:00.000Z",
      "timingBasis": "editorial-default",
      "asset": null,
      "status": "proposed"
    }
  ]
}
```

### Required invariants

- `slateId` and candidate IDs are stable and unique.
- Every candidate starts at revision 1.
- Every candidate has one exact profile and future time before it can be approved.
- Every schedulable V1 post is at most 280 Unicode characters. Premium long-post capability is not assumed.
- Every candidate labels its basis as `artist-truth`, `cited-research`, or `mixed`; cited and mixed candidates point to source IDs.
- Campaign linkage is explicit, never inferred from copy.
- `asset` is either null or a typed reference to one exact approved asset.
- Status is one of `proposed`, `approved`, `skipped`, `scheduled`, `posted`, `needs-attention`.
- Generated copy is never treated as approved because the model labeled it ready.

## Review UX

Opening a Daily X Slate shows compact post cards, not raw JSON.

Each card shows:

- lane: Worldview, Campaign thread, or Release;
- exact post text;
- short "Why this fits" note;
- suggested date, time, timezone, and account;
- timing basis: audience data, known schedule, or editorial default;
- optional asset thumbnail and approved-source label;
- provenance badge: Artist truth, Researched, or Artist + research;
- live standard-post character count;
- source links when factual research materially shaped the post;
- **Edit**, **Approve**, and **Skip**.

The header shows the slate date, account, campaign influence, and counts. A slate whose creation or research timestamp is more than 48 hours old shows a non-blocking freshness warning. **Approve all** first opens a compact confirmation listing every exact ready candidate and proposed time; confirmation then approves each candidate independently. It is not a blanket authorization for future revisions.

### Edit behavior

Editing creates a new candidate revision. If the candidate was approved or scheduled, the old authorization is invalidated and the artist must approve the changed copy again. The UI says this before saving.

### Approval behavior

Approving a candidate atomically:

1. validates the slate and current candidate revision;
2. resolves the exact connected X profile;
3. validates future time and optional asset integrity;
4. mints a host-side authorization over the exact copy, profile, time, options, and asset digest;
5. creates one Scheduled Work order;
6. creates one linked Calendar event;
7. marks the same candidate `scheduled` and records the order ID.

If any step fails, the candidate remains unapproved. Never leave a Calendar event without its work order or mark the slate scheduled without both.

### Skip behavior

Skip records the decision in the slate and creates no work order. It is reversible until the slate is archived.

## Scheduling

Suggested timing is a recommendation, not a fabricated optimization claim.

Priority order:

1. connected account analytics with a named observation window;
2. known audience behavior saved in HQ context;
3. explicit campaign timing constraints;
4. an editorial default, visibly labeled as such.

Without analytics, space posts by at least two hours, avoid overnight local time, preserve release-time commitments, and never describe a default as "best time."

Every approved post becomes the single source of truth for its Calendar item. Calendar edits route back through the same revision and reauthorization rules.

## Exact Authorization

Authorization binds:

- slate ID and candidate ID;
- candidate revision;
- exact X profile ID;
- exact post text and options;
- exact scheduled timestamp and timezone;
- optional asset reference and content hash;
- a stable payload digest;
- the authorizing user/client and timestamp.

The agent cannot mint this record. Only a user action handled by the host can.

## Asset Rules

- Worldview and campaign-adjacent posts may be text-only.
- Direct-release media must come from the active Campaign's verified Release Kit.
- A reusable HQ asset may be proposed only after a separate exact verification path exists; it is not silently treated as a final.
- A changed, missing, restricted, or drifted file blocks scheduling.
- No media substitution or generation occurs at publish time.

## Threads

The editorial worker may draft a thread concept, but V1 automatic scheduling is single-post only. Thread execution remains disabled until Artist OS can bind and verify the ordered reply chain, parent receipt, partial-failure behavior, and exact authorization for every segment.

Do not flatten a thread into multiple unrelated scheduled posts or pretend the current single-post executor can preserve reply order.

## Dedupe And Fatigue Control

Before creating a slate, compare against recent slates, scheduled X work, and verified receipts.

V1 exposes this history through the read-only `list_x_editorial_history` tool. Approval independently blocks an exact normalized repeat inside seven days and any second X post targeting the same minute, so collision safety does not rely only on model behavior.

Block or rewrite:

- exact or near-duplicate copy;
- the same core take repeated without new substance;
- repeated direct promotion inside the same short window;
- two candidates targeting the same time slot;
- a campaign post that conflicts with an already-approved artist-wide post.

The dedupe key must include normalized copy, profile, time window, campaign, and asset where present. Similarity warnings should be visible, not silently discarded.

## Failure States

| Failure | Behavior |
| --- | --- |
| Missing X profile | Slate may be drafted; approval is disabled with **Connect X**. |
| Stale or missing research | Mark the angle unsupported; do not state it as current fact. |
| Campaign connection is forced | Downgrade to Worldview or discard. |
| Proposed time is now past | Require a new time before approval. |
| Candidate changed during approval | Reject on revision mismatch and reload the slate. |
| Asset drifted | Refuse approval and point to Release Kit review. |
| Persistence fails | Roll back the decision; do not create a partial schedule. |
| Provider result is ambiguous | Stop in Needs attention; never auto-retry on another route. |
| Receipt is missing | Do not mark posted. |

## Notifications And Discoverability

- X Editorial appears in Workers in both HQ and Campaign workspaces.
- A Campaign launch carries that Campaign into the same agent chat context.
- A newly created slate appears in Outputs and Canvas.
- Slates awaiting decisions may appear in the existing bell/attention surface, linked to the same Output.
- Scheduled candidates appear in HQ Plan and retain a Campaign link when applicable.
- The app must not create a separate X inbox, X calendar, or campaign-local slate registry.

## Implementation Slices

### Slice 1 — Editorial intelligence

- Add `artist-x-editorial` bundled skill and references.
- Add one X Editorial starter worker.
- Make it a default visible worker in HQ and Campaigns.
- Give it Deep Research and `create_output`, but no publish tool.
- Test skill bundling and agent contract.

### Slice 2 — Typed slate and visual review

- Add shared V1 slate parser/validator and digest helpers.
- Detect `artist-x-slate` Outputs and render the dedicated preview.
- Add Edit, Approve, Skip, and exact per-card status.
- Use optimistic revision checks.

### Slice 3 — Host authorization and scheduling

- Add a text-first X authorization command separate from Release Kit media authorization.
- Reuse `ScheduledWorkOrder`, Artist Calendar, runner, preview, approval, and receipt paths.
- Extend `ScheduledWorkAuthorization` with a discriminated definition; do not weaken the current Release Kit definition.
- Allow optional verified Release Kit media and no-media X posts.
- Persist order, Calendar event, and slate decision as one recoverable transaction.

### Slice 4 — Attention and history

- Link Needs You/bell items to the same slate.
- Reflect runner status and receipts back into candidate cards.
- Add recent-slate dedupe and campaign-pressure warnings.

## Shipped V1 Boundary

Implemented:

- one HQ-owned X Editorial worker launchable from HQ or a Campaign;
- Artist HQ truth, read-only Campaign context, Deep Research, Comms writing, and recent-slate history;
- dedicated Daily X Slate review with Edit, Skip, Approve, and Approve All;
- exact host-minted authorization, Scheduled Work, HQ Calendar linkage, and verified receipt reflection;
- text-only posts and exact Campaign Release Kit media, including fresh restriction and integrity checks before execution;
- duplicate-copy and same-minute schedule refusal;
- Needs-attention state reflected back into the originating slate.

Deliberately deferred:

- native ordered X threads;
- automatic performance-learning changes to the artist's voice or identity;
- near-duplicate semantic warnings beyond the agent's history comparison and host exact-copy gate.

### Slice 5 — Native threads and learning loop

- Add ordered thread execution only after partial-failure and reply-chain semantics are specified.
- Read verified performance into future timing and lane selection without rewriting artist identity around one viral outlier.

## Acceptance Criteria

1. The same X Editorial worker launches from HQ and Campaigns.
2. It reads artist truth before researching or drafting.
3. Campaign material appears only when it passes the relevance gate.
4. The agent creates a schema-valid Daily X Slate Output with traceable sources.
5. No agent tool can approve or post a candidate.
6. Edit invalidates prior approval.
7. Approve creates one exact work order and one linked Calendar event.
8. Approve All creates independent approvals and orders.
9. Text-only X posts work without pretending they have a Release Kit asset.
10. Direct-release media stays pinned to a verified Release Kit snapshot.
11. Done requires a verified receipt.
12. No duplicate HQ/campaign X schedules or runner loops exist.

## Out Of Scope For V1

- autonomous posting;
- engagement farming or automated replies;
- cold DMs;
- fabricated trend or account analytics;
- generic cross-platform content adaptation;
- recurring unattended editorial loops;
- automated native threads;
- paid promotion;
- a second calendar, scheduler, or social-post database.
