# P-02 entry review

Revision r3 · 2026-09-09 · accepted for implementation, not rollout.

P-01 committed as `dfac3d512` on canonical main at user request. User then authorized continuing P-02. T-04/T-05 now have executable packets. Existing P-01 evidence remains revision r2 and does not imply production certification.

Independent reviewer `rival_phase1` accepted this entry and carried forward prior accepted P-01 nodes into r3 after confirming their implementation/evidence remained unchanged, except the verification launcher now selects the new production-journal probe only when explicitly passed `--production-journal`. Default P-01 probe behavior remains the same. This is a review carry-forward, not a fresh execution of the historical P-01 tests.

Installed Pi 0.84.3 exposes awaited `Agent.subscribe` listeners and an injectable stream function. Its higher-level AgentSession notifications do not await persistence. Implement the barrier at the core Agent and replay committed assistant messages through that same loop. Native tool wrappers commit results before the SDK can request the next turn. Plaintext SDK transcript persistence, dynamic hooks/context, extra model calls and fallback are excluded from this route.

P-02 supports an internal single-agent read-only runner with frozen execution inputs and a private production journal. Existing UI/workflow routing remains disabled until the later migration phase. Explicitly reject unsupported capabilities. Tests use separate worker processes, installed native SDK reads, local model simulation and a copied packaged Electron runtime. Paid providers and the running Artist OS app are outside this phase's test activity.

Ownership: phase2_journal handles persistence/key protection; phase1_boundary_map handles Pi bridge and checkpoint controller; phase2_host handles host orchestration; primary owner handles process proof, packet and integration; rival_phase1 independently reviews. No overlapping edits or other-agent work is staged.
