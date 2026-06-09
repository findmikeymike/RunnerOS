import type { TeamMetadata } from './types.ts';

export const HEAD_OF_BIZ_TEAM_SLUG = 'head-of-biz-team';
export const COMMERCE_LAUNCH_TEAM_SLUG = 'commerce-launch-team';
export const ENGINEERING_SHIP_TEAM_SLUG = 'engineering-ship-team';
export const REVIEW_AND_QA_TEAM_SLUG = 'review-and-qa-team';

const riskyBusinessActions = ['publish', 'spend', 'customer_message', 'refund', 'external_action'] as const;
const riskyEngineeringActions = ['code_change', 'deploy', 'delete', 'external_action'] as const;

export const STARTER_TEAMS: ReadonlyArray<{
  slug: string;
  metadata: TeamMetadata;
  body: string;
}> = [
  {
    slug: HEAD_OF_BIZ_TEAM_SLUG,
    metadata: {
      name: 'Head of Biz Team',
      description: 'Coordinates business operations, metrics, commerce work, content, finance, and approval-gated action.',
      avatar: '🏢',
      lead: 'head-of-biz',
      standing: true,
      permissionMode: 'ask',
      members: [
        { slug: 'ecommerce-ops', role: 'Commerce operations, store setup, fulfillment, and order issues' },
        { slug: 'content-strategist', role: 'Launch content, campaign ideas, and channel planning' },
        { slug: 'finance-analyst', role: 'Margins, revenue checks, and business reporting' },
        { slug: 'reviewer', role: 'Final verification before claims or risky actions' },
      ],
      verification: { default: 'advisory', requiredFor: [...riskyBusinessActions] },
    },
    body:
      '# Head of Biz Team\n\n' +
      'Use when RunnerOS needs to operate a business lane instead of answering a single question. The lead owns prioritization; specialists own bounded tasks; approvals gate risky external actions.\n',
  },
  {
    slug: COMMERCE_LAUNCH_TEAM_SLUG,
    metadata: {
      name: 'Commerce Launch Team',
      description: 'Turns a product idea into a reviewed launch package for commerce workflows.',
      avatar: '🛒',
      lead: 'head-of-biz',
      standing: true,
      permissionMode: 'ask',
      members: [
        { slug: 'product-strategist', role: 'Offer, product angle, positioning, and launch checklist' },
        { slug: 'ecommerce-ops', role: 'Shopify, Printify, Etsy, listing, and fulfillment operations' },
        { slug: 'content-creator', role: 'Launch copy, short-form ideas, and social derivatives' },
        { slug: 'reviewer', role: 'Pre-approval verification and launch package review' },
      ],
      verification: { default: 'advisory', requiredFor: [...riskyBusinessActions] },
    },
    body:
      '# Commerce Launch Team\n\n' +
      'Use for listing drafts, product launch packets, content kits, and approval-ready commerce actions.\n',
  },
  {
    slug: ENGINEERING_SHIP_TEAM_SLUG,
    metadata: {
      name: 'Engineering Ship Team',
      description: 'Coordinates implementation, tests, review, cleanup, and handoff for engineering changes.',
      avatar: '🚢',
      lead: 'system-architect',
      standing: true,
      permissionMode: 'ask',
      members: [
        { slug: 'coder', role: 'Implementation owner for scoped code changes' },
        { slug: 'test-engineer', role: 'Targeted automated tests and verification strategy' },
        { slug: 'code-reviewer', role: 'Correctness, maintainability, and regression review' },
        { slug: 'cleanup-agent', role: 'Final cleanup, dead code, lint, and consistency pass' },
      ],
      verification: { default: 'blocking', requiredFor: [...riskyEngineeringActions] },
    },
    body:
      '# Engineering Ship Team\n\n' +
      'Use for code work that needs explicit ownership, tests, review, and a clean handoff.\n',
  },
  {
    slug: REVIEW_AND_QA_TEAM_SLUG,
    metadata: {
      name: 'Review and QA Team',
      description: 'Runs skeptical completion checks across code, tests, security, and truthfulness.',
      avatar: '✅',
      lead: 'truth-guardian',
      standing: true,
      permissionMode: 'safe',
      members: [
        { slug: 'code-reviewer', role: 'Code correctness and regression review' },
        { slug: 'test-engineer', role: 'Coverage, test gaps, and verification evidence' },
        { slug: 'security-auditor', role: 'Security-sensitive behavior and abuse case review' },
      ],
      verification: { default: 'blocking', requiredFor: [...riskyEngineeringActions, ...riskyBusinessActions] },
    },
    body:
      '# Review and QA Team\n\n' +
      'Use as a final gate before claiming a complex feature, workflow, or business action is complete.\n',
  },
];

export const STARTER_TEAM_SLUGS: readonly string[] = STARTER_TEAMS.map((team) => team.slug);

