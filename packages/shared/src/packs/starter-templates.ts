import type { PackMetadata } from './types.ts';

export const PERSONAL_OPS_COMMAND_CENTER_PACK = {
  slug: 'personal-ops-command-center',
  metadata: {
    name: 'Personal Ops Command Center',
    description: 'Operator bundle for personal company workflows, agent teams, approvals, and daily review loops.',
    version: '0.1.0',
    category: 'operations',
    owner: 'runner',
    tags: ['personal-ops', 'operator', 'workflows'],
    agents: ['orchestrator'],
    skills: ['workflow-creator', 'automation-creator', 'agent-creator'],
    guardrails: {
      permissionMode: 'ask',
      requiresApprovalFor: ['external-write', 'spend-money', 'send-message', 'publish-content'],
      notes: [
        'Personal ops can be more autonomous than main, but external writes and spend still require approval.',
      ],
    },
    profiles: {
      main: {
        description: 'Safe version for normal RunnerOS users.',
        permissionMode: 'ask',
      },
      'personal-ops': {
        description: 'Michael operator mode for running agent teams and workflows.',
        agents: ['orchestrator'],
        skills: ['workflow-creator', 'automation-creator', 'agent-creator'],
        permissionMode: 'ask',
      },
      'runner-os-core': {
        description: 'Internal RunnerOS build/debug install variant.',
        permissionMode: 'ask',
      },
    },
  } satisfies PackMetadata,
  body: `# Personal Ops Command Center

Use this pack when RunnerOS is acting as a personal operating layer: agent teams,
workflows, approvals, recurring reviews, and domain packs like Ads Ops or Video
Studio.

This starter intentionally activates only core creator/orchestration primitives.
Domain-specific packs should be installed separately.
`,
} as const;

export const LEGACY_STARTER_PACK_SLUGS = [
  PERSONAL_OPS_COMMAND_CENTER_PACK.slug,
] as const;

export const AUTONOMOUS_COMPANY_OS_PACK = {
  slug: 'autonomous-company-os',
  metadata: {
    name: 'Autonomous Company OS',
    description: 'Always-on company operating pack for agent teams, workflows, schedules, approvals, memory, and executive review.',
    version: '0.1.0',
    category: 'operations',
    owner: 'runner',
    tags: ['company-os', 'autonomous-ops', 'agent-teams', 'workflows', 'approvals'],
    agents: [
      'orchestrator',
      'researcher',
      'writer',
      'critic',
      'triager',
      'ads-agent',
      'youtube-research-agent',
      'hypermotion-agent',
      'shopify-agent',
      'update-system-agent',
    ],
    skills: [
      'workflow-creator',
      'automation-creator',
      'agent-creator',
      'content-strategy',
      'customer-research',
      'competitor-profiling',
      'ad-creative',
      'google-ads',
      'ai-seo',
      'lead-magnets',
    ],
    sources: [
      'google-ads',
      'youtube-research',
      'video-studio',
      'shopify',
    ],
    workflows: [
      'daily-company-brief',
      'weekly-growth-review',
      'competitor-watch',
      'campaign-health-check',
      'support-triage',
    ],
    automations: [
      'daily-company-brief',
      'weekly-growth-review',
      'competitor-watch',
      'campaign-health-check',
      'support-triage',
    ],
    guardrails: {
      permissionMode: 'ask',
      requiresApprovalFor: [
        'external-write',
        'send-message',
        'publish-content',
        'launch-campaign',
        'budget-change',
        'spend-money',
        'delete-data',
        'production-change',
      ],
      notes: [
        'This pack is meant to run a company operating loop, not bypass approvals.',
        'Automations are declared for setup/planning but are not auto-enabled by the current pack installer.',
        'Use team memory and workflow receipts as the operating record.',
      ],
    },
    profiles: {
      main: {
        description: 'Safe opt-in company mode for normal Runner users.',
        permissionMode: 'ask',
      },
      'personal-ops': {
        description: 'Higher-context personal company mode with growth, content, commerce, and system-review teams.',
        agents: ['orchestrator', 'ads-agent', 'youtube-research-agent', 'hypermotion-agent', 'shopify-agent'],
        skills: ['marketing-ideas', 'marketing-psychology', 'blue-ocean-strategy'],
        permissionMode: 'ask',
        startupContext: [
          'Company goals, current offers, active channels, approval rules, and open loops.',
          'Daily company brief, weekly growth review, competitor watch, campaign health, and support triage are the first operating loops to configure.',
        ],
      },
      'runner-os-core': {
        description: 'RunnerOS internal install variant for building the autonomous-company runtime itself.',
        agents: ['orchestrator', 'update-system-agent'],
        permissionMode: 'ask',
      },
    },
    runtime: {
      startupContext: [
        'Think in departments: executive ops, growth, content, sales/support, product research, finance/admin, and audit.',
        'Prefer durable workflow runs over one-off chat when work should continue, be reviewed, or be repeated.',
        'Escalate external writes, publishing, account mutation, spend, and production changes to the approval inbox/human.',
      ],
    },
    dependencies: [
      {
        kind: 'external',
        slug: 'company-context',
        required: false,
        note: 'Add company context: goals, offers, products, channels, credentials, KPIs, and approval rules.',
      },
      {
        kind: 'external',
        slug: 'messaging-gateway',
        required: false,
        note: 'Connect messaging gateway channels if you want reports and approvals outside the desktop app.',
      },
      {
        kind: 'external',
        slug: 'ad-platform-oauth',
        required: false,
        note: 'Connect Google/Meta Ads OAuth before reporting or campaign operations.',
      },
    ],
  } satisfies PackMetadata,
  body: `# Autonomous Company OS

Use this pack when RunnerOS should behave like an always-on company operating
system: agent departments, durable workflows, recurring checks, approval gates,
and memory-backed operating rhythm.

## Operating Model

- Executive Ops: Orchestrator owns priorities, delegation, and status synthesis.
- Growth Ops: Ads Agent monitors campaigns and prepares approval-gated changes.
- Content Studio: Researcher, Writer, Critic, YouTube Research, and Hypermotion
  run the content pipeline.
- Commerce Ops: Shopify Agent handles product/store research and draft actions.
- Support/Admin: Triager classifies inbound work and drafts next actions.
- Audit: Update/System Agent checks configuration, drift, and stale setup.

## First Loops To Configure

1. Daily company brief
2. Weekly growth review
3. Competitor watch
4. Campaign health check
5. Support triage

## Operating Cadence Setup

The Orchestrator/HNIC should propose concrete approved automations for the
workspace, for example:

- SchedulerTick at 7am on weekdays -> workflow daily-company-brief
- SchedulerTick weekly -> workflow weekly-growth-review
- FileWatch on an approved inbox folder -> workflow campaign-health-check
- MessageReceive from an approved channel -> workflow support-triage

Use create_automation only after showing the user the full trigger, workflow
target, trigger inputs, and permission mode. Default to permissionMode: ask.

## Safety Contract

The pack is intentionally approval-first. It can plan, draft, inspect, report,
and prepare actions. It should not publish, send, spend, mutate accounts, launch
campaigns, change budgets, delete data, or touch production without explicit
approval.

These guardrails are operating instructions for the installed team. RunnerOS
does not yet turn pack guardrails into workspace permission policy automatically.

## Current Installer Limit

RunnerOS can create real workflow-backed automations through approval-gated
create_automation, but pack install still does not silently enable background
cadence. After installing this pack, the Orchestrator should draft the cadence
and ask before saving it.
`,
} as const;

export const PRINT_ON_DEMAND_COMPANY_OS_PACK = {
  slug: 'print-on-demand-company-os',
  metadata: {
    name: 'Print-On-Demand Company OS',
    description: 'Operate a print-on-demand apparel business from design drops through Printify, Shopify, content, social posting, and growth review.',
    version: '0.1.0',
    category: 'commerce',
    owner: 'runner',
    tags: ['pod', 'print-on-demand', 'printify', 'shopify', 'apparel', 'content', 'social'],
    agents: [
      'pod-ops-orchestrator',
      'pod-intake-agent',
      'pod-product-strategist',
      'pod-catalog-manager',
      'pod-content-director',
      'pod-growth-analyst',
      'print-agent',
      'shopify-agent',
      'social-publisher',
      'hypermotion-agent',
      'ads-agent',
      'researcher',
      'writer',
      'critic',
    ],
    skills: [
      'pod-product-strategy',
      'pod-listing-copy',
      'pod-pricing-margin',
      'pod-content-calendar',
      'pod-growth-review',
      'workflow-creator',
      'automation-creator',
      'customer-research',
      'competitor-profiling',
      'printify-commerce',
      'print-product-assets',
      'shopify-commerce',
      'social-publishing',
      'content-strategy',
      'ad-creative',
      'google-ads',
      'hyperframes',
    ],
    sources: [
      'printify',
      'shopify',
      'printing-press-social',
      'hypermotion',
      'video-studio',
      'google-ads',
      'meta-ads',
    ],
    workflows: [
      'pod-design-intake',
      'pod-product-launch',
      'pod-content-batch',
      'pod-daily-social-publishing',
      'pod-daily-business-review',
      'pod-weekly-growth-review',
    ],
    automations: [
      'pod-design-drop-intake',
      'pod-daily-business-review',
      'pod-content-batch',
      'pod-daily-social-publishing',
      'pod-weekly-growth-review',
    ],
    guardrails: {
      permissionMode: 'ask',
      requiresApprovalFor: [
        'external-write',
        'publish-content',
        'product-create',
        'product-update',
        'price-change',
        'spend-money',
        'delete-data',
      ],
      notes: [
        'Michael remains the design and final aesthetic authority.',
        'Pack install activates the team and workflows but must not silently enable background automations.',
        'Live Printify, Shopify, social, ad, price, delete, and external-write actions require approval.',
      ],
    },
    profiles: {
      main: {
        description: 'Safe POD operator setup for normal RunnerOS users.',
        permissionMode: 'ask',
      },
      'personal-ops': {
        description: 'Michael operator setup for design-drop driven POD business operations.',
        permissionMode: 'ask',
        startupContext: [
          'Default design inbox: ~/RunnerOS-POD/inbox/designs unless the user chooses another folder.',
          'First loop: design drop -> intake -> product strategy -> Printify/Shopify packets -> content batch -> approval.',
          'Daily loops should review launches, content, sales, stuck work, and approval-needed actions.',
        ],
      },
      'runner-os-core': {
        description: 'Internal RunnerOS setup for testing POD pack install, workflow starts, and automation recipes.',
        agents: ['pod-ops-orchestrator'],
        permissionMode: 'ask',
      },
    },
    runtime: {
      startupContext: [
        'Treat this as a modular POD business operating system, not a one-off chat helper.',
        'Prefer workflow receipts and approval packets over loose instructions.',
        'Start with Printify and Shopify. Social publishing is approval-gated. Paid ads are review/planning only until explicitly approved.',
      ],
    },
    dependencies: [
      {
        kind: 'external',
        slug: 'printify-secret',
        required: false,
        note: 'Add PRINTIFY_API_TOKEN in Settings -> Secrets before live Printify work.',
      },
      {
        kind: 'external',
        slug: 'shopify-secret',
        required: false,
        note: 'Add SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN in Settings -> Secrets before live Shopify work.',
      },
      {
        kind: 'external',
        slug: 'social-profile-login',
        required: false,
        note: 'Run social profile readiness checks before approved posting.',
      },
    ],
  } satisfies PackMetadata,
  body: `# Print-On-Demand Company OS

Use this pack when RunnerOS should run a print-on-demand apparel business loop:
design intake, product strategy, Printify planning, Shopify catalog work,
content production, social publishing packets, and growth review.

## V1 Operating Loop

1. A design lands in the watched design inbox.
2. POD Intake Agent inspects the asset and creates a handoff.
3. POD Product Strategist decides product, audience, placement, colors, and price band.
4. POD Catalog Manager coordinates Print Agent and Shopify Agent.
5. POD Content Director creates social hooks, captions, carousels, and video briefs.
6. Social Publisher prepares dry-runs for approved content.
7. POD Growth Analyst reviews daily/weekly progress.

## Automation Setup

Suggested automations are declared by the pack but not enabled on install:

- FileWatch on the approved design inbox -> workflow pod-design-intake
- SchedulerTick weekday morning -> workflow pod-daily-business-review
- SchedulerTick Mon/Wed/Fri -> workflow pod-content-batch
- SchedulerTick weekday late morning -> workflow pod-daily-social-publishing
- SchedulerTick Friday afternoon -> workflow pod-weekly-growth-review

Use create_automation only after showing the full trigger, workflow target,
trigger inputs, and permission mode. Default to permissionMode: ask.

## Safety Contract

The pack can inspect, plan, draft, dry-run, report, and prepare approval
packets. It must not upload artwork, create/update/publish products, post
social content, change prices, spend money, delete data, or mutate external
accounts without explicit approval.
`,
} as const;

export const STARTER_PACKS = [
  PERSONAL_OPS_COMMAND_CENTER_PACK,
  AUTONOMOUS_COMPANY_OS_PACK,
  PRINT_ON_DEMAND_COMPANY_OS_PACK,
] as const;
