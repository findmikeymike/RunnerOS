# Signals / Your World Implementation Evidence

Implementation worktree: `/tmp/artist-os-signals-world`.
Branch: `codex/signals-your-world`.
Starting canonical main: `1f1c41293` (2026-09-07).
Fast-forwarded to canonical `d27bafa7d` before the final gate.

Specification: [47 Signals / Your World](../creator-command-center/47-signals-your-world-spec.md).

## Holistic Hardening (2026-09-07)

Working against committed Slice 3 `7ca3dd2d4`, still on the feature worktree.
The following fixes are implemented; final combined gates are recorded below
only after the independent reviews and test runs complete.

- Native YouTube parsing matches the bundled CLI's actual nested results and
  channel-upload envelope. Regression tests execute that CLI against a local
  fixture server, not merely a mocked adapter response.
- Retried workflows refresh failed/interrupted discovery without throwing away
  usable evidence. Missing synthesis coverage remains partial. Admission and
  restart recovery cannot run collection for an abandoned attempt.
- Authentication retry retains the accepted handoff message identity. Cancelling
  a handoff restores its unsent draft without overwriting newer user edits.
  Bounded retrieval retains useful ideas and their source references.
- The board puts the briefing and ideas first. Full reports open in the existing
  scrolling document reader; failed loads show Retry, not a truncated document
  pretending to be complete. History is dated, saved nuggets work on either
  track, and snoozed schedules show the actual next run.
- Native transcript collection falls back to Monid, then Zero. Monid metadata
  collection supports channel resolution, recent uploads and one-off videos;
  Zero remains transcript-only. Both Monid endpoints are pinned, with current
  schema/price/health inspection and existing user budget limits before spending.
- Paid operations keep durable receipts. Known interrupted runs resume polling;
  unknown submissions do not start a second charge. Fresh host-authorized scans
  can retry confirmed terminal, reconciled attempts. Successful transcripts are
  cached across tracks before another provider is tried.
- Existing shipped YouTube prompts and skill copies receive the routing update
  through a narrowly scoped migration; customized and deleted copies remain
  protected. The startup ordering is covered separately from template tests.

### Evidence Boundaries

Desktop and 390px renderer fixtures exercised long reports, report-load failure,
empty tracks, nuggets, setup and snoozing. Screenshots include
`/tmp/signals-fixed-desktop.png`, `/tmp/signals-fixed-mobile.png`, and
`/tmp/signals-fixed-full-reader-mobile.png`. These use mocked ElectronAPI data;
the real running app was not restarted or changed.

Monid's published guides recommend `apify /starvibe/youtube-video-transcript`
and `apify /streamers/youtube-scraper`. Their schemas informed bounded fixtures.
The actual Artist OS credential store currently has no connected Monid token.
No paid request, live account transcript, or end-to-end live report is claimed.
Live MCP schema, price and response certification requires connecting Monid.

### Independent Closure

- Native CLI, provider routing, Monid receipts/resume and budgets: 56 tests,
  296 assertions passed; no remaining actionable finding. A terminal failure
  with unknown exact billing retains the full projected charge. It may use
  Zero, but cannot authorize another Monid charge without cost settlement.
- Existing-install migration: 181 tests, 2,047 assertions passed. Known fixture
  hashes match committed bytes. The production SessionManager startup block
  was executed in isolation with oldest prompts, old metadata, customized
  bodies and repeated startup. A discovered whitespace-preservation gap was
  fixed before the final gate. This is not a live app restart test.
- Workflow retry/service: 58 service tests, 443 assertions passed. Independent
  runner/service checks covered lane admission and refreshed retry evidence.
- Handoff, bounded retrieval and renderer reviews closed all actionable
  findings; no production provider or artist account was used by these tests.

### Final Frozen Verification

- `PANGOCAIRO_BACKEND=fontconfig bun run test`: exit 0; 8,444 regular plus
  318 isolated tests passed, 1 existing installed-CUA-contract skip, 0 failed.
  Log: `/tmp/signals-hardening-full-tests-closure.log`.
- `bun run typecheck:all`: exit 0.
  Log: `/tmp/signals-hardening-typecheck-closure.log`.
- `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:main`: exit 0.
  Log: `/tmp/signals-hardening-main-build-closure.log`.
- `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:renderer`: exit 0.
  Log: `/tmp/signals-hardening-renderer-build-closure.log`.
- `git diff --check`: clean. Build bundle-size warnings remain; no packaged,
  signed, deployed, live-provider or running-app certification is claimed.
- Earlier gates caught an obsolete Zero-first skill assertion and the real
  startup whitespace-preservation gap. Both were corrected and the complete
  suite rerun on frozen code; these are not waived failures.
- Work remains uncommitted on `codex/signals-your-world` at `7ca3dd2d4`.
  Canonical main independently advanced to `2531ca001` during this work; this
  task did not modify, merge into, or restart it. Main integration and its
  post-merge regression gate are still separate work.

## Slice Gates

| Slice | Implementation | Independent review | Verification |
| --- | --- | --- | --- |
| 1: identity, collection, lifecycle | Implemented; checkpoint ready | Independent review passed; all actionable findings closed | Final post-fix full suite: 8,533 passed, 1 skipped, 0 failed; monorepo typecheck and Artist OS main-process build passed |
| 2: synthesis, reader, audio | Implemented; checkpoint ready | Independent audio/metadata and renderer reviews passed after fixes | Final merged-base suite: 8,580 passed, 1 skipped, 0 failed; typecheck and both main/renderer builds passed |
| 3: retrieval and handoff | Implemented; checkpoint ready | Independent backend and renderer reviews passed after fixes | Final post-fix suite: 8,653 passed, 1 skipped, 0 failed; monorepo typecheck and both Artist OS builds passed |

## Verified So Far

- Isolated dependencies installed with `bun install --frozen-lockfile --ignore-scripts`.
- Conditional collector/analyst instructions distinguish explicit new-contract
  runs from legacy weekly behavior. Exact shipped prompts can update; custom
  text, names, deletions, and installed workflow bytes remain protected.
- Focused prompt and existing briefing-template tests: 12 passed, 0 failed.
- RPC transport, channel parity, shared contracts, report validation and prompt
  compatibility: 41 passed, 0 failed (249 assertions, latest combined run).
- Backend service integration: 37 passed, 0 failed, including real queue
  admission, immutable evidence, deadlines, cancellation, ambiguous HQ rejection,
  repeated refused retries and restart recovery.
- `PANGOCAIRO_BACKEND=fontconfig bun run test`: exit 0; 8,236 regular tests
  plus 297 isolated tests passed, 1 skipped, 0 failed. Output:
  `/tmp/signals-world-full-tests-closure.log`. This run includes the final
  website parser adjustment and its service-path regression test.
- `bun run typecheck:all`: exit 0. Output:
  `/tmp/signals-world-typecheck-closure.log`.
- `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:main`: exit 0,
  output verified, no warnings. Output: `/tmp/signals-world-build-closure.log`.
  This is a main-process build, not a packaged application or renderer smoke test.

## Review Gate

Independent shared review reproduced three defects. They are now fixed with
regression tests: index failure cannot imply empty coverage, malformed index
fields cannot bypass provenance, and checked empty channels can participate in
a valid mixed no-change scan.

Independent backend review identified three additional issues:

1. Failure before/after collection can strand a request without a workflow run.
2. The generic retry path needs an authorized new attempt association while
   retaining the original configuration and evidence.
3. Website collection needs readable dated item evidence, not raw HTML prefixes
   permanently labeled incomplete.

All three are closed, including an independent real runner/service probe
that refused a retry while the lane was occupied, retried after lane release,
started exactly one session and finalized its report. Refused attempts have a
separate durable, bounded journal. Website packets now contain structured
readable items. The independent final review verified four useful updates from
the captured YouTube Help page, honest unknown publication dates, and the
adapter-to-service report path. The separate Node 24 public HTTPS smoke also
returned four updates. Month-only/relative labels cannot prove a quiet week;
such a scan remains partial rather than falsely reporting no change.

Whole transcripts replace clipped prefixes; over-budget videos remain uncovered.
The bundled-tool resolver now works in compiled CommonJS. Independent Zero
review closed query validation, metadata-contract revalidation before spending,
and CLI output-size findings. Guard/helper tests use fixtures, not real payments.

## Evidence Boundaries

No paid provider requests, live agent scans, artist data edits, or app restarts
have been performed. Public read-only website fetches and bounded Zero capability
metadata inspection were performed; these do not certify a complete live report.
YouTube metadata now prefers the existing YouTube Data API connection and falls
back to the pinned Monid scraper. No compatible healthy Zero channel-discovery
fallback was found; Zero remains transcript-only.
Slice 1 committed as `572d5ed6f`. Slice 2 committed as `da73c5a5a`. Current main through
`723dbb3cb` was merged into the feature branch as `86ee2fed9` before final Slice 3 verification; no Signals work
has been landed into main or pushed by this task.
Slice 3 committed as `7ca3dd2d4`. Follow-up hardening below remains uncommitted.

## Final Slice 3 Verification

On feature HEAD `86ee2fed9` plus the reviewed Slice 3 working changes:

- `PANGOCAIRO_BACKEND=fontconfig bun run test`: exit 0; 8,354 regular plus
  299 isolated tests passed, 1 existing skip, 0 failed. The post-ranking-fix
  run used permitted loopback test servers. Log:
  `/tmp/signals-slice3-full-tests-closure.log`.
- `bun run typecheck:all`: exit 0 after the final ranking patch. Log:
  `/tmp/signals-slice3-typecheck-closure.log`.
- `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:main`: exit 0;
  output verified after the final backend patch. Log:
  `/tmp/signals-slice3-main-build-closure.log`.
- `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:renderer`: exit 0
  on the final renderer code. Log:
  `/tmp/signals-slice3-renderer-build-final.log`. Existing Jotai deprecation,
  gray-matter eval, and bundle-size warnings remain; no dependency work was
  mixed into this slice. These builds do not certify signed packaging.
- `git diff --check`: clean. Main `723dbb3cb` is included in this feature
  checkpoint. No live app was restarted and no paid scan/TTS run was performed.

## Slice 3 Boundaries

- One live, local `find_signal_ideas` lookup serves the seven specified active
  workers. It reads immutable sidecars and current saved report bytes, not a
  prompt inventory or a second database. It never starts collection or paid work.
- General discovery checks up to the newest 200 candidate reports and marks
  partial availability if capped; exact references bypass that discovery cap.
  Every response, including provenance, is at most five entries and 4,000
  serialized characters. Oversized entries are omitted whole, not stripped of
  provenance. Ordinary work can continue when research is unavailable.
- New ideation access uses the existing `agent.chat` permission in both the
  requesting workspace and resolved HQ. This is a conservative editor/owner
  gate; ordinary report viewing remains unchanged. No paid-execution permission
  is used for read-only lookup.
- Handoffs bind a source reference in the existing session directory, with
  private file permissions. Only an unsent Content Genius campaign draft or HQ
  Artist Manager draft can bind. No research prose is stored in this sidecar.
- Actual Send checks the current source again under the session admission lock
  and requires human input. An explicit post-flush acceptance receipt bound to
  the persisted user-message ID consumes the binding, including after restart.
  Failed sends retain it; explicit reviewed detachment
  is available. Duplicate bindings resolve to the same unsent draft.
- Source selection and research guidance do not approve posts, emails, spending,
  asset production, or artist-context changes. Legacy/manual Share Intel remains
  unchanged.

### Slice 3 Review Fixes

- Independent backend review reran 74 focused tests with no initial blocker.
  A second review then reproduced a missing failure case: failed first-message
  persistence followed by a rename could make an unaccepted user message look
  consumed. The explicit acceptance receipt and guarded pre-ack rollback fix
  that path. Independent reproduction now confirms no acknowledgement, no
  phantom user turn, pending source retained, changed-source retry blocked,
  and successful rebind after source validation. The 16 host/store/durability
  tests pass with 62 assertions. FIFO sidecars are rejected without blocking.
- Renderer testing found that eager input clearing discarded a draft even when
  the host rejected Send. Guarded drafts now wait for explicit acceptance and
  compare text/attachment snapshots before clearing; later user edits survive.
- The final host gate also fault-injected receipt-write failure after the
  message flush: no acknowledgement or consumed binding was reported. Permanent
  FIFO and unmatched-receipt tests were added. Latest host/store/durability run:
  19 passed, 70 assertions, `/tmp/signals-handoff-tests.log`.
- Independent renderer review reproduced a partial-result issue: valid small
  ideas were hidden when other entries exceeded the response budget. All three
  UI consumers now retain validated entries from successful partial results;
  exact-reference checks remain. Independent recheck: 13 passed, 33 assertions.
- Real headless Chrome fixtures verified 1440px desktop and 390px mobile,
  explicit destination and activation, Cancel/Escape, persistent unsent reuse,
  damaged-reference recovery, delayed results after switching chats, failed
  draft-save recovery, and coordinated cross-workspace navigation. Real
  FreeFormInput checks covered rejected Send, duplicate suppression, concurrent
  typing retained on acceptance, and unchanged accepted text cleared.
- Screenshots inspected: `/tmp/signals-slice3-handoff-desktop.png` and
  `/tmp/signals-slice3-source-mobile.png`. Fixture evidence and replay paths:
  `/tmp/signals-slice3-ui-evidence.md`. Temporary renderer fixtures were removed
  and the preview server stopped. These are mocked ElectronAPI renderer checks,
  not live installed-app/provider certification.
- The first full-suite attempt was stopped after sandbox restrictions prevented
  loopback test servers from opening. The suite was rerun with local-server
  permissions; no test was skipped or weakened to bypass that restriction.
- A final precision probe found report recency could outrank a newer underlying
  development with the same topical match. Recent time-sensitive results now
  rank by validated event/source date before report date; relevance remains
  first and evergreen/exact-reference behavior is unchanged. The reader's
  26 tests pass, including two ranking regressions; independent recheck passed
  all 26 with 73 assertions and no remaining finding.

## Slice 2 Review And Browser Evidence

- Final commands on merged base `a676c72dd`: `PANGOCAIRO_BACKEND=fontconfig
  bun run test` (8,281 regular + 299 isolated tests), `bun run typecheck:all`,
  and `CRAFT_PRODUCT_VARIANT=artist-os bun run electron:build:main` /
  `electron:build:renderer`: all exit 0. Renderer build retains bundle-size
  warnings; no packaged, signed, or live-account build certification is claimed.
  Logs: `/tmp/signals-slice2-full-tests-final.log`,
  `/tmp/signals-slice2-typecheck-merged.log`,
  `/tmp/signals-slice2-main-build-merged.log`,
  `/tmp/signals-slice2-renderer-build-merged.log`.
- Full-suite failure during verification identified a static chrome assertion
  still expecting reader markup in HQ. The test now verifies HQ wiring and
  the extracted reader; navigation and legacy assertions remain intact.

- One shared reader now serves Industry and Your World, with scoped history,
  explicit legacy adoption, weekly schedule/config consistency and one-off links.
- Host finalization saves a hashed `SignalReportMetadata` sidecar only after
  successful completion. Audio validates that sidecar, current admitted attempt,
  final Output identity and actual saved report bytes before credentials/cache.
  Missing or malformed recap leaves the report readable and shows unavailable.
- Review fixes: custom multi-action schedules cannot be silently replaced;
  stale setup drafts cannot overwrite a newer config; Weekly does not claim
  active when Work re-enabled a matcher whose track config is disabled.
- Rendered testing found duplicate sibling dialog keys retaining an orphan
  portal after Cancel. Distinct setup/links keys fixed it; actual clicks,
  cancellation during slow resolution and Escape were rerun successfully.
- Isolated headless Chrome fixture: 1440px desktop and 390px narrow layouts,
  empty/populated tracks, valid/invalid links, scan-first default despite a newer
  one-off, per-track selection restoration, and no audio call before Listen.
- Browser race fixture additionally verified late channel results after cancel
  are ignored, stale settings preserve the draft without reaching save, and a
  failed transport retry retains its idempotency key. No console errors.
- Temporary browser fixture files and preview server were removed/stopped.
  Screenshots: `/tmp/signals-world-report-desktop.png`,
  `/tmp/signals-world-report-mobile-fixed.png`,
  `/tmp/signals-world-setup-mobile.png`. Browser fixtures are not live-account
  or paid-provider certification.
