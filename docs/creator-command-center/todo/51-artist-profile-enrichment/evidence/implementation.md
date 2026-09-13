# Implementation evidence

Implemented September 13, 2026 and hardened on `codex/profile-enrichment-review-fixes` from `95a6a7fab`.

Delivered: host-enforced Deep Research deadlines/tool budgets and durable receipts; canonical career research record and rebuildable managed context; identity/attempt fencing; evidence-gated publication; persistent correction/removal overlays; RPC/transport; Profile UI; Manager brief and explicit career retrieval; relevant campaign focus inheritance; next-turn context refresh.

Review hardening completed September 13:

- Enrichment registration is lazy and lifecycle-owned, including headless/server wiring, startup recovery drain, runtime error reporting, and shutdown drain.
- Native browser reads are host-budgeted and receipt-backed. Research tabs use a dedicated ephemeral partition, cannot attach saved social/ad accounts, deny sensitive permissions and app deep links, and fail closed on private/reserved or unresolved destinations at navigation and every Electron request hop. The unpinned built-in WebFetch route is denied because it bypasses that Electron policy. Functional content query parameters survive while tracking/credential parameters and unsafe IP ranges are rejected. Browser batches are rejected so one trusted navigate/snapshot maps to one auditable receipt.
- Candidate publication requires the receipt excerpt to support the actual claim, and every publication transition re-checks the same owner, identity generation, attempt, and state under the workspace lock.
- Cancellation fences active work in memory even when its durable write fails; shutdown durably interrupts active research before enrichment unsubscribes.
- Existing sessions receive current context again at each admitted turn, so corrections/removals are not limited to newly launched chats.
- Established artist identity changes require explicit **Clear context**. Clear stops active work, privacy-scrubs the Team record, preserves Profile/Branding/Voice/growth data, leaves standalone Outputs intact, and publishes only a fact-free invalidation marker until new research replaces it.

Verification:

- Focused suite: 165 tests passed across Deep Research, enrichment storage/service, shared-record safety, Manager/session context, RPC registration, and native-browser network controls.
- `packages/server-core` and `apps/electron` typechecks: passed.
- `bun run typecheck:all`: reaches the pre-existing `packages/entitlement-service` WebCrypto `Uint8Array<ArrayBufferLike>`/`BufferSource` errors; the changed packages pass independently.
- `bun run check:dependency-containment`: cannot certify this isolated review worktree because its intentionally shared `node_modules` symlink resolves to the canonical checkout.
- `git diff --check`: passed.

The test research path is synthetic and clearly separate from live acceptance. No app restart, paid provider action, Spotify analytics request, or Spotify snapshot write was performed. Canonical UI and real-source acceptance remain pending the user's separate restart approval and a configured compatible source.
