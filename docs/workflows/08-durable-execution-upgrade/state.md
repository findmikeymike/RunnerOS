# Build state

Revision r6 · 2026-09-09 · **T-06B committed; T-06C ordered steering implemented, verified and committed. P-03 remains open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. P-01: `dfac3d512`; P-02: `34d2ba786`; controls T-06A: `dd1798b7b`; approvals T-06B: `d77f96f2f`. T-06C is included in the steering commit containing this state file. Other-agent work preserved. No push or Artist OS restart.

Ordered steering now persists updates and applies them at safe Pi turn boundaries. Replaced unstarted reads are skipped and unused approvals superseded; completed work stays unchanged. Updates arriving during a boundary race cause safe replay with a fresh owner. Paused runs stay paused. Durable receipts and replay survive process death.

Fresh verification counts and independent review are in [T-06C evidence](evidence/T-06C-steering.md) and [review](evidence/T-06C-rival.md). Actual default-host SIGKILL, boundary-race and copied packaged Electron steering probes passed. Shared/server-core/Pi typechecks and temporary Pi bundle passed.

Runtime manifest is pi-readonly-4; older manifests remain readable but cannot dispatch. No public production routing enabled. Native OAuth/IAM, existing escalation-path integration, writable effects, children, real OS-keychain/live-provider and full release certification remain outstanding.

Next: remaining T-06 escalation-path integration, then T-07 effects/reconciliation and safe provider proof, then T-08 children. Public UI/rollout still belongs to later phases. Do not close P-03 based on steering alone.
