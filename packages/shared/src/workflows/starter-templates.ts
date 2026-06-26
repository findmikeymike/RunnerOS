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
export const LEGACY_STARTER_WORKFLOW_SLUGS = [
  WEEKLY_CONTENT_PIPELINE_SLUG,
  EMAIL_TRIAGE_SLUG,
] as const;
export const DAILY_COMPANY_BRIEF_SLUG = 'daily-company-brief';
export const WEEKLY_GROWTH_REVIEW_SLUG = 'weekly-growth-review';
export const COMPETITOR_WATCH_SLUG = 'competitor-watch';
export const CAMPAIGN_HEALTH_CHECK_SLUG = 'campaign-health-check';
export const SUPPORT_TRIAGE_SLUG = 'support-triage';
export const POD_DESIGN_INTAKE_SLUG = 'pod-design-intake';
export const POD_PRODUCT_LAUNCH_SLUG = 'pod-product-launch';
export const POD_CONTENT_BATCH_SLUG = 'pod-content-batch';
export const POD_DAILY_SOCIAL_PUBLISHING_SLUG = 'pod-daily-social-publishing';
export const POD_DAILY_BUSINESS_REVIEW_SLUG = 'pod-daily-business-review';
export const POD_WEEKLY_GROWTH_REVIEW_SLUG = 'pod-weekly-growth-review';

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
        id: 'draft-reply',
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
    'Pair this with the eventual EmailReceive trigger (Phase 4 + future external trigger from `docs/future-external-triggers.md`).\n\n' +
    'Until then, paste an email manually to test the routing logic.\n',
};

const dailyCompanyBrief = {
  slug: DAILY_COMPANY_BRIEF_SLUG,
  metadata: {
    name: 'Daily Company Brief',
    description: 'Summarize priorities, open loops, risks, and recommended agent work for the day.',
    avatar: '📋',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'company_context', type: 'string', required: true, description: 'Current company state, goals, KPIs, and open loops.' },
        { name: 'time_horizon', type: 'string', default: 'today' },
      ],
    },
    steps: [
      {
        id: 'triage',
        agent: 'triager',
        input:
          'Triage this company context for {{trigger.time_horizon}}. Return:\n' +
          '- top 5 open loops\n' +
          '- blockers needing human decision\n' +
          '- urgent risks\n' +
          '- items safe for agents to continue\n\n' +
          '{{trigger.company_context}}\n',
      },
      {
        id: 'plan',
        agent: 'orchestrator',
        input:
          'Turn this triage into a daily operating plan. Assign each item to a department/agent, mark approval needs, and keep it concise.\n\n' +
          '{{steps.triage.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Daily Company Brief\n\n' +
    'Use this as the first daily operating loop. Paste current business context until workspace memory and integrations can supply it automatically.\n',
};

const weeklyGrowthReview = {
  slug: WEEKLY_GROWTH_REVIEW_SLUG,
  metadata: {
    name: 'Weekly Growth Review',
    description: 'Review growth signals, content, ads, channel traction, and next experiments.',
    avatar: '📈',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'growth_data', type: 'string', required: true, description: 'Metrics, channel notes, campaign data, content results, and sales/support signals.' },
        { name: 'goal', type: 'string', default: 'increase qualified demand' },
      ],
    },
    steps: [
      {
        id: 'diagnose',
        agent: 'ads-agent',
        input:
          'Review this growth data against the goal "{{trigger.goal}}". Identify what is working, what is wasting effort, and what needs approval before changing.\n\n' +
          '{{trigger.growth_data}}\n',
      },
      {
        id: 'content-opportunities',
        agent: 'researcher',
        input:
          'Extract content, offer, and audience opportunities from this growth review. Return 5 concrete tests.\n\n' +
          '{{steps.diagnose.output}}\n',
      },
      {
        id: 'executive-plan',
        agent: 'orchestrator',
        input:
          'Create a weekly growth plan with owners, expected impact, risk, and approval gates.\n\n' +
          'Growth diagnosis:\n{{steps.diagnose.output}}\n\n' +
          'Opportunities:\n{{steps.content-opportunities.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Weekly Growth Review\n\n' +
    'Use this as the weekly executive loop for ads, content, offers, and demand generation. Live ad mutations still require explicit approval.\n',
};

const competitorWatch = {
  slug: COMPETITOR_WATCH_SLUG,
  metadata: {
    name: 'Competitor Watch',
    description: 'Track competitor positioning, offers, content, ads, product moves, and implications.',
    avatar: '👀',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'competitors', type: 'string', required: true, description: 'Competitor names, URLs, or notes.' },
        { name: 'focus', type: 'string', default: 'positioning, offers, content, ads, product changes' },
      ],
    },
    steps: [
      {
        id: 'research',
        agent: 'researcher',
        input:
          'Research these competitors with focus on {{trigger.focus}}. Prefer current public sources and cite them.\n\n' +
          '{{trigger.competitors}}\n',
      },
      {
        id: 'implications',
        agent: 'critic',
        input:
          'Analyze this competitor research. Return threats, openings, false alarms, and recommended responses.\n\n' +
          '{{steps.research.output}}\n',
      },
      {
        id: 'brief',
        agent: 'writer',
        input:
          'Write a concise competitor watch brief for an operator. Include actions and what not to overreact to.\n\n' +
          '{{steps.implications.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Competitor Watch\n\n' +
    'Use for weekly or ad-hoc market scans. Pair with automations only after source permissions and review rules are configured.\n',
};

const campaignHealthCheck = {
  slug: CAMPAIGN_HEALTH_CHECK_SLUG,
  metadata: {
    name: 'Campaign Health Check',
    description: 'Inspect paid campaign performance and prepare approval-gated recommendations.',
    avatar: '💸',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'campaign_data', type: 'string', required: true, description: 'Google/Meta campaign metrics, spend, CPA, ROAS, notes, or pasted report.' },
        { name: 'budget_guardrail', type: 'string', default: 'do not increase spend without approval' },
      ],
    },
    steps: [
      {
        id: 'health',
        agent: 'ads-agent',
        input:
          'Analyze this campaign data. Flag waste, winners, broken tracking, creative fatigue, budget risks, and exact changes requiring approval.\n\n' +
          'Budget guardrail: {{trigger.budget_guardrail}}\n\n' +
          '{{trigger.campaign_data}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review these campaign recommendations for overreach, weak evidence, and unsafe actions. Be strict.\n\n' +
          '{{steps.health.output}}\n',
      },
      {
        id: 'approval-brief',
        agent: 'writer',
        input:
          'Create an approval brief: keep/kill/change, expected upside, downside risk, and exact user approval needed.\n\n' +
          'Recommendations:\n{{steps.health.output}}\n\nReview:\n{{steps.review.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Campaign Health Check\n\n' +
    'This workflow prepares campaign decisions. It must not launch campaigns, change budgets, or mutate ad accounts without explicit approval.\n',
};

const supportTriage = {
  slug: SUPPORT_TRIAGE_SLUG,
  metadata: {
    name: 'Support Triage',
    description: 'Classify inbound support/customer messages and draft safe next actions.',
    avatar: '🎧',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'messages', type: 'string', required: true, description: 'Support tickets, emails, DMs, reviews, or call notes.' },
        { name: 'tone', type: 'string', default: 'clear, helpful, concise' },
      ],
    },
    steps: [
      {
        id: 'classify',
        agent: 'triager',
        input:
          'Classify these inbound customer/support messages. Return severity, category, owner, SLA, and recommended next action.\n\n' +
          '{{trigger.messages}}\n',
      },
      {
        id: 'draft',
        agent: 'writer',
        input:
          'Draft replies or internal handoff notes in this tone: {{trigger.tone}}.\n\n' +
          'Triage:\n{{steps.classify.output}}\n\nOriginal messages:\n{{trigger.messages}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review the drafts for risk, bad promises, missing context, and places where a human must approve before sending.\n\n' +
          '{{steps.draft.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Support Triage\n\n' +
    'Use this for inbound customer work. It drafts and routes; it does not send messages unless a publishing/sending automation is separately approved.\n',
};

const podDesignIntake = {
  slug: POD_DESIGN_INTAKE_SLUG,
  metadata: {
    name: 'POD Design Intake',
    description: 'Inspect a dropped design file or folder and turn it into a product-ready intake report.',
    avatar: 'P',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'asset_path', type: 'string', required: true, description: 'Design file or folder path.' },
        { name: 'designer_notes', type: 'string', default: '' },
        { name: 'target_collection', type: 'string', default: '' },
      ],
    },
    steps: [
      {
        id: 'inspect',
        agent: 'pod-intake-agent',
        input:
          'Inspect this POD design input. Do not upload or mutate external systems.\n\n' +
          'Asset path: {{trigger.asset_path}}\n' +
          'Designer notes: {{trigger.designer_notes}}\n' +
          'Target collection: {{trigger.target_collection}}\n\n' +
          'Return file inventory, usable assets, rejected/unclear assets, print-readiness risks, and a structured handoff.\n',
      },
      {
        id: 'brief',
        agent: 'pod-product-strategist',
        input:
          'Turn this intake into a sellable POD product brief. Be willing to hold weak products.\n\n' +
          '{{steps.inspect.output}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review this POD product brief for weak audience, weak offer, print risks, or missing approval gates.\n\n' +
          '{{steps.brief.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Design Intake\n\n' +
    'Use this when a design lands in the POD inbox. It produces a safe product brief; it does not upload or publish anything.\n',
};

const podProductLaunch = {
  slug: POD_PRODUCT_LAUNCH_SLUG,
  metadata: {
    name: 'POD Product Launch',
    description: 'Prepare Printify and Shopify launch packets from an approved POD product brief.',
    avatar: 'L',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'product_brief', type: 'string', required: true },
        { name: 'asset_path', type: 'string', required: true },
        { name: 'printify_shop', type: 'string', default: '' },
        { name: 'shopify_collection', type: 'string', default: '' },
      ],
    },
    steps: [
      {
        id: 'manifest',
        agent: 'pod-catalog-manager',
        input:
          'Create a POD launch manifest. Keep all writes approval-gated.\n\n' +
          'Product brief:\n{{trigger.product_brief}}\n\n' +
          'Asset path: {{trigger.asset_path}}\n' +
          'Printify shop: {{trigger.printify_shop}}\n' +
          'Shopify collection: {{trigger.shopify_collection}}\n',
      },
      {
        id: 'printify-packet',
        agent: 'print-agent',
        input:
          'Prepare a Printify dry-run/action packet from this launch manifest. Do not execute live writes.\n\n' +
          '{{steps.manifest.output}}\n',
      },
      {
        id: 'shopify-packet',
        agent: 'shopify-agent',
        input:
          'Prepare a Shopify draft/action packet from this launch manifest. Do not execute live writes.\n\n' +
          '{{steps.manifest.output}}\n\nPrintify packet:\n{{steps.printify-packet.output}}\n',
      },
      {
        id: 'copy',
        agent: 'writer',
        input:
          'Draft Shopify-ready listing copy and social-ready copy for this POD product.\n\n' +
          'Manifest:\n{{steps.manifest.output}}\n\nShopify packet:\n{{steps.shopify-packet.output}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review this launch packet. Identify missing approval gates, weak copy, pricing concerns, and launch risks.\n\n' +
          'Manifest:\n{{steps.manifest.output}}\n\nPrintify:\n{{steps.printify-packet.output}}\n\nShopify:\n{{steps.shopify-packet.output}}\n\nCopy:\n{{steps.copy.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Product Launch\n\n' +
    'Use this after product strategy is approved. It prepares Printify and Shopify action packets; live writes still require approval.\n',
};

const podContentBatch = {
  slug: POD_CONTENT_BATCH_SLUG,
  metadata: {
    name: 'POD Content Batch',
    description: 'Turn POD products into hooks, captions, carousel outlines, and video briefs.',
    avatar: 'B',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'product_context', type: 'string', required: true },
        { name: 'content_goal', type: 'string', default: 'organic product discovery' },
        { name: 'platforms', type: 'string', default: 'instagram,tiktok,x,youtube' },
      ],
    },
    steps: [
      {
        id: 'angles',
        agent: 'pod-content-director',
        input:
          'Create a POD content batch. Do not publish or schedule anything.\n\n' +
          'Product context:\n{{trigger.product_context}}\n\n' +
          'Goal: {{trigger.content_goal}}\n' +
          'Platforms: {{trigger.platforms}}\n',
      },
      {
        id: 'captions',
        agent: 'writer',
        input:
          'Draft captions, carousel copy, and short-form hooks from this content direction.\n\n' +
          '{{steps.angles.output}}\n',
      },
      {
        id: 'video-brief',
        agent: 'hypermotion-agent',
        input:
          'Draft a short-form video or motion creative brief for the strongest POD angles. Do not render or publish anything.\n\n' +
          'Angles:\n{{steps.angles.output}}\n\nCaptions:\n{{steps.captions.output}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review this POD content batch for weak hooks, spam risk, bad claims, and missing assets.\n\n' +
          'Angles:\n{{steps.angles.output}}\n\nCaptions:\n{{steps.captions.output}}\n\nVideo brief:\n{{steps.video-brief.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Content Batch\n\n' +
    'Use this to create organic content around products. It creates drafts and briefs, not live posts.\n',
};

const podDailySocialPublishing = {
  slug: POD_DAILY_SOCIAL_PUBLISHING_SLUG,
  metadata: {
    name: 'POD Daily Social Publishing',
    description: 'Prepare today\'s approved POD social posts for platform dry-runs and approval.',
    avatar: 'S',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'approved_content_batch', type: 'string', required: true },
        { name: 'platforms', type: 'string', default: 'instagram,tiktok,x,youtube' },
      ],
    },
    steps: [
      {
        id: 'select',
        agent: 'pod-content-director',
        input:
          'Select today\'s POD posts from this approved content batch. Return exact platform, copy, media needs, and product URLs.\n\n' +
          '{{trigger.approved_content_batch}}\n\nPlatforms: {{trigger.platforms}}\n',
      },
      {
        id: 'dry-run',
        agent: 'social-publisher',
        input:
          'Prepare dry-run publishing plans for these POD posts. Do not publish, schedule, comment, DM, upload, or submit final actions without approval.\n\n' +
          '{{steps.select.output}}\n',
      },
      {
        id: 'review',
        agent: 'critic',
        input:
          'Review the social dry-run packet for live-action risk, wrong platform fit, missing media, or unclear approval.\n\n' +
          '{{steps.dry-run.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Daily Social Publishing\n\n' +
    'Use this for approved social content. It prepares posting dry-runs and approval packets before any live action.\n',
};

const podDailyBusinessReview = {
  slug: POD_DAILY_BUSINESS_REVIEW_SLUG,
  metadata: {
    name: 'POD Daily Business Review',
    description: 'Summarize daily POD sales, launches, content output, stuck work, and next actions.',
    avatar: 'R',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'sales_notes', type: 'string', default: '' },
        { name: 'listing_notes', type: 'string', default: '' },
        { name: 'content_notes', type: 'string', default: '' },
      ],
    },
    steps: [
      {
        id: 'review',
        agent: 'pod-growth-analyst',
        input:
          'Create a POD daily business brief. Stay read-only.\n\n' +
          'Sales notes:\n{{trigger.sales_notes}}\n\nListing notes:\n{{trigger.listing_notes}}\n\nContent notes:\n{{trigger.content_notes}}\n',
      },
      {
        id: 'paid-signal',
        agent: 'ads-agent',
        input:
          'Do a read-only paid-signal review for this POD daily brief when connected ad accounts or pasted ad notes are available. Do not change budgets, campaigns, audiences, ads, or tracking.\n\n' +
          '{{steps.review.output}}\n',
      },
      {
        id: 'route',
        agent: 'pod-ops-orchestrator',
        input:
          'Turn this daily business brief into next actions, owners, and approval-needed items.\n\n' +
          'Business brief:\n{{steps.review.output}}\n\nPaid signal:\n{{steps.paid-signal.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Daily Business Review\n\n' +
    'Use this each weekday to keep the POD business moving without inventing fake progress.\n',
};

const podWeeklyGrowthReview = {
  slug: POD_WEEKLY_GROWTH_REVIEW_SLUG,
  metadata: {
    name: 'POD Weekly Growth Review',
    description: 'Find POD winners, losers, content lessons, product expansion ideas, and next-week priorities.',
    avatar: 'W',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'week_context', type: 'string', required: true },
        { name: 'goals', type: 'string', default: 'increase profitable listing velocity' },
      ],
    },
    steps: [
      {
        id: 'analyze',
        agent: 'pod-growth-analyst',
        input:
          'Review this POD week. Identify winners, losers, stuck work, and economic risks.\n\n' +
          'Goals: {{trigger.goals}}\n\nWeek context:\n{{trigger.week_context}}\n',
      },
      {
        id: 'research',
        agent: 'researcher',
        input:
          'Suggest practical POD product, niche, or content expansion ideas based on this weekly analysis. Keep it grounded and non-generic.\n\n' +
          '{{steps.analyze.output}}\n',
      },
      {
        id: 'product-plan',
        agent: 'pod-product-strategist',
        input:
          'Propose next POD products, variants, or design directions from this weekly analysis and expansion research. Include launch/hold rationale.\n\n' +
          'Analysis:\n{{steps.analyze.output}}\n\nResearch:\n{{steps.research.output}}\n',
      },
      {
        id: 'content-plan',
        agent: 'pod-content-director',
        input:
          'Propose next week POD content themes, angles, and platform priorities from this weekly analysis and product plan. Do not schedule or publish.\n\n' +
          'Analysis:\n{{steps.analyze.output}}\n\nProduct plan:\n{{steps.product-plan.output}}\n',
      },
      {
        id: 'plan',
        agent: 'pod-ops-orchestrator',
        input:
          'Create next week\'s POD operating plan from this analysis and research. Include product, content, analytics, and approval-needed actions.\n\n' +
          'Analysis:\n{{steps.analyze.output}}\n\nResearch:\n{{steps.research.output}}\n\nProduct plan:\n{{steps.product-plan.output}}\n\nContent plan:\n{{steps.content-plan.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# POD Weekly Growth Review\n\n' +
    'Use this weekly to choose the next product and content moves based on what actually happened.\n',
};

export const STARTER_WORKFLOWS: ReadonlyArray<{
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}> = [
  weeklyContentPipeline,
  emailTriage,
  dailyCompanyBrief,
  weeklyGrowthReview,
  competitorWatch,
  campaignHealthCheck,
  supportTriage,
  podDesignIntake,
  podProductLaunch,
  podContentBatch,
  podDailySocialPublishing,
  podDailyBusinessReview,
  podWeeklyGrowthReview,
];

export const STARTER_WORKFLOW_SLUGS: readonly string[] = STARTER_WORKFLOWS.map((w) => w.slug);
