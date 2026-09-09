# Independent specification review

Revision r1 · 2026-09-09 · Planning review, not implementation acceptance.

Author/integrator: primary agent. Independent reviewer: separate `/root/spec_review` agent. Review was read-only, using this packet and selective current-code checks, including rerun-from-step behavior.

## Findings resolved

1. **Estimated spend is not a hard cap.** Section 8 and A-17 now require enforceable upper-bound reservations/provider limits for a bounded-spend guarantee. Estimate-only adapters retain explicit limitations and existing spending authorization rules.
2. **One unavailable provider must not block all recovery.** Section 11 now requires bounded local classification, background provider reconciliation and blocking only affected/conflicting work. A-19 tests unrelated progress.
3. **Preparation-time authorization can go stale.** Every dispatch attempt now revalidates current cancellation/pause, permission/policy, account, approval, deadline and budget, binding relevant revisions to its claim. A-08/A-11 include same-process waits and revocation.
4. **Early task evidence must not masquerade as release certification.** T-01 graph verification now requires baseline/boundary inventory only. T-02/T-03 require their explicit prototype subsets. Packets clarify mapped acceptance IDs are traceability, not completed production scenarios.

Reviewer second pass confirmed the first three fixes, source-link resolution, acyclic 29-node graph and appropriate executable-first-phase/outlined-later-phase distinction. Its final verdict was ready after correcting item 4. The integrator applied item 4 and reran structural/link checks; no claim that the reviewer reran implementation tests.

Additional integrator clarification: explicit reruns preserve effect lineage/uncertainty, and rollback must isolate v2 data from already-released binaries that cannot understand future engine markers.

## Limits

No implementation was performed. No production durability, provider integration, power-loss, performance or release certification is conferred by this review. The plan checker validates structure/presence only. The SQLite/DBOS engine choice remains subject to P-01 evidence.
