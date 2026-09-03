---
name: spotify-ads-manager
description: Plan, draft, review, and diagnose Spotify Ads Manager campaigns through the saved browser account. Use for Spotify campaign strategy, campaign/ad set/ad setup, creative requirements, audience planning, delivery checks, reporting exports, and final approval handoff when Ads API access is unavailable.
---

# Spotify Ads Manager

Use Spotify Ads Manager as a first-class paid channel alongside Meta and Google. This V1 playbook operates the browser dashboard; it does not require Spotify Ads API access.

This workflow is adapted from the campaign strategy, draft builder, reporting, and monitoring patterns in Spotify's Apache-2.0 `spotify/ads-agentic-tools` project. The browser UI is the authority for fields and options available to the connected account.

## Choose Spotify Intentionally

Recommend Spotify when audio-first reach, repeated listening moments, music discovery, contextual listening, artist/genre affinity, or a song-native creative experience fits the campaign goal.

Compare it with:

- Meta for visual/social discovery, retargeting, broad creative testing, and social proof.
- Google/YouTube for active intent, search demand, video viewing, and measurable site actions.
- A mixed plan when each platform has a distinct role. Do not split a small budget across three channels without enough learning budget.

Spotify for Artists can improve the plan with top cities, listener demographics, source/playlist signals, top songs, and trend direction. It informs targeting; it does not create ads.

## Required Inputs

Before setup, resolve:

- goal and primary success metric
- total or daily budget and date window
- destination URL or promoted Spotify/song destination
- territories and audience rationale
- approved audio/video asset, copy, CTA, and companion image for audio
- connected Spotify profile and correct Ads Manager account
- measurement readiness for traffic, lead, conversion, sales, or ROAS goals

If a required field is absent, keep the plan non-actionable and name only the missing inputs.

## Campaign Structure

Model every plan as:

1. Campaign: objective and campaign-level identity.
2. Ad set: schedule, budget, geography, age, platform, targeting, format, placement, category, and delivery estimate.
3. Ad: approved creative, companion image when required, CTA, destination, and display copy.

Prefer broad, interpretable ad sets over many narrow fragments. Split ad sets only when territory, audience hypothesis, format, creative, or budget role genuinely differs.

For music campaigns, start with audio unless approved video creative and the objective justify video. Never invent targeting fields, placement names, categories, or format availability; use what the live account shows.

## Draft Workflow

1. Resolve the configured account with `cd tools/printing-press-social && node src/social.mjs catalog --json`, then attach it with `browser_tool profile spotify <id>`. Never use a generic browser session when one is configured.
2. Run `ads-operator campaign-plan --platform spotify` from approved artist and campaign context.
3. Run `ads-operator setup-plan --platform spotify` to produce the field-by-field browser plan.
4. Open Spotify Ads Manager and confirm the correct account.
5. Build the campaign, ad set, and ad as a draft. The user's setup request authorizes draft entry and approved asset upload; do not add repetitive prompts.
6. Review objective, budget, schedule, targeting, geography, age, platforms, format, placements, category, CTA, destination, creative, and audience/delivery estimate.
7. Stop at the final screen before Submit, Publish, or Launch.
8. Create `ads-operator packet create --platform spotify ...` and ask for one explicit approval for the exact final payload and spend.
9. After approval, perform only the approved final action and verify the resulting status in Ads Manager.

Any later live pause/resume, budget, targeting, creative, schedule, destination, or status change needs a fresh approval for that exact change. Read-only inspection and reporting do not.

## Reporting And Monitoring

Use the ad set report as the primary browser reporting view. Set the exact date range and export CSV where possible. Capture:

- spend, impressions, reach, and frequency
- clicks and CTR
- completion rate
- played-to-25/50/75/100 percentages
- delivery or pacing state
- audience breakdowns available in the account

Normalize exports with `ads-operator import --platform spotify --level adset`, then audit before making claims. Preserve unknown columns. Metrics may lag; record the report date range and when the dashboard says data was updated.

Diagnose in this order:

1. delivery and pacing
2. audience size and targeting restrictions
3. format, asset, or review status
4. completion and click behavior
5. landing destination and measurement readiness
6. budget concentration and creative fatigue

Do not present a guessed benchmark as Spotify policy or account truth.

## Output

Return:

1. Why Spotify is or is not the right channel
2. Campaign tree
3. Field-ready draft plan
4. Creative and asset checklist
5. Measurement and reporting plan
6. Missing inputs
7. Final approval packet only when the draft is ready to submit
