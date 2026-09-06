---
status: proposed
owner: agent
last_verified: 2026-09-04
source_of_truth: true
related: ../19-artist-manager-brief-context-architecture-spec.md, ../30-release-manager-essentials-execution-spec.md, ../14-state-of-play-opportunity-engine-spec.md, ../23-release-kit-architecture-spec.md, ../24-session-task-list-spec.md, ../26-agent-bound-messaging-spec.md, ../28-track-intelligence-spec.md
---

# Campaign Release Path And Manager Orchestration

## Decision

Turn the existing Campaign Essentials page into a date-aware release path and
teach the existing Artist Manager to guide that exact path. Do not create a
second campaign store, another manager persona, or a new worker directory.

The product should answer three questions immediately:

1. Where are we in this release?
2. What is the next useful thing to finish?
3. Who can help me do it?

```text
mission-brief release date + release-board + campaign evidence
                              |
                   pure Release Path compiler
                              |
              Essentials UI + Campaign Manager Brief
                              |
                     Continue campaign
                              |
        existing worker, workflow, tool, or manual next step
                              |
           approved packet, asset, link, or provider receipt
                              |
                 release-board status and evidence
```

## Product Outcome

A first-time artist should not need to understand the worker roster. After
creating a campaign and entering a release date, Essentials shows the release
as five understandable phases. One focus row explains what should happen now
and opens the right conversation or action.

The Artist Manager uses the same computed path as the UI. When the artist says
"continue the campaign," the manager discusses the next decision, retrieves
only the context needed for it, and delegates one bounded task to the existing
specialist or workflow. The artist can still open any worker directly.

## Non-Goals

- Do not reorganize the Workers page by release phase.
- Do not add a Campaign Manager agent beside the Artist Manager.
- Do not replace the Release Board or duplicate its item statuses.
- Do not turn State of Play into a second campaign checklist.
- Do not automatically mark work complete because an agent produced text.
- Do not require every campaign to use every optional promotion lane.
- Do not create free-form conversations among many agents.
- Do not schedule or publish content, send email, spend money, upload a
  release, or accept provider terms without the existing exact approval.

## Current Code Truth

This feature extends these live paths:

| Existing primitive | Current behavior | Required evolution |
| --- | --- | --- |
| Campaign `mission-brief` | Owns campaign title, dates, focus, and campaign framing | Supply release date and campaign timezone to the Release Path compiler |
| Campaign `release-board` | Owns categories, items, inclusion, status, and linked work | Remain canonical; add bounded evidence, schedule override, and packet references only where required |
| `getReleaseBoardItemAction` | Maps an Essentials row to an agent, workflow, or tool | Become the canonical action map used by both the UI and Artist Manager |
| Campaign Manager Brief | Reports readiness, missing items, assets, work, approvals, and failures | Add active phase, next action, target date, dependency state, late-start note, and packet readiness |
| State of Play | Ranks current obligations and opportunities | Consume the next Release Path action as evidence; do not duplicate the path |
| Essentials UI | Shows every Release Board category and row | Project the same rows into five date-aware phases with one clear current focus |
| `message_agent` and workflows | Provide bounded specialist handoffs and durable receipts | Carry compact typed briefs; no agent conversation loops |
| Outputs, Finals, Release Kit | Store work products and approved release assets | Carry campaign-use metadata needed for sequencing and publishing |

## Core Laws

1. **One writable truth.** Item status remains in `release-board`. The Release
   Path is a derived view and is safe to regenerate.
2. **One compiler, two consumers.** Essentials and the Campaign Manager Brief
   must call the same pure Release Path compiler.
3. **Dates guide; dependencies govern.** A due item is not actionable if a
   required source is missing. The UI names the source instead of launching
   work that must fail.
4. **Optional is not blocking.** Optional and conditional rows affect the path
   only after the artist includes them or evidence makes the condition true.
5. **Evidence beats agent claims.** Completion uses the existing Release Board
   status contract and linked asset, session, run, review, URL, or receipt.
6. **The manager recommends and delegates.** Specialists perform bounded work;
   the manager owns the artist conversation and final synthesis.
7. **Packets are approved campaign context.** Draft outputs do not become
   campaign direction merely because an agent created them.
8. **Late campaigns become smaller, not dishonest.** The path compresses to
   release-critical work and labels dates at risk. It never hides lateness.
9. **No context flood.** Workers receive the approved packet and exact source
   references required for their task, not the entire HQ and campaign.
10. **Public actions keep their gates.** A roadmap position, completed packet,
    or manager handoff is never authorization to publish, send, spend, book,
    upload, or change an account.

## The Five Phases

Offsets are defaults relative to the campaign release date. They are calendar
dates in the campaign timezone, not 24-hour durations. A campaign may override
an item target date without changing the global playbook.

### 1. Foundation - default target D-28

Purpose: establish the facts and source material every later phase depends on.

- release date and campaign timezone
- final master
- approved lyrics
- initial credits and contributor identities
- campaign mission and intended audience

Foundation can begin without a release date, but the path remains undated and
the focus action is to set one. Master and lyrics block creative production.
Missing final credits do not block early concept work, but they block delivery,
rights, DSP pitch, and final QA.

### 2. Campaign Direction - default target D-21

Purpose: agree on what the campaign means and the world it should create before
generating a pile of disconnected assets.

- song-specific creative world
- audience and emotional promise
- campaign positioning and ethos
- visual language and repeatable identity
- single-art direction and final single art

The Artist Manager leads the conversation. World Builder, Branding Agent, Art
Director, and other specialists return proposals through bounded handoffs. The
approved synthesis becomes the Campaign Direction Packet.

### 3. Content Production - default target D-14

Purpose: decide what is worth making, then produce enough approved material to
support the rollout.

- content concepts and hooks
- flagship ideas, repeatable formats, and fast wins
- shot and production plan
- lyric, performance, viral, behind-the-scenes, UGC, and selected extra clips
- variants for approved source pieces
- approved captions, overlays, and publishing intent

The existing `content-mastermind` workflow is the default concept path. Content
Genius, Scroll Stopper, and Anticipation Director generate distinct material;
Content Director selects and synthesizes it into one Campaign Content Playbook.
They do not repeatedly message one another.

### 4. Launch - default window D-14 through D+7

Purpose: make the release operational, distribute approved content, and open
the artist's owned channels.

- distributor delivery
- credits, metadata, rights, and splits
- DSP pitch, pre-save link, Spotify Canvas, and final QA
- social rollout and daily publishing schedule
- website update and community announcement when those systems are connected
- advertising plan, creative, tracking, and approved launch

Planning and readiness happen before release. Spend and public posting follow
their exact approval and schedule contracts. The phase does not wait until
release day to begin ad strategy or account preparation.

### 5. Amplify - default start D+7

Purpose: use observed reaction to decide where additional effort is justified.

- Spotify and social performance review
- ads performance and creative fatigue review
- follow-up content and winning-format variants
- selected influencer, playlist, Instagram trending, college radio, or press
  efforts

Boosters are recommendations, not automatic checklist requirements. They enter
the active path only when included by the artist or supported by fresh evidence
and accepted through State of Play or the Artist Manager.

## Release Path Contract

Add a pure shared compiler under `packages/shared/src/artist-context/`:

```ts
type CampaignReleasePhaseId =
  | 'foundation'
  | 'direction'
  | 'production'
  | 'launch'
  | 'amplify'

type CampaignReleasePhaseStatus =
  | 'complete'
  | 'current'
  | 'upcoming'
  | 'at-risk'
  | 'overdue'

interface CampaignReleasePathItem {
  key: `${ReleaseBoardCategory['id']}:${string}`
  phase: CampaignReleasePhaseId
  label: string
  status: ReleaseBoardItemStatus
  targetDate?: string
  targetOffsetDays: number
  targetSource: 'default' | 'override' | 'undated'
  dependencies: string[]
  missingDependencies: string[]
  actionable: boolean
  blocking: boolean
  action: ReleaseBoardItemAction | null
  evidenceRefs: CampaignEvidenceRef[]
}

interface CampaignReleasePath {
  version: 1
  workspaceId: string
  revision: string
  asOfDate: string
  releaseDate?: string
  timezone: string
  generatedAt: string
  timing: 'undated' | 'on-track' | 'compressed' | 'late'
  currentPhase: CampaignReleasePhaseId
  nextItem: CampaignReleasePathItem | null
  phases: Array<{
    id: CampaignReleasePhaseId
    label: string
    status: CampaignReleasePhaseStatus
    targetDate?: string
    completed: number
    total: number
    items: CampaignReleasePathItem[]
  }>
  warnings: string[]
}
```

The compiler accepts normalized mission, Release Board, packet state, asset
state, operational state, timezone, and `now`. It performs no file access and
no model call.

`revision` is a stable hash of the normalized source revisions plus
`asOfDate`. It changes when campaign truth changes or the campaign enters a new
calendar day, but not because two consumers compiled it milliseconds apart.
Essentials and Campaign Manager must agree on this revision before launching
the next action.

### Ranking the next item

Choose one next item deterministically:

1. unresolved release-critical blockers whose dependencies are available
2. overdue core items in the earliest incomplete phase
3. due-soon core items in the current phase
4. included optional or conditional items in the current phase
5. the first dependency-ready item in the next phase

Within one rank, use target date and then a stable playbook order. Never use
array accident or model judgment as the tie-breaker.

### Phase completion

A phase is complete when all included core and artist-selected items mapped to
it are `done` or explicitly `skipped`. A later phase may begin while an earlier
nonblocking item remains, but the earlier phase remains at risk and visible.

### Late-start compression

- More than 28 days remain: show the normal path.
- 14 to 28 days remain: label the campaign compressed and prioritize release
  facts, direction, art, distribution, and a viable content minimum.
- 1 to 13 days remain: label it late, keep release-critical operations first,
  and move optional production and boosters under Later.
- Release date has passed: make Launch failures and approvals primary until
  resolved, then move to Amplify.

Compression changes ranking and presentation, not stored item statuses or
historical target evidence.

## Release Board Evolution

Keep the existing categories and item ids for storage compatibility. Add a
versioned playbook map that assigns current rows to phases, default offsets,
dependencies, owner/action, and completion evidence. The UI projects category
rows through this map instead of rewriting the saved board.

Add only these optional item fields if the implementation proves they cannot
remain in linked records:

```ts
interface ReleaseBoardItem {
  targetDateOverride?: string
  evidenceRefs?: CampaignEvidenceRef[]
  contextPacketRef?: CampaignContextPacketRef
}
```

New core or conditional rows required by the path:

- campaign audience / promise
- Campaign Direction Packet
- Campaign Content Playbook
- website update, conditional on a connected or managed site
- community announcement, conditional on a configured community sender
- post-release performance review

Migration follows the existing rule: newly shipped core items enter `needed`,
never `skipped`. Conditional rows remain excluded until their capability is
available or the artist includes them.

### Default playbook map

This is the shipped default, not a model-authored sequence. Item-level target
overrides may move a row without changing its phase or prerequisites.

| Phase | Existing or new rows | Default target | Hard prerequisites |
| --- | --- | --- | --- |
| Foundation | `music:master`, `music:lyrics`, new `music:campaign-audience` | D-28 | campaign exists; release date is required only for dated guidance |
| Direction | `music:song-world` | D-24 | master and lyrics |
| Direction | `music:release-identity`, new `music:direction-packet` | D-21 | song world; packet also requires release identity |
| Direction | `visuals:cover-art`, `visuals:press-photos` | D-18 | approved Direction Packet |
| Production | `content:idea-generation`, new `content:content-playbook` | D-18 | approved Direction Packet; playbook also requires concept results |
| Production | `content:lyric-clips`, `content:performance-clips`, `content:viral-clips` | D-14 | approved Content Playbook plus required source media |
| Production | optional content and visual extras | D-10 | approved Content Playbook plus their required source assets |
| Launch | `setup:metadata`, `setup:rights-splits`, `setup:distributor` | D-21 | verified release facts; distributor also requires master and cover art |
| Launch | `setup:dsp-pitch`, `setup:presave`, `visuals:canvas`, `setup:epk` | D-10 | delivered release identity where required plus their exact assets/facts |
| Launch | `setup:social-schedule`, new `setup:website-update`, new `setup:community-announcement` | D-7 | approved campaign packets and applicable connected capability; publishing/sending approval remains separate |
| Launch | `promotion:budget`, `promotion:ad-creatives`, `promotion:artist-playlist`, optional `promotion:paid-campaign` | D-7 plan, D0 launch | approved Direction/Content packets; spend requires exact approval |
| Launch | `setup:release-qa` | D-3 | all included release-critical Launch rows have evidence or named exceptions |
| Amplify | new `promotion:performance-review` | D+7 | fresh Spotify/social/ads evidence, with missing sources reported honestly |
| Amplify | `promotion:influencer-campaign`, `promotion:ig-trending`, `promotion:college-radio`, `promotion:playlist-targets` | D+7 when selected | accepted booster recommendation or explicit artist inclusion |
| Launch or Amplify | `promotion:press-list` | D-14 by default | campaign direction; may move post-release when the artist chooses a reaction-led press angle |

`music:record-doctor` stays an optional Foundation check. Optional merch,
poster, visualizer, meme, UGC, and extra-video rows retain their current
included controls and map to Production. No omitted existing row is deleted.

## Campaign Context Packets

### Campaign Direction Packet

One approved packet that references, rather than replaces:

- campaign mission and release date
- HQ artist profile, audience, voice, and branding
- song world and approved lyrics
- target listener and emotional promise
- campaign premise, ethos, motifs, visual language, and avoid-list
- approved single-art direction and final asset reference when it exists
- unresolved decisions and source freshness

World Builder and Branding Agent may contribute proposals. Artist Manager owns
the synthesis and artist discussion. The artist approves the packet before it
becomes targeted context for content and visual workers.

### Campaign Content Playbook

One approved packet produced through Content Director after concept work:

- content goal and audience behavior
- flagship concepts and Big Swing
- recurring formats and fast wins
- hooks, opening frames, song sections, and production requirements
- cadence and intended sequence
- platform and account-role intent
- captions/overlay rules and avoid-list
- references to approved campaign direction and source assets

Draft concepts remain Outputs. Only the approved playbook becomes routed
campaign context for content creation, editing, variant, social, and ads
workers.

### Storage and routing

The approved Output or Final remains canonical. A bounded derived context doc
stores its id, revision, source hashes, summary, unresolved decisions, and
target-agent routing. Refresh replaces the derived packet when the canonical
approved revision changes. No agent writes the derived packet by hand.

Proposed slugs:

- `campaign-direction-packet`
- `campaign-content-playbook`

Routing is targeted. Artist Manager and Release Manager can retrieve both.
Creative workers receive Direction. Content creation, variant, social, and ads
workers receive both only when relevant to their task.

## Campaign Asset Intent

Extend Campaign Asset, Output, and Final metadata through one shared optional
contract rather than encoding publishing intent in filenames:

```ts
interface CampaignContentIntent {
  contentType:
    | 'lyric'
    | 'performance'
    | 'viral'
    | 'behind-the-scenes'
    | 'ugc'
    | 'announcement'
    | 'ad'
    | 'other'
  songSection?: 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'outro' | 'full' | 'other'
  summary: string
  platforms: Array<'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'other'>
  accountRole: 'main' | 'fan-page' | 'either'
  variantGroupId?: string
  sequenceTags?: string[]
  durationSeconds?: number
}
```

This metadata is descriptive, not permission. The scheduler selects only
approved Finals, honors frozen payloads, avoids duplicate use, and keeps exact
posting approval. Missing intent never permits the model to guess silently;
the Social Publisher may propose a tag update for approval.

## Artist Manager Contract

Do not add another manager agent. Extend the existing
`artist-manager-operating-system` procedure and Campaign Manager Brief.

### On campaign open

The compact brief includes:

- release date, timezone, days to release, and timing classification
- current phase and phase progress
- one next item with target date and why it is next
- missing dependencies and release-critical blockers
- Direction and Content packet approval/revision state
- active work, approvals, recent relevant results, and source freshness

### On "continue campaign"

1. Refresh `get_campaign_brief` and compare the revision.
2. Read the compiled `nextItem` and its exact action mapping.
3. Retrieve only the source details that could change the recommendation.
4. Explain the next step in one short sentence.
5. Discuss direction when judgment is required; do not launch production
   before the artist agrees on the direction.
6. Invoke one existing worker, workflow, tool, or manual action.
7. Pass a compact typed handoff: goal, packet refs, locked facts, missing facts,
   desired output, target date, and approval limits.
8. Receive the result through the existing receipt path and summarize it for
   the artist.
9. Link the session/run/output to the Release Board item. Do not mark it done
   without the item's existing completion evidence or artist confirmation.

If a specialist is inactive or unavailable, the manager offers Activate or an
honest manual route. It does not choose a vaguely similar worker.

## Specialist Orchestration

- **Direction:** Artist Manager leads; World Builder, Branding Agent, and Art
  Director return bounded proposals. Artist Manager synthesizes the packet.
- **Content concepts:** use `content-mastermind`; Content Director remains the
  final editor of the Campaign Content Playbook.
- **Production:** launch the exact creation/editing worker from the selected
  playbook item and pass only approved packet context and source assets.
- **Release operations:** Release Manager owns metadata, rights, delivery,
  links, DSP pitch, and QA as defined in spec 30.
- **Publishing:** Social Publisher owns scheduling and posting from approved
  Finals. Variant workers prepare variants but do not schedule them.
- **Paid growth:** Ad Creative -> Ads Strategist -> Ad Runner remains the typed
  chain. Planning can begin before release; spend remains approval-gated.
- **Post-release:** Spotify/social analysts provide fresh evidence. State of
  Play and Artist Manager recommend boosters; the artist chooses them.

## Essentials UI

Keep the existing `Essentials` navigation destination. Replace the undirected
wall of categories with progressive disclosure:

```text
[ Release in 18 days ]                         [ Continue campaign ]

Current focus
Campaign Direction Packet                         Due Sep 12  [ Continue ]
Master and lyrics are ready. Define the campaign world before content work.

[ Foundation ] [ Direction ] [ Production ] [ Launch ] [ Amplify ]
      4/4            2/5            0/8          3/10        0/0

Current phase rows...
More in this phase
Later phases
```

Rules:

- Phase controls are compact tabs, not large cards.
- Default to the current phase and show one focus row above it.
- Completed earlier phases collapse to one line.
- Later phases stay collapsed but show target date and progress.
- Optional items stay under `More options` until included.
- Every actionable row has one direct action using the canonical action map.
- A blocked row names the missing prerequisite and links to it.
- `Continue campaign` opens Artist Manager with the current path revision and
  next-item reference, not a generic blank prompt.
- Do not add explanatory walls, worker grids, duplicate activity feeds, or a
  second calendar to this page.
- Workers page and worker categories remain unchanged.

## State of Play Relationship

Release Path is the complete ordered campaign journey. State of Play remains
the cross-system attention and recommendation layer.

State of Play may elevate:

- the Release Path next item
- an overdue or newly blocked release-critical item
- a pending approval or failed run that prevents path progress
- a post-release booster supported by fresh evidence

It stores a reference to the item and compiler revision. It does not copy the
whole path, own completion, or invent a conflicting next step.

## Failure And Edge Cases

- **No release date:** preserve phase order, omit dates, and make setting the
  date the focus. Do not invent one.
- **Release date changes:** recompute defaults immediately; keep explicit item
  overrides and history. Warn when an override is now after release.
- **Timezone changes:** recompute calendar date labels from date-only targets;
  never shift them because of UTC conversion.
- **Past release:** prioritize unresolved launch failures, approvals, and QA,
  then Amplify. Do not reset the board.
- **Missing master or lyrics:** allow planning conversations but block asset
  production that requires the missing source.
- **Conflicting packet revisions:** refuse automatic handoff and ask the artist
  which approved revision is current.
- **Deleted or deactivated worker:** show Activate; never silently remap.
- **Failed workflow or agent run:** keep the item `in-progress` or move it to
  review/attention per existing lifecycle rules; never mark done.
- **Duplicate launch:** semantic item id plus active session/run suppresses an
  equivalent second launch.
- **Optional capability disconnected:** hide it from core progress and explain
  setup only after the artist includes it.
- **Concurrent updates:** Release Board writes retain the existing atomic
  mutation contract; compiler output is discarded and recomputed on revision
  mismatch.
- **Stale campaign brief:** `Continue campaign` refreshes before launch and
  falls back to the last valid brief with a visible stale warning.

## Implementation Slices

### Slice 1 - Shared Release Path compiler

- playbook map from existing Release Board rows to phase, target, dependency,
  owner, and evidence rules
- pure compiler and typed result
- late-start and release-date-change behavior
- Campaign Manager Brief fields
- State of Play item reference support

Exit gate: the UI and manager can consume one deterministic result; no new UI
or autonomous work is required yet.

### Slice 2 - Essentials Release Path UI

- compact phase tabs and progress
- current focus row
- direct Continue, prerequisite, Activate, and existing item actions
- completed/later phase disclosure
- unchanged optional-item controls and status semantics

Exit gate: a new user can identify the current phase, next step, due date, and
responsible path without opening Workers.

### Slice 3 - Context packets and content intent

- approved Direction and Content packet lifecycle
- targeted derived context routing
- Content Director synthesis path
- Campaign Content Intent metadata across assets, Outputs, Finals, variants,
  and social scheduling selection

Exit gate: a production or publishing worker receives approved direction and
can distinguish, sequence, and explain campaign content without filenames or
prompt guesses.

### Slice 4 - Artist Manager orchestration

- `Continue campaign` launch contract
- manager skill and prompt updates
- exact item/action lookup
- bounded specialist/workflow handoff
- receipt and Release Board linkage
- missing-worker activation and duplicate-run handling

Exit gate: Artist Manager can guide Foundation through Amplify using the same
path visible in Essentials, while every completion and external action retains
its existing evidence and approval boundary.

## Verification

### Pure compiler tests

- normal D-28 campaign across all five phases
- campaigns with 27, 14, 13, 1, 0, and negative days remaining
- leap day, month/year boundaries, and multiple timezones
- no release date and malformed release date
- release date moved earlier and later
- item target override preservation
- core, optional, conditional, skipped, review, and done semantics
- missing dependency versus dependency-ready ranking
- stable tie-breaking and no duplicate next item
- past-release Launch recovery before Amplify

### Context and orchestration tests

- Campaign Manager Brief and Essentials use the same compiler revision
- manual, workflow, automation, and resumed manager sessions receive the same
  compact path fields
- only approved packet revisions reach targeted workers
- stale or conflicting packets fail closed
- content workflow returns one Content Director synthesis
- one Release Board item produces at most one active equivalent launch
- failed or cancelled work never completes the item
- inactive worker produces Activate, not fallback substitution
- manager handoff does not grant publish, send, spend, upload, or account access

### UI tests

- current phase and focus are correct at desktop and narrow widths
- completed and later phases disclose without layout shift or text overlap
- missing release date and compressed/late campaigns remain understandable
- optional items do not inflate core progress
- Continue opens Artist Manager with the exact item reference
- row action, review link, session link, and status menu remain functional
- Workers page order and grouping are unchanged

### End-to-end journeys

1. New campaign with date -> add master and lyrics -> Continue opens Direction.
2. Approve Direction -> content workflow -> approve Content Playbook -> create
   and tag source clips -> variants -> approved Finals -> social schedule.
3. Complete release operations -> website/community conditional steps appear
   only when configured -> approvals remain exact.
4. Seven days after release -> fresh performance evidence -> one justified
   booster recommendation -> artist includes or declines it.
5. Start a campaign eight days before release -> see a compressed viable path,
   named risks, and no fake promise that every optional step will fit.

## Done Means

- A new user sees a coherent release journey instead of a worker directory.
- Essentials, State of Play, and Artist Manager agree on the next campaign step.
- Campaign direction and content decisions persist as approved, routed packets.
- Creation and publishing workers can understand what each approved asset is
  and how it fits the rollout.
- The manager coordinates existing specialists without chat loops or a new
  persona.
- Existing completion evidence and public-action approvals remain authoritative.
- No second campaign checklist, calendar, context dump, or worker taxonomy was
  introduced.
