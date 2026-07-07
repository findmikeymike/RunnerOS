# Ads Operator

Read-only RunnerOS paid ads operator skeleton.

It sits above provider-specific paths:

- Google Ads: route to `tools/google-ads/bin/google-ads.mjs`.
- Meta Ads: use browser dashboard/export mode until Meta API/MCP is connected and usable.
- Meta campaign setup: create read-only `campaign-plan` and `setup-plan` artifacts, then use Ads Manager browser mode to create a draft only. Stop before Publish/Launch.
- CSV exports: normalize local campaign/ad exports into a common metric shape.
- Audits: flag spend waste, weak CTR, no-conversion spend, search-term cleanup, fatigue signals, and budget concentration.
- Campaign plans: draft read-only campaign structures from artist context, territories, goals, and budget.
- Ad Library intel: create public Meta Ad Library browser research plans and analyze captured ad examples into hook/angle/format packets.
- Approval packets: create validation-ready JSON with secret redaction and evidence verification flags. This tool does not apply changes.

## Commands

```bash
node tools/ads-operator/bin/ads-operator.mjs doctor --json
node tools/ads-operator/bin/ads-operator.mjs accounts --platform google --json
node tools/ads-operator/bin/ads-operator.mjs campaigns --platform google --account <customer-id> --json
node tools/ads-operator/bin/ads-operator.mjs export-plan --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs import <file.csv> --platform meta --level campaign --json
node tools/ads-operator/bin/ads-operator.mjs audit <file.csv|import.json> --platform google --level search-term --goal conversions --json
node tools/ads-operator/bin/ads-operator.mjs ad-library-plan --artist "Artist Name" --competitors "Similar Artist,Label" --keywords "genre phrase,fan phrase" --countries "US,GB" --out ad-library-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs ad-library-analyze captured-ads.json --artist "Artist Name" --out ad-library-intel.json --json
node tools/ads-operator/bin/ads-operator.mjs campaign-plan --platform meta --goal leads --artist-context artist.md --territories "Los Angeles,London" --budget "$50/day" --out campaign-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs setup-plan --platform meta --goal leads --artist-context artist.md --territories "Los Angeles,London" --budget "$50/day" --campaign-name "Artist lead test" --out setup-plan.json --json
node tools/ads-operator/bin/ads-operator.mjs packet create --platform google --type budget --account <id> --action "..." --spend-impact "..." --evidence <path> --out packet.json --json
node tools/ads-operator/bin/ads-operator.mjs receipt create --packet packet.json --status approved --out receipt.json --json
```

## Safety

No command publishes, pauses, enables, deletes, changes bids/budgets, uploads assets, or applies recommendations. Mutation-like commands fail closed.

Packet and receipt text fields redact token/session-like values before output. Local evidence paths are marked with `verified: true|false`; remote evidence references are allowed but marked unverified by this skeleton.

Meta Ad Library research uses the public library at `https://www.facebook.com/ads/library`. It normally does not require an ad-account login. If Meta blocks automation, asks for verification, or rate-limits the browser, the agent should ask the user to continue manually or provide captured examples. Public commercial ad-library data does not expose CTR, CPA, ROAS, or spend; longevity is only a weak signal.
