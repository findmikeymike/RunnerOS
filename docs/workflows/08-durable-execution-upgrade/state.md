# Build state

Revision r9 · 2026-09-09 · **T-06F host startup/shutdown implemented and independently reviewed; included in this commit. T-06/P-03 remain open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`, starting HEAD `8a5537d89`. User requested only the first task or two of the next phase slice; completed one task and stopped. No push or app restart.

The new trusted host factory opens the protected journal and owns the read runner/controls lifetime. Shutdown blocks new work immediately, saves active work as paused, drains existing operations, and then closes storage. Settled failures remain visible and permit safe close retry; hung work keeps storage open. Request arguments are pinned before asynchronous work.

Evidence: [host lifecycle](evidence/T-06F-lifecycle.md), [independent review and fixes](evidence/T-06F-rival.md), [task packet](tasks/T-06F.md).

The factory is not registered in Electron bootstrap. Next task: production host/actor/key and quit wiring with public admission still gated, followed by run-view projections. Effects/reconciliation, safe provider proof, children, schedules, migration and full rollout remain ahead. Runtime manifest stays pi-readonly-5.

Small follow-up after `43172a1ff`: real Pi now verified through the new host factory, including native read, close/reopen and completed-result reuse. [Evidence](evidence/T-06F-real-host-followup.md). Test-only follow-up remains included in this commit; production wiring is still next.

Small authority slice: a current host-authentication/workspace resolver and real-journal denial tests are implemented, included in this commit. [Evidence and integration contract](evidence/T-06-authority-slice.md). Trusted authentication/membership sources must be supplied during startup wiring; no live activation claimed.

Small Electron storage slice: main-process host factory now supplies Electron safeStorage and canonical data root. Readiness, plaintext fallback and locked-keychain refusal covered by focused tests. [Evidence](evidence/T-06-electron-storage-slice.md). Included in this commit; startup registration and real OS keychain certification remain pending.

Small shutdown slice: pending host startup and drainage now precede app cleanup; repeated quit cannot bypass the wait, failed drainage is retryable, and update installation aborts when cleanup fails. [Evidence](evidence/T-06-shutdown-slice.md). Included in this commit. Production host startup and live quit/update verification remain pending.

After commit `a12a12ba4`, a small startup prerequisite adds authenticated live-connection lookup to the RPC server. [Evidence](evidence/T-06-live-connection-slice.md). This connection-check slice is included in this commit; stable identity/membership wiring and host startup remain pending.

Local owner slice: Electron authority factory now combines stable installation identity, authenticated live connections and current configured workspaces; shared-server/external bindings fail closed. [Evidence](evidence/T-06-local-owner-slice.md). Included in this commit. Host activation remains separate.

Startup composition slice: a default-off entry point now joins authority and protected host creation, with local-only policy checks before/after identity loading. [Evidence](evidence/T-06-startup-gate-slice.md). Included in this commit; bootstrap invocation, production runner binding resolution and live verification remain pending.

Binding slice: production read-binding resolver now uses host workspace/connection configuration and API-key fingerprints, rejecting fallback routes and configuration changes during credential lookup. [Evidence](evidence/T-06-binding-slice.md). Included in this commit; conservative API-key-only scope and no activation.

Bootstrap slice: Electron now connects the internal host and existing control handlers only with explicit `CRAFT_DURABLE_READ_HOST=1` for Artist OS; default startup remains unchanged. [Evidence](evidence/T-06-bootstrap-slice.md). Included in this commit. Flag not set, app not restarted; live flagged startup/quit smoke and production authorization-provider integration remain pending.

Approval/status follow-up: approval-bound reads now recheck current bindings and safe-mode permissions around authorization; explicit startup failure presents a generic warning. [Evidence](evidence/T-06-policy-status-slice.md). Included in this commit. Missing authorization providers still block dispatch; public admission stays legacy.
