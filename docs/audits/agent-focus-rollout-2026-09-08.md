---
status: implemented; live acceptance open
last_verified: 2026-09-08
branch: main
worktree: /Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os
---

# Agent focus rollout

Branding UI was committed first as `8a33aacc3`. This rollout reuses that transparent,
76px centered header, 28px buttons, neutral surfaces, orange outline/icon/check,
button-width divider and fast soot hover helpers across 27 agents. Existing bound
chats can choose a focus for their next response. No routine success toasts return.

## Delivered

- 103 explicit recipes: Branding 5, other Tier 1 specialists 54, Tier 2 specialists
  36, full Artist Manager 8 optional lenses. Recipes resolve against each worker's
  actual installed inventory, with multi-skill bundles only for coherent outcomes.
- Definitions own artist-facing hover descriptions and meaningful icons. Full stays
  explicit. Record Doctor remains a producer-submission assistant; Lyric Video
  remains single-asset work; playlist review does not imply supported mutation.
- Shared selection across direct chat, `message_agent`, workflows, prompt automation,
  scheduled work, Pulse, HQ actions, Signals handoff, repurposing and agent deep links.
  Scheduling, automation and workflow editors now persist the focus. Missing/stale
  focus and required dependencies block clearly; no Full fallback.
- Host-owned direct composition. Deliberate card changes affect the next input;
  in-flight initialization, provider fallback, auth retry and source activation retry
  retain the admitted recipe. Source retries use one-shot host tokens and the original
  input identity, without duplicate user bubbles. Stop and newer inputs invalidate them.
- Installed same-session capability expansion has a content/policy revision, reason,
  timestamp and original input identity. At most one new skill per response and two
  per session. No installation, new source, new tool or spending authority.
- Focus selection can preload authorized on-demand context, without bypassing disabled
  documents or private routing. Context budgets withhold complete documents. Optional
  sources remain on demand; social publishing selects one ready TryPost/Postiz/native
  route. Explicit empty sources cannot inherit unrelated workspace defaults.
- Forks inherit host current focus. Remote transfers carry selection intent, validate
  destination definitions/dependencies and rebuild prompts/capabilities. Historical
  messages do not contain historical focus snapshots; branching one retains the source's
  current selected focus. Failed openings restore a clean, retryable pending shell.
- Startup refreshes the approved built-in focus metadata. Other agent fields and the
  canonical development launch mode remain intact. No customer migration layer.

## Verification

- Full repository suite: **8,802 passed, 0 failed, 1 skipped**, 30,190 assertions,
  757 files. `PANGOCAIRO_BACKEND=fontconfig bun test` with generated release/dist
  paths excluded. Localhost test servers required normal local execution because the
  restricted sandbox could not bind their ports.
- All-package typechecks passed. Artist OS main and renderer builds passed.
- ESLint passed for changed Electron/shared/server/session-tool files; existing
  warnings remain (zero errors). `git diff --check` passed.
- Actual shared React components with production CSS passed an isolated browser
  sweep of all 27 agent headers at 1280/768/390/320px: compact height, no page overflow,
  all choices reachable, hover under 700ms, rapid crossing/re-entry, readable hover
  retention, keyboard selection, disabled selection during opening, no browser errors.
  Command: `bun scripts/test-task-mode-header-ui.ts`.
- Focused tests cover inventory round-trips, multi-primary recipes, source selection,
  context authorization/budgets, RPC-owned composition, hidden opening rollback,
  concurrent selection, fallback/auth/source retry identity, capability limits,
  transfer validation, editor persistence and deterministic tracked-work invocation.
- Existing weekly Signals workflow remains active. Its instructions/inputs/order/output
  retain the original frozen content digest after removing only the new explicit mode
  field; the selected `weekly-intelligence` mode is asserted independently.

## Adversarial review and fixes

Read-only rival passes found and verified fixes for eager optional adapter registration,
source retry consuming the pending focus, selected on-demand context being omitted,
empty source lists inheriting workspace defaults, direct launches dropping required
bundles, and failed openings retaining contradictory selected/pending state. Additional
wiring checks fixed scheduling/editor focus loss. Confirmed findings were retested.

## Live acceptance boundary

Browser checks use real UI components and built CSS in an isolated fixture. They do
not certify the running Electron/provider loop. No paid provider quality comparison,
50% prompt reduction target, latency claim, or two-round-trip guarantee is claimed.
The canonical development app must be relaunched with the user's permission before
its smoke test exercises this new main process and refreshed built-in recipes.
