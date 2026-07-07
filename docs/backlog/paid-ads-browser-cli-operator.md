---
status: backlog
owner: product
last_verified: 2026-07-06
source_of_truth: true
---

# Paid Ads Browser + CLI Operator

## Decision

Build a hybrid paid-ads operator for RunnerOS.

The product should not depend on Meta or Google API approval before it can help a user set up, inspect, and improve campaigns. The reliable V1 path is:

1. Use browser automation for logged-in ad dashboards when API approval is missing.
2. Use Printing Press / Runner CLIs when credentials and API access exist.
3. Parse dashboard CSV exports before relying on screenshots.
4. Use Computer Use only as a visual fallback for UI elements that browser/CDP cannot operate.
5. Never publish, spend, pause, enable, delete, or change budgets without explicit user approval.

Plain English: make the Ads Agent behave like a careful media buyer sitting at the user's logged-in ad dashboard, with structured CLI/API reads when available, browser export flows when not, and hard approval gates around anything that can spend money.

## Why

Meta Ads and Google Ads are not normal "paste an API key and go" integrations:

- Google Ads API requires OAuth plus a developer token, and developer token approval can block real production use.
- Meta Marketing API and official Ads MCP require app/business eligibility, OAuth scopes, and platform approval.
- Google Analytics requires Google Cloud credentials plus GA4 property-level access.
- Google Ad Manager requires OAuth/admanager scopes and a network code; some work still lives outside REST coverage.

But users can usually access the dashboards in a browser today. Runner should exploit that safely instead of waiting for every provider approval path to be solved.

## Source Research

### CLI Printing Press engine

Repo studied: `mvanhorn/cli-printing-press`.

Useful patterns:

- Generates agent-native Go CLIs plus MCP servers and skills.
- Optimized for `--json`, `--compact`, `--select`, `--dry-run`, `--no-input`, `--yes`, `--csv`, and typed exit codes.
- Pushes high-value entities into local SQLite for fast repeated reads, search, history, and compound diagnostics.
- Can research official docs, community tools, MCP servers, and sniff browser traffic for undocumented APIs.
- Has an `auth doctor` concept for checking installed CLI credentials without printing secrets.

Important limit:

- It is not a magic bypass for provider auth. If the provider requires approved API access, a printed CLI still needs that access unless the CLI is specifically built around public or sniffed browser endpoints that can be used safely and legitimately.

### Google Ads Printing Press CLI

Repo studied: `printing-press-library/library/marketing/google-ads`.

Current fit:

- Strong structured-data path for Google Ads account discovery, GAQL reporting, field lookup, campaigns, budgets, assets, conversions, audiences, planning, and billing operations.
- Supports agent-friendly CLI usage and `doctor`.
- Existing Runner wrapper already lives at `tools/google-ads/bin/google-ads.mjs`.

Auth reality:

- Requires OAuth with `https://www.googleapis.com/auth/adwords`.
- Requires a Google Ads developer token.
- Optional manager-account calls need login customer ID.

V1 implication:

- Keep this as the preferred structured Google Ads path when credentials are present.
- Do not make it the only path. Browser dashboard flow must work when developer token approval is absent.

### Meta Ads Printing Press CLI

Repo studied: `printing-press-library/library/marketing/meta-ads`.

Current fit:

- Strong read-only insights CLI for Meta Marketing API.
- Uses local SQLite history for creative fatigue, decay, learning, overlap, reconcile, bottleneck, stale, and inventory commands.
- Single-token setup is simpler than Google Ads once the user has a valid Meta access token.

Auth reality:

- Requires `META_ACCESS_TOKEN`.
- Intended read scope is `ads_read`.
- Write scope such as `ads_management` should not be used for Runner V1.
- User access tokens can be short-lived; Business Manager system-user tokens are better for repeat use but require business setup.

V1 implication:

- Use this CLI for read-only diagnostics if a token exists.
- Browser dashboard remains the practical setup/edit path.

### Google Analytics Printing Press CLI

Repo studied: `printing-press-library/library/marketing/google-analytics`.

Current fit:

- Useful for GA4 channel, source, top-page, event, conversion, funnel, compare, revenue, and "what changed" reads.
- Agent flags include `--agent`, `--json`, `--compact`, `--no-input`, and `--yes`.

Auth reality:

- Requires a service-account JSON key or explicit credentials.
- The service account must also be added as a Viewer inside each GA4 property.

V1 implication:

- Useful for post-click performance and landing-page diagnosis.
- Not a replacement for Google Ads or Meta campaign setup.

### Google Ad Manager Printing Press CLI

Repo studied: `printing-press-library/library/marketing/google-ad-manager`.

Current fit:

- Strong for publisher/ad-ops workflows: report run/rerun/watch, ad unit tree, inventory orphans, order graph, line item pace, search, local SQLite mirror.
- Can simplify async report orchestration.

Auth reality:

- Requires Google OAuth access token with admanager/admanager.readonly scope.
- Requires Google Ad Manager network code.
- Access tokens are short-lived unless Runner owns a refresh path.
- Some trafficking, forecasting, and creative work remain outside REST coverage.

V1 implication:

- Treat as optional later expansion for publisher-side ad ops, not the core Meta/Google campaign operator.

## Existing RunnerOS Context

Current useful pieces:

- `ads-agent` exists in `packages/shared/src/agent-definitions/starter-templates.ts`.
- `google-ads` source exists as a local CLI source backed by `tools/google-ads/bin/google-ads.mjs`.
- `meta-ads` source exists as Meta's hosted Ads MCP beta, but it needs Meta OAuth/eligibility.
- `browser_tool` exists as the in-app browser/CDP tool with open, navigate, snapshot, find, click, fill, paste, upload, wait, screenshot, downloads, evaluate, scroll, focus, release, and close flows.
- `computer-use` exists as a built-in source for full desktop fallback.
- Outputs and Finals are now available for saving audits, campaign plans, CSV summaries, and approval receipts.

Current gap:

- Ads Agent knows API/CLI paths, but it does not yet have a complete browser-first operating doctrine, platform flowbooks, export parsing, evidence capture, or approval packet system for no-API Meta/Google work.

## Goals

1. Let Ads Agent help with Meta and Google Ads before API approval exists.
2. Make browser-operated dashboard work reliable enough for real account inspection and campaign drafts.
3. Prefer structured data from CLI/API/CSV over screenshot interpretation.
4. Make every external action approval-gated, auditable, and reversible where possible.
5. Save useful campaign audits/plans/receipts as Outputs that can be promoted to Finals.
6. Give agents clear routing: CLI/API when available, browser export when not, Computer Use only when necessary.
7. Avoid asking users to paste secrets into chat.
8. Avoid fake confidence when a provider blocks automation, login, export, or account access.

## Non-Goals

- Do not bypass provider approval, login, 2FA, CAPTCHA, rate limits, security checks, or access controls.
- Do not scrape private data outside the user's logged-in account context.
- Do not build a shadow ad platform in V1.
- Do not auto-spend or auto-publish.
- Do not support every Google campaign type in the first implementation.
- Do not rely on screenshots as the primary source for numeric analysis when an export or table data path exists.
- Do not store raw provider tokens in Outputs, Canvas, logs, chat, or receipts.

## Operating Modes

### Mode 1: CLI/API Read Mode

Use when credentials and provider access are present.

Primary uses:

- Google Ads account discovery.
- GAQL reporting.
- Google Ads field lookup.
- Meta read-only insights via Printing Press Meta CLI if installed/configured.
- GA4 performance reads.
- Google Ad Manager reporting and inventory reads.

Behavior:

- Run `doctor` first.
- Prefer `--agent`, `--json`, `--compact`, and `--select`.
- Use dry-run or preview modes for any write-capable command.
- Summarize business meaning, not raw API dumps.

### Mode 2: Browser Dashboard Mode

Use when API/CLI access is missing, blocked, or insufficient.

Primary uses:

- Human login.
- Campaign setup drafts.
- Reading dashboard tables.
- Selecting account/date range/filter.
- Exporting CSV reports.
- Downloading previews or receipts.
- Inspecting recommendations/change history/diagnostics.

Default browser order:

1. Runner in-app `browser_tool` when a fresh browser session is acceptable.
2. External Chrome CDP when the user already has the target dashboard logged in or the dashboard does not behave well inside the in-app browser.
3. Computer Use only when CDP cannot see or operate the needed control.

Behavior:

- Start read-only.
- Capture current URL/account/date range before analysis.
- Prefer CSV/download export over DOM table scraping.
- Use screenshots as visual evidence, not as sole numeric truth.
- Stop and ask the user on 2FA, CAPTCHA, account switchers, billing risk, or unclear publish/save actions.

### Mode 3: User-Provided Export Mode

Use when browser automation is blocked or the user already has exports.

Inputs:

- Meta Ads CSV/XLSX exports.
- Google Ads CSV/XLSX exports.
- GA4 exports.
- Screenshots for context.
- Manual campaign setting notes.

Behavior:

- Parse and normalize files.
- Ask for missing context: platform, account, date range, currency, attribution window, campaign objective.
- Produce an audit with confidence labels.

### Mode 4: Computer Use Fallback

Use only for:

- Native file picker weirdness.
- Browser UI that CDP cannot inspect.
- Account switcher popups.
- Drag-and-drop media upload.
- Security dialogs the user explicitly asks the agent to help navigate.

Rules:

- Must call status first.
- Must observe before each meaningful UI action.
- Must not interact with passwords, 2FA codes, payment methods, or security prompts unless the user directly instructs and remains in control.
- Must fall back to user handoff if macOS permissions break.

## Reliability Ranking

For reads and analysis:

1. CLI/API JSON with known account/date range.
2. Provider dashboard CSV export parsed locally.
3. DOM table extraction from dashboard.
4. Screenshots with visible labels.
5. Agent memory or user description.

For writes/setup:

1. CLI/API dry-run or preview packet, if provider access exists.
2. Browser-filled draft stopped before final save/publish.
3. Browser live mutation after explicit approval.
4. Computer Use live mutation only when CDP cannot operate and user explicitly approves.

## V1 Scope

### Platforms

V1 should focus on:

- Meta Ads Manager.
- Google Ads.
- Optional GA4 read overlay for landing-page and conversion context.

V1 should document but not prioritize:

- Google Ad Manager.
- YouTube Studio posting.
- TikTok Ads.
- LinkedIn Ads.
- Programmatic/publisher ad ops beyond Google Ad Manager read flows.

### Campaign Types

Meta V1:

- Traffic campaign draft.
- Engagement campaign draft.
- Leads campaign draft if the account has existing lead setup.
- Sales/conversions campaign draft if pixel/conversion setup is already present.
- Read-only performance audit for campaign/ad set/ad/ad creative.

Google Ads V1:

- Search campaign draft.
- Basic YouTube/video campaign planning, but not full automation unless UI flow is verified.
- Read-only performance audit for campaigns/ad groups/keywords/search terms/assets.
- Conversion goal and billing checks as read-only unless user explicitly approves changes.

Defer:

- Performance Max full build.
- Shopping feed setup.
- New pixel/tag installation.
- Offline conversion upload.
- New billing/payment method setup.
- Broad automated bid strategy changes.
- Bulk campaign creation.

## Primary User Flows

### Flow A: "Analyze my campaign"

1. Agent identifies platform: Meta, Google Ads, GA4, or GAM.
2. Agent checks configured sources:
   - Google Ads CLI doctor/auth status.
   - Meta Ads MCP/source status.
   - Optional installed Printing Press CLIs.
3. If CLI/API works, use structured commands.
4. If CLI/API is missing, open browser dashboard and guide/export.
5. Agent sets date range and level:
   - account
   - campaign
   - ad set/ad group
   - ad/keyword/search term/asset
6. Agent exports data if available.
7. Agent normalizes metrics.
8. Agent produces:
   - what is working
   - what is wasting money
   - what is blocked
   - creative/audience/keyword issues
   - recommended next moves
   - approval-needed actions
9. Agent saves an Output named like `Paid Ads Audit - <platform> - <date range>`.

### Flow B: "Set up a campaign"

1. Agent asks for missing strategic inputs:
   - platform
   - goal
   - offer/release
   - landing page
   - target audience
   - geography
   - budget
   - schedule
   - creative assets
   - conversion event
   - exclusions
   - spend cap
2. Agent builds campaign blueprint before touching the dashboard.
3. Agent opens dashboard in browser.
4. Agent fills draft fields step-by-step.
5. Agent stops at review/publish screen.
6. Agent creates an approval packet:
   - platform/account
   - campaign objective/type
   - budget and schedule
   - targeting
   - creative/ad copy
   - URL/UTM
   - conversion/bidding
   - screenshots
   - exact next click/action
7. Agent asks for explicit approval.
8. If approved, agent executes only the approved action.
9. Agent captures receipt/screenshot and saves an Output.

### Flow C: "Improve this campaign"

1. Agent reads current performance.
2. Agent checks settings and delivery constraints.
3. Agent separates:
   - analysis
   - recommendations
   - changes needing approval
4. Agent creates one action packet per external change.
5. Agent applies only approved packets.
6. Agent records before/after evidence.

### Flow D: "Use my Runner campaign assets"

1. Agent reads current campaign context.
2. Agent reads Finals for the campaign:
   - cover art
   - ad creative
   - short clips
   - press copy
   - landing/streaming links
3. Agent maps assets to platform placements.
4. Agent checks creative specs.
5. Agent uploads assets through browser only after user approval.
6. Agent records which Output/Final was used.

## Meta Ads Flowbook

### Readiness Checks

- Confirm the user is in the correct Business Manager.
- Confirm ad account name/ID and currency.
- Confirm account status and billing warnings.
- Confirm date range.
- Confirm objective being inspected.
- Confirm pixel/conversion event availability before recommending conversion campaigns.

### Dashboard Read Flow

Preferred order:

1. Campaigns table export.
2. Ad sets table export.
3. Ads table export.
4. Breakdown export where useful:
   - age/gender
   - placement
   - platform
   - country/region
   - device
5. Delivery diagnostics screenshots.
6. Creative preview screenshots.

Metrics to normalize:

- spend
- impressions
- reach
- frequency
- CPM
- link clicks
- CPC
- CTR
- landing page views
- conversions/results
- cost per result
- ROAS/value if present
- delivery status
- learning status
- quality/engagement/conversion ranking if visible

### Setup Flow

1. Open Ads Manager.
2. Select ad account.
3. Start new campaign.
4. Choose objective.
5. Confirm special ad category.
6. Set campaign name using Runner naming convention:
   - `<artist/release> - <objective> - <audience/angle> - <YYYY-MM-DD>`
7. Choose campaign budget or ad set budget.
8. Configure ad set:
   - conversion location
   - pixel/event if needed
   - budget/schedule
   - audience
   - location
   - age/gender if needed
   - detailed targeting or custom/lookalike audience
   - exclusions
   - placements
   - optimization/delivery
9. Configure ad:
   - page/IG account
   - format
   - media
   - primary text
   - headline
   - description
   - CTA
   - destination URL
   - UTM parameters
10. Preview placements.
11. Stop at publish/review.
12. Produce approval packet.

### Safe Meta Actions

Read-only without approval:

- Navigate dashboard.
- Change visible reporting date range for inspection.
- Apply filters.
- Export CSV.
- Inspect campaign settings.
- Open previews.

Requires explicit approval:

- Publish campaign/ad set/ad.
- Change budget.
- Change bid strategy.
- Pause/enable/delete.
- Change audience.
- Change placements.
- Upload creative into an ad.
- Change conversion event.
- Accept/reject recommendations.
- Edit catalog/product set.

## Google Ads Flowbook

### Readiness Checks

- Confirm account/customer ID.
- Confirm manager account if applicable.
- Confirm billing warnings.
- Confirm conversion goals.
- Confirm website/landing page.
- Confirm date range and attribution expectations.
- Run Google Ads CLI doctor if credentials exist.

### CLI Read Flow

Preferred commands through existing Runner wrapper:

```bash
node tools/google-ads/bin/google-ads.mjs doctor --agent
node tools/google-ads/bin/google-ads.mjs auth status --agent
node tools/google-ads/bin/google-ads.mjs customers list-accessible-customers --agent
node tools/google-ads/bin/google-ads.mjs google-ads-fields search --agent --query campaign
node tools/google-ads/bin/google-ads.mjs customers-google-ads search <customer-id> --agent
```

Use GAQL for:

- campaign performance
- ad group performance
- keyword performance
- search terms
- asset performance
- conversion actions
- recommendations
- change history

### Browser Read Flow

Preferred dashboard areas:

- Overview.
- Campaigns.
- Ad groups.
- Ads.
- Keywords.
- Search terms.
- Assets.
- Landing pages.
- Audiences.
- Recommendations.
- Conversion goals.
- Change history.
- Auction insights.

Preferred export order:

1. Campaign table.
2. Ad group table.
3. Keyword table.
4. Search terms table.
5. Asset table.
6. Conversion goals/settings screenshot.
7. Change history export/screenshot.

Metrics to normalize:

- cost
- impressions
- clicks
- CTR
- average CPC
- conversions
- conversion rate
- cost per conversion
- conversion value
- ROAS/value per cost
- search impression share
- lost IS budget
- lost IS rank
- quality score
- top impression rate
- absolute top impression rate

### Search Campaign Setup Flow

1. Open Google Ads.
2. Select account/customer.
3. Start campaign.
4. Choose objective or no-goal-guidance mode.
5. Choose Search.
6. Confirm conversion goals.
7. Set campaign name:
   - `<artist/release> - Search - <intent/theme> - <YYYY-MM-DD>`
8. Set bidding strategy.
9. Set budget.
10. Set networks.
11. Set location/language.
12. Create ad group.
13. Add keyword themes and match types.
14. Create responsive search ad:
   - final URL
   - display path
   - headlines
   - descriptions
   - assets/extensions if appropriate
15. Review estimated performance.
16. Stop before publish.
17. Produce approval packet.

### Safe Google Actions

Read-only without approval:

- Navigate dashboard.
- Change visible reporting date range for inspection.
- Export CSV.
- Inspect recommendations.
- Inspect conversion goals.
- Inspect search terms and keywords.

Requires explicit approval:

- Publish campaign.
- Change budget.
- Change bidding.
- Pause/enable/remove.
- Apply recommendations.
- Add negative keywords.
- Add/edit keywords.
- Add/edit ads/assets.
- Change locations/languages.
- Change conversion goals.
- Change billing/payment.

## GA4 Support

GA4 should be used as context for paid-media diagnosis, not as the main campaign operator.

Use cases:

- Landing-page quality.
- Channel/source performance.
- Funnel dropoff.
- Conversion event validation.
- Revenue/AOV context.
- Post-click mismatch: clicks but no engaged sessions/conversions.

Preferred paths:

1. GA4 Printing Press CLI if credentials exist.
2. Browser dashboard export if credentials do not exist.
3. User-provided exports.

Outputs:

- `Paid Traffic Landing Page Read`
- `GA4 Campaign Attribution Check`
- `Funnel Leak Report`

## Google Ad Manager Support

Google Ad Manager should be a later optional module, useful for publisher/ad-ops accounts.

Use cases:

- Revenue by ad unit.
- Delivery risk.
- Line-item pacing.
- Inventory orphan checks.
- Order graph.
- Changed entities since last sync.

Do not merge this into the core artist campaign flow unless the user actually operates publisher inventory.

## Proposed Architecture

### New Backlog Feature Name

`paid-ads-browser-cli-operator`

### New Local Source

Add a local source:

- slug: `ads-operator`
- type: `local`
- format: `cli-tool`
- path: `tools/ads-operator`
- purpose: normalize paid-ads data, parse exports, generate action packets, coordinate CLI/browser evidence.

This should not replace `google-ads`. It should sit above provider-specific sources as the routing/orchestration layer.

### New Tool Wrapper

Add:

```text
tools/ads-operator/
  README.md
  package.json
  bin/ads-operator.mjs
  src/
    doctor.mjs
    detect.mjs
    normalize/
    parsers/
    audits/
    approval-packets/
    receipts/
    flowbooks/
  test/
```

Candidate commands:

```bash
node bin/ads-operator.mjs doctor --json
node bin/ads-operator.mjs detect --platform meta|google --json
node bin/ads-operator.mjs import <file> --platform meta|google --level campaign|adset|adgroup|ad|keyword --json
node bin/ads-operator.mjs normalize <file> --platform meta|google --json
node bin/ads-operator.mjs audit <normalized-json> --goal conversions|traffic|awareness|leads --json
node bin/ads-operator.mjs packet create --platform meta|google --type publish|budget|status|targeting|creative --json
node bin/ads-operator.mjs receipt create --packet <packet.json> --evidence <folder> --json
node bin/ads-operator.mjs flowbook meta-campaign-setup --json
node bin/ads-operator.mjs flowbook google-search-setup --json
```

Responsibilities:

- Parse CSV/XLSX exports.
- Normalize platform-specific columns.
- Detect missing required context.
- Compute core diagnostics.
- Generate approval packets.
- Generate receipts.
- Never store secrets.

### New Skill

Add a skill:

- slug: `paid-ads-browser-operator`
- purpose: make Ads Agent excellent at browser-operated paid-media work.

Skill contents:

- source routing rules
- browser/CDP commands policy
- Meta flowbook
- Google Ads flowbook
- GA4 context flowbook
- export parsing protocol
- approval packet protocol
- evidence capture protocol
- forbidden actions
- fallback policy

### Ads Agent Update

Update `ads-agent`:

- Skills:
  - keep `ad-creative`
  - keep `google-ads`
  - add `paid-ads-browser-operator`
- Sources:
  - keep `google-ads`
  - add `ads-operator`
  - optionally add `meta-ads` only if the current Meta MCP source is meant to be exposed by default
  - `computer-use` should remain optional, not default

Prompt changes:

- Browser dashboard mode is allowed and preferred when API approval is missing.
- CLI/API mode is preferred for structured reads when credentials exist.
- Export CSV before analyzing visible dashboard screenshots.
- Ask for approval before any external mutation.
- If browser automation is blocked, give the user a precise handoff: what to export, from where, with which columns/date range.

### Browser Tool Integration

Use existing `browser_tool` first.

Useful commands:

```text
browser_tool open --foreground
browser_tool navigate <url>
browser_tool snapshot
browser_tool find <text>
browser_tool click <ref>
browser_tool fill <ref> <value>
browser_tool paste <text>
browser_tool upload <ref> <file>
browser_tool wait network-idle 5000
browser_tool screenshot --annotated
browser_tool downloads list 10
browser_tool release
browser_tool close
```

Enhancements to consider:

- Download parser helper that turns latest browser download into a typed `AdDataImport`.
- Evidence folder helper that saves screenshot, URL, timestamp, and normalized CSV together.
- Safer "approval stop" helper that detects publish/save/enable/delete labels and forces confirmation.

### External Chrome CDP Path

Add this as a future path if Runner in-app browser is unreliable for ads dashboards.

Use when:

- The user is already logged into Google Ads or Meta Ads in Chrome.
- Provider blocks Electron webview.
- Account switching is easier in the real browser profile.

Rules:

- User must explicitly choose/allow control of the Chrome tab/profile.
- Do not extract cookies or tokens.
- Use CDP for DOM snapshots, table reads, clicks, downloads, and screenshots.
- If Chrome CDP is not available, fall back to Runner browser or user-provided export.

### Computer Use Path

Keep optional and narrow.

Use when:

- Browser DOM cannot expose the control.
- File picker/upload requires native UI.
- The dashboard uses canvas-like components.
- CDP cannot interact with a popup.

Do not use Computer Use as the primary ads operator because it is less deterministic than CDP and depends on macOS permissions.

## Data Contracts

### AdConnectionProfile

```ts
type AdConnectionProfile = {
  platform: 'meta' | 'google-ads' | 'ga4' | 'google-ad-manager'
  accountId?: string
  accountName?: string
  currency?: string
  timeZone?: string
  accessModes: Array<'cli' | 'api' | 'mcp' | 'runner-browser' | 'chrome-cdp' | 'computer-use' | 'manual-export'>
  credentialState: 'connected' | 'missing' | 'expired' | 'blocked' | 'unknown'
  lastVerifiedAt?: string
  notes?: string[]
}
```

### AdDataImport

```ts
type AdDataImport = {
  id: string
  platform: 'meta' | 'google-ads' | 'ga4' | 'google-ad-manager'
  level: 'account' | 'campaign' | 'ad-set' | 'ad-group' | 'ad' | 'keyword' | 'search-term' | 'asset' | 'landing-page'
  source: 'cli' | 'api' | 'csv-export' | 'xlsx-export' | 'dom-table' | 'manual'
  accountId?: string
  accountName?: string
  dateRange: {
    start: string
    end: string
    label?: string
  }
  currency?: string
  rawFilePath?: string
  normalizedRowsPath: string
  columnMap: Record<string, string>
  warnings: string[]
  createdAt: string
}
```

### NormalizedAdRow

```ts
type NormalizedAdRow = {
  platform: 'meta' | 'google-ads'
  level: string
  id?: string
  name?: string
  status?: string
  objective?: string
  spend?: number
  impressions?: number
  reach?: number
  frequency?: number
  clicks?: number
  linkClicks?: number
  ctr?: number
  cpc?: number
  cpm?: number
  conversions?: number
  conversionRate?: number
  costPerConversion?: number
  conversionValue?: number
  roas?: number
  qualityScore?: number
  impressionShare?: number
  raw: Record<string, unknown>
}
```

### AdActionPacket

```ts
type AdActionPacket = {
  id: string
  platform: 'meta' | 'google-ads'
  accountLabel: string
  actionType: 'publish' | 'budget-change' | 'status-change' | 'targeting-change' | 'creative-change' | 'keyword-change' | 'bid-change' | 'recommendation-apply'
  riskLevel: 'low' | 'medium' | 'high'
  spendImpact: 'none' | 'possible' | 'direct'
  currentState?: Record<string, unknown>
  proposedState: Record<string, unknown>
  exactUserApprovalNeeded: string
  evidencePaths: string[]
  rollbackPlan?: string
  createdAt: string
}
```

### AdReceipt

```ts
type AdReceipt = {
  packetId: string
  approvedByUserAt: string
  executedAt: string
  platform: 'meta' | 'google-ads'
  accountLabel: string
  actionTaken: string
  result: 'completed' | 'blocked' | 'partial' | 'failed'
  providerVisibleId?: string
  evidencePaths: string[]
  followUpNeeded?: string[]
}
```

## Output / Finals Behavior

Agents should create Outputs for:

- campaign audit
- campaign setup blueprint
- approval packet
- setup receipt
- optimization recommendation set
- export normalization summary

Recommended Output types:

- `paid_ads_audit`
- `paid_ads_plan`
- `paid_ads_approval_packet`
- `paid_ads_receipt`
- `paid_ads_export_summary`

Final slots to consider later:

- `Ad Campaign Plan`
- `Paid Ads Audit`
- `Launch Approval Packet`
- `Ads Setup Receipt`

Do not promote automatically to Final. Let user or agent tool promote only when approved.

## Analysis Rules

### Core Questions

Every audit should answer:

- Is the campaign spending?
- Is delivery blocked?
- Is the account/campaign in learning or limited state?
- Is budget too low, too high, or misallocated?
- Is the objective aligned with the user's actual goal?
- Is targeting too broad, too narrow, or stale?
- Is creative fatigue visible?
- Is CTR healthy for the platform/format?
- Is CPC/CPM rising without conversion lift?
- Are conversions configured and visible?
- Are search terms/placements wasting spend?
- Are landing pages converting or leaking?
- What should be paused, duplicated, refreshed, excluded, or tested next?

### Confidence Labels

Each finding should carry:

- `high` if backed by CLI/API/export data.
- `medium` if backed by dashboard-visible table plus screenshot.
- `low` if inferred from screenshot or partial user description.

### Recommendation Shape

Each recommendation should include:

- issue
- evidence
- why it matters
- suggested action
- expected upside
- risk
- approval needed or not

## Safety Rules

### Always Allowed Without Approval

- Read public docs.
- Open ad dashboards.
- Inspect account/campaign/ad settings.
- Change local visible date range for reporting.
- Apply dashboard filters for inspection.
- Export/download reports.
- Take screenshots.
- Parse local files.
- Produce plans, drafts, and recommendations.

### Requires Explicit Approval

- Publish, launch, or submit any campaign/ad/ad set/ad group.
- Save changes to budget, bid, schedule, status, targeting, placements, keywords, creative, URL, UTM, conversion goal, catalog, or billing.
- Pause, enable, remove, archive, delete, duplicate, or bulk edit.
- Apply platform recommendations.
- Upload new creative into an ad account.
- Create, edit, or delete audiences.
- Create, edit, or delete conversion events.
- Change billing/payment/account settings.

### Hard Stops

Stop and hand control to the user when:

- Password entry appears.
- 2FA appears.
- CAPTCHA appears.
- Provider security checkpoint appears.
- Payment method setup appears.
- Legal/policy attestation appears.
- Political/special-ad-category issue appears and facts are unclear.
- The agent cannot tell whether a button is preview/save/publish.

## Approval Packet Standard

Before any approved action, the agent must show:

- Platform and account.
- Current page/URL.
- Exact action.
- Exact spend impact.
- Before/after settings.
- Screenshots or export evidence.
- Rollback plan where applicable.
- The exact approval phrase it needs.

Example:

```text
Approval needed:
Approve publishing "WTVOY - Traffic - Tornado Hook - 2026-07-06" in Meta Ads account "Mikey Mike".

Spend impact:
$20/day starting July 8, ending July 15.

I will click:
Publish campaign.

Rollback:
Pause campaign immediately if the receipt does not show expected draft/live state.
```

## UI Requirements

### Ads Agent Setup Card

Show:

- Google Ads CLI/API status.
- Meta Ads API/MCP status.
- Browser dashboard availability.
- Last successful dashboard export.
- Last successful CLI/API read.
- Recommended path:
  - "Use browser dashboard"
  - "Use Google Ads CLI"
  - "Upload export"
  - "Connect API"

### Browser Operation Banner

When the agent controls a dashboard:

- Platform.
- Account if known.
- Current action:
  - inspecting
  - exporting
  - drafting
  - waiting for approval
  - applying approved change
- Clear "Take over" / "Release browser" affordance.

### Approval Modal

Use the existing approval model where possible, but paid ads should show spend impact prominently:

- action type
- account
- campaign/ad/ad set/ad group
- daily/lifetime budget
- start/end dates
- exact UI click or command
- evidence links

## Implementation Plan

### Phase 1: Spec + Source Routing

- Add this backlog spec.
- Audit existing Ads Agent, `google-ads` source, `meta-ads` source, `browser_tool`, and `computer-use`.
- Decide whether Meta Printing Press CLI should be bundled as a local read-only source or kept as later optional install.
- Add routing decision tree to Ads Agent docs/prompt.

Phase 1 execution note, 2026-07-07:

- Existing Ads Agent, `google-ads`, `meta-ads`, `browser_tool`, `computer-use`, and Outputs paths were audited in [Paid Ads Execution Prep](./paid-ads-execution-prep.md).
- Decision: do not bundle Meta Printing Press CLI in V1 Phase 1. Keep Meta's official Ads MCP as the connected API path, and make browser dashboard/export mode the normal fallback when Meta API/MCP access is missing or blocked.
- Ads Agent now keeps `google-ads` required and `meta-ads` optional, and its prompt no longer blocks Meta work on OAuth setup. It routes through CLI/API/MCP when connected, browser dashboard/export when not, user-provided exports when automation is blocked, and Computer Use only as a narrow fallback.

Phase 2 execution note, 2026-07-07:

- Added `tools/ads-operator` as a read-only local CLI skeleton.
- Implemented deterministic `doctor`, route-plan commands for `accounts` and `campaigns`, CSV `import`, `export-plan`, and approval-only `packet create`.
- Mutation-like commands fail closed and report `writeExecuted: false`.
- Approval packets redact secret-like text fields and mark local evidence paths as verified/unverified.
- Google `cost_micros` imports normalize to account currency units instead of raw micros.
- CSV import now handles report preamble rows, Meta Ads Manager export headers, Google Ads search-term export headers, currency/percent values, and richer normalized metrics.
- Added read-only `audit` for spend waste, weak CTR, no-conversion spend, search-term cleanup, fatigue signals, and budget concentration.
- Added read-only `campaign-plan` for artist-context campaign structures, target audiences, territories, goals, and budget planning.
- Added approval packet file output and receipt schema/creation.
- Added `ads-operator` as a builtin local source pointing at `tools/ads-operator`.
- Ads Agent prompt now points CSV export analysis and approval packet creation at `tools/ads-operator`.
- Electron packaging now includes `tools/ads-operator` with the other managed local tools.

### Phase 2: Ads Operator CLI Skeleton

- Add `tools/ads-operator`.
- Implement `doctor`.
- Implement CSV import skeleton.
- Implement normalized metric schema.
- Implement approval packet JSON schema.
- Add unit tests for schema validation.

### Phase 3: Export Parsers

- Meta campaign/ad set/ad CSV parser.
- Google campaign/ad group/keyword/search term CSV parser.
- Basic GA4 channel/source parser.
- Column alias mapping.
- Currency/date normalization.
- Confidence/warnings model.

### Phase 4: Audit Engine

- Budget/spend pacing checks.
- Delivery blocked checks.
- CTR/CPC/CPM trend checks where date rows exist.
- Meta frequency/fatigue checks.
- Google search term waste checks.
- Google lost impression share checks.
- Conversion visibility checks.
- Landing-page mismatch checks if GA4 context is present.

### Phase 5: Browser Flowbooks

- Add paid ads skill with Meta and Google flowbooks.
- Update Ads Agent to use browser dashboard mode when API is missing.
- Add browser evidence capture instructions.
- Add user handoff instructions for blocked exports.

### Phase 6: Approval Packets + Outputs

- Generate approval packets as files.
- Publish packets as Outputs.
- Capture receipts after approved actions.
- Save screenshots/downloads under a stable evidence folder.

### Phase 7: UI Polish

- Ads Agent setup card.
- Browser operation banner.
- Approval modal with spend impact.
- Output widgets for recent ad audits/plans.

### Phase 8: Optional Printing Press Expansion

- Bundle/install Meta Ads read-only CLI if licensing/provenance is acceptable.
- Add GA4 CLI source if useful for campaign analytics.
- Add Google Ad Manager CLI source only for publisher/ad-ops use cases.
- Add `cli-printing-press auth doctor` style aggregate health if Printing Press tools are installed.

## Testing Plan

### Unit Tests

- CSV parser accepts common Meta export headers.
- CSV parser accepts common Google Ads export headers.
- Unknown columns are preserved in `raw`.
- Required context warnings are generated.
- Currency/date parsing is stable.
- Approval packets reject missing account/action/spend-impact/evidence fields.
- No secret-like values are written to packet/receipt output.

### Integration Tests

- `ads-operator doctor --json` returns deterministic status.
- Import sample Meta CSV -> normalized rows.
- Import sample Google CSV -> normalized rows.
- Audit sample data -> expected findings.
- Approval packet -> Output creation path.

### Browser Fixture Tests

Use local static fixture pages that mimic:

- Meta campaigns table.
- Meta campaign setup review screen.
- Google Ads campaigns table.
- Google Search campaign review screen.
- Export/download button.
- Publish/save/enable danger buttons.

Verify:

- Agent can snapshot, find, click, wait, download, and parse.
- Agent stops before publish.
- Agent captures screenshot evidence.

### Live Manual Smoke

Do this only with user-owned accounts and smallest safe actions.

Read-only smoke:

- Open Meta Ads dashboard.
- Confirm account.
- Set date range.
- Export campaign CSV.
- Parse and summarize.

Draft-only smoke:

- Start Meta campaign draft.
- Fill harmless draft fields.
- Stop before publish.
- Produce approval packet.
- User cancels.

Google read-only smoke:

- Open Google Ads dashboard.
- Confirm account.
- Export campaigns/keywords/search terms.
- Parse and summarize.

Google draft-only smoke:

- Start Search campaign draft.
- Fill harmless draft fields.
- Stop before publish.
- Produce approval packet.
- User cancels.

Optional approved smoke:

- Only after user explicitly agrees.
- Use tiny spend or paused/draft state.
- Capture receipt.

## Security And Privacy

- Never print or persist provider tokens.
- Never inspect cookies/local storage for auth material.
- Never save raw login pages, passwords, or 2FA screenshots into Outputs.
- Treat ad account IDs, campaign IDs, spend, and customer data as private workspace data.
- Redact emails, phone numbers, customer lists, and payment details from receipts.
- If customer list/custom audience upload appears, require a separate explicit privacy warning.
- Keep all browser exports under workspace-local evidence paths.
- Do not upload exports to third-party LLM/tooling unless the user explicitly allows.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Provider dashboard changes UI labels | Browser flow breaks | Prefer exports and fixture tests; keep flowbooks easy to update |
| Electron browser login blocked | User cannot reach dashboard | Support external Chrome CDP and manual export fallback |
| Computer Use macOS permissions fail | Visual fallback unavailable | Keep Computer Use optional, not primary |
| Agent clicks publish accidentally | Real spend/action risk | Hard approval packet gate plus danger-button stop rules |
| CSV formats vary | Bad analysis | Column alias maps, warnings, raw preservation |
| API credentials missing | CLI path unavailable | Browser dashboard mode is first-class |
| API credentials expire | Intermittent failure | Doctor/auth status first, clear reconnect instruction |
| Screenshots misread numbers | Bad recommendations | CSV/API data preferred; screenshot-only findings marked low confidence |
| User has wrong account selected | Wrong campaign action | Account confirmation required before every write packet |
| Provider ToS/security check | Account risk | Stop on CAPTCHA/2FA/security/policy prompts |

## Acceptance Criteria

V1 is acceptable when:

- A user without Meta/Google API approval can ask Ads Agent to analyze a campaign from dashboard export.
- A user without Google Ads developer-token approval can still receive a Google Ads campaign audit from browser/export data.
- Ads Agent can open or guide the correct dashboard flow and produce a precise export handoff if automation is blocked.
- Ads Agent can draft a Meta or Google Search campaign and stop before publish.
- Every live mutation produces an approval packet before action and a receipt after action.
- CLI/API mode is still preferred when configured.
- Existing `google-ads` wrapper continues to work.
- No token/secrets leak into chat, logs, Outputs, receipts, or Canvas.
- Tests cover parsers, packets, and browser fixture stop-before-publish behavior.

## Backlog Checklist

- [x] Add `paid-ads-browser-operator` skill.
- [x] Add `ads-operator` local source.
- [x] Add `tools/ads-operator` CLI skeleton.
- [x] Add Meta CSV parser V1.
- [x] Add Google Ads CSV parser V1.
- [ ] Add GA4 context parser.
- [x] Add normalized metrics schema V1.
- [x] Add audit engine V1.
- [x] Add approval packet schema.
- [x] Add receipt schema.
- [ ] Update Ads Agent prompt/source/skill wiring.
- [ ] Add browser flowbook docs.
- [ ] Add browser fixture tests.
- [ ] Add live verification checklist entries.
- [ ] Add user docs for "Ads without API approval".
- [ ] Add setup UI copy explaining CLI/API vs browser modes.

## Open Questions

- Should Runner bundle the Meta Ads Printing Press CLI as a local read-only source, or keep Meta's official hosted MCP source as the only built-in Meta source until the browser operator lands?
- Should external Chrome CDP be a first-class Runner source, or only a developer/power-user fallback?
- Where should browser evidence folders live for cross-workspace portability?
- Should approval packets become a generic Runner action type beyond paid ads?
- Should budget/spend approvals require a stricter confirmation phrase than normal external actions?
- Should campaign setup use in-app browser by default, or ask the user whether to use their already-logged-in Chrome profile?
