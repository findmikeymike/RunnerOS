# P-03 r10 integration evidence

Date: 2026-09-09. Starting canonical main/origin/main: `32d4b000c`. This evidence accompanies the r10 implementation commit; remote push is separate. Scope is internal optional host machinery; public START remains legacy and `CRAFT_DURABLE_READ_HOST` is not enabled by this work.

## Changes and proof

- Production local-read authorization now binds principal/workspace, exact connection/account/model, validated permission sources and bounded approval lifetime. Native file integration verifies policy changes require fresh approval and committed read results replay without a second read. Later model-start checks stop revoked workspace access before reserving or calling another model.
- Shutdown now reports a prolonged wait without forcing storage closed. Isolated updater regression proves failed or hanging cleanup cannot proceed to install.
- Encrypted operation intent/attempt/outcome rows preserve adapter version, credential, idempotency key, output schema and shared conservative budget. Unknown outcomes require authoritative reconciliation; command replay cannot redispatch.
- Real native immutable artifact adapter uses a pinned private-directory identity, exclusive creation, fsync, content verification and no overwrite. A fresh process was SIGKILLed after artifact fsync and before journal acknowledgement; recovery found the artifact and committed success with one total invocation.
- Dedicated atomic child row/edge admission reserves full root cost and attempt caps. One-level read children inherit authority and constraints; required joins enforce output schema and recorded order, pause/cancel fences and stable acknowledgement. Actual subprocess SIGKILL before launch and before join preserves one native read. Detached children explicitly retain independent lifecycle.

## Recorded runs (intermediate, before final child integration)

- Focused journal/read/authorization/host/control/startup/shutdown suite: 150 pass, 697 assertions.
- Actual subprocess approval/control/attention/Pi replay/native artifact suite: 15 pass, 157 assertions. Pi uses a disposable loopback fixture provider; it is not remote-provider certification.
- Isolated updater shutdown suite: 2 pass, 8 assertions.
- Independent effect coordinator/artifact review and post-fix tests: 8 pass, 25 assertions. Reviewer authored operation core, so this is not independent review of that core.
- Electron typecheck passed before later permission/child changes; refresh all affected typechecks after final edits.

Review fixes include malformed Unicode before filesystem dispatch, frozen intent and caller claim across awaits, adapter metadata rechecks, directory dev/ino binding across restart, policy-source and final-lookup revision checks, current team authority, required-child parent dispatch fences and observation-only stopped-run recovery. All confirmed findings were fixed. No reviewed path is approved for broader activation by these tests.

## Explicitly unproven

Copied disposable Electron lifecycle probe did not finish: one sandbox SIGABRT and two 45-second supervisor timeouts outside sandbox, before the first observed post-readiness/availability marker. No actual safeStorage success or packaged UI journey was established. Earlier diagnostic markers were added afterward; unchanged failing runs were not repeated. The user's running app was never restarted.

No remote write provider, paid generation, publishing, general write-tool activation, legacy AgentMessageService conversion or staged rollout was performed. P-03 exit remains open; P-04–P-06 remain ahead. Graph validation checks document structure only.

## Final independent review and checks

- Final combined journal, read, authorization, effects, children, host/control, Electron authority/startup/shutdown tests: **179 pass, 824 assertions**.
- Independent operation-core and coordinator review by phase2_host: **22 pass, 90 assertions**, no remaining confirmed blocker in that scope. The reviewer did not author operation or observation core.
- Independent child review by rival_phase1: **15 pass, 53 assertions**, no remaining confirmed blocker in bounded one-level child contracts. Reviewer did not author child code.
- Shared/server-core typechecks passed after child and observation changes. Main-process bundling with canonical `artist-os` variant succeeded into `/tmp/artist-os-p03-main.cjs`; no app was launched or installed output replaced.
- Final subprocess approval/control/attention/Pi replay/native artifact/child suite: **17 pass, 174 assertions**.
- Additional actual default-factory Pi child subprocess proof: **1 pass, 18 assertions**. The real Pi server/native Read uses a synthetic loopback SSE provider. SIGKILL after child completion before parent join, delete the source, recover twice: provider calls stay at 2, read-bearing requests at 1, saved tool attempts at 1. This is not a remote-provider test.
- Host now owns child dispatch through tracked `startChild` and the active parent claim. New real-host lifecycle tests: **3 pass, 27 assertions** (included in final combined count). Required cancellation propagates, detached children retain independent lifecycle, and close waits for both before journal closure. Independent reviewer confirmed this seam with the existing host suite: 13 pass, 68 assertions.
- Final main-process bundle passed again after host-child integration. Shared, server-core and Electron typechecks passed. `git diff --check` and the r10 structural graph check passed.
- Total distinct final focused tests across combined/process/actual-Pi-child/isolated-updater suites: **199 passed**, no failures. Model-facing delegation exposure and actual packaged/remote-provider certification remain gated.
