// AUTO-GENERATED — do not edit by hand. Run `bun run generate:bundled-skills` to update.
// Source: packages/shared/src/skills/bundled/

import type { StarterSkill } from './starter-templates.ts';

export const BUNDLED_STARTER_SKILLS: StarterSkill[] = [
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
