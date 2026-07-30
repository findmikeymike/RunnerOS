/**
 * Starter workflow templates seeded into the global library on first run.
 *
 * Each entry maps to a `WORKFLOW.md` written under `~/.workflows/<slug>/`.
 * Seeding is idempotent: existing files are never overwritten, and tombstoned
 * starters stay deleted (`.deleted-workflows.json`). They are starters, not
 * load-bearing built-ins — `ensureRequiredWorkflows` should NOT include them.
 */

import type { WorkflowMetadata } from './types.ts';

export const WEEKLY_CONTENT_PIPELINE_SLUG = 'weekly-content-pipeline';
export const EMAIL_TRIAGE_SLUG = 'email-triage';
export const CONTENT_MASTERMIND_SLUG = 'content-mastermind';
export const PAID_CAMPAIGN_BUILDER_SLUG = 'paid-campaign-builder';

const weeklyContentPipeline = {
  slug: WEEKLY_CONTENT_PIPELINE_SLUG,
  metadata: {
    name: 'Weekly Content Pipeline',
    description: 'Research a topic, draft a post, critique it, revise, hand off for human approval.',
    avatar: '📝',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'topic',
          type: 'string',
          required: true,
          description: 'What you want to write about (one sentence)',
        },
        { name: 'word_count', type: 'number', default: 600 },
        { name: 'audience', type: 'string', default: 'experienced practitioners' },
      ],
    },
    steps: [
      {
        id: 'research',
        agent: 'researcher',
        input:
          'Research "{{trigger.topic}}". Prefer primary sources. Return:\n' +
          '- 3-sentence TL;DR\n' +
          '- 4-6 key findings, each with a citation\n' +
          '- 2-3 open questions\n' +
          '- Numbered source list\n',
      },
      {
        id: 'draft',
        agent: 'writer',
        input:
          'Write a {{trigger.word_count}}-word blog post for {{trigger.audience}}.\n' +
          'Direct, specific voice. No throat-clearing.\n\n' +
          'Source material:\n' +
          '{{steps.research.output}}\n',
      },
      {
        id: 'critique',
        agent: 'critic',
        input:
          'Review this draft. Honest, not nice. Single highest-leverage change.\n\n' +
          '{{steps.draft.output}}\n',
      },
      {
        id: 'revise',
        agent: 'writer',
        input:
          'Revise the draft based on this critique. Keep the word count close to {{trigger.word_count}}.\n\n' +
          'Original draft:\n' +
          '{{steps.draft.output}}\n\n' +
          'Critique:\n' +
          '{{steps.critique.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Weekly Content Pipeline\n\n' +
    'Run this when you have a half-formed topic and want a clean draft to start from.\n\n' +
    '**Tips:**\n' +
    '- Spend the most prompt budget on the topic — vague topics produce vague research.\n' +
    '- The critique step is intentionally harsh. If the revised draft still feels weak, fork this workflow and tweak the critic\'s prompt to be even more specific.\n',
};

const emailTriage = {
  slug: EMAIL_TRIAGE_SLUG,
  metadata: {
    name: 'Email Triage',
    description: 'Classify an email, decide on next action, optionally draft a reply.',
    avatar: '📥',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'from', type: 'string', required: true },
        { name: 'subject', type: 'string', required: true },
        { name: 'body', type: 'string', required: true },
      ],
    },
    steps: [
      {
        id: 'classify',
        agent: 'triager',
        input:
          'Classify this email. Return:\n' +
          '- urgency: now | today | this week | later | drop\n' +
          '- category: question | sales | newsletter | bug-report | personal | other\n' +
          '- one-line summary\n' +
          '- action: reply | forward | delete | nothing\n\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n\n' +
          'Body:\n' +
          '{{trigger.body}}\n',
      },
      {
        id: 'draft_reply',
        agent: 'writer',
        input:
          'Draft a short, direct reply to this email. Match my voice (clear, no fluff).\n\n' +
          'Triage notes: {{steps.classify.output}}\n\n' +
          'Original:\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n' +
          'Body: {{trigger.body}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Email Triage\n\n' +
    'Pair this with the eventual EmailReceive trigger (Phase 4 + future external trigger from `docs/backlog/future-external-triggers.md`).\n\n' +
    'Until then, paste an email manually to test the routing logic.\n',
};

const contentMastermind = {
  slug: CONTENT_MASTERMIND_SLUG,
  metadata: {
    name: 'Content Mastermind',
    description: 'Three distinct creative engines generate independently, then Content Director selects, fuses, and packages the strongest campaign portfolio.',
    avatar: '🧠',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'campaign_brief',
          type: 'string' as const,
          required: true,
          description: 'Song, release, artist, goal, audience, and relevant context',
        },
        {
          name: 'locked_elements',
          type: 'string' as const,
          default: 'None',
          description: 'Elements that must survive, such as location, chorus, artist appearance, CTA, or asset',
        },
        {
          name: 'production_context',
          type: 'string' as const,
          default: 'One creator, one phone, minimal budget, but preserve one unconstrained Big Swing',
          description: 'Available assets, people, locations, budget, timing, and production capabilities',
        },
      ],
    },
    steps: [
      {
        id: 'native-ideas',
        agent: 'content-genius',
        description: 'Generate human, native, personality-driven concepts.',
        input: `Independently generate 4–6 strong content concepts.

Do not optimize around what another agent may produce. Focus on human truth, personality, native platform behavior, dialogue, performance, participation, and repeatable formats.

Campaign:
{{trigger.campaign_brief}}

Locked elements:
{{trigger.locked_elements}}

Production context:
{{trigger.production_context}}`,
        timeout: 600,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 500 },
      },
      {
        id: 'anticipation-ideas',
        agent: 'anticipation-director',
        description: 'Generate concepts powered by visible inevitability and payoff.',
        input: `Independently generate 4–6 powerful anticipation concepts.

Follow your engine fully. Concepts may have zero thematic relationship to the song when the attention mechanic is stronger. Preserve only the campaign intent and explicitly locked elements. Include at least one fearless concept unconstrained by convenience or budget.

Campaign:
{{trigger.campaign_brief}}

Locked elements:
{{trigger.locked_elements}}

Production context:
{{trigger.production_context}}`,
        timeout: 600,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 500 },
      },
      {
        id: 'absurd-ideas',
        agent: 'scroll-stopper',
        description: 'Generate absurd, polarizing, visually immediate concepts.',
        input: `Independently generate 4–6 absurd, highly retellable video concepts.

Follow the Scroll Stopper engine fully. Do not weaken ideas to force lyrical, thematic, or brand symbolism. Preserve the campaign’s intended presence and explicitly locked elements. Include commanding opening frames and clear payoffs.

Campaign:
{{trigger.campaign_brief}}

Locked elements:
{{trigger.locked_elements}}

Production context:
{{trigger.production_context}}`,
        timeout: 600,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 500 },
      },
      {
        id: 'direct-portfolio',
        agent: 'content-director',
        description: 'Select, fuse, reject, prioritize, and package the final slate.',
        input: `Act as final Content Director. Apply your ruthless audience-first concept, packaging, and retention judgment to this independent idea pool without role-playing another person.

Campaign:
{{trigger.campaign_brief}}

Locked elements:
{{trigger.locked_elements}}

Production context:
{{trigger.production_context}}

CONTENT GENIUS:
{{steps.native-ideas.output}}

ANTICIPATION DIRECTOR:
{{steps.anticipation-ideas.output}}

SCROLL STOPPER:
{{steps.absurd-ideas.output}}

Build one decisive Content Portfolio. Do not score thematic alignment. Campaign intent and locked elements are constraints, not taste points. Preserve one genuinely ambitious Big Swing even if it needs ten people, $300+, a special location, practical effects, or AI/VFX.

Select and fuse by strength—not quotas. Portfolio labels may overlap; never pad the document with weaker ideas just to fill a section.

Deliver:
- Creative verdict
- One Big Swing
- Three flagship ideas
- Strong supporting ideas
- Repeatable formats
- Fast wins
- Strongest legitimate fusions
- Start Now / Build Next / Invest for Impact
- First three to execute
- Rejected or merged ideas with blunt reasons

Produce the complete polished document, not a summary.`,
        timeout: 900,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 1800 },
      },
    ],
    outputs: {
      mode: 'final-step' as const,
      kind: 'document' as const,
      title: 'Campaign Content Mastermind',
      primary: { from: 'step-output' as const, step: 'direct-portfolio' },
    },
  } satisfies WorkflowMetadata,
  body: '# Content Mastermind\n\nRun this when a campaign needs a high-quality creative slate rather than a generic idea list.\n',
};

const paidCampaignBuilder = {
  slug: PAID_CAMPAIGN_BUILDER_SLUG,
  metadata: {
    name: 'Paid Campaign Builder',
    description: 'Turn one artist campaign brief into a coordinated paid-media strategy, creative testing system, and approval-ready execution packet.',
    avatar: '📈',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'campaign_brief',
          type: 'string' as const,
          required: true,
          description: 'Release, campaign goal, timing, audience, offer, and relevant artist context',
        },
        {
          name: 'budget',
          type: 'string' as const,
          required: true,
          description: 'Total budget or working budget range',
        },
        {
          name: 'platforms',
          type: 'string' as const,
          default: 'Recommend the strongest mix',
          description: 'Meta, Google, Spotify, or let the strategist recommend',
        },
        {
          name: 'territories',
          type: 'string' as const,
          default: 'Recommend from available artist intelligence',
          description: 'Target countries, cities, or markets',
        },
        {
          name: 'destination',
          type: 'string' as const,
          default: 'Use the campaign’s primary approved destination',
          description: 'Smart link, pre-save, streaming page, store, video, or landing page',
        },
        {
          name: 'available_assets',
          type: 'string' as const,
          default: 'Use approved Campaign and Vault assets',
          description: 'Existing clips, artwork, performances, photos, copy, or asset limitations',
        },
      ],
    },
    steps: [
      {
        id: 'strategy',
        agent: 'ads-strategist',
        description: 'Build the media strategy, budget allocation, audiences, territories, and testing rules.',
        input: `Build a decisive Ads Strategy Packet for this artist campaign.

Campaign:
{{trigger.campaign_brief}}

Budget:
{{trigger.budget}}

Requested platforms:
{{trigger.platforms}}

Territories:
{{trigger.territories}}

Destination:
{{trigger.destination}}

Available assets:
{{trigger.available_assets}}

Use real Artist HQ, campaign, Spotify, and prior-performance context when available. Clearly label unavailable intelligence instead of fabricating it.

Deliver:
- campaign objective and primary conversion
- platform selection with reasons
- budget allocation and pacing
- audience and territory plan
- campaign/ad-set architecture
- testing matrix
- success, kill, and scale rules
- tracking requirements
- risks and missing inputs
- exact handoff requirements for Ad Creative and Ad Runner`,
        timeout: 600,
        retries: 1,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 900 },
      },
      {
        id: 'creative',
        agent: 'ad-creative-agent',
        description: 'Convert the strategy into platform-native creative concepts, hooks, copy, formats, and tests.',
        input: `Build the Paid Creative Packet from the approved strategic direction.

Campaign:
{{trigger.campaign_brief}}

Available assets:
{{trigger.available_assets}}

ADS STRATEGY PACKET:
{{steps.strategy.output}}

Produce:
- strongest creative thesis
- 3–5 distinct ad concepts
- opening hooks and first-frame direction
- primary copy, headlines, and CTA variants
- platform-specific formats and placements
- asset requirements and production gaps
- testing combinations mapped to the strategy
- concepts to reject and why
- exact handoff fields for Ad Runner

Do not weaken every concept into the same safe brand expression. Preserve distinct creative mechanisms while respecting factual, platform, and policy boundaries.`,
        timeout: 600,
        retries: 1,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 1200 },
      },
      {
        id: 'execution-packet',
        agent: 'ads-agent',
        description: 'Reconcile strategy and creative into one account-ready, approval-gated campaign build plan.',
        input: `Act as final Ad Runner. Compile one execution-ready Paid Campaign Packet.

Campaign:
{{trigger.campaign_brief}}

Budget:
{{trigger.budget}}

Platforms:
{{trigger.platforms}}

Territories:
{{trigger.territories}}

Destination:
{{trigger.destination}}

ADS STRATEGY:
{{steps.strategy.output}}

PAID CREATIVE:
{{steps.creative.output}}

Reconcile contradictions rather than repeating both packets.

Deliver:
- final campaign architecture
- budget and pacing table
- exact audiences, territories, placements, and exclusions
- ad-to-creative mapping
- naming conventions
- destination and tracking checklist
- account/source readiness
- missing assets or blockers
- draft build sequence
- approval packet
- launch checklist
- first reporting checkpoints
- kill, revise, and scale rules

This workflow creates a plan and approval packet only. Inspect connected accounts read-only when useful, but never publish, launch, change budgets, or mutate an external account during this workflow.`,
        timeout: 900,
        retries: 1,
        onFailure: 'stop' as const,
        completion: { requireNonEmptyOutput: true, minOutputChars: 1600 },
      },
    ],
    outputs: {
      mode: 'final-step' as const,
      kind: 'document' as const,
      title: 'Paid Campaign Builder',
      primary: { from: 'step-output' as const, step: 'execution-packet' },
    },
  } satisfies WorkflowMetadata,
  body: `# Paid Campaign Builder

Run this when an artist campaign needs one coordinated paid-media plan instead of disconnected strategy, creative, and account recommendations.

The workflow stops at an approval-ready execution packet. External account changes remain separate and require explicit approval.
`,
};

export const STARTER_WORKFLOWS: ReadonlyArray<{
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}> = [weeklyContentPipeline, emailTriage, contentMastermind, paidCampaignBuilder];

export const STARTER_WORKFLOW_SLUGS: readonly string[] = STARTER_WORKFLOWS.map((w) => w.slug);

/**
 * Starter workflows added after the original first-run seed. Startup ensures
 * these reach existing libraries while honoring deletion tombstones and
 * preserving user-edited copies.
 */
export const ENSURED_STARTER_WORKFLOW_SLUGS = [
  CONTENT_MASTERMIND_SLUG,
  PAID_CAMPAIGN_BUILDER_SLUG,
] as const;
