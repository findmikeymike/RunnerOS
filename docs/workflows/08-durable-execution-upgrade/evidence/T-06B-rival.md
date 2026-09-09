# T-06B rival review

Revision r5 · 2026-09-09 · independent reviewer rival_phase1. Recorded by integration owner from the read-only reviewer response.

Exact durable approvals for certified local reads reviewed: journal authorization, decision receipts, host resume/control integration and affected regressions. Public approval UI/RPC, steering, effects and children are outside this slice.

Resolved findings:
- High: asynchronous authorizer mutation could authorize different input than the subprocess executed. Independently reproduced; fixed with a pinned checkpoint snapshot and separate deeply frozen resolver copy. Resolver and caller mutation regressions pass.
- Approval consumption/dispatch needed injected rollback proof. Failed-save test preserves approved status and zero attempts.
- Parent identified that a waiting operation could accept a result before dispatch. Attempt-count guard and Pause/Cancel regressions pass.

Expired pending decisions can still be denied; approval intake enforces expiry. Independently executed approval and host suites: **43 passed, 220 assertions**. Exact principal/account/policy/input bindings, persisted expiry, duplicate receipts, controls, current authorization and immutable replay reviewed. No remaining blocking code findings.

Previously accepted r4 prerequisites carry forward into r5 as historical acceptance, not fresh executions. Changed approval components have separate fresh verification. Final consolidated logs reviewed: 87 durability tests / 437 assertions and packaged Electron approval recovery passed. T-06B narrow exit accepted; no remaining blockers. T-06 and P-03 remain open.
