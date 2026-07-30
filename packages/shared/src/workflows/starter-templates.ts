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
export const INDUSTRY_OUTREACH_PIPELINE_SLUG = 'industry-outreach-pipeline';
export const COLLEGE_RADIO_CAMPAIGN_SLUG = 'college-radio-campaign';
export const MERCH_PRODUCT_BUILDER_SLUG = 'merch-product-builder';

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

const industryOutreachPipeline = {
  slug: INDUSTRY_OUTREACH_PIPELINE_SLUG,
  metadata: {
    name: 'Industry Outreach Pipeline',
    description: 'Find high-fit music-industry targets, then turn the strongest opportunities into verified, personalized, approval-ready outreach.',
    avatar: '🎯',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'campaign_brief',
          type: 'string' as const,
          required: true,
          description: 'Artist, release, sound, related artists, campaign, links, timing, and current objective',
        },
        {
          name: 'outreach_goal',
          type: 'string' as const,
          required: true,
          description: 'The relationship or outcome being pursued',
        },
        {
          name: 'target_lanes',
          type: 'string' as const,
          default: 'A&R, artist development, indie labels, managers, publishers, sync, and credible scene connectors',
          description: 'Target roles or industry categories',
        },
        {
          name: 'markets',
          type: 'string' as const,
          default: 'Recommend from the artist and campaign context',
          description: 'Countries, cities, scenes, or territories',
        },
        {
          name: 'sender_identity',
          type: 'string' as const,
          default: 'Use the approved Artist HQ sender identity',
          description: 'Artist or team member who would send the outreach',
        },
        {
          name: 'target_count',
          type: 'number' as const,
          default: 10,
          description: 'Maximum number of researched targets',
          min: 1,
          max: 25,
          integer: true,
        },
        {
          name: 'draft_count',
          type: 'number' as const,
          default: 3,
          description: 'Maximum number of finalists receiving personalized drafts',
          min: 0,
          max: 10,
          integer: true,
          maxFrom: 'target_count',
        },
        {
          name: 'enrichment_budget',
          type: 'number' as const,
          default: 0,
          description: 'Planning ceiling for a later paid-enrichment approval packet; this workflow spends $0',
          min: 0,
          max: 25,
        },
      ],
    },
    steps: [
      {
        id: 'hunt',
        agent: 'industry-hunter',
        description: 'Research and rank a tight list of evidence-backed industry targets.',
        input: `Build an Industry Hunter Target List for this artist campaign.

Campaign:
{{trigger.campaign_brief}}

Outreach goal:
{{trigger.outreach_goal}}

Target lanes:
{{trigger.target_lanes}}

Markets:
{{trigger.markets}}

Maximum targets:
{{trigger.target_count}}

Use Artist HQ and campaign context before asking for repeated information.

Research real reachable operators—not famous executives by default. Prefer people whose current public work, roster, credits, interviews, projects, or professional activity prove meaningful fit.

For every target include:
- name, role, and organization
- target category
- verified public profile and evidence links
- evidence checked date
- why this person fits this specific artist
- likely outreach angle
- suggested low-friction ask
- reachability
- confidence
- confirmed facts versus inference
- missing information
- explicit Outreach Agent handoff

Do not purchase contact enrichment during this step. Do not invent titles, relationships, profile URLs, emails, quotes, or interests.

Return the research packet directly to the workflow. Do not create a separate Output because the final Outreach Packet will be the workflow’s canonical Output.`,
        timeout: 1200,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          requireToolUse: true,
          minOutputChars: 1400,
          maxAgentMessages: 0,
        },
      },
      {
        id: 'outreach-packet',
        agent: 'outreach-agent',
        description: 'Select the strongest opportunities and create deeply personalized outreach drafts.',
        input: `Act as the final Outreach Director for this campaign.

Campaign:
{{trigger.campaign_brief}}

Outreach goal:
{{trigger.outreach_goal}}

Sender:
{{trigger.sender_identity}}

Maximum personalized finalists:
{{trigger.draft_count}}

Later paid contact-enrichment planning ceiling:
\${{trigger.enrichment_budget}}

INDUSTRY HUNTER TARGET LIST:
{{steps.hunt.output}}

Select only the strongest legitimate opportunities. Do not draft for weak targets merely to fill the requested count.

Recheck important public facts and source freshness for each finalist. Do not repeat the entire broad hunt.

Do not perform paid lookup in this workflow. A positive ceiling is planning context, not spending approval. When paid enrichment could materially improve a finalist, include an exact later approval packet whose aggregate maximum cannot exceed the stated ceiling. Never guess an email.

Produce one polished Industry Outreach Packet containing:
- campaign and artist fit snapshot
- executive recommendation
- selected finalists and blunt selection reasons
- targets rejected or deferred and why
- confirmed recipient/profile/contact information
- confidence and unresolved caveats
- specific public research supporting each angle
- one recommended outreach angle per finalist
- two subject options
- one concise personalized email draft
- exact low-friction ask
- one follow-up draft and timing recommendation
- sender/account requirements
- links or assets to include
- Ready Now / Verify First / Do Not Contact status
- final approval checklist

If Gmail is connected, create one private Gmail draft for each Ready Now finalist using the exact sender, recipient, subject, body, links, and attachments from the packet. Draft creation is private and reversible, so it does not require approval. If Gmail is unavailable, preserve the complete draft in the packet and state "Gmail drafts skipped — not connected."

Never send a message. Sending remains a separate public action requiring current-turn approval for the exact draft and sender.

Do not fabricate familiarity, praise, referrals, relationships, quotes, contact information, or personal interests.`,
        timeout: 900,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          requireToolUse: true,
          minOutputChars: 1800,
          maxAgentMessages: 0,
        },
      },
    ],
    outputs: {
      mode: 'final-step' as const,
      kind: 'document' as const,
      title: 'Industry Outreach Pipeline',
      primary: { from: 'step-output' as const, step: 'outreach-packet' },
    },
  } satisfies WorkflowMetadata,
  body: `# Industry Outreach Pipeline

Run this when an artist needs a small number of genuinely relevant industry relationships—not a scraped bulk prospect list.

The workflow researches broadly, personalizes selectively, and stops at an approval-ready outreach packet. It never sends messages automatically.
`,
};

const collegeRadioCampaign = {
  slug: COLLEGE_RADIO_CAMPAIGN_SLUG,
  metadata: {
    name: 'College Radio Campaign',
    description: 'Verify college and noncommercial radio targets, then turn the strongest eligible stations into approval-ready outreach and submission queues.',
    avatar: '📻',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'release_brief',
          type: 'string' as const,
          required: true,
          description: 'Artist, release, date, genre, story, links, and campaign context',
        },
        {
          name: 'sound_alikes',
          type: 'string' as const,
          required: true,
          description: 'Two to five honest comparable artists',
        },
        {
          name: 'clean_status',
          type: 'string' as const,
          required: true,
          description: 'Clean, explicit, or clean edit available',
        },
        {
          name: 'markets',
          type: 'string' as const,
          default: 'Prioritize hometown, tour markets, and strongest artist-fit regions',
          description: 'Geographic priorities',
        },
        {
          name: 'station_count',
          type: 'number' as const,
          default: 12,
          description: 'Maximum verified targets',
          min: 1,
          max: 50,
          integer: true,
        },
        {
          name: 'email_draft_count',
          type: 'number' as const,
          default: 5,
          description: 'Maximum personalized email drafts',
          min: 0,
          max: 20,
          integer: true,
          maxFrom: 'station_count',
        },
        {
          name: 'sender_identity',
          type: 'string' as const,
          default: 'Use the approved Artist HQ sender identity',
          description: 'Artist or team member who would send the outreach',
        },
        {
          name: 'include_physical',
          type: 'boolean' as const,
          default: false,
          description: 'Include stations currently requiring physical submissions',
        },
      ],
    },
    steps: [
      {
        id: 'verify-stations',
        agent: 'college-radio-agent',
        description: 'Verify current stations, shows, contacts, and submission rules.',
        input: `Build a current, verified College Radio Target List for this release.

Release:
{{trigger.release_brief}}

Honest sound-alikes:
{{trigger.sound_alikes}}

Clean status:
{{trigger.clean_status}}

Market priorities:
{{trigger.markets}}

Maximum verified targets:
{{trigger.station_count}}

Use Artist HQ and campaign context before asking for repeated information.

Treat bundled station directories only as research leads. Verify every target against current public sources before recommending it.

For every station or show include:
- station, show, host or music director when publicly confirmed
- current evidence URL and date checked
- format and artist-fit reasoning
- current submission method: email, form, upload, or physical
- confirmed public contact or submission URL
- attachment, file-format, clean-edit, and release-date rules
- eligibility or geographic restrictions
- recommended angle
- confidence and missing information
- Ready / Verify First / Not Eligible status

Reject directory-only records as unverified. Never invent contacts, submission rules, airplay claims, or relationships.

Do not send email, submit forms, upload music, or mail packages.

Do not call create_output or message_agent in this workflow. Return the complete packet directly to the workflow. Outreach runs exactly once as the next step and creates the canonical final Output.`,
        timeout: 1200,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          requireToolUse: true,
          minOutputChars: 1600,
          maxAgentMessages: 0,
        },
      },
      {
        id: 'campaign-packet',
        agent: 'outreach-agent',
        description: 'Turn verified stations into a focused, approval-ready campaign.',
        input: `Act as the final College Radio Campaign Director.

Release:
{{trigger.release_brief}}

Sender:
{{trigger.sender_identity}}

Maximum email drafts:
{{trigger.email_draft_count}}

Include physical-submission targets:
{{trigger.include_physical}}

VERIFIED COLLEGE RADIO TARGET LIST:
{{steps.verify-stations.output}}

Use the verified research packet as source truth. Do not repeat the broad station search unless information is missing, stale, or contradictory.

Select only genuinely eligible, high-fit targets. Do not fill quotas with weak stations.

Create email drafts only for targets with a verified email submission method. Route forms and uploads into manual submission queues. Include physical targets only when explicitly enabled.

Produce one polished College Radio Campaign containing:
- release and radio-fit snapshot
- ranked verified targets with blunt selection reasons
- email-ready targets with To, Subject, Body, links, and attachments
- form and upload submission field plans
- physical mailing queue when enabled
- one-sheet, clean-edit, metadata, and asset gaps
- recommended submission and follow-up dates
- excluded or deferred targets and reasons
- Ready Now / Verify First / Not Eligible status
- exact approval checklist

If Gmail is connected, create one private Gmail draft for each email-ready target. Draft creation is private and reversible, so it does not require approval. If Gmail is unavailable, preserve the complete drafts in the campaign packet and state "Gmail drafts skipped — not connected."

Never send messages, submit forms, upload files, or claim delivery. Those public actions remain separate and require exact approval.`,
        timeout: 900,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          minOutputChars: 1800,
          maxAgentMessages: 0,
        },
      },
    ],
    outputs: {
      mode: 'final-step' as const,
      kind: 'document' as const,
      title: 'College Radio Campaign',
      primary: { from: 'step-output' as const, step: 'campaign-packet' },
    },
  } satisfies WorkflowMetadata,
  body: `# College Radio Campaign

Run when an artist needs current-rule-aware college and noncommercial radio outreach.

The workflow verifies first, drafts selectively, and stops before delivery.
`,
};

const merchProductBuilder = {
  slug: MERCH_PRODUCT_BUILDER_SLUG,
  metadata: {
    name: 'Merch Product Builder',
    description: 'Turn uploaded artwork into one production-ready Printify product, optional lifestyle mockup direction, Shopify storefront guidance when connected, and an approval-gated Merch Launch Kit.',
    avatar: '👕',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'artwork',
          type: 'string' as const,
          required: true,
          description: 'Uploaded artwork, file paths, folder, or existing Output',
        },
        {
          name: 'product_goal',
          type: 'string' as const,
          required: true,
          description: 'Product idea, audience, campaign purpose, and launch context',
        },
        {
          name: 'product_preferences',
          type: 'string' as const,
          default: 'Choose the strongest single product and avoid catalog sprawl',
          description: 'Garment, placement, colors, sizes, or provider preferences',
        },
        {
          name: 'target_market',
          type: 'string' as const,
          default: 'Use Artist HQ and campaign context',
          description: 'Primary country or fulfillment region',
        },
        {
          name: 'mockup_request',
          type: 'boolean' as const,
          default: false,
          description: 'Request an artist-wearing-the-product lifestyle concept',
        },
        {
          name: 'artist_reference',
          type: 'string' as const,
          default: 'Use an approved Artist Vault face reference when available',
          description: 'Approved artist reference image or Vault asset',
        },
        {
          name: 'generation_budget',
          type: 'number' as const,
          default: 0,
          description: 'Planning ceiling for a later image-generation approval packet; this workflow spends $0',
          min: 0,
          max: 100,
        },
        {
          name: 'sample_first',
          type: 'boolean' as const,
          default: true,
          description: 'Require sample or physical QA before recommending publication',
        },
      ],
    },
    steps: [
      {
        id: 'build-kit',
        agent: 'print-agent',
        description: 'Lead the complete product build and conditionally delegate visual or Shopify work only when needed.',
        input: `Act as lead Merch Product Builder and final director.

Artwork:
{{trigger.artwork}}

Product goal:
{{trigger.product_goal}}

Product preferences:
{{trigger.product_preferences}}

Target market:
{{trigger.target_market}}

Lifestyle mockup requested:
{{trigger.mockup_request}}

Approved artist reference:
{{trigger.artist_reference}}

Later image-generation planning ceiling:
\${{trigger.generation_budget}}

Sample-first:
{{trigger.sample_first}}

Use Artist HQ, campaign, branding, voice, visual-world, release, and Vault context before asking for repeated information.

ARTWORK AND PRODUCT INTAKE
- Inspect the real supplied files.
- Separate production artwork from screenshots, notes, references, and existing mockups.
- Flag resolution, transparency, crop, contrast, edge safety, text, background, aspect-ratio, and possible rights concerns.
- Never silently upscale, stretch, remove a background, rewrite artwork, or alter the design.
- Choose one strongest product unless the user explicitly requested more.

PRINTIFY RESEARCH
- Run Printify doctor and inspect the actual connected shop.
- Use current catalog, provider, variant, shipping, placement, and cost data.
- Select the blueprint, provider, garment, print area, colors, and sizes based on quality, availability, target market, economics, and artwork compatibility.
- Preserve aspect ratio and use real product-template constraints.
- Produce a placement matrix and exact product manifest.
- Treat Printify as the fulfillment/product source of truth.

PRIVATE PRINTIFY DRAFT BUILD
- If the accepted artwork is production-ready, upload it with \`uploads an-image ... --private-draft --agent\`.
- Create exactly one unpublished Printify product with \`shops products-json create-anew-product ... --private-draft --agent\`.
- Do not use \`--confirm-runner\`; this workflow is authorized only for the bounded private upload and unpublished draft.
- Capture the returned upload ID, product ID, unpublished status, and official Printify mockup URLs.
- Save official mockup image files into session data when the source provides downloadable URLs. Otherwise preserve the official URLs and state the download gap.
- If the artwork is not production-ready, do not upload or create a product. Return Needs Artwork Fix with the exact blocker.

OPTIONAL ART DIRECTOR DELEGATION
Contact Art Director exactly once only when:
- lifestyle mockup requested is true; or
- the supplied artwork needs creative repair or product-specific adaptation that Print Agent cannot safely perform.

Give Art Director the selected real product specification, accepted artwork, exact problem, approved reference, and planning ceiling.

Never create a real-person likeness from text alone. Use only the approved reference with a reference-capable tool. If no usable reference exists, return a non-likeness alternative.

Do not generate or purchase imagery in this workflow. A positive ceiling is planning context, not spending approval. Art Director must return the strongest mockup direction, a reference-safe prompt, the exact tool/model plan, and a later approval packet capped by that ceiling. A future generated lifestyle image must be labeled promotional concept art, not exact product proof; official Printify mockups remain the accuracy reference.

CONDITIONAL SHOPIFY DELEGATION
Run Shopify doctor as a read-only connection check.

If Shopify validates successfully, contact Shopify Agent exactly once. Give it the finalized Printify product plan and ask it to:
- inspect existing products, collections, storefront patterns, and likely duplicates read-only
- determine whether the Printify shop is intended to sync to this Shopify store
- recommend collection placement, title, Shopify HTML description, SEO title, meta description, tags, alt text, and media order
- produce a post-Printify-sync DRAFT update plan
- make no Shopify changes

If Shopify does not validate, do not contact Shopify Agent. Record: "Shopify skipped — not connected."

Never create a second Shopify product when Printify will sync the fulfillment-backed product. Shopify work follows the Printify draft/sync.

ECONOMICS AND LISTING
- Show real product costs and known shipping.
- Clearly label unknown fees and return assumptions.
- Calculate price floor, conservative launch price, stretch price, gross margin, fulfillment-adjusted contribution, and discount room.
- Flag products whose economics do not support likely acquisition costs.
- Write buyer-facing listing copy without invented quality, scarcity, delivery, sustainability, or product claims.

FINAL MERCH LAUNCH KIT
Produce one decisive document containing:
- executive recommendation
- accepted and rejected asset inventory
- one selected product and why it won
- exact shop, blueprint, provider, variants, colors, and sizes
- print placement matrix and production warnings
- print-ready or revision-needed asset paths
- private Printify upload and unpublished product receipts, including IDs
- official Printify mockup files or source URLs
- optional lifestyle mockup direction and exact later-generation approval packet
- product cost and margin waterfall
- recommended pricing and discount room
- title options and recommended title
- short description and clean Shopify HTML description
- SEO title, meta description, tags, collections, and alt text
- recommended storefront media order
- Shopify Connected / Shopify Skipped status
- duplicate-product and sync warnings
- sample-order and physical-QA recommendation
- exact approval packet only for later publish, sync, sample order, spend, or another consequential action
- later Shopify draft-update plan when connected
- Ready Now / Needs Artwork Fix / Needs Approval / Blocked status
- exact next approval

The private artwork upload and one unpublished Printify product draft are the only allowed writes. Do not order a sample, sync, publish, update Shopify, delete anything, spend money, or perform another external write.

Return the complete Merch Launch Kit directly to the workflow. Do not create a duplicate document Output.`,
        timeout: 1800,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          requireToolUse: true,
          minOutputChars: 2200,
          maxAgentMessages: 2,
        },
      },
    ],
    outputs: {
      mode: 'final-step' as const,
      kind: 'document' as const,
      title: 'Merch Launch Kit',
      primary: { from: 'step-output' as const, step: 'build-kit' },
    },
  } satisfies WorkflowMetadata,
  body: `# Merch Product Builder

Run this when campaign artwork should become one serious, production-ready merch product rather than a bloated print-on-demand catalog.

Print Agent leads one run, Art Director joins only when visual work is needed, and Shopify Agent joins only when a real Shopify connection validates.

The workflow may upload accepted artwork and create one private unpublished Printify draft automatically. It stops for approval before spending, ordering, syncing, publishing, deleting, or any other public or consequential action.
`,
};

export const STARTER_WORKFLOWS: ReadonlyArray<{
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}> = [
  weeklyContentPipeline,
  emailTriage,
  contentMastermind,
  paidCampaignBuilder,
  industryOutreachPipeline,
  collegeRadioCampaign,
  merchProductBuilder,
];

export const STARTER_WORKFLOW_SLUGS: readonly string[] = STARTER_WORKFLOWS.map((w) => w.slug);

/**
 * Starter workflows added after the original first-run seed. Startup ensures
 * these reach existing libraries while honoring deletion tombstones and
 * preserving user-edited copies.
 */
export const ENSURED_STARTER_WORKFLOW_SLUGS = [
  CONTENT_MASTERMIND_SLUG,
  PAID_CAMPAIGN_BUILDER_SLUG,
  INDUSTRY_OUTREACH_PIPELINE_SLUG,
  COLLEGE_RADIO_CAMPAIGN_SLUG,
  MERCH_PRODUCT_BUILDER_SLUG,
] as const;

/** Automatically active in new Artist HQ workspaces. */
export const HQ_DEFAULT_WORKFLOW_SLUGS = STARTER_WORKFLOW_SLUGS.filter(
  (slug) => slug !== COLLEGE_RADIO_CAMPAIGN_SLUG && slug !== MERCH_PRODUCT_BUILDER_SLUG,
);

/** Automatically active in new Campaign workspaces. */
export const CAMPAIGN_DEFAULT_WORKFLOW_SLUGS = STARTER_WORKFLOW_SLUGS;
