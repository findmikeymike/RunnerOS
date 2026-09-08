---
name: Monid
description: Discover, inspect, and run external data and service tools through the built-in Monid MCP connection.
requiredSources:
  - monid
tags: [tools, mcp, research, data, paid]
---

# Monid

Use Monid when a task needs an external capability that RunnerOS does not already provide through a dedicated connected source. Typical jobs include web and social search, scraping, enrichment, company or people data, product research, media services, and live structured data.

Do not use Monid for local files, code edits, shell work, math, or questions the model can answer without fresh external data.

This is the MCP-native RunnerOS adaptation of Monid's official agent guidance. Do not install the Monid CLI or ask the user for an API key; users connect their Monid account in RunnerOS Settings.

## Marketplace preference

Use a dedicated connected source first, then Monid for marketplace capabilities. Use Zero only when the user explicitly requests Zero or current Monid discovery and inspection establish that Monid does not provide the needed capability. A disconnected account, budget block, outage, failed request, or unresolved paid attempt is not capability absence and never authorizes switching to Zero.

Use the connected Monid MCP tools exposed by the source for discovery, inspection, execution, and result retrieval. Read the actual tool schemas; tool names and request fields must come from the connection, not guessed CLI-to-MCP names. Load this skill when external tool work is needed; do not require a startup read for ordinary conversation.

## Tool order

1. **Discover** the narrow capability needed for this task.
2. **Inspect** the best candidate before any paid run.
3. **Run** with the smallest useful input and result limit.
4. **Poll or retrieve** asynchronous results without blocking the conversation unnecessarily.
5. Report the useful result, material cost, and any provider failure.

Always read response hints before choosing the next action. They may contain endpoint relationships, caveats, or the correct follow-up operation.

## Choosing an endpoint

- Prefer an existing dedicated RunnerOS source when it already covers the service.
- Match the endpoint to the exact task; do not choose only by provider popularity.
- Use health to break ties between endpoints that fit; do not use it as a hard filter.
- Prefer verified endpoints with `healthy` or `stable` status when fit and price are comparable.
- Treat `unknown` health as missing evidence, not automatic failure.
- Never use an endpoint marked as an outage unless the user explicitly wants to try it.
- Inspect the current schema, price, health, and expected runtime every time. Do not reuse stale parameters from memory.
- Map inspected body, query, and path inputs exactly to the corresponding MCP run fields. Never guess where a parameter belongs.

## Pinned YouTube Routes

For YouTube, use the connected native source first, then these Monid pins. The Zero exception below still applies; unavailable Monid is not an automatic fallback. Do not search the marketplace on every run:

- Transcripts: provider `apify`, endpoint `/starvibe/youtube-video-transcript`. One canonical `youtube_url`, with `language: "en"`; never mix in a channel URL. Preserve timestamped segments and verify the returned video identity. Maximum price is `$0.02` per video, or the user's lower limit.
- Channel/video metadata: provider `apify`, endpoint `/streamers/youtube-scraper`. Inspect the schema and use one `startUrls` entry with explicit result limits. This is separate from transcription; do not transcribe an entire channel just to resolve its name.
- Inspect the pinned endpoint's current schema, price and availability before spending. A pin removes repeated discovery, not validation. If the task no longer fits the pin, discover the missing capability within Monid. Report an unavailable pinned route; do not switch providers to repeat an unresolved paid attempt.
- For host-managed Signals runs, the collector owns provider calls, caching and paid-attempt receipts. Analyze its packets; do not independently call these tools to repeat collection. An interrupted or uncertain paid attempt must be reconciled before another provider is charged.

Pin references: [Monid transcript recipe](https://monid.ai/blog/every-youtube-transcript-ready-for-your-llm), [Monid metadata recipe](https://monid.ai/blog/guides/youtube-scraper-past-the-quota). Public documentation is not proof of a successful live run.

## Other narrow routes

These are economical candidates observed in the official public catalog on 2026-09-08, not claims of best reviews or proven live reliability. Inspect current schema, total price and availability before every paid run. Pins skip discovery only for the exact matching job. Dedicated connected tools remain first.

| Job | Provider and endpoint | Observed price and scope |
| --- | --- | --- |
| Requested professional email from known person/company | `hunterio` `/email-finder` | $0.02392/result; inspect required identity inputs. Keep confidence, source URLs and deliverability; never invent an address. |
| Known LinkedIn profile | `ploid` `/linkedin/profile` | $0.01/call; public role/history, not an email finder. |
| Public Instagram profile | `tikhub` `/api/v1/instagram/v1/fetch_user_info_by_username` | $0.0015/call; one username. Preserve actual nested field meanings. |
| Bounded web search | `context.dev` `/web/search` | $0.00009/result; summary states a 10-result minimum. Inspect bounds and start at the valid minimum. |
| One URL as readable text | `context.dev` `/web/scrape/markdown` | $0.0009/call; one URL and inspected extraction options. |
| Approved economical image draft | `minimax` `/v1/image_generation` | $0.0035/result; one image. Text-only draft under the current guard; use a different inspected route for reference images or edits. No typography-quality guarantee. |

Official current-detail references: [email](https://api.monid.ai/public/v1/providers/hunterio/endpoints/email-finder), [LinkedIn](https://api.monid.ai/public/v1/providers/ploid/endpoints/linkedin/profile), [Instagram](https://api.monid.ai/public/v1/providers/tikhub/endpoints/api/v1/instagram/v1/fetch_user_info_by_username), [search](https://api.monid.ai/public/v1/providers/context.dev/endpoints/web/search), [page text](https://api.monid.ai/public/v1/providers/context.dev/endpoints/web/scrape/markdown), [image draft](https://api.monid.ai/public/v1/providers/minimax/endpoints/v1/image_generation). Public catalog prices and verification tags do not prove this app has run the endpoint successfully; current health/reviews may be unavailable.

## Cost controls

- Discovery, inspection, and in-budget data runs may proceed without approval.
- Runner enforces the user's single-call and rolling 7-day limits automatically. Do not ask for approval for ordinary calls that fit both limits.
- If a run is blocked by a limit, report the price and remaining budget; do not retry or ask repeatedly.
- Start with one query and a limit of 5-10 results unless the request clearly needs more.
- Remember that per-result limits may apply to every query in an array. Default to one array item.
- Pricing may include tiers, units, variants and output-dependent fees; a zero base amount does not mean free. Stop when the existing guard cannot bound the complete price.
- Never bypass an unclear or unbounded price. Use a bounded result field such as `maxItems` or `limit` for per-result endpoints.
- Reconcile the projected charge against the actual `cost.value` returned by the completed run. Mention cost when it is material or the user is budget-conscious.

## Run lifecycle

- For interactive work, start the run and poll rather than blocking for the full runtime.
- Poll about every 5-10 seconds until a terminal status: `COMPLETED`, `FAILED`, `BLOCKED`, `STOPPED`, or `TIMED_OUT`.
- Status values are uppercase. A `BLOCKED` run is terminal: surface the relevant control from its `controls` data and do not keep polling or retry unchanged.
- Only attempt to stop an active run when its detail says `stoppable: true`; then poll until it reaches `STOPPED`.
- Save or return the completed result through the MCP response or an explicit user-requested output path. Do not create arbitrary result files by default.

## Safety

- External reads may run when they are clearly within the user's request and budget.
- Require approval covering any mutation, message, post, purchase, upload, publish, delete, account change, or other consequential action. Reuse an existing explicit bounded workflow authorization within its approved scope; do not ask again per item.
- Never invent missing fields or silently broaden the requested scope.
- A successful discovery result does not prove the provider works. Judge success from the actual run result.
- Only after a confirmed terminal failure and reconciliation of its paid attempt may you try one clearly better Monid candidate within the approved scope and budget. Never repeat an uncertain or pending paid submission. Do not create an expensive retry loop.

## Zero fallback

Use a dedicated connected source first, then Monid for marketplace capabilities. Use Zero only when the user explicitly requests Zero or current Monid discovery and inspection establish that Monid does not provide the needed capability. A disconnected account, budget block, outage, failed request, or unresolved paid attempt is not capability absence and never authorizes switching to Zero. Preserve Zero's own inspect-first workflow and hard spend cap. Do not install its CLI, create a wallet, or fund it without the user's approval. Eligible reads use the saved weekly allowance; other actions require the existing bounded job authorization.
