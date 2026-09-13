# Independent plan review

Revision r1, 2026-09-10. Reviewer: separate default subagent /root/review_spec; compiler: /root. Scope: packet completeness, lifecycle/permission/audio contracts and dependency plan. Not a code or live product acceptance review.

Initial verdict: coherent phased proposal; no blocking graph defect or false implementation claim. Four important gaps identified:

1. Durable audible acknowledgement and single speaking lease missing from C3. Added claimDelivery/acknowledgeDelivery, lease expiry, ownership, idempotency and competing-window checks.
2. Retry identity could change on reconnect. Added durable intent reservation, stable clientRequestId lookup and lost-response/new-call test.
3. Standing worker permissions could bypass promised UI approval. Specified restrictive voice-origin cap, exact scoped grant exception and fail-closed fallback; added allow-all adversarial case.
4. SDK proof could only test its own fake scheduler. T-102 now requires actual wrapper and production event seam; architectural mock alone cannot pass the phase exit.

Compiler applied all four fixes. These are reviewed design requirements, not proven implementation. Independent recheck confirmed all four findings resolved at specification level, with no remaining consequential blocker to P1 once authorized and setup-ready. This does not certify runtime feasibility.
