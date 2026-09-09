# T-06F host lifecycle evidence

Revision r9 · 2026-09-09 · source based on `8a5537d89` plus the host lifecycle commit containing this evidence.

Implemented one bounded task: `DurableWorkflowHost.open()` owns existing protected-key loading, journal construction, runner/control service lifetime and temporary-key zeroing. `close()` fences requests immediately and waits for runner quiescence plus accepted host requests before closing the journal. Runner quiescence persists cooperative pauses, drains active/background execution, suppresses replacement runs, and retains failed pause obligations for safe retries.

## Fresh verification

- **165 tests passed, 918 assertions, 19 files.** Affected journal, Pi checkpoint/IPC/startup, runner/default factory, host lifecycle, controls, RPC, attention helper and existing real Pi subprocess recovery/control/approval/steering/attention probes. Command uses Bun with release/dist exclusions. Local record: `/tmp/artist-os-t06f-final-tests.log`.
- Host/runner subset independently rerun by rival: **49 tests, 247 assertions** (included in the 165, not additive).
- Typechecks passed: server-core `bun run typecheck`; shared `bun run tsc --noEmit`; pi-agent-server `bun run typecheck`. Shared has no `typecheck` script; the direct compiler command was used.
- Plan graph validation passed. It checks document structure/evidence presence, not runtime correctness.
- `git diff --check` passed.

Host tests use the real journal and runner with synthetic backend/key-protection fixtures. They prove envelope identity preservation, refusal of missing/unavailable protection, no automatic replay, asynchronous request drainage, immediate admission fence, late model-result preservation, argument pinning, idempotence and safe retry after pause/backend/storage-close failure. Runner tests additionally cover queued resume suppression, hung/rejected abort drainage and retained pause obligations after active work disappears.

## Independent review/fix

See [rival record](T-06F-rival.md). Fixed facade mutation before validation and permanent rejected-quiesce caching. Both have passing regressions; reviewer reported no remaining confirmed blocker for the bounded slice.

## Limits and next boundary

No Electron bootstrap/quit registration or live app restart. Synthetic envelopes do not certify actual OS protection. Existing real Pi process probes are runner regressions, not proof of Pi launched through the new factory. A hung provider keeps close pending; the eventual desktop integration must own an outer quit policy without closing storage underneath live work. T-06 and P-03 remain open. No public workflow admission, external effects, children or UI activation added.
