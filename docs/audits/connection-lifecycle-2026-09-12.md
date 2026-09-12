# Connection lifecycle audit — 2026-09-12

Scope: account switching, refresh, sign-in/sign-out, source activation, and credential changes during active sessions. Conducted in `codex/connection-lifecycle` from main `b28600c7f`, with disposable test profiles and fake provider transports. No app restart or live external action.

## Confirmed and addressed

- Same-slug sources in different workspaces shared one refresh promise. Refreshes now follow the effective credential owner; inherited credentials update their owner instead of creating borrower copies.
- Delayed refreshes and OAuth callbacks could restore disconnected credentials or overwrite a newer login. Credential and sign-in revisions fence persistence, returned tokens, and authentication status. Callback nonces remain single-use while in-progress exchanges stay cancellable.
- An account change could inherit the previous account's refresh token. Inheritance now requires positively matching account identity.
- Changed API instances and MCP custom headers/stdio settings could leave old clients active. Rebuilt API clients and complete configuration comparison apply changes.
- Late connections/source builds could revive removed sources; replacing a client could cut off an already submitted request. Source intent fencing and client retirement preserve admitted results while updating subsequent routing.
- Shared CLI cache updates could finish out of order or expose incomplete JSON. Per-path queues include credential resolution and publish private files atomically.
- Startup secret loading and alias migrations could overwrite newer edits; delayed deletion could clear a newly saved environment value. Current-record publication and ordered migration locks protect those edits.
- Refresh discovery ignored inherited credentials, and a failed account's cooldown outlived a repaired connection. Effective credential reads and credential-specific failure tracking retain cooldowns only for unchanged failures.
- Claude provider authentication leaked through shared process environment; Copilot refresh could overwrite logout/reconnection. Provider operations require connection-owned credentials and refresh ownership checks.
- Persistent Pi/Claude clients could retain stale credentials, endpoint settings, or saved CLI secrets. New operations resolve current settings; active turns keep their admitted transport and receipts. A same-slug Claude/Pi provider change rebuilds the idle backend using the existing conversation replay path.
- ChatGPT/Copilot callbacks could commit after cancel, logout, or a newer login. Server-owned sign-in snapshots now bind callback completion and cancellation.
- Connection setup could expose a new endpoint with an old key, or leave that pair behind on failure. Per-connection serialization and stable reads keep setup coherent; conditional rollback restores only credentials still owned by the failed setup. Initialization runs outside the writer lock.
- Disconnect could delete a sign-in admitted after it began. Grouped conditional deletion distinguishes newer sign-ins from routine token rotation and performs no late local writes after remote revocation.

## Boundaries

- Existing approval rules remain unchanged. No new prompts or approval gates were added.
- A request already admitted to a provider stays with its original connection so its result is not lost. Subsequent operations observe connection changes.
- Google Ads and YouTube CLI caches remain globally shared by existing product policy; this audit does not introduce multi-artist account models.
- Source files changed during an asynchronous credential backend write may leave an unused credential record. Ownership is rechecked before returning a token or updating source status; source configuration is never recreated from that completion.
- Website deployment adapters and community mailers capture their provider connection for each admitted operation. This audit does not claim that existing label-only website approvals bind a canonical provider account; that broader configuration contract remains the Phase 3 follow-up.

## Verification

- All 44 isolated test files passed in separate processes: 495 tests, 2,102 assertions.
- All-package TypeScript checks and dependency containment passed.
- Artist OS main and renderer builds passed in the worktree. No app was launched or restarted.
- After merging canonical main's concurrent artist-mission commit, affected prompt tests and the connection barrier tests passed: 49 tests, 370 assertions.
- The regular suite was run as six shards. Repaired test doubles were rerun in their shards: 9,921 passed, 10 skipped, 1 failed, 39,098 assertions. The remaining failure is described below.
- One unresolved full-shard failure remains in the unchanged native session watcher test: its first immediate file write produces no notification. That file passes standalone (3 tests, 9 assertions). This is not a fully green full-suite claim; watcher readiness/test isolation remains for Phase 5.

## Post-landing review fixes (2026-09-12)

A critical review of this lane found and fixed four gaps the audit above did not cover:

- A source update arriving after the source build loop but before agent assignment created the agent with empty sources: `reloadSessionSources` defers to the pending build while the agent is null, and nothing re-applied the withheld update. Agent creation now catches up to any source update observed during the build.
- Legacy Claude credential writes bypassed the revision fencing this audit claims: routine token refresh dual-wrote through unfenced setters (bumping the auth revision for rotation, which could make a racing disconnect look superseded, and clobbering newer sign-ins), and the onboarding Claude exchange committed unfenced after the network call. Rotations now use ownership-checked compare-and-set writes that never bump the auth revision, and the exchange marks its sign-in intent before the network call and commits conditionally.
- Refresh cooldowns were keyed by slug alone, so the same slug enabled in two workspaces with different credentials cleared each other's failure records through identity mismatches. Cooldowns are now scoped per workspace instance; successful re-authentication still clears every instance of the slug.
- A joiner of a shared refresh promise inherited the owning caller's superseded rejection even when its own route was still valid. Joiners now re-evaluate the superseded result against their own route and adopt the committed token when one exists. Expired never-completed OAuth exchanges are also pruned from the completing map so code verifiers and client secrets do not outlive the flow TTL.
