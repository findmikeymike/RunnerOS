# Branding task-mode correctness

Base: canonical Artist OS `main` at `25c636ba9`. Changes remain uncommitted.
Unrelated FreeFormInput/Claude steering code, docs, tests, and scripts were preserved.
No app restart, push, merge, or live model request was performed.

## Fixed

- Hidden host starters do not enter `SESSIONS.md`, memory-sidecar review,
  refreshed titles, or remote-transfer summaries. A hidden input is a memory
  turn boundary: its answer cannot be paired with an older human request.
- The opening gate spans focus resolution through durable hidden-message
  admission. Concurrent focus clicks and ordinary sends cannot overtake it.
  A failed save rolls back only that unaccepted starter and permits retry.
- Each admitted response captures its prompt, primary skills, selected sources,
  and receipt. Async initialization, provider fallback, and automatic auth retry
  retain that snapshot. A later focus selection is persisted for the next turn;
  it does not mutate the active backend or auto-send another response.
- Renderer acknowledgements belong to a session and request identity. Delayed
  success/failure cannot affect another session, including switching away and back.
- Updated the stale direct-launch prompt assertion and recorded the current
  persistent-card decision at the top of Spec 48. No visual redesign.

## Evidence

- Before fixes, adversarial tests reproduced four failures: hidden log entry,
  memory-sidecar invocation, early backend context replacement, and concurrent
  focus selection during the opening admission gap.
- Final focused run: **191 passed, zero failed**, 784 assertions across 15 files,
  using the standard five-second timeout and packaged/dist ignore flags.
  Covers session admission/durability, real fallback-wrapper sequencing with
  deterministic fake providers, auth retry, renderer session transitions,
  mode resolution, metadata, BaseAgent, session logs, and launch/chrome contracts.
- `bun run typecheck:all`: passed across all nine packages.
- Changed-file ESLint: passed for renderer, shared, and server files. Server
  checks use the shared package's existing config; no root ESLint config exists.
- Artist OS variant Electron main build and production renderer build: passed.
  Renderer retains existing chunk-size/deprecation warnings.
- `git diff --check`: passed.
- Independent read-only review found and then rechecked the failed-save and auth
  retry edges; no remaining meaningful issue was identified in those fixes.

An initial concurrent validation run hit three archive-test timeouts and one
stale prompt-text assertion. The assertion was updated to the implemented
on-demand wording. Archive tests passed separately (16/16), then the final
focused run passed with the original timeout; no timeout or production archive
behavior was changed.

## Remaining acceptance

Native UI inspection confirmed the running Artist OS is the canonical packaged
app under `apps/electron/release-artist-os/mac-arm64/Artist OS.app`. It has not
loaded these source/build changes. Update/restart requires the user's permission
before real Electron/provider acceptance can certify the patch.

Next live check: initial focus opens one response with no fake user bubble;
cards remain visible/selected; rapid clicks and session switching are safe;
mid-answer focus changes affect only the following turn; hidden starters produce
no memory-review/title mini calls. Verify configured and Claude provider routes
without changing user model/permission preferences, and exercise fallback when
possible without inducing account changes.

The Spec 48 performance/quality gate remains unmeasured here: 50% context
reduction, at most two planning/read rounds, no irrelevant skill preloads, blind
quality parity, and intentional holistic Full behavior. These fixes do not
certify full rollout, host capability expansion, Manager focus, or automated
launch parity.

## Subsequent UI pass — user requested before relaunch

The user explicitly deferred relaunch/provider acceptance until after this UI pass
and will perform the live smoke test. Agent identity and focus controls now share
one 64px header: left-aligned identity, italic guide, and focus buttons to the
right. Uses restrained warm accents, shared hairline shadows, dark gradients,
distinct icons, and a checkmark for the selected mode. The existing chat menu,
first-click start, and next-turn selection behavior remain wired to the same paths.

Narrow panels scroll horizontally, button labels wrap within their available
width, and the selected focus stays visible when the panel resizes. Full Brand
System remains named explicitly, with its slower/comprehensive scope in the
tooltip and an additional visible hint on wider panels.

Validation: 49 focused tests passed; Electron typecheck and changed-file lint
passed. `scripts/test-task-mode-header-ui.ts` renders the actual React components
with production CSS in isolated Chrome: 1280/768/390/320px layouts, bounded header
height, no page overflow, selected state, chat menu, keyboard access to Full, and
selected-focus visibility on resize all pass with no browser errors. The
production Artist OS renderer was rebuilt. These are browser/component checks,
not claims about the still-running packaged app. No restart, commit, or push.


## Five-choice pairing — 2026-09-08

User approved consolidating to Brand Audit, Artist World, Voice & Beliefs,
Campaign Angles, and Full Brand System. Artist World selects narrative + visual
skills. Voice & Beliefs selects belief + expression skills. Both are focused
bundles, not Full. Parsing now allows non-Full bundles; prompt instructions use
both primary skills toward one coherent result without duplicate questionnaires.
The underlying skills remain separate. No compatibility migration was added:
the user clarified this is an app in development with no users.

Fresh validation: 72 focused tests and 117 agent storage tests passed, all-package
typechecks and changed-file lint passed, Artist OS main and renderer builds
passed. The actual-component browser check asserts exactly five buttons,
selection, compact layout at 1280/768/390/320px, keyboard access, and no browser
errors. A narrow independent code review found no meaningful issues. Provider
execution remains unverified; the user plans to smoke after relaunch. No restart,
commit, or push was performed.
