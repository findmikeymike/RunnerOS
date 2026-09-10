# Build state

Revision r10 · 2026-09-09 · **P-03 internal implementation pass finished; phase exit remains open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`; starting HEAD `32d4b000c` matches origin/main. Earlier slices are pushed. This r10 pass is recorded with its source/evidence commit; verify `git log` for the SHA. Remote push is separate. The user authorized the larger integration pass, replacing the small-slice limit. Never restart the user's app without permission.

Implemented and independently reviewed:

- Production read approvals bind current local/team authority, exact connection/account/model, matching validated policy sources and expiry. Policy changes across awaited lookups block stale approval use; access revocation blocks later model calls.
- Shutdown reports prolonged waiting and failed cleanup without forcing storage closed or installing an update prematurely.
- Encrypted effect intent/attempt/outcome records enforce immutable identity, bounded shared cost, exact output validation and authoritative uncertainty reconciliation. Observation-only recovery records stopped-run outcomes without permitting dispatch.
- Native immutable artifact adapter pins directory identity across restart and writes exclusively with fsync. SIGKILL after write before acknowledgement recovers with one invocation.
- Dedicated atomic child admission commits the child row, parent edge and full root reservations together. Stable IDs, ordered validated joins, required parent pause/cancel fences and explicit detached behavior are enforced. Certification is one-level local read only. SIGKILL before launch and before join recovers one child/read.

Final evidence is in [P-03 r10 integration](evidence/P-03-r10-integration.md). The plan graph is structurally valid; that is not runtime certification. Historical accepted nodes retain only their prior scopes.

Not activated: default-off `CRAFT_DURABLE_READ_HOST=1` opt-in remains unchanged; public START and legacy AgentMessageService remain legacy. No general write tools or model-facing delegation were enabled. The internal host now exposes a tracked startChild seam using its active parent claim. Actual default-factory Pi child recovery and integrated required/detached child shutdown have both passed disposable tests. No public/model-facing delegation tool was exposed.

Open exit gates: a concrete safe remote-provider adapter/target proof, copied/packaged Electron safeStorage and actual UI restart journey. The copied Electron probe timed out before confirming availability; this is not a pass. The user's running app and live credentials were untouched. P-04 scheduling, P-05 migration/UI and P-06 rollout/certification remain ahead.

Live desktop smoke subsequently passed canonical development startup, real protected journal open/reopen, authenticated service routing, normal Quit and native app relaunch; see [live smoke evidence](evidence/P-03-live-smoke.md). A relaunch cleanup bypass was fixed, rebuilt, live-tested and recorded with the smoke evidence. The user plans to test long-running workflows next. That smoke predates the normal-engine integration below; packaged release and remote-provider gates remain open.

## Normal-engine connection — first reviewed slice

See [normal-engine integration](normal-engine-integration.md) for the current slices and acceptance boundaries. Admission acknowledgement, normal journal-backed run history, and saved-run controls are now connected in source behind the existing host opt-in. Public START still uses the current engine; agent get-run and scheduled observers remain legacy. The next slice must certify a real host-resolved agent/connection/cost policy and connect shared Start. No new desktop smoke or remote provider certification is claimed.

Fresh verification for this slice: **119 tests passed, 557 assertions** across admission, host lifetime, projection, approvals/controls, children, normal RPC routing and renderer recovery helpers. Server-core and Electron typechecks and changed renderer lint passed. Cold rival review found both ID-collision and stale-visibility defects; fixes were independently rechecked with **41 tests / 183 assertions** and no remaining scoped findings. Normal START and desktop visual acceptance remain outside this evidence.

## Normal Start connection — second slice

Normal Start is now connected in source for explicit `execution: durable-local-read` workflows while the existing local host opt-in is enabled. Unmarked workflows keep normal execution; marked unsupported/automatic/host-unavailable paths fail before admission. Real prompt/account/model resolution is preserved. Eight model requests and a ten-minute deadline bound attempts, not dollar spending. Shared guards cover normal starts and older legacy reruns. See [integration details and configuration](normal-engine-integration.md). Earlier statements that public START is wholly legacy describe the earlier slices. No user-profile workflow was converted and the running app was not restarted.

Fresh second-slice checks: **360 distinct tests passed / 1,583 assertions** across the affected durability/parser/storage/runner/RPC/recovery suites and the isolated default-Pi process test. Server-core and Electron typechecks passed. Cold rival found mixed-engine Start and older-legacy-rerun concurrency gaps; both were fixed and independently rechecked (15 tests / 54 assertions, no remaining scoped blocker). The Pi probe used synthetic credentials and localhost only: two model requests and one native read. This is not live-provider or desktop smoke certification.

The final real-host regression also proves that an older failed legacy run cannot bypass active durable work: no legacy session is created and the prior record remains byte-for-byte unchanged.

## Follow-up rival fixes — 2026-09-09

All four follow-up findings are fixed: admission stays blocked until cancelled execution actually drains (both engines); mounted history discovers work after lost Start replies and reconnect; fresh authorized detail reads recover from transient errors; and approval badges refresh from saved progress. Request ownership now survives slow replies across polling ticks, while decisions, route changes and unmount still fence stale replies. No additional START is issued during discovery recovery.

Fresh checks: **155 tests passed / 660 assertions** across runner, host, routing, history and renderer request/discovery controllers; changed renderer lint passed. Rival independently verified the drain fixes and final request-lifecycle fix, with no remaining scoped findings. Controller lifecycle tests do not constitute mounted React or desktop smoke proof; no app restart, live provider call or commit was performed.
