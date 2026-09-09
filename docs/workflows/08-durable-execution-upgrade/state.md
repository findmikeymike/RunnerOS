# Build state

Revision r4 · 2026-09-09 · **P-02 committed; P-03 control slice T-06A accepted. P-03 remains open.**

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. P-01 committed as `dfac3d512`; user requested P-02 commit and continuation, so P-02 committed as `34d2ba786`. Other-agent work was preserved. Current T-06A changes are uncommitted. No push or Artist OS restart.

Completed: encrypted production journal and real Pi read execution; now durable Pause/Resume/Cancel commands with atomic receipts, expected versions and control-revision fences. Resume drains old work before a fresh claim. Late issued results remain saved without reviving paused/cancelled work. Duplicate old Resume cannot reverse newer Pause. Pause is cooperative at dispatch checkpoints, not rollback of already-issued operations.

Fresh verification: **60 durability tests / 267 assertions**, plus **355 existing regression tests / 1121 assertions**. Packaged Electron Pause/SIGKILL/Resume probe passed. Independent rival accepted the narrow control slice; compatibility regression added from review. See [T-06A evidence](evidence/T-06A-controls.md). Final typecheck status is recorded there.

Schema 2 keeps old history readable but old adapter execution is rejected; new runtime manifest is pi-readonly-2. No public production routing enabled. Native OAuth/IAM, writable effects, approvals, steering, children, real OS-keychain/live-provider and full release-suite certification remain outstanding. The synthetic P-01 engine is never imported into product execution.

Next: expand T-06 exact approval waits and ordered steering against the new command contract, then T-07 effect/reconciliation adapters and safe real-provider proof, then T-08 child lifecycle. Do not close P-03 or enable rollout based on T-06A alone.

Historical evidence: [P-01 engine decision](evidence/engine-decision.md), [P-01 rival/fix](evidence/rival-review.md), [P-02 verification](evidence/P-02-verification.md), [P-02 rival/fix](evidence/P-02-rival-fix.md). Historical counts are not fresh executions.
