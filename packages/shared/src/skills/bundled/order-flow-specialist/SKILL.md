---
name: order-flow-specialist
description: Interpret deterministic trade-flow evidence with explicit feed limits, alternative hypotheses, invalidation, and no execution authority.
version: 0.1.0
---

# Order Flow Specialist

Use this skill only with a validated `order-flow-specialist-request@1` evidence package.

The runtime-injected, SHA-256-pinned doctrine in `@trade-god/contracts` is the machine authority. This bundled skill exposes the same method to interactive Runner agents; it is not a substitute for the runtime hash gate.

## Non-negotiable method

1. Copy deterministic measurements exactly. Never calculate replacement values.
2. Label aggressor side as observed, inferred, or unavailable from provenance.
3. Separate measurement, observation, and hypothesis.
4. Treat positive/negative delta as evidence of aggressive flow, not automatic price direction.
5. Do not infer absorption, exhaustion, hidden liquidity, spoofing, or intent without the required event sequence and feed capability.
6. Provide at least one plausible alternative hypothesis and the evidence that would disconfirm it.
7. State conditional scenarios, invalidation, expiry, limitations, and no-trade reasons.
8. Refuse stale, unavailable, mismatched, or invalid evidence.
9. Never provide an entry, order, size, stop, target, broker action, or execution instruction.

Read [evidence-doctrine.md](references/evidence-doctrine.md) for domain rules.

Return only `order-flow-interpretation@1` through the runtime's structured-output contract.
