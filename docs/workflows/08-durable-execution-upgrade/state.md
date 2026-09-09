# Build state

Revision r8 · 2026-09-09 · **T-06D committed; T-06E durable control routing implemented, verified and committed. T-06/P-03 remain open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. P-01: `dfac3d512`; P-02: `34d2ba786`; controls: `dd1798b7b`; approvals: `d77f96f2f`; steering: `9274f2041`; attention bridge: `8dba3c438`. T-06E is included in the durable-control integration commit containing this state file. Other-agent work preserved. No push or app restart.

Dedicated durable-control RPC and Electron API route Pause, same-run Resume, Cancel and ordered updates through trusted host authority. Exact retry receipts never repeat runtime calls. Current redacted state is separate. Cancel/Deny acknowledgement is independent of cooperative backend shutdown; shutdown errors remain separately observable. Legacy rerun behavior is unchanged.

Fresh checks and scope are in [T-06E evidence](evidence/T-06E-controls.md) and [independent review](evidence/T-06E-rival.md). Real Pi process controls and copied packaged control journal proof passed. Service is still an optional unconfigured production dependency, so this is not live UI activation.

Runtime manifest remains pi-readonly-5. Next: host actor/key lifecycle and run-view projections, then remaining P-03 effects/reconciliation, safe provider proof and children. Scheduling, migration, UI rollout and full certification remain ahead.
