# Build state

Revision r7 · 2026-09-09 · **T-06C committed; T-06D attention bridge implemented, verified and committed. T-06/P-03 remain open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. P-01: `dfac3d512`; P-02: `34d2ba786`; controls: `dd1798b7b`; approvals: `d77f96f2f`; steering: `9274f2041`. T-06D is included in the attention-bridge commit containing this state file. Other-agent work preserved. No push or Artist OS restart.

Added a journal-backed attention service and optional integration in the existing attention RPC. Exact normalized review input stays encrypted at rest. Trusted host principal checks protect projection and decision access. Immutable receipts are separate from current state. Renderer requests preserve retry identity and refresh stale cards without resubmission. Expired requests can still stop work. Durable notifications target only the requesting client.

Verification and limits: [T-06D evidence](evidence/T-06D-attention.md), [independent review](evidence/T-06D-rival.md). Actual Pi decision recovery and copied packaged journal proof passed. Production bootstrap does not provide this optional service yet; no live UI or admission enabled. T-06D does not mean user-facing integration is complete.

Runtime manifest pi-readonly-5 binds the new encrypted review payload semantics; older runtime records are readable and historical receipts remain acknowledgeable, but new unsupported execution/approval stays blocked.

Next: remaining T-06 control routing and host actor/key lifecycle, then T-07 effects/reconciliation plus safe provider proof, then T-08 children. Public rollout, schedules/chains, migration and full release verification remain ahead.
