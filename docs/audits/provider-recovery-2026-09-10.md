# Provider recovery — Area 6

Implementation branch: `codex/provider-recovery`, started from main `d10032d2e` and refreshed to `c9c4b0c2d` before final verification.

## Changes

- Auxiliary mini completions no longer own or reset the active chat backend. Steering, permission responses, and session-state access continue to target the chat while summaries run. All in-flight candidates remain tracked for cancellation and disposal.
- Title generation and regeneration now call the fallback wrapper's mini-completion path, preserving existing prompt, language, cleanup, and null-on-failure behavior.
- Authentication and billing failures retain connection attention and receive a 60-second process-local cooldown. Healthy routes are preferred automatically. If only attention-flagged routes remain usable, they can be probed; the new cooldown does not force a wait. Existing transient-provider backoff remains unchanged.
- Successful provider credential writes/deletes and saved connection-route repairs clear only the affected connection's attention cooldowns. Successful connection tests can clear them explicitly. Failed persistence, unrelated secrets, cosmetic/model edits, and new attention notices do not clear backoff. Legacy credential resets use the conventional `anthropic-api` and `claude-max` migration destinations.

## Scope boundaries

No new approval gates, backend cache, dependency changes, or increased test timeouts. This checkout does not include the separate uncommitted Area 5 steering-reliability work; integrate its overlapping fallback-wrapper edits carefully when landing both on main. Tool receipts and continuation instructions do not establish exactly-once external writes.

Tests use fake providers and temporary configuration. No paid provider call, app restart, or live Electron acceptance is claimed. No current Linux CI result is inferred from local checks.

## Validation

At `c9c4b0c2d` plus these uncommitted edits:

- Full discovered suite in two complementary shards: 5,003 + 4,434 passed, 10 skipped, zero failures.
- All 30 isolated test files: 403 passed, zero failures.
- Combined: **9,840 passed, 10 skipped, zero failures**.
- Independent review: no remaining must-fix findings after narrowing legacy credential invalidation.
- `bun run typecheck:all`: passed.
- Artist OS main-process and renderer builds: passed (existing renderer chunk-size/dependency warnings only).
- `git diff --check`: passed.

Regression coverage includes concurrent chat/mini steering, candidate disposal and cancellation, title fallback, actual auth failure followed by automatic fallback and later primary skip, all-attention and mixed cooldown routes, primary-only operation, cooldown expiry, and successful/failed credential/config persistence.

Broader-suite maintenance: refresh the inherited durable-control RPC snapshot and settings-tab styling expectation; limit scheduled-work agent/workflow mocks to their intended fixtures instead of intercepting explicit storage directories; complete source-credential mocks with the existing user-secret lookup method. Ordered-import reproductions confirm the workflow mock caused the unrelated storage and Signals failures. The product-boundary subprocess timeout passed unchanged when rerun without simultaneous builds.
