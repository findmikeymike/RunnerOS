---
name: ads-strategy
description: "Build paid-ad campaign strategy packets covering goal, platform choice, funnel structure, audience and territory plan, test design, budget logic, and approval-ready execution inputs."
---

# Ads Strategy

Use this when the user asks for ad strategy, campaign planning, media plan, where to spend, audience targeting, territories, rollout structure, or how to turn artist context into a paid campaign.

This skill plans. It does not touch ad accounts.

## Required Inputs

- Campaign goal: awareness, traffic, leads, sales, conversions, or ROAS.
- Platform scope: Meta, Google, or both.
- Budget range and time window.
- Artist Ad DNA packet or Artist HQ context.
- Release/campaign context and destination URL, if available.
- Prior performance exports or account findings, if available.

If budget, territories, or goal are missing, ask for them or mark the output non-actionable.

## Output: Ads Strategy Packet

Produce:

1. Goal and success metric: one primary metric and 2-3 guardrail metrics.
2. Platform rationale: why Meta, Google, or both.
3. Funnel structure: prospecting, retargeting, search intent, landing page, conversion event, and follow-up path.
4. Campaign architecture: campaign, ad set/ad group, audience, location, creative-test, and measurement structure.
5. Audience plan: 3-6 testable audiences with rationale from artist context.
6. Territory plan: target locations, why they matter, and what evidence would improve confidence.
7. Creative test plan: required angle diversity, format mix, and minimum viable creative set.
8. Budget plan: daily/total budget, control vs test split, pacing, and minimum learning budget warnings.
9. Kill/scale rules: what to pause, hold, iterate, or increase based on spend, clicks, CTR, CPA, ROAS, or learning state.
10. Execution handoff: exact fields Ads Agent needs for `campaign-plan` and `setup-plan`.

## Budget Logic

Use conservative planning defaults:

- Keep proven/control spend separate from test spend.
- Do not recommend scale decisions without enough data.
- Treat low-budget campaigns as learning experiments, not performance proof.
- Use 70/20/10 as a starting framework only when there is enough prior performance data.
- New artist campaigns can use control/test/explore splits instead of pretending there are proven channels.

## Safety

- Never imply a live account change has been made.
- Never recommend publishing, spending, pausing, or changing budgets without Ads Agent approval flow.
- If the strategy lacks required budget or territory inputs, mark it `actionable: false`.
