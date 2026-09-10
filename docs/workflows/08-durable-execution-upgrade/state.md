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

Live desktop smoke subsequently passed canonical development startup, real protected journal open/reopen, authenticated service routing, normal Quit and native app relaunch; see [live smoke evidence](evidence/P-03-live-smoke.md). A relaunch cleanup bypass was fixed, rebuilt, live-tested and recorded with the smoke evidence. The user plans to test long-running workflows next. Visible durable approval/recovery remains blocked by legacy-only run list/detail routing; packaged release and remote-provider gates remain open.
