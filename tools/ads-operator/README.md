# Ads Operator

Read-only RunnerOS paid ads operator skeleton.

It sits above provider-specific paths:

- Google Ads: route to `tools/google-ads/bin/google-ads.mjs`.
- Meta Ads: use browser dashboard/export mode until Meta API/MCP is connected and usable.
- CSV exports: normalize local campaign/ad exports into a common metric shape.
- Audits: flag spend waste, weak CTR, no-conversion spend, search-term cleanup, fatigue signals, and budget concentration.
- Campaign plans: draft read-only campaign structures from artist context, territories, goals, and budget.
- Approval packets: create validation-ready JSON with secret redaction and evidence verification flags. This tool does not apply changes.

## Commands

```bash
node tools/ads-operator/bin/ads-operator.mjs doctor --json
node tools/ads-operator/bin/ads-operator.mjs accounts --platform google --json
node tools/ads-operator/bin/ads-operator.mjs campaigns --platform google --account <customer-id> --json
node tools/ads-operator/bin/ads-operator.mjs export-plan --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs import <file.csv> --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs audit <file.csv|import.json> --platform google --level search-term --goal conversions --json
node tools/ads-operator/bin/ads-operator.mjs campaign-plan --platform meta --goal leads --artist-context artist.md --territories "Los Angeles,London" --budget "$50/day" --out campaign-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs packet create --platform google --type budget --account <id> --action "..." --spend-impact "..." --evidence <path> --out packet.json --json
node tools/ads-operator/bin/ads-operator.mjs receipt create --packet packet.json --status approved --out receipt.json --json
```

## Safety

No command publishes, pauses, enables, deletes, changes bids/budgets, uploads assets, or applies recommendations. Mutation-like commands fail closed.

Packet and receipt text fields redact token/session-like values before output. Local evidence paths are marked with `verified: true|false`; remote evidence references are allowed but marked unverified by this skeleton.
