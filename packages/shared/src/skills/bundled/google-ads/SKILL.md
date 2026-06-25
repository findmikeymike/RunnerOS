---
name: google-ads
description: Use RunnerOS' bundled Google Ads source for account discovery, GAQL reporting, field lookup, diagnostics, planning, and approval-gated operations.
---

# Google Ads

Use this skill when the user asks for Google Ads reporting, campaign diagnostics, keyword/search-term analysis, account discovery, budget review, or Google Ads setup help.

## Source

Use the bundled `google-ads` source. It exposes a repo-owned local tool at:

```bash
cd tools/google-ads
node bin/google-ads.mjs <command> --agent
```

Current bundled build: `2026.6.25-runneros-v24`, targeting Google Ads API `v24`.

Do not assume a globally installed `google-ads-pp-cli`. RunnerOS resolves the bundled binary through `tools/google-ads/bin/google-ads.mjs`.

## First Checks

```bash
cd tools/google-ads && node bin/google-ads.mjs doctor --agent
cd tools/google-ads && node bin/google-ads.mjs auth status --agent
```

If auth is missing, tell the user to open Tools → Google Ads → Connect Google Ads. RunnerOS stores Google OAuth, developer token, and optional login customer ID for future app launches.

## Read-Only Commands

```bash
cd tools/google-ads && node bin/google-ads.mjs customers list-accessible-customers --agent
cd tools/google-ads && node bin/google-ads.mjs google-ads-fields search --agent --query campaign
cd tools/google-ads && node bin/google-ads.mjs customers-google-ads search <customerId> --agent --query "<GAQL>"
```

Use real hyphenated commands. Some upstream introspection may show underscore names; convert them to hyphen form before executing.

## Safety

- Start read-only.
- For proposed writes, run a `--dry-run` preview first and show the exact object, operation payload, reason, risk, and expected impact.
- Summarize business meaning; do not dump raw API output unless asked.
- Never mutate campaigns, budgets, keywords, audiences, conversions, billing, or status without explicit approval in the current conversation.
