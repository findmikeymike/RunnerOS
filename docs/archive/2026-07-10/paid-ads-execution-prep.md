---
status: archived
owner: agent
last_verified: 2026-07-10
source_of_truth: false
---

> Archived 2026-07-10. Reason: the preparation map was executed and now points at an old worktree. Remaining Ads Operator work is tracked in `docs/backlog/paid-ads-browser-cli-operator.md`; live account proof is tracked in `external-integration-live-verification.md`.

# Paid Ads Execution Prep

Prep target: execute [Paid Ads Browser + CLI Operator](../../backlog/paid-ads-browser-cli-operator.md) at a high level without guessing.

## Current Repo State

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center`
- Branch: `codex/creator-command-center`
- Upstream: `origin/codex/creator-command-center`
- Git status at prep time: clean.

## 1. Current Ads Agent Map

Source: `packages/shared/src/agent-definitions/starter-templates.ts`

- Ads Agent slug: `ads-agent`
- Current skills: `meta-ads`, `google-ads`, `paid-ads-browser-operator`
- Current sources: `meta-ads`, `google-ads`, `ads-operator`
- Current permission mode: `ask`
- Current prompt bias: CLI/API/MCP first when connected; browser dashboard/export mode when Meta, Google, or Spotify API access is missing, expired, blocked, or insufficient.

Phase 1 mismatch that was fixed:

- Backlog wants browser/export mode to be first-class when API approval is missing.
- Previous prompt told the user Meta OAuth must be connected first.
- Previous starter-agent test enforced that old behavior.

Phase 1 changes made:

- Ads Agent now attaches the existing `meta-ads` builtin source as optional, so unauthenticated Meta MCP does not get injected into sessions.
- Ads Agent prompt now routes `CLI/API/MCP -> browser dashboard export -> user-provided export -> Computer Use fallback`.
- Decision recorded: do not bundle Meta Printing Press CLI in V1 Phase 1.
- Spotify Ads V1 route added: use Spotify Ads Manager / Spotify Ad Studio through the browser for planning and drafts; use Spotify for Artists only for audience/song/city intel. Spotify Ads API is optional later and must not block V1 work.

Required later change:

- None for the Phase 1/2 routing skeleton.

Phase 2 current state:

- `tools/ads-operator` exists as a read-only CLI skeleton.
- `ads-operator` exists as a builtin local source pointing at `tools/ads-operator`.
- `paid-ads-browser-operator` exists as the browser/export operating protocol skill.
- It supports `doctor`, `accounts`, `campaigns`, `export-plan`, CSV `import`, and approval-only `packet create`.
- It does not execute mutations; mutation-like commands fail closed.
- Approval packets redact secret-like values, record structured evidence, and mark local evidence paths as verified/unverified.
- Google `cost_micros` imports are scaled down to account currency units.
- CSV import handles report preamble rows, Meta Ads Manager export headers, Google Ads search-term export headers, currency/percent values, and richer normalized metrics.
- Audit engine V1 flags spend waste, weak CTR, no-conversion spend, search-term cleanup, fatigue signals, and budget concentration.
- Campaign plan V1 drafts read-only campaign structures from artist context, territories, goals, and budget. Live creation still requires approval packet flow.
- Campaign plans can be written to JSON artifacts with `--out`.
- Approval packet file output and receipt schema/creation are implemented.

## 2. Source And Tooling Map

Source registry: `packages/shared/src/sources/builtin-sources.ts`

- `google-ads` is a builtin local CLI source.
- `ads-operator` is a builtin local CLI source for read-only export normalization, route planning, and approval packets.
- `meta-ads` is a builtin MCP source using `https://mcp.facebook.com/ads`.
- `computer-use` is builtin but should remain optional.

Packaging: `apps/electron/electron-builder.yml`

- Existing local tools are explicitly packaged.
- `tools/ads-operator` is now included in package files and extraResources in every relevant block, matching `tools/google-ads`.

Google Ads wrapper: `tools/google-ads/bin/google-ads.mjs`

- Wrapper resolves bundled `google-ads-pp-cli`.
- It loads cached RunnerOS credentials from `~/.config/runneros/google-ads/credentials.json`.
- Live local check passed structurally:
  - API reachable.
  - Auth not configured.
  - Missing `GOOGLE_ADS_ACCESS_TOKEN` and `GOOGLE_ADS_DEVELOPER_TOKEN`.

Browser tool:

- `browser_tool` already supports open, navigate, snapshot, find, click, fill, paste, upload, wait, screenshot, downloads, evaluate, focus, release, close.
- System prompt already frames browser use as a fallback when source setup/API coverage is fragile.
- Paid ads needs stricter danger-button doctrine, not a brand-new browser engine for V1.

Outputs:

- `create_output` already supports `report`, `dataset`, `receipt`, `external-action`, files, receipts, context, approval, and Canvas display.
- Paid ads can use existing Output types first; custom paid-ad output taxonomy can be tags before new enum work.

## 3. Test Impact Map

Known tests to update or add:

- `packages/shared/src/agent-definitions/storage.test.ts`
  - Updated in Phase 1 to expect `google-ads`, `meta-ads`, `ad-creative`, browser dashboard/export routing, Meta Printing Press CLI deferral, routing decision tree, approval packet language, and explicit approval.
- `packages/shared/src/sources/__tests__/storage.test.ts`
  - Already covers `google-ads` and `meta-ads` builtin resolution.
  - Added coverage for `ads-operator` builtin resolution.
- New tests for `tools/ads-operator`
  - `doctor --json` deterministic shape.
  - Meta CSV parser accepts common campaign/ad set/ad export headers.
  - Google Ads CSV parser accepts campaign/ad group/keyword/search-term exports.
  - Report preamble rows are skipped before the detected header row.
  - Currency, comma-separated numbers, percentages, and Google `cost_micros` are normalized.
  - Audit output includes totals, findings, recommended actions, and no writes.
  - Campaign plan output includes artist-context signals, territories, structure, research prompts, and approval gate.
  - Packet files and receipt files are created with write-executed guardrails.
  - Unknown columns are preserved in `raw`.
  - Secret-like values are not emitted in packets/receipts.
  - Approval packet rejects missing account/action/spend impact/evidence.
- Later browser fixture tests
  - Static Meta table/export page.
  - Static Google Ads table/export page.
  - Publish/save danger-button stop behavior.

## 4. Build Architecture Map

Recommended first implementation slice:

1. Add `tools/ads-operator` skeleton.
2. Implement pure local schemas and validation:
   - `AdConnectionProfile`
   - `AdDataImport`
   - `NormalizedAdRow`
   - `AdActionPacket`
   - `AdReceipt`
3. Implement `doctor --json`.
4. Implement CSV parser core with platform column alias maps.
5. Add sample fixture CSVs and tests.
6. Add builtin `ads-operator` source. Done.
7. Add `paid-ads-browser-operator` skill. Done.
8. Regenerate system map after the new source/skill lands.

Defer until after the first green slice:

- Browser dashboard automation.
- Live dashboard smokes.
- Approval modal UI changes.
- External Chrome CDP.
- Meta Printing Press CLI bundling.
- Custom paid-ad Output kind enum changes.

Reason:

- Parser/schema/operator foundation is deterministic, testable, and safe.
- Browser/live account work is high-variance and should sit on top of working import/audit/packet contracts.

## 5. Current External Research

Authoritative checks done on 2026-07-07:

- Google Ads API access is still governed by developer-token access levels and permissible use. Production access requires appropriate access level; Basic Access review is documented as 5 business days and Standard as 10 business days.
  - Source: https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- Google Ads API OAuth still requires OAuth 2.0 plus a developer token.
  - Source: https://developers.google.com/google-ads/api/docs/oauth/overview
- Google Ads UI statistics tables can be downloaded as reports, including Excel CSV, TSV, PDF, XLSX, XML, and Google Sheets.
  - Source: https://support.google.com/google-ads/answer/2404176
- Meta Marketing API still separates permissions such as `ads_read` / `ads_management` from Marketing API access tier. Meta renamed Ads Management Standard Access to Marketing API Access Tier on 2026-05-04.
  - Source: https://developers.facebook.com/docs/permissions/
  - Source: https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization
  - Source: https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/
- Runner already points `meta-ads` at Meta's hosted Ads MCP endpoint, but account eligibility/OAuth readiness still must be treated as conditional.
  - Local source: `packages/shared/src/sources/builtin-sources.ts`

Research implication:

- The backlog premise is valid: do not block paid-ads usefulness on API approval. Browser/export mode should be a normal path, not a sad fallback.

## Execution Recommendation

Start with a new implementation branch or nested worktree if the next step is coding. First build target:

```text
tools/ads-operator + builtin ads-operator source + paid-ads-browser-operator skill
```

First verification gate:

```bash
node tools/ads-operator/bin/ads-operator.mjs doctor --json
bun test tools/ads-operator/test
bun test packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/sources/__tests__/storage.test.ts
bun run docs:system-map
bun run typecheck:shared
git diff --check
```

Hard safety rule for all later slices:

- The agent may inspect, export, parse, draft, and create approval packets without spend approval.
- The agent must not publish, save dashboard mutations, change budgets/status/bids/targets/creative/keywords/conversions/billing, upload assets, or apply recommendations without explicit approval naming the exact account, action, and spend impact.
