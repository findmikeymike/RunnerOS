# T-06F independent rival/fix review

Revision r9 · 2026-09-09 · reviewer `rival_phase1`; parent transcribed read-only reviewer findings.

Independent review confirmed a shutdown retry defect: the runner permanently cached a rejected quiesce promise, preventing later host close attempts from reaching storage/key cleanup even after the transient failure cleared. Fix retains each attempt's original rejection but clears the failed attempt cache. Failed pause obligations survive active execution drainage and are retried before a subsequent close can succeed. Admission remains fenced throughout.

Reviewer independently reran host lifecycle and runner tests: **49 passed, 247 assertions**. Coverage includes transient pause failure, retained pending pause after execution drainage, original error preservation, and a successful second close without reopening admission. No further confirmed blocker for this bounded task.

The separate host test worker found a caller-mutation race caused by deferring facade invocation to a microtask. Parent now invokes the underlying async service/runner synchronously so existing argument pinning occurs before returning; regression passes.

Historical r8 prerequisite acceptance carries forward as historical evidence, not newly executed proof. Changed runner paths receive fresh affected regression coverage. This review does not close T-06 or P-03.

Limits: hung work leaves close pending; fixture envelopes do not certify OS protection; no Electron bootstrap/quit integration, live UI activation, or actual Pi-through-new-host-factory claim.
