# Build state

## Latest checkpoint — normal API write adoption, September 17

Normal durable Start now supports explicitly declared `sourceWrites` on selected API sources for Ask-mode agents. The shared API/OAuth path receives exact frozen method grants; the existing approval surface authorizes each write once. Journal schema 10/runtime revision 7 add separate bounded write requests and final approval revalidation. Confirmed receipts are saved before tool completion and replay without sending again. Uncertain responses pause; ordinary Resume cannot resend. Switching models after a dispatched write in the same step is blocked to preserve the conversation and receipts; later-step fallback remains available.

Verification: all 15 real normal-Start process tests / 147 assertions pass, including SIGKILL after saving a write receipt but before returning the tool result: restart completes with one POST and one approval total. Lost responses pause, and credits failure after a confirmed write cannot dispatch a backup model. The combined runner/gateway/parser regression passes 177 tests / 988 assertions; projection checks pass 18 tests / 86 assertions. Cold Rival independently passed 114 tests / 675 assertions; its final expired-run warning finding was fixed with a two-step regression covering a write in an earlier completed step. Server-core and Pi typechecks pass; shared checking reports the unrelated unfinished Composio test type error. No live account write or app restart occurred. Other agents’ unfinished changes are preserved.

This supersedes the previous contract-only adoption boundary below. Remote MCP/session writes and automatic migration of unmarked workflows are not included.

## Latest checkpoint — shared interrupted-write contract, September 17

The host effect journal now supports one-attempt writes without claiming provider idempotency. Confirmed receipts are reusable only with current access; uncertain writes cannot be resent through Resume, steering, fallback or child work. The shared adapter checks authorization at final dispatch. Run history presents uncertainty without approval buttons or private inputs. Schema 9 rejects older binaries. A fresh-process SIGKILL test proves exactly one simulated external write despite lost receipt; recovery stays honestly unknown.

Verification: 144 journal/child regression tests passed; six shared write-adapter tests passed, including actual process death and final-dispatch revocation. The final combined write, projection, effect-runner and journal check passes 45 tests / 199 assertions. Cold Rival rechecked the authorization fix with 20 tests and no remaining scoped finding. Server-core typecheck passes; shared-package checking still reports the unrelated Composio test error. Other agents’ changes are preserved. No app restart/live write occurred.

Normal model-called writes are **not enabled** by this checkpoint. The next adoption work must wire an existing authorized action plus an explicit effect budget into this shared contract. Current read workflows retain their Safe/GET admission rules.

## Current checkpoint — shared API source reads, September 17

Normal Start now captures selected API source GET tools and exposes only each step’s frozen tool definitions through durable Pi. Calls/results use the existing journal; current source permissions and credential ownership are rechecked on replay and before publication. Shared OAuth refresh preserves a persisted credential generation; reconnect/replacement invalidates it. Existing shared API/OAuth transport is reused. No extra read approval, per-provider adapter, write-tool adoption or broad workflow migration was introduced.

Verification: 136 runner/bundle/Start/output/fallback regression tests passed; 133 journal/Pi regression tests and five real subprocess IPC tests passed. The API gateway’s 19 focused tests cover refresh/replacement, dispatch fencing, request bounds and credential-echo handling. Cold review found response buffering and encoded credential-filter gaps; both were fixed and independently rechecked with all 18 tests passing. Server-core and Pi typechecks pass. All 11 normal-Start process tests pass, including a real default-Pi source-tool process test using the shared API server/client and synthetic fetch, with no approval prompt or token in model payloads. A real process-kill/reopen/resume test reuses the saved API result, performs exactly one GET across both processes, and completes the pending model turn. Shared-package typechecking is blocked only by the unrelated unfinished `composio-guidance.test.ts:40` type error; it was preserved. No app restart or live connected-account request was made.

Historical sections below describe their original narrower scopes. API read recovery is this completed implementation slice; interrupted writes and final live adoption verification remain separate work.

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

### Role-aware fallback Settings and workflow recovery — 2026-09-10

Continued on canonical main at `633e6df67`. Added independent General/Reasoning/Fast backup settings and matching per-provider overrides; workflow steps explicitly choose their work type. Ordinary step sessions persist that choice, while durable runs freeze exact candidate bindings and own their retry/switch decisions in the journal. Rate limits retry once, billing failures move on without a futile wait, and exhausted choices pause with a specific remedy. Run details expose actual model attempts. The unfinished read-only step may restart on another model; completed prior steps remain saved. Shared request/time limits are not reset.

Rival review found and fixed malformed profile handling, a Settings sibling-list overwrite, invisible Settings load failure, and a crash window that could retry a provider already known to be out of credits, and a delayed old authorization failure that could pause its replacement attempt. Parent review added explicit expired-run guidance and blocked Resume. Journal schema 4 fences older writers on reopen while preserving old unopted replay. Shared/Pi error classifiers now distinguish exhausted quota from ordinary HTTP 429 rate limits.

No user Settings or profile workflows were changed. No desktop app restart or live account calls were made. Extended thinking and unsupported tools/transports remain unchanged; these are explicit model-quality lists, not automatic capability or dollar-budget guarantees. See integration slice 10 for the exact contract.

Verification: **865 tests / 6,016 assertions across 73 files** passed in the combined regression suite, including seven actual default-Pi subprocess cases with synthetic localhost providers. After the final race fix, **138 tests / 706 assertions across 14 files** passed, including the new delayed-old-provider regression. Independent Rival closure reported no remaining concrete findings. Shared, server-core and Electron typechecks, changed renderer lint, and `git diff --check` passed. Desktop interaction smoke remains unperformed; the existing app was not restarted. This milestone is committed locally at closure, with no push.

### Approved public remote reads — 2026-09-10

Added the first bounded remote-tool adapter: explicit `webReadUrls` enables durable `web_fetch` for up to eight exact public HTTPS targets. Admission, frozen descriptors, current-owner permission checks and tool dispatch enforce the same list. The dedicated transport pins a checked public IPv4 address, verifies TLS, rejects redirects/credentials/compressed or unsupported content, and bounds time and response size. Existing ordinary web fetch is unchanged. Journal schema 5 preserves older local runs while fencing older writers on reopen. Remote child delegation and remote writes remain unsupported.

Saved web results replay without another fetch; interruption before saving can repeat the GET. Actual Pi SDK tests verify tool registration/replay, a synthetic subprocess SIGKILL test verifies saved-result recovery, and a local TLS fixture verifies certificate acceptance and hostname-mismatch rejection. No public internet/provider account or desktop smoke was performed, and no existing workflow was converted. See integration slice 11 for the opt-in configuration and limits.

Verification: combined regression run completed **873 passing / 1 failing of 874 tests across 73 files**. The failure exposed an existing disposable SQLite fixture reading schema before configuring its busy timeout. Moved its unchanged timeout ahead of that read; the entire affected storage-process file then passed **6 tests / 158 assertions**, including all 50 admission SIGKILL iterations. Independent Rival reviewed both the remote slice and this fixture correction with no remaining findings. Shared, Pi, server-core and Electron typechecks passed; `git diff --check` passed. Task-owned changes committed locally at closure; unrelated concurrent Artist Pulse work preserved. No push or app restart.

### Redirects between approved pages — 2026-09-10

Continued from canonical main at `9cda17688`. Added explicit `webReadRedirects` opt-in, pinned through workflow parsing, Start, journal and Pi registration. A request may follow at most three supported redirects exclusively within the frozen exact URL list. Each hop repeats public-IP/TLS validation and shares the original total deadline; loops, unsafe destinations and unapproved targets are rejected. Current policy checks cover all possible approved destinations, including after asynchronous authorization. Schema 6 migrates older records without changing saved grants. Default/false preserves redirect rejection.

Rival identified that changing the default tool description would invalidate saved model-context hashes on recovery. Restored its exact previous wording and added both byte-level compatibility coverage and actual Pi SDK replay checks seeded with the old description. Final independent review found no remaining actionable issues. Redirect transport tests cover hop limits, DNS changes, timeout/cancellation, stale connection errors, cleanup and credential isolation; the broader suite includes native local TLS and subprocess recovery coverage.

Verification: **910 tests / 6,380 assertions across 74 files passed**, with zero failures. Shared, Pi, server-core and Electron typechecks and `git diff --check` passed. No public-network account calls, desktop restart or live-app smoke; transport redirect cases use an injected network fixture. No user workflows converted. This slice is committed locally at closure; no push.

### Certified instruction-only skill adoption — 2026-09-10

Continued from integrated main `4188ef122`. Added exact-revision certification for the managed Artist Belief System and Artist Brand Expression Strategist skills, including all references. Compatible safe/thinking-off read-only workers may use these primary skills; selected lists and launch receipts must match. Admission freezes private core/reference instructions and enabled personal preferences into the existing encrypted system prompt. User overrides, helpers, source/tool grants, unknown revisions and adjacent expansions fail closed. Existing no-skill prompts remain unchanged. This does not enable the broader built-in Branding modes or convert user definitions.

Rival reviewed provenance, permissions, privacy, old-run compatibility and the process proofs with no remaining actionable findings. A real default-Pi fixture receives complete core/reference/preference content with only the four native read tools. A synthetic host SIGKILL fixture changes preferences between admission and recovery: recovery uses the original snapshot without repeating the completed model turn; a new run uses the new preferences. Public run history excludes the private snapshot. These prove transport and recovery behavior, not live-model skill adherence.

Verification: **946 tests / 6,970 assertions across 78 files passed**, zero failures. Server-core and Electron typechecks and `git diff --check` passed. No live provider account, app restart or desktop smoke. Task-owned changes committed and pushed at closure; unrelated concurrent Settings edits preserved.


### Actionable admission blockers — 2026-09-17

Continued on canonical main at `efa8c3cd7`, preserving concurrent Release Kit, Outputs and V2 documentation work. Normal Start now identifies the first blocked step and provides specific static guidance for supported bundle restrictions. Typed errors survive SessionManager; private exception details do not enter public Start errors. This corrects the outdated blanket “no skills” advice without widening certification. No admission, model dispatch or legacy fallback occurs when a later step fails. Repair-and-retry releases the original start lock normally.

Independent Rival review found no actionable scoped defects. Verification: **448 workflow tests / 4,621 assertions across 45 files**, zero failures, including localhost default-Pi and subprocess crash recovery. Initial sandbox execution could not run local provider servers; the complete workflow suite passed outside that restriction with synthetic credentials. Final wording received a further **33-test Start regression** pass. Server-core typecheck and `git diff --check` passed. No app restart, desktop smoke or live account call. This is workflow-scoped evidence, not a whole-repository test claim.


### Connected-source identity foundation — 2026-09-17

Continued on canonical main at `53e89ea10`. Added a host-only resolver that freezes and revalidates workspace-owned static bearer API source configuration, guide, directory identity, scoped URL list and credential fingerprint. This is the prerequisite for separate source-account approval/dispatch bindings: existing durable approvals are bound to the model credential, which cannot substitute for a connected-source credential. No connected tool, live request, normal-Start adoption or journal migration is enabled in this slice.

Rival reproduced an unreadable-guide hole in the ordinary source loader (read errors become null). Fixed by directly reading the guide, rejecting errors other than true absence, and distinguishing absent/empty content. Added real permission-change and restoration regressions. Independent closure found no further actionable issues. Synthetic subprocess proof saves the binding, kills the process, then verifies unchanged recovery and rotated-credential rejection in fresh processes; it does not exercise the production credential store or any provider account.

Verification: **93 tests / 375 assertions across 7 files**, zero failures; server-core typecheck and `git diff --check` passed. Preserved concurrent Release Kit, Outputs, Settings and Composio work. No app restart, live account/network call or desktop smoke. Only task-owned files are included in this slice's commit.


### Authenticated read transport, existing approval policy — 2026-09-17

Continued at `4fd1c977d` on canonical main. Added a host-only bounded HTTPS JSON GET transport using the saved static-bearer source binding. Credentials are revalidated after DNS and released only into the immediate request callback; exact URL grants, pinned public IPv4, certificate/hostname checks, no redirects, total timeout/cancellation and response size/type checks constrain dispatch. Upstream errors do not expose headers/body/secrets, and direct token echoes reject. Shared IPv4 extraction preserves public-web behavior.

Per the user's instruction, this adds **no new approval prompts or approval policy**. The transport invokes synchronous checks of the caller's existing authorization before lookup and before dispatch, and never retries or asks for approval itself. It remains unregistered with normal Start: endpoint certification, source-specific journal approval identity, host/Pi bridge and result-replay wiring are the next adoption work. Existing workflows are unchanged.

Independent Rival review found no actionable scoped issues. **109 tests / 426 assertions across 5 files passed**, including native localhost HTTPS bearer delivery, hostname mismatch rejection, late DNS/credential cancellation fencing, policy revocation, source rotation and the prior SIGKILL binding proof. Server-core and Pi typechecks and `git diff --check` passed; an initial test-fixture header union typing error was corrected before the final typecheck. Tests used synthetic credentials/local fixtures, not live accounts. No app restart or desktop smoke. Concurrent Release Kit/Composio/Settings work was preserved.


### Connected-read journal recovery — 2026-09-17

Continued at `6aaec6f51` on canonical main. Reused the existing operation journal's independent credential binding for the connected read adapter. Full source binding/URL are persisted in the encrypted intent; private untrusted results replay only after current access checks. Added workspace-bound adapters and an immediate journal attempt/control/deadline guard before awaited transports dispatch. This changes no approval policy and adds no prompts.

Rival found a prevented GET was being saved as a terminal tool error, blocking its intended read after resume. Fixed pre-dispatch access/binding failures to remain retryable and added pause -> resume -> one GET coverage. Independent closure found no further actionable findings and reran 10 adapter/process tests. Actual SIGKILL proofs demonstrate one fetch for a saved result, a separately bounded retry for an unsaved result, and cached-data denial after credential rotation. Source credentials/transport are synthetic; the journal and source binding resolver are real.

Verification: **126 tests / 611 assertions across 16 files**, zero failures, including shared journal/operation/approval/control regressions and existing artifact recovery. Server-core and shared typechecks and `git diff --check` passed. Normal Start/Pi exposure and the model-request/operation budget bridge remain pending; no normal workflow was converted. No live account calls, app restart or desktop smoke. Concurrent Release Kit, Composio and related Settings work preserved.

### Normal connected-read context adoption — 2026-09-17

Slice 18 connects explicit `connectedReads` declarations to normal Start and the durable runner. The initial route is Spotify Get Artist using an existing workspace static-bearer API source. The host captures source bindings, journals responses, and adds bounded untrusted observations to agent prompts. It does not expose a new model tool, support OAuth refresh, convert existing workflows, or broaden approval policy. Separate operation and model request budgets remain intact; schema 7 fences older journal binaries on reopen. See normal-engine-integration.md for authoring and scope.

Synthetic normal Start/default Pi proof passed with one account read, native local tools unchanged and account data present in the model context. Three subprocess tests prove saved response reuse after SIGKILL, bounded retry after an unsaved response, and credential-change pauses without another GET/model dispatch. Restoring the original binding permits saved result reuse. No new approvals were created.

Cold Rival found a publication authorization race after awaited workspace resolution. A regression first reproduced an unauthorized publication attempt; the fix rechecks current source access and the immutable execution claim before writing. Rival independently closed the finding. A stale multistep completion also now holds its own immutable claim for connected-access checks.

Verification: broader shared journal/workflow/server workflow regression run passed **770 tests / 6,066 assertions across 70 files**. After the publication fix, the directly affected connected/output/multistep suites passed **29 tests / 180 assertions**, including the new publication regression. Server-core and shared TypeScript checks passed; diff check clean. No live provider/account call, desktop restart or user-workflow conversion was performed. Broader OAuth/MCP and model-selected connected tool adoption remain separate work.

### Shared read policy and approval-friction correction — 2026-09-17

User direction: stop expanding a provider-by-provider hardening project and remove unnecessary approval prompts. Current code audit found two real nuisance gates: durable safe reads unconditionally requested an additional approval, and ordinary Ask-mode MCP classification omitted current workspace/source permission context. Both are fixed. Allowed reads/searches reuse existing policy without another dialog; denied reads, changed credentials, sensitive paths and explicit Gmail sends retain their checks. The default-Pi normal Start fixture now uses production authorization instead of a test-only no-approval callback.

Removed the Spotify-only connected URL rule. One canonical queryless HTTPS GET path now handles eligible configured static-bearer sources, with unchanged exact origin/base-path binding, saved results, request bounds and transport protection. Runner tests cover Spotify, GitHub and a custom analytics source without provider-specific code. This is not general OAuth/MCP durable proxy support: normal integrations already share their existing credential/refresh/server-building stack and continue operating there. The current architecture decision at the top of normal-engine-integration.md prohibits restarting a per-provider GET certification ladder or duplicating auth stacks.

Rival found no actionable remaining findings after independently running 31 tests / 289 assertions. Fresh targeted verification: 78 tests / 496 assertions across parser, runner, binding, adapter, safe-read authorization, source policy and Gmail send approval paths; 76 isolated pre-tool-use checks / 140 assertions; 9 normal Start/default Pi modes / 83 assertions with production authorization; 3 crash/recovery tests / 75 assertions. Server-core/shared typechecks and diff check passed. No desktop restart or live account/provider call. Concurrent Composio and Signals edits were preserved; only the single owned permission-context hunk in shared pre-tool-use.ts belongs to this correction.
