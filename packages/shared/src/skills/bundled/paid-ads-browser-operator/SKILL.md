---
name: paid-ads-browser-operator
description: Operate Meta Ads, Google Ads, and Spotify Ads safely through browser dashboards, exported CSV/XLSX files, Spotify for Artists audience intel, and the local ads-operator CLI. Use when API/MCP auth is missing, incomplete, blocked, or insufficient; when the user provides paid-ads exports; when an agent needs browser/export fallback for campaign reporting, diagnostics, setup planning, or approval packets; or before any paid-ads action that could publish, spend, pause, enable, delete, or change budgets, bids, targeting, creative, keywords, conversions, billing, recommendations, catalogs, or status.
---

# Paid Ads Browser Operator

Use this skill to keep paid-ads work useful when APIs are unavailable while still preventing accidental account changes.

## Routing

1. Prefer connected structured sources for read-only work:
   - Google Ads: use `google-ads`.
   - Meta Ads: use `ads-operator --platform meta` as the local browser/export/setup operator. Use `meta-ads` only when authenticated and eligible.
   - Spotify Ads: use browser mode for Spotify Ads Manager / Spotify Ad Studio in V1. Spotify Ads API is optional later and must not block work.
2. If structured access is missing, blocked, expired, or incomplete, switch to browser dashboard/export mode.
3. Before Meta or Google browser work, run `browser_tool accounts`, resolve one exact saved dashboard account, and attach it with `browser_tool account <meta-ads|google-ads> <profile>`. These logins live in Settings > Ad Accounts. Never use a generic browser session when a configured account exists.
4. For Spotify audience strategy, use Spotify for Artists browser intel when the user is logged in: top cities, listener demographics, source/playlist signal, song performance, and audience trend clues. Do not confuse Spotify for Artists with Spotify Ads Manager.
5. If browser automation is blocked, ask the user for an export/screenshot and give exact platform, account, date range, table, columns, and file type.
6. Use screenshots as visual evidence only. Use API/export data for numbers when available.
7. Use Computer Use only when normal browser automation cannot inspect or operate the page and the user has enabled it.

## Ads Operator

Run local helper commands from the repo/workspace root so export paths remain stable:

```bash
node tools/ads-operator/bin/ads-operator.mjs doctor --json
```

Use only these commands in the current skeleton:

```bash
node tools/ads-operator/bin/ads-operator.mjs accounts --platform meta|google --json
node tools/ads-operator/bin/ads-operator.mjs campaigns --platform meta|google --account <id> --json
node tools/ads-operator/bin/ads-operator.mjs export-plan --platform meta|google --level campaign|adset|adgroup|ad|keyword --json
node tools/ads-operator/bin/ads-operator.mjs import <file.csv> --platform meta|google --level campaign|adset|adgroup|ad|keyword --json
node tools/ads-operator/bin/ads-operator.mjs audit <file.csv|import.json> --platform meta|google --level campaign|adset|adgroup|ad|keyword|search-term --goal conversions|traffic|awareness|leads|sales|roas --json
node tools/ads-operator/bin/ads-operator.mjs campaign-plan --platform meta|google --goal <goal> --artist-context <file.md> --territories "city one,city two" --budget "<amount>" --out campaign-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs setup-plan --platform meta|google --goal <goal> --artist-context <file.md> --territories "city one,city two" --budget "<amount>" --campaign-name "<name>" --out setup-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs packet create --platform meta|google --type publish|budget|status|targeting|creative --account <id> --action "..." --spend-impact "..." --evidence <path> --out packet.json --json
node tools/ads-operator/bin/ads-operator.mjs receipt create --packet packet.json --status approved|rejected|skipped --out receipt.json --json
```

Treat `packet create` and `receipt create` as artifacts, not execution commands. The tool is read-only; mutation-like commands must fail closed.

Use `audit` after import to surface spend waste, weak CTR, no-conversion spend, search-term cleanup, fatigue signals, and budget concentration.

Use `campaign-plan` to draft a campaign from artist context, audience signals, territories, goal, and budget. It may recommend audience and territory research, but it must not publish or create the campaign.

Use `setup-plan` before browser-guided campaign setup. For Meta, it returns the Ads Manager route, campaign/ad set/ad fields, browser steps, evidence requirements, and approval gate. Follow it to create drafts only; stop before Publish/Launch.

## Browser Export Protocol

Before inspecting a dashboard:

- Confirm platform, account/business/customer, objective, and date range.
- Prefer table exports over manual copying.
- Record the dashboard URL or page name, date range, filters, attribution/window if visible, and export filename.
- Stop before clicking any ambiguous Save, Publish, Apply, Launch, Enable, Pause, Delete, budget, bid, targeting, creative, keyword, billing, recommendation, or upload control.
- Never ask for or expose passwords, access tokens, cookies, API keys, 2FA codes, or recovery codes.

For Meta:

- Use browser/export mode when Meta MCP is unauthenticated, blocked, or insufficient.
- For campaign setup, run `campaign-plan` first, then `setup-plan --platform meta`, then use Meta Ads Manager browser mode to create a draft only.
- Export campaign, ad set, or ad tables where possible.
- Check objective, delivery/status, budget, spend, results, CPA/CPL/ROAS where available, CTR, CPC, CPM, frequency, conversion signal, learning/delivery limits, audience overlap, placement issues, catalog/feed issues, and creative fatigue.
- Stop before Publish, Launch, Apply, Save changes, Turn on, budget changes, tracking changes, or any other control that can spend or mutate the account.

For Google Ads:

- Use `google-ads` first when configured.
- Use dashboard/export mode when API credentials or developer token are missing.
- Export campaign, ad group, keyword, search term, asset, conversion, or recommendation views as needed.
- Check spend, conversions, cost/conv, conversion value, ROAS, CTR, CPC, impression share, search terms, negatives, match type waste, limited budgets, bidding strategy, conversion tracking, and disapproved assets.

For Spotify Ads:

- V1 path is browser-guided Spotify Ads Manager / Spotify Ad Studio, not API-first.
- Configure Spotify Ads Manager under Settings > Spotify, then attach the exact `spotify/<profile>` saved login before opening the dashboard.
- Use Spotify for Artists only for audience and song intel, not campaign creation. It can inform cities, age/gender if visible, listener growth, top songs, playlist/source signal, and campaign geography.
- In Spotify Ads Manager, inspect or draft campaigns, ad sets, ads, targeting, budget, placements/formats, and reporting only when the user is logged in.
- Before campaign setup, identify campaign objective, song/landing URL, creative assets, audio/video format, territories, budget, dates, audience/artist targeting, and CTA.
- Stop before Launch, Submit, Publish, Save changes, budget changes, targeting changes, asset upload, status changes, or anything that could spend or mutate the account.
- For Spotify approval packets, do not call `ads-operator --platform spotify`; it is not supported yet. Write the approval packet manually using the same fields below.
- If the Spotify Ads API is later configured, treat it like Google/Meta structured access: read-only first, then approval packet before writes.

## Export Handling

1. Keep the raw export path.
2. Normalize with `ads-operator import`.
3. Preserve unknown columns in raw data instead of dropping them silently.
4. State uncertainty when exports lack attribution, conversion windows, or column definitions.
5. Do not make strong claims from screenshots when export/API data is available.

## Approval Gate

Before any external ad-account change, stop and produce an approval packet.

Approval packet must include:

- platform and account
- current source/page/export
- exact object being changed
- current value and proposed value
- exact action
- spend impact
- evidence used
- expected upside
- risk and rollback plan
- exact approval phrase needed

Never apply changes without explicit approval in the current conversation. This includes publishing, pausing, enabling, deleting, budget/bid changes, targeting changes, creative or catalog updates, keyword or negative keyword changes, conversion/billing changes, uploads, recommendations, and status changes.

After approval review, create a receipt that records the packet phrase, status, and evidence. Do not use receipts to claim live ad execution; this operator is read-only.

## Output Shape

Return paid-ads findings in this order:

1. What I checked
2. Data source and confidence
3. What is working
4. What is wasting money or blocking delivery
5. Recommended read-only next checks
6. Approval-needed actions, if any
