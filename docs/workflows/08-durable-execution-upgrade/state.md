# Build state

Revision r9 · 2026-09-09 · **T-06F host startup/shutdown implemented and independently reviewed; included in this commit. T-06/P-03 remain open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`, starting HEAD `8a5537d89`. User requested only the first task or two of the next phase slice; completed one task and stopped. No push or app restart.

The new trusted host factory opens the protected journal and owns the read runner/controls lifetime. Shutdown blocks new work immediately, saves active work as paused, drains existing operations, and then closes storage. Settled failures remain visible and permit safe close retry; hung work keeps storage open. Request arguments are pinned before asynchronous work.

Evidence: [host lifecycle](evidence/T-06F-lifecycle.md), [independent review and fixes](evidence/T-06F-rival.md), [task packet](tasks/T-06F.md).

The factory is not registered in Electron bootstrap. Next task: production host/actor/key and quit wiring with public admission still gated, followed by run-view projections. Effects/reconciliation, safe provider proof, children, schedules, migration and full rollout remain ahead. Runtime manifest stays pi-readonly-5.
