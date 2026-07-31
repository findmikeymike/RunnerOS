/**
 * Compile-time product catalog for the Trade God app.
 *
 * Keep this list intentionally small. Artist OS assets remain available in
 * sibling worktrees, but they are not seeded or bundled by this product.
 */
export const TRADE_GOD_STARTER_AGENT_SLUGS = [
  'concierge',
  'setup-concierge',
  'orchestrator',
  'researcher',
  'writer',
  'coder',
  'triager',
  'critic',
] as const;

// Workspace activation is user-owned. Trade God never edits activation
// manifests across the shared RunnerOS workspace registry at startup.
export const TRADE_GOD_DEFAULT_ACTIVATED_AGENT_SLUGS = [] as const;

export const TRADE_GOD_BUNDLED_SKILL_SLUGS = [
  'order-flow-specialist',
] as const;
