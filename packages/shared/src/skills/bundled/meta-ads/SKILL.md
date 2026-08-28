---
name: meta-ads
description: Operate Meta Ads safely through RunnerOS' Meta Ads source when connected, or through the local ads-operator browser/export/setup route when API access is missing or insufficient.
---

# Meta Ads

Use this skill when the user asks for Meta Ads reporting, campaign diagnostics, audience/ad set review, creative fatigue checks, account discovery, budget review, or Meta campaign setup help.

For browser dashboard work, run `browser_tool accounts`, then attach the exact saved login from Settings > Ad Accounts with `browser_tool account meta-ads <profile>`. Do not use a generic browser session for a configured account.

## Source And Local Route

Prefer the `meta-ads` source when it is connected and eligible for the requested read-only account work.

When Meta API/MCP access is missing, blocked, expired, or insufficient, use the local `ads-operator` route:

```bash
node tools/ads-operator/bin/ads-operator.mjs doctor --json
node tools/ads-operator/bin/ads-operator.mjs accounts --platform meta --json
node tools/ads-operator/bin/ads-operator.mjs campaigns --platform meta --account <id> --json
node tools/ads-operator/bin/ads-operator.mjs export-plan --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs import <file.csv> --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs audit <file.csv|import.json> --platform meta --level campaign --goal conversions --json
node tools/ads-operator/bin/ads-operator.mjs campaign-plan --platform meta --goal <goal> --artist-context <file.md> --territories "city one,city two" --budget "<amount>" --json
node tools/ads-operator/bin/ads-operator.mjs setup-plan --platform meta --goal <goal> --artist-context <file.md> --territories "city one,city two" --budget "<amount>" --campaign-name "<name>" --json
```

## Browser Setup Rules

- Create drafts only.
- Stop before Publish, Launch, Apply, Save changes, Turn on, budget increases, or schedule activation.
- Use `setup-plan --platform meta` before browser-guided campaign setup.
- Require explicit user approval in the current conversation before any live Meta Ads change.

## Safety

- Start read-only.
- Do not ask for passwords, 2FA codes, cookies, recovery codes, or raw access tokens.
- Use exports or structured source data as the numeric source of truth when possible.
- Summarize business meaning; do not dump raw API/export output unless asked.
