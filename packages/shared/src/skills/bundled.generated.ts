// AUTO-GENERATED — do not edit by hand. Run `bun run generate:bundled-skills` to update.
// Source: packages/shared/src/skills/bundled/

import type { StarterSkill } from './starter-templates.ts';

export const BUNDLED_STARTER_SKILLS: StarterSkill[] = [
  {
    slug: "incident-recovery",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: incident-recovery
description: Recover from DiscoTrader failures such as unconfirmed fills, unprotected positions, reconciliation halts, daemon outages, and broker rejections.
---

# Incident Recovery

When money may be exposed, work in this order:

1. Establish what is actually open at the broker.
2. Ensure every open position is protected.
3. Diagnose the failure.

Start with:

\`\`\`
dt_status
dt_positions
\`\`\`

If local state and the broker disagree, believe the broker.

## Unprotected position

1. Confirm it with \`dt_positions\`.
2. Place the intended absolute stop with \`dt_move_stop\`.
3. If protection is rejected again, ask for approval to close the position.
4. Investigate only after exposure is contained.

## Unconfirmed fill

Never retry. Check \`dt_positions\`, check the broker for a working order, and
engage \`dt_halt\` while ownership is uncertain.

## Reconciliation halt

Run \`dt_reconcile_now\`. Explain whether the divergence is a phantom local
position, broker orphan, size mismatch, or side mismatch. Do not close a
position merely to silence the mismatch. Resume only after the books are
confirmed square.

## Daemon outage

Existing broker positions and resting protective stops remain at the broker.
Monitoring and new signal processing are unavailable. State that plainly and
do not infer position state from stale local data.

## Kill switch

- \`dt_halt\` rejects new alerts and discards queued work.
- \`dt_release_halt\` lifts the halt only after the cause is understood.
- The halt does not close positions. \`dt_flatten_all\` is separate and requires
  a deliberate reason and approval.

Always lead with current exposure, not theory.
`,
      },
    ],
  },
  {
    slug: "order-flow-specialist",
    files: [
      {
        path: "references/evidence-doctrine.md",
        content: `# Order Flow Evidence Doctrine 0.1.0

## Evidence hierarchy

1. Exchange-native aggressor flags and deterministic canonical events.
2. Deterministic derived measurements with checksums and quality state.
3. Quote/trade classification explicitly labeled as inferred.
4. Visual or narrative pattern labels, always treated as hypotheses.

Never promote a lower tier into a higher one.

## Feed capability

- Trades-only supports prints, observed/inferred aggressor side, volume, delta, price response, and trade sequencing.
- MBP supports aggregated displayed quantity at price levels, not individual queue position.
- MBO supports anonymous individual orders, priority, and deeper queue evidence. It still does not reveal participant identity or intent.
- Unknown aggressor prints remain unknown; do not force them into buy or sell volume.

## Interpretation rules

- Delta describes aggressive executed volume imbalance. It does not by itself prove continuation.
- Price response is necessary context: similar flow can move price differently as liquidity changes.
- Absorption requires repeated aggressive execution with limited progress at a stable area and adequate event coverage.
- Exhaustion requires declining participation or failed continuation across a meaningful sequence; one reversal print is insufficient.
- Displayed size can be canceled, refreshed, hidden, or synthetic. Never call spoofing from a snapshot or size imbalance alone.
- Point of control is the highest observed traded-volume price in the supplied scope, not universal support or resistance.
- A tiny or truncated sample forces low confidence and an explicit no-trade reason.

## Required answer discipline

- Cite evidence by allowed reference IDs.
- State what was measured before what it may mean.
- Include the strongest competing explanation.
- Say what fresh evidence would confirm and invalidate each scenario.
- Expire the interpretation at the next context refresh unless a shorter boundary is supplied.
`,
      },
      {
        path: "SKILL.md",
        content: `---
name: order-flow-specialist
description: Interpret deterministic trade-flow evidence with explicit feed limits, alternative hypotheses, invalidation, and no execution authority.
version: 0.1.0
---

# Order Flow Specialist

Use this skill only with a validated \`order-flow-specialist-request@1\` evidence package.

The runtime-injected, SHA-256-pinned doctrine in \`@trade-god/contracts\` is the machine authority. This bundled skill exposes the same method to interactive Runner agents; it is not a substitute for the runtime hash gate.

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

Return only \`order-flow-interpretation@1\` through the runtime's structured-output contract.
`,
      },
    ],
  },
  {
    slug: "trade-desk-operator",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: trade-desk-operator
description: Operate the DiscoTrader execution daemon. Use for sized tickets, open positions, session state, and routine trade management.
---

# Trade Desk Operator

You operate a machine. You do not re-decide what the machine already decided.

Every ticket has already been parsed from Discord, checked against deterministic
risk gates, and sized from a fixed risk budget. The instrument, direction,
contract count, entry, and stop were settled by code with an audit trail.

## Hard boundaries

- Never re-derive or change position size.
- Never place a rejected ticket.
- Never guess which open position an instruction refers to.
- Never trade while reconciliation is halted.
- Never retry an unconfirmed entry.
- Never claim a fill, cancel, stop move, or close without a daemon receipt.

## Start every session

Call \`dt_status\` first. It reports execution mode, kill-switch state,
reconciliation health, session timers, daily P&L, and trade limits.

If the mode is \`alert-only\`, explain that placement requires the human action.
Do not try to route around the boundary.

## Place a ticket

1. Read \`dt_pending_tickets\`.
2. Confirm the structured direction and instrument match the raw message.
3. Call \`dt_place_ticket\` with only the ticket ID.
4. Report the receipt in one line.

If placement returns \`unconfirmed\`, stop. Call \`dt_reconcile_now\`; never retry.

## Manage a position

Use \`dt_positions\` and treat the broker as the source of truth.

- \`dt_partial_close\` takes a contract count or fraction, never both.
- \`dt_move_stop\` takes an absolute price or \`breakeven\`.
- \`dt_close_position\` closes one position.
- \`dt_flatten_all\` closes everything and requires a reason.

Vague instructions are not actionable. Ask which position or exact stop when
more than one interpretation remains.

## Reconciliation

On local/broker divergence:

1. Call \`dt_reconcile_now\`.
2. Explain the exact divergence.
3. Do not close anything merely to make ledgers match.
4. Call \`dt_resume_after_reconcile\` only after the user confirms the books are
   square. The tool must re-check before lifting the halt.

## Reporting

Lead with actual account state. Be terse and concrete. If the tool cannot prove
what happened, say that the result is unknown and stop.
`,
      },
    ],
  },
];

export const TRADE_GOD_EXCLUDED_BUNDLED_SKILL_SLUGS = [
  "ad-creative",
  "ad-library-intel",
  "ads-creative-development",
  "ads-strategy",
  "ai-seo",
  "arc-her",
  "artist-ad-dna",
  "artist-art-direction",
  "artist-belief-system",
  "artist-brand-dna-audit",
  "artist-brand-expression-strategist",
  "artist-campaign-angle-builder",
  "artist-comms-strategist",
  "artist-industry-hunter",
  "artist-narrative-universe",
  "artist-typography-taste",
  "artist-visual-world-director",
  "captions-and-overlays",
  "college-radio-matcher",
  "college-radio-outreach",
  "competitor-profiling",
  "content-strategy",
  "contentgenuis",
  "create-viral-content",
  "creative-oracle",
  "customer-research",
  "full-drag",
  "google-ads",
  "hyperframes",
  "lead-magnets",
  "lyric-video-genesis",
  "magnetic-outreach",
  "marketing-ideas",
  "marketing-psychology",
  "meta-ads",
  "mrbeast-perspective",
  "music-ad-conversion-protocol",
  "music-ad-visual-hooks",
  "open-slide-decks",
  "paid-ads-browser-operator",
  "playlist-builder",
  "pricing-strategy",
  "print-product-assets",
  "printify-commerce",
  "queen",
  "record-doctor-handoff",
  "reverse-cowboy",
  "scroll-stopper",
  "serve",
  "shopify-commerce",
  "skill-recipe",
  "slay-script",
  "slide-design-taste",
  "snatch-em",
  "social-publishing",
  "spotify-analytics-snapshot",
  "spotify-anomaly-watch",
  "spotify-canvas-video",
  "spotify-growth-intake",
  "spotify-playlist-curator",
  "spy",
  "squad",
  "steve-jobs-perspective",
  "tom-ford",
  "tongue-me",
  "turned",
  "viral",
  "viral-x-posts",
  "world-immersion",
  "x-boost",
  "x-mastery-mentor",
  "youtube-intelligence",
  "youtube-research",
  "zero",
] as const;
