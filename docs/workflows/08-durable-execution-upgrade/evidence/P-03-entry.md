# P-03 entry — first control slice

Revision r4 · 2026-09-09 · entry accepted by independent reviewer `rival_phase1`.

User requested commit and continuation. P-02 was committed as `34d2ba786` on canonical main. Its accepted internal read-only implementation and historical r3 evidence remain the prerequisite; no public rollout was enabled.

Expand the first part of T-06 as T-06A, durable pause/resume/cancel commands. Approval waits and steering then consume this shared command/fence contract; effects and children follow in sequence. Do not implement a synthetic approval UI or invent approval requests for authorized reads just to claim P-03 complete.

The selected safety boundary is the saved dispatch permit, not reversal of an already-issued operation. Maintain original ownership for late results, fence successor work with the current control revision, and acquire a fresh execution after resume. A duplicate receipt is historical evidence and must never restore an obsolete run state. No native OAuth, paid provider operation, public API/UI enabling or Artist OS restart is involved.

Earlier accepted evidence may carry forward only as reviewed historical evidence; fresh T-06A tests and independent review are separate. Schema 2 refuses old binary dispatch and runtime manifest pi-readonly-2 rejects automatic continuation of prior adapter revisions. Full migration and live UI/provider certification remain later gates.

Reviewer explicitly approved the entry scope and historical P-01/P-02 carry-forward. Affected journal/protocol/host code is recertified for T-06A using separate fresh evidence, not represented as unchanged. See [T-06A verification](T-06A-controls.md).
