# Build state

Revision r5 · 2026-09-09 · **T-06A committed; T-06B exact approvals implemented, verified and committed. P-03 remains open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. P-01: `dfac3d512`; P-02: `34d2ba786`; controls T-06A: `dd1798b7b`. T-06B is included in the approval-slice commit containing this state file. Other-agent work preserved. No push or Artist OS restart.

Approval waits and exact decisions now survive restart. Current permission is checked before dispatch; changed policy/account cannot reuse a saved approval. Approval consumption and dispatch attempt commit together. Review fixes protect against mutable authorization requests and results arriving before any dispatch attempt.

Fresh verification: **87 durability tests / 437 assertions**, **355 existing regressions / 1121 assertions**, all three package typechecks and temporary Pi bundle passed. Actual default-host SIGKILL and copied packaged Electron approval probes passed. See [T-06B evidence](evidence/T-06B-approvals.md) and [independent review](evidence/T-06B-rival.md).

Runtime manifest advances to pi-readonly-3; older manifests remain readable but cannot dispatch. No public production routing enabled. Native OAuth/IAM, writable effects, ordered steering, children, real OS-keychain/live-provider and full release certification remain outstanding.

Next: remaining T-06 ordered steering without changing completed work or reusing approvals for changed work; then T-07 effects/reconciliation and safe provider proof; then T-08 children. Do not close P-03 based on the approvals slice.
