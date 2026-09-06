---
status: proposed
owner: agent
last_verified: 2026-09-04
source_of_truth: true
release: v1
related: ../27-in-app-user-guide-spec.md, ../07-artist-vault-architecture-spec.md, ../19-artist-manager-brief-context-architecture-spec.md, ./42-campaign-release-path-orchestration-spec.md, ./43-approved-branding-amendments-spec.md
---

# State-Aware First-Use Guide

## Decision

Turn the existing question-mark Artist OS Guide into the single home for a
short, optional, state-aware setup path.

On a genuinely new Artist OS installation, offer setup once after the real app
has loaded. The artist may start, skip, or watch a short overview. Every setup
action opens the real destination and teaches one action in place. Completion
comes from saved application truth, never from clicking Next or visiting a page.

```text
first usable launch
       |
one-time setup offer -------------------- Explore myself
       |                                      |
state-aware setup                              no repeat popup
       |
typed Guide action -> real page -> one anchored tip
       |
saved app state changes
       |
pure setup-state compiler refreshes progress
       |
Continue setup from the existing ? Guide at any time
```

This is V1 release guidance, not a new onboarding platform, questionnaire,
agent, workflow, or marketing funnel.

## Product Outcome

A first-time artist should understand, by doing:

1. what powers the workers
2. where permanent artist truth belongs
3. where reusable files belong
4. where current work should begin
5. that external accounts are connected only when useful

The guide should get the artist to one real useful action quickly. It should not
try to teach the entire product, require every integration, or make the artist
memorize the navigation.

## Research Direction

The design follows two relevant platform principles:

- Apple recommends onboarding that is fast, optional, and interactive, with
  contextual instruction placed near the interface it describes.
- WCAG requires logical focus order and supports disabling nonessential motion
  through the user's reduced-motion preference.

Primary references:

- https://developer.apple.com/design/human-interface-guidelines/onboarding
- https://www.w3.org/WAI/WCAG22/Understanding/focus-order
- https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html

## Current Code Truth

The implementation must extend what already exists:

| Existing primitive | Current behavior | Required evolution |
| --- | --- | --- |
| Top-right question mark | Opens one `ArtistGuideDialog` | Remain the only help entrance; expose Continue/Restart Setup |
| `ArtistGuideDialog` | Six content tabs, typed actions, Command footer | Add a compact setup mode inside the same dialog |
| `artist-guide-content.ts` | Defines content, action IDs, workspace defaults, and AI readiness | Keep reference content; add setup-step definitions separately |
| `handleArtistGuideAction` | Switches workspace and routes typed guide actions | Remain the navigation authority for setup actions |
| `deriveArtistGuideAiReadiness` | Ready only when one LLM connection is authenticated | Feed the setup compiler's AI step |
| Profile, Voice, Branding parsers | Provide structured values and completion percentages | Supply meaningful Brain foundation checks |
| Artist Vault manifest | Provides typed assets, status, rights, and agent visibility | Supply the working-material step |
| Workspace scope | Distinguishes HQ, campaign, lab, and general workspaces | Supply the first-work step and safe target switching |
| Existing `preferences.json` RPC | Several renderer clients replace the whole file; one legacy Preferences page drops unknown fields | Do not store onboarding here; use a focused typed presentation store |

There is currently no first-use Artist OS setup state, no coach-mark target
contract, and no automatic opening of the Artist Guide.

## Core Laws

1. **One guide system.** First use, replay, reference content, and contextual
   help all live behind the existing question mark.
2. **Optional from the first screen.** `Explore myself` dismisses the automatic
   offer permanently for that guide version.
3. **Real state completes work.** A route visit, button click, or coach-mark
   dismissal never marks a setup step complete.
4. **Existing users are not new users.** Shipping this feature must not surprise
   artists who already have sessions, context, assets, Outputs, or campaigns.
5. **One action at a time.** Each coach mark explains the current control and
   then gets out of the way.
6. **Prerequisites are ordered.** Guided agent setup cannot run until an AI
   provider is authenticated.
7. **Optional connections stay optional.** Spotify, social, email, ads, and
   other services never block core setup completion.
8. **The app remains usable.** Skipping, closing, losing a target, going offline,
   or restarting cannot trap the artist.
9. **No fake animation.** Motion or spotlighting clarifies location; it is never
   decorative, continuous, or required to understand the step.
10. **No parallel truth.** Setup state does not duplicate Brain, Vault,
    workspace, provider, campaign, or connection data.

## User Journey

### One-time welcome

After a genuine first launch reaches a stable Artist HQ screen, show a compact
welcome panel:

```text
Set up Artist OS
Give your team enough context to do useful work.

[Start setup]   [Explore myself]
Watch the 90-second overview
```

Rules:

- Do not show it over licensing, workspace creation, OAuth, another dialog,
  What's New, or a deep-linked task.
- Do not make it part of the splash or delay initial paint.
- Omit the video action until a valid overview URL with captions exists.
- Closing with Escape or the close button has the same result as
  `Explore myself`; it does not reappear next launch.
- Record the offer as shown before opening it so a crash cannot create a popup
  loop.

### Setup mode inside the Guide

The setup mode is a focused view within `ArtistGuideDialog`, not a seventh
documentation tab. It contains five compact rows and one primary next action.

```text
SET UP ARTIST OS                         2 of 4 ready

[check] Connect AI                      Ready
[  2  ] Build your Artist Brain         Continue
[  3  ] Add working material            Not started
[  4  ] Start your first work            Choose a path
[  +  ] Connect what you use             Optional

[Continue: Build your Artist Brain]
Full Artist OS Guide
```

The progress count covers the four core readiness checks. Optional Connections
is shown separately and never changes `4 of 4`.

### Question-mark behavior

- Unfinished and not dismissed: open directly to Setup.
- Dismissed: open the current contextual Guide tab, with a quiet
  `Continue setup` action in the header.
- Completed: open the current contextual Guide tab, with `Review setup` in the
  header.
- `Start setup again` resets tip presentation and the resume pointer, but does
  not erase real app data or force completed steps back to incomplete.
- The existing General, HQ, Campaigns, Creative Lab, Connections, and Top Bar
  content remains available.

## The Five Rows

### 1. Connect AI - core

Purpose: enable Artist Manager and every worker.

Complete when at least one current LLM connection has
`isAuthenticated === true`.

States:

- `not-started`: no connection exists
- `attention`: connections exist but none authenticate
- `complete`: at least one authenticates

Primary action: existing `settings.ai` route. The coach mark anchors to the
existing Add Provider control or, when a broken connection exists, its
Reconnect/Edit control.

Never call a provider connected merely because its configuration record exists.

### 2. Build your Artist Brain - core

Purpose: establish enough artist truth for useful work without demanding that
every field be perfect.

This row has three subchecks. Use semantic minimums rather than arbitrary
percentage thresholds.

**Profile foundation**

- `artistName` is present
- at least two are present: `mission`, `bio`, `sound`, `audience`,
  `similarArtists`, `visualWorld`

**Voice foundation**

- at least two are present: `summary`, `speakingStyle`, `avoid`,
  `captionExamples`, `commentReplyExamples`, `postExamples`, `writingExcerpts`

**Branding foundation**

- at least two are present: `creativeDna`, `tensions`, `fascinations`,
  `mythology`, `emotionalTerritory`, `audienceGravity`

The Brain row is complete only when all three foundations pass. Existing UI
completion percentages remain unchanged and may continue toward 100%; the
guide labels this state `Foundation ready`, not `Brain complete`.

Actions:

- `Set up with Artist Manager`
- `Profile`
- `Voice`
- `Branding`

Manager setup opens the HQ Artist Manager with one fixed kickoff request:

```text
Help me establish the minimum useful Artist Brain. Ask concise questions, use
what is already saved, and guide me through Profile, Voice, and Branding without
inventing answers or overwriting my words.
```

This action does not grant the manager new context-write authority. Brain saves
remain governed by their existing UI and approved amendment contracts.

If AI is not ready, `Set up with Artist Manager` first opens AI setup and stores
a bounded return intent to this row.

### 3. Add working material - core

Purpose: give workers one real piece of music and make Vault's role concrete.

Complete when the Artist HQ Vault contains at least one asset that is:

- category `music`
- accepted by the same agent-visibility predicate used by Artist Vault context
  (usable by agents, safe/cleared rights, non-draft, present, valid path)

Show a separate recommendation, not a blocker, until the Vault also contains
an agent-usable visual such as an artist photo, face reference, cover, logo, or
brand asset.

Primary action: `Add music` in Vault. Secondary action: `Open Vault`.

A file chooser cancellation changes nothing. A file selected but rejected by
Vault validation does not complete the row.

### 4. Start your first work - core

Purpose: move from setup into an actual Artist OS loop.

Offer three paths:

- `I have a release` -> create or open a Campaign
- `I am developing songs` -> open Creative Lab
- `I am not sure` -> ask Artist Manager

Complete when any one path produces durable work:

- a Campaign workspace with a valid mission brief containing a title and at
  least one of goal, release date, or timeline
- a Creative Lab song saved in the workspace's durable Lab library
- a non-archived durable Output scoped to Artist HQ, a Campaign, or Creative Lab

Merely creating a blank workspace, opening Lab, sending a greeting, or asking
the manager to start something does not complete the row. The resulting
Campaign, Lab song, or Output does. This deliberately reuses existing durable
truth rather than adding onboarding-only action receipts or inspecting chat
text.

When spec 42 ships, Campaign creation should land on its date-aware Essentials
path. Until then, use the existing Campaign overview and Essentials action.

### 5. Connect what you use - optional

Purpose: explain that external services unlock capabilities without presenting
an intimidating wall of setup.

The row opens the existing Connections Guide and settings routes. Group choices
by user goal, not credential type:

- Hear audience signals: Spotify and social accounts
- Send and coordinate: Google/Gmail, Community email, messaging
- Promote releases: Meta, Google, and Spotify ads
- Sell and fulfill: commerce and print

Rules:

- No service is selected by default.
- Do not count saved developer keys as a user-facing connected account unless
  the existing service status confirms readiness.
- Do not ask for permissions before the artist chooses the feature that needs
  them.
- Skipping this row is normal and does not display a warning.

## Setup-State Compiler

Add a pure shared compiler. It receives normalized snapshots and has no file,
RPC, navigation, or model access.

```ts
type ArtistSetupStepId = 'ai' | 'brain' | 'vault' | 'first-work' | 'connections'

type ArtistSetupStepState =
  | 'not-started'
  | 'in-progress'
  | 'attention'
  | 'complete'
  | 'optional'

interface ArtistSetupSnapshot {
  version: 1
  artistWorkspaceId: string
  revision: string
  generatedAt: string
  coreReady: number
  coreTotal: 4
  complete: boolean
  nextStepId: Exclude<ArtistSetupStepId, 'connections'> | null
  steps: Array<{
    id: ArtistSetupStepId
    state: ArtistSetupStepState
    label: string
    detail?: string
    subchecks?: Array<{ id: string; label: string; complete: boolean }>
    actionIds: ArtistGuideActionId[]
  }>
  warnings: string[]
}
```

Inputs:

- authenticated LLM connection summaries
- parsed Profile, Voice, and Branding values plus parse failures
- Artist Vault manifest or load failure
- scoped workspace list and campaign mission summaries, resolved through each
  workspace's `artistWorkspaceScope`
- durable Lab library song count after `getLabState` hydration
- Output summaries for Artist HQ, Campaign, and Creative Lab workspaces

Rules:

- Parse/load failure becomes `attention`, never silently `not-started`.
- Brain is `not-started` when all parsed foundation fields are blank and
  `in-progress` when at least one is present but the three foundations do not
  pass. Trim whitespace before every presence check.
- Vault is `not-started` when the manifest is empty and `in-progress` when it
  has assets but no qualifying music asset.
- First work is `not-started` when no scoped durable work exists and
  `in-progress` when only blank/non-qualifying Campaign state exists.
- Connections is always `optional`; its detail may summarize connected goals
  but it never becomes a core warning.
- Resolve every Campaign and Lab record to its owning Artist HQ. Never infer
  ownership from the currently selected workspace or count another artist's
  work.
- Query Output summaries only; setup never loads Output asset bodies.
- `revision` is a stable hash of normalized input revisions and identities.
- The next step is the earliest incomplete core step whose prerequisite is
  available. Core rows remain directly accessible out of order; only the
  manager-guided Brain action is disabled until AI is ready.
- The renderer must not reimplement completion logic.
- Data refresh events recompute the snapshot; they do not patch a step locally.
- Ignore an asynchronous result if its owning Artist HQ changed while inputs
  were loading. One artist's late result cannot update another artist's Guide.

## Presentation-State Persistence

Completion is derived. Persist only how the guide was presented.

Add `${CONFIG_DIR}/artist-onboarding.json` with one versioned, typed store:

```ts
interface ArtistOnboardingPresentationStoreV1 {
  version: 1
  recordsByArtistWorkspaceId: Record<string, ArtistOnboardingPresentationV1>
}
```

Each record is:

```ts
interface ArtistOnboardingPresentationV1 {
  version: 1
  guideVersion: 1
  artistWorkspaceId: string
  offer: 'unseen' | 'shown' | 'started' | 'dismissed' | 'completed'
  lastStepId?: ArtistSetupStepId
  seenTipIds: string[]
  skippedOptionalIds: string[]
  firstShownAt?: number
  dismissedAt?: number
  completedAt?: number
  updatedAt: number
}
```

Store records by Artist HQ workspace ID so one artist's setup presentation does
not leak into another. Cap `seenTipIds` at 64 and `skippedOptionalIds` at 16,
deduplicate while preserving most-recent order, validate finite nonnegative
timestamps, and reject unknown step/tip IDs.

Do not use renderer `localStorage` or `preferences.json` for this record. Current
preferences clients perform whole-file writes, and at least one legacy writer
drops unknown fields; either can erase onboarding state after it is saved.

Add narrow backend RPCs such as `artistOnboarding.read` and
`artistOnboarding.patch` that:

- load the latest onboarding store inside the handler
- validate the workspace-keyed onboarding patch and guide version
- merge only that workspace's record
- union and bound `seenTipIds` and `skippedOptionalIds`
- apply monotonic offer transitions so a stale window cannot turn
  `dismissed` or `completed` back into `shown`
- support compare-and-set with `expectedOffer`; the automatic welcome opens
  only when the atomic `unseen -> shown` claim succeeds
- serialize concurrent mutations in the main process, write through the
  project's atomic JSON helper, and return the merged record
- broadcast a typed onboarding-presentation-changed event to renderer windows

`restart` is a separate explicit operation invoked only by the artist from the
Guide. It may move `dismissed` or `completed` to `started` and clears bounded
tip/resume presentation, but it never auto-opens a dialog or alters completion
inputs. Ordinary patch calls cannot perform that reverse transition.

Wire the schema, storage module, protocol channels/events, Electron API types,
mocks, and RPC routing together. A malformed file is renamed for recovery and
treated as a load failure for that run, not silently reset while onboarding is
open.

Once `offer` reaches `dismissed` or `completed`, never automatically reopen the
same `guideVersion`. If real setup later becomes incomplete, show that truth
inside the Guide without reopening it.

An older guide record migrates forward while preserving `dismissed` or
`completed`; a product update does not replay onboarding. A record from a newer
unknown schema/guide version fails closed: do not auto-open, preserve the file,
and keep manual reference Guide access available.

## Genuine First-Use Detection

An absent presentation record is not enough. Existing users upgrading to this
feature also lack that record.

Before automatically showing the welcome, compile `meaningfulExistingUse`.
It is true when any of these exist:

- any nonempty Profile, Voice, or Branding foundation field
- any Vault asset
- any Campaign workspace
- any saved Lab song
- any visible session scoped to Artist HQ, Campaign, or Creative Lab whose
  header has `lastMessageAt` (a blank shell-created session does not count)
- any Output

Rules:

- Missing presentation state plus meaningful existing use: initialize as
  `dismissed`; do not auto-open.
- Missing state plus no meaningful use: eligible for the one-time offer.
- Write `shown` before rendering the offer.
- Treat an absent record as `unseen` only inside the atomic claim. A second
  window receives `applied: false` and must not open another welcome.
- Wait until workspaces, provider summaries, and the active route are loaded.
- A preconfigured provider alone does not suppress Artist OS onboarding. It may
  come from general Runner setup and is not evidence that Artist OS was used.
- Wait while any blocking dialog or fullscreen overlay is open.
- Reuse the shell's `hasOpenOverlay()`/dismissible-layer bridge and explicit
  shell modal state. Do not maintain a second selector list in onboarding.
- If launch opens a specific session, Output, settings page, or deep link,
  suppress the automatic offer for that run.
- A data-load error suppresses auto-open; the question mark remains available.
- What's New is suppressed for a genuine first-use run. It can be opened later
  from its existing location.
- Launch arbitration order is: licensing and required workspace creation,
  explicit deep link, genuine first-use welcome, then What's New. Never queue
  the welcome to appear unexpectedly after the artist has started working.
- After higher-priority licensing/workspace gates resolve and HQ is stable, the
  automatic-offer window lasts at most 10 seconds. It cancels immediately on
  route/workspace change, text entry, or a newly opened dialog. Cancellation
  leaves the record `unseen`; the question mark still exposes Setup, and a
  later pristine launch may offer it once.

## Contextual Coach Marks

### Target contract

Destinations opt in with stable attributes:

```tsx
data-artist-guide-target="ai-add-provider"
data-artist-guide-target="brain-profile-primary"
data-artist-guide-target="vault-add-music"
data-artist-guide-target="campaign-create"
```

Never locate a target by visible text, Tailwind class, DOM position, or an
unbounded query supplied by content.

### Lifecycle

1. Setup action routes through existing `handleArtistGuideAction`.
2. A bounded pending-tip intent carries guide version, step ID, target ID, and
   destination workspace ID.
3. After route and workspace settle, the target registers and the tip anchors.
4. The tip explains one action and allows the real control to be used.
5. Target state changes trigger a fresh setup snapshot.
6. The tip closes; completion comes only from the new snapshot.

Pending intents expire after one route attempt or 15 seconds. Missing targets
fall back to a small non-anchored message with `Back to setup`; they never leave
an invisible overlay or navigation lock.

### Visual behavior

- One restrained orange-red outline around the target.
- One short opacity/outline emphasis when it first appears.
- No continuous pulse, cursor animation, confetti, parallax, or bouncing arrow.
- Keep the target fully legible and clickable.
- Place the tip beside the target with viewport collision handling.
- On compact layouts, use a bottom sheet pointing to the visible target.
- Never stack a coach mark over another modal, menu, file chooser, or OAuth
  browser flow.

## Focus, Keyboard, And Motion

- Welcome and Guide setup use the existing accessible Dialog primitive and trap
  focus while modal.
- Escape always closes the current layer and restores focus to its trigger.
- Coach marks are non-modal. DOM and tab order remain logical; no positive
  `tabIndex` values.
- When a coach mark opens, announce its title and instruction through an ARIA
  live region without repeatedly announcing position changes.
- Do not obscure the focused target or primary action.
- Honor `prefers-reduced-motion: reduce`: no smooth scrolling, target movement,
  transform animation, or pulse. Use an immediate static outline.
- The flow must be fully operable with keyboard alone at desktop and compact
  widths.

## Optional Overview Video

The video is a secondary explanation, not a completion requirement.

- Show the link only when a valid HTTPS URL is configured.
- Require English captions and a concise transcript link.
- Target 60 to 120 seconds.
- Demonstrate the same five-row mental model using the current production UI.
- Open without replacing setup progress.
- Never embed credentials, private artist data, or personal inbox content.
- A missing network connection or dead URL leaves setup fully usable.
- Version the configured video independently so replacing it does not replay
  onboarding.

## Events And Refresh

Recompute setup state after:

- LLM connection added, removed, authenticated, or failed
- Profile, Voice, or Branding context updated
- Vault manifest updated
- workspace created, removed, or scope changed
- campaign mission brief updated
- Lab song saved or removed
- an Output is created, archived, restored, or removed in an Artist OS workspace

Debounce bursts, but never cache completion across an app restart without
checking current data. If one source fails, preserve other step states and mark
only the affected step `attention`.

## Error And Edge Cases

- No Artist HQ workspace: do not auto-open; offer `Create Artist HQ` from the
  question mark using existing workspace rules.
- LLM revoked after completion: Guide shows AI `attention`, but automatic
  onboarding does not replay.
- Brain document malformed: show `Repair in Brain`; do not treat it as empty.
- Vault asset becomes missing/private: Vault readiness may regress inside the
  Guide without reopening the welcome.
- Campaign deleted: another qualifying path may keep first-work complete.
- Multiple windows: the dedicated backend patch RPC serializes mutations,
  merges against the latest onboarding store, and deduplicates seen tip IDs; only
  the focused main window may auto-offer.
- App crash during welcome: `shown` prevents a popup loop; question mark offers
  Continue Setup.
- User switches workspace mid-tip: close the tip and preserve the resume step.
- Target moves during resize/scroll: reposition through ResizeObserver and
  scroll events; close if detached.
- Offline: local setup remains available; provider and video actions explain
  connectivity without marking completion.

## Privacy And Telemetry

- The setup compiler runs locally.
- Do not send Brain values, asset names, provider identities, or campaign names
  to analytics.
- V1 requires no remote onboarding telemetry.
- If aggregate product analytics are added later, they may record only anonymous
  step/action identifiers after a separate privacy decision.

## Focused Tests

### Pure compiler

- authenticated versus configured-but-broken AI connections
- every Profile, Voice, and Branding foundation boundary
- malformed Brain documents become attention
- usable music versus draft, missing, archived, private, needs-clearance,
  agent-disabled, or invalid-path assets
- optional visual recommendation never blocks readiness
- blank campaign does not complete first work
- qualifying campaign, durable Lab song, and scoped non-archived Output each
  complete first work
- manager greeting or requested action without durable work does not complete
  first work
- Campaign, Lab, and Output records owned by another Artist HQ do not count
- Connections remains optional
- deterministic next-step and stable revision

### First-use decision

- pristine install offers setup once
- `shown` is persisted before render
- Explore, close, and Escape prevent future automatic offers
- existing context, asset, campaign, Lab song, scoped session, or Output each
  suppresses the upgrade popup
- a configured provider by itself does not suppress Artist OS onboarding
- deep links and blocking overlays suppress the current-run offer
- user navigation/input and the 10-second eligibility deadline cancel a late
  automatic offer without marking it shown
- source-load failure fails closed without a false new-user assumption
- completed or dismissed guide versions do not replay after restart

### Guide integration

- question mark remains the only Guide host
- unfinished setup opens Setup mode when appropriate
- dismissed/completed setup opens contextual reference content
- Continue/Review/Restart actions preserve real app data
- typed actions switch to the correct HQ, Campaign, or Lab workspace
- a late snapshot from the previous Artist HQ is ignored after workspace switch
- AI prerequisite return intent is bounded and resumes once

### Coach marks

- stable registered target anchors correctly
- missing, detached, hidden, and timed-out targets recover visibly
- route or workspace change closes stale tips
- target clicks remain operational
- focus order and Escape behavior remain correct
- reduced motion removes transforms, smooth scroll, and pulse
- compact layout uses a non-obscuring bottom sheet
- no coach mark stacks over OAuth, file chooser, or another dialog

### Persistence

- onboarding schema, loader, atomic writer, and RPC round-trip valid records
- malformed onboarding storage is quarantined and fails closed for that run
- concurrent window patch RPC calls merge bounded sets without restoring old
  state or dropping another artist's record
- simultaneous `unseen -> shown` claims allow exactly one window to auto-open
- generic preference writes cannot erase onboarding presentation state
- older dismissed/completed records migrate without replay
- newer unknown guide versions and unknown IDs fail closed without data loss

## Implementation Slices

### Slice 1 - Setup truth

- pure setup-state compiler and semantic foundation checks
- typed normalized inputs and revision
- focused presentation-state schema and atomic storage
- dedicated onboarding read/patch RPCs and renderer change event
- meaningful-existing-use decision
- exhaustive unit tests

No UI auto-opens in this slice.

### Slice 2 - Guide setup mode

- setup mode inside `ArtistGuideDialog`
- progress, next action, optional Connections row
- Continue/Review/Restart behavior behind the existing question mark
- typed actions for Vault import, campaign creation, Lab, and manager setup
- renderer integration tests

### Slice 3 - One-time offer

- post-launch eligibility coordinator
- overlay, deep-link, focused-window, and crash-loop guards
- one-time welcome panel
- no-repeat restart tests

Stop and manually verify pristine-install and existing-user behavior before any
coach-mark work.

### Slice 4 - Contextual teaching

- target registration contract
- pending-tip intent and expiry
- anchored desktop tip, compact fallback, and missing-target recovery
- keyboard, focus, reduced-motion, resize, and workspace-switch tests

### Slice 5 - Release polish

- optional configured overview video and transcript
- final copy aligned with the shipped Website and Community capabilities
- live Electron acceptance pass at desktop and compact widths

Website and Community implementation do not block Slices 1 through 4. They
should finish before final V1 guide copy and video are recorded so the guide
does not describe an outdated product.

## Live Acceptance Gate

Use a temporary clean Artist OS profile plus a populated upgrade profile.

### Clean profile

1. Launch the real Artist OS build and confirm the app paints before welcome.
2. Start setup and connect one real authenticated model.
3. Continue into Brain and save exactly the minimum Profile, Voice, and Branding
   foundations.
4. Import one usable music file into Vault; cancel one chooser first and prove
   cancellation does not complete the step.
5. Choose a Campaign or Lab path and create qualifying durable work.
6. Finish with no optional service connected.
7. Restart and confirm no automatic replay.
8. Open the question mark and confirm Review Setup and the full Guide work.

### Skip and recovery

1. Reset only presentation state in the temporary profile.
2. Choose Explore Myself.
3. Restart and confirm the welcome stays closed.
4. Open the question mark and Continue Setup manually.
5. Remove or revoke one readiness source and confirm the Guide reports attention
   without auto-reopening.

### Existing profile

1. Launch a profile with existing work but no onboarding record.
2. Confirm no first-use welcome appears.
3. Open the question mark and confirm setup can still be started manually.

Automated tests, typecheck, renderer build, and `git diff --check` are required,
but they do not replace these three live flows.

## Explicit Non-Goals

- no forced full-product tour
- no multi-screen marketing questionnaire
- no mandatory Spotify, social, email, ads, or commerce connection
- no completion from page visits or dismissed tips
- no duplicate help center or second question-mark entry
- no new general-purpose onboarding backend service
- no automatic Brain writes or broader manager permissions
- no automatic public action, send, spend, publish, or account mutation
- no server-side onboarding telemetry in V1
- no dead placeholder video button
