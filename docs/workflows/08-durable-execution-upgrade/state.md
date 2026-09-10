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


### Scheduled adoption slice — 2026-09-09

Canonical `main` verified at `bd3dd7684`; existing manual integration is the baseline. Tracked Scheduled Work now routes explicitly marked single local-read definitions into the durable host using its persisted attempt identity. Reconciliation repairs the admission/returned-ID write gap without a second dispatch, and journal projections drive scheduled completion. Other automatic entrypoints, multi-step runs, output publishing, and external effects remain outside this slice.

Cold review found unavailable/disabled-host restart ambiguity and early background-lane release during cancel/pause cleanup. Fixes retain startup gating whenever recovery storage is present but unavailable, preserve saved claims, and consult actual worker ownership before releasing the lane or settling terminal status. Late asynchronous replies remain attempt-fenced. The optional flag still controls opening the host; saved data does not silently enable new execution.

Verification is recorded after the final checks below. The current app was not restarted; no live provider calls or user-profile workflow changes were made. An unrelated ArtistHQHome renderer edit was preserved.

Final checks: **220 tests passed / 930 assertions across 12 targeted files**, including the real SIGKILL admission-gap process test; server-core and Electron typechecks passed; changed Electron main-process files passed ESLint; `git diff --check` passed. Rival closure review found no remaining scoped findings after both fixes and the disabled-host restart correction. No commit or app restart was performed in this slice. Next adoption boundary: multi-step execution, with its own pinned step inputs, completion and replay proofs.


### Sequential multi-step adoption — 2026-09-09

Continued from the uncommitted scheduled slice on canonical `main` (`bd3dd7684`). One to eight sequential local-read steps now share a journal and the original total budget/deadline. All agent bundles resolve before admission and must share a model/connection. Earlier text-output references are frozen and validated; per-step outputs survive restart and later-step failure. Last-step completion and run success are atomic. Scheduled occurrence reconciliation applies to the same multi-step run identity.

Cold Rival reviewed journal ordering, model-turn offsets, steering, cancellation, templates and history without actionable findings. Parent additionally checked compatibility for explicitly allowed empty results. SIGKILL recovery and real default-Pi/native-read process tests use synthetic profiles/providers only; desktop acceptance remains open. No app restart, commit, or unrelated renderer edits were performed.

Final verification: **344 tests / 1,595 assertions** across 19 targeted files passed, plus **2 real default-Pi process tests / 15 assertions** (346 distinct tests total). Shared, server-core, Pi agent server, and Electron typechecks passed; `git diff --check` passed. Rival's focused review and empty-result compatibility closure reported no remaining actionable findings. Next adoption boundary is durable output publishing and supported source/tool capabilities; mixed providers and arbitrary external actions remain separate.

### Final text Output publication — 2026-09-09

Continued on canonical main at `62c70cfba`, preserving the uncommitted scheduled/multi-step slices. Explicit final-step report/document contracts now publish through a host-owned atomic bundle writer. Saved text remains recoverable until a journal receipt certifies success. Manual and tracked scheduled starts share this path. Same-title runs have distinct output slugs; exact replay preserves the original bundle, while modifications conflict safely. No model write tools or external publishing were enabled.

Rival found provider credentials incorrectly gating finished text publication and late backend failures stranding pending results. Recovery now resolves the current local workspace independently of the provider, and pending results pause through stream, direct backend-fail and destroy errors. Fresh review closed both findings. Current local authority and files.write permission remain required.

Final checks: **279 tests / 1,384 assertions across 24 files**, including real SIGKILL publication, multi-step and scheduled-admission recovery; shared, server-core and Electron typechecks passed. Changed Electron files passed targeted ESLint; a broader lint invocation encountered two existing shadow-class errors in untouched settings pages (SecretsSettingsPage and SettingsPageSwitcher). No unrelated lint edits were made. `git diff --check` passed. This slice used injected synthetic backends; prior real-Pi evidence remains scoped to the preceding slice. No app restart, desktop smoke, live provider call, commit or push was performed.

### Workspace filesystem sources — 2026-09-10

Committed the scheduled, multi-step and final Output slices on canonical main as `d10032d2e`. Continued with bounded local filesystem source context: existing enabled directories inside the workspace, frozen guide/configuration/directory identity, no connector activation or new model tools. All step sources are revalidated before dispatch and after awaited tool authorization. Changed or revoked sources pause; saved result replay remains available when the original contract is restored. See slice 6 in the integration document for limits.

Rival caught inconsistent source-name sorting; the actual default-Pi test exposed canonical workspace alias mismatch during recovery. Both are fixed with regressions. Precomposition rejects unsupported optional connectors using normal source-selection semantics. Final scoped review reported no remaining concrete findings. Native-read policy was not converted into a global filesystem sandbox, and source file contents are not snapshots.

Verification: **208 tests / 1,076 assertions across 18 files**, plus **3 actual default-Pi process tests / 23 assertions** using synthetic credentials and a localhost provider (211 distinct tests). Tests cover revocation during awaited authorization, changed guides, symlink swaps, canonical aliases, multi-source ordering and cached-result replay. Server-core and Electron typechecks passed; `git diff --check` passed. No app restart, live provider account call or desktop smoke. Source-adoption changes remain uncommitted; the prior slices are committed locally and not pushed by this turn.

### Frozen workflow inputs — 2026-09-10

Committed the filesystem-source slice on canonical main as `c5c0c6990`. Continued with typed manual/tracked-schedule inputs: original scalar values, defaults, constraints and untrusted-field annotations are saved with the run and projected into history. All steps substitute once using saved inputs; template-looking input text stays literal. Unknown ordinary fields are dropped, while permission/source controls and prototype names reject. Optional missing fields expand to empty text. Same scheduled occurrence recovery returns saved values before validating edited defaults.

Parent and Rival found repeated normalization replacing intentional blank/null optional values with defaults. Final durable admission now owns normalization; RPC/SessionManager preserve raw durable inputs, and a default-off shared option preserves explicit empty markers through durable schedule creation, bound/unbound automation queueing and later input supply. Legacy normalization remains unchanged. Regression tests cover all affected entrypoints, numeric nonfinite rejection, frozen restart replay and single-pass untrusted input handling. Final Rival review reported no remaining concrete findings.

Verification: **428 tests across 27 files**, plus **4 actual default-Pi process tests** with synthetic credentials/localhost (432 distinct tests). The final normal-Start regression rerun passed 19 tests. Shared, server-core and Electron typechecks passed. `git diff --check` passed. No live provider account, desktop restart/smoke, push or additional commit was performed; this input slice is uncommitted. Local main is 10 commits ahead of the last fetched origin/main.

### Holistic review and focused structured steps — 2026-09-10

Committed the frozen-input slice as `c9c4b0c2d`, then reviewed the four recent normal-engine integration commits and their journal/Output-lock dependencies. All four confirmed findings are fixed: unavailable recovery storage blocks new manual workflow admission as well as schedules; process birth identity distinguishes reused PIDs; Output lock ownership is published atomically with guarded dead-owner reclamation; pending publication exposes a safe repair category without leaking raw exceptions. See [holistic review evidence](evidence/normal-engine-holistic-review.md). Journal schema v3 rejects older binaries on reopen; already-open mixed-version raw Journal consumers are outside the supported host contract. Unreadable/ownerless legacy Output locks fail closed regardless of age.

Continued with two bounded adoption slices, each independently reviewed and corrected. Explicit skill-free worker task modes now resolve and verify their exact launch receipt before admission; selected source recipes follow normal mode selection semantics. Structured JSON outputs now validate before a step completes, support declared nested fields in later-step templates, and recover from saved raw results without repeating completed model work. Unsupported schema keywords reject before admission. Review found and fixed inherited-property handling in the shared validator and template lookup; only actual saved fields satisfy required properties or enter prompts.

These changes preserve the explicit workflow marker and default-off host opt-in. Skill-backed modes, remote tools, mixed providers and public delegation remain separate adoption work. No user-profile workflow was converted, no live provider account was used, and the desktop app was not restarted or smoke-tested. Synthetic default-Pi/native-read tests cover manual, sequential, filesystem-source, typed-input and structured-output paths.

Final verification: **852 tests passed / 5,987 assertions across 73 files** (834 shared/workflow/scheduled-work tests, including subprocess recovery and five default-Pi cases; 18 Electron host tests). Shared, server-core and Electron typechecks passed; targeted Electron main-process lint and `git diff --check` passed. Independent Rival closure found no remaining scoped findings after the mode-source and inherited-property fixes. All task-owned changes are committed at goal closure; no push was performed.
