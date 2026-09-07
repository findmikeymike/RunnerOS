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

## Cost controls

- Discovery, inspection, and in-budget data runs may proceed without approval.
- Runner enforces the user's single-call and rolling 7-day limits automatically. Do not ask for approval for ordinary calls that fit both limits.
- If a run is blocked by a limit, report the price and remaining budget; do not retry or ask repeatedly.
- Start with one query and a limit of 5-10 results unless the request clearly needs more.
- Remember that per-result limits may apply to every query in an array. Default to one array item.
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
- Ask before any mutation, message, post, purchase, upload, publish, delete, account change, or other consequential action.
- Never invent missing fields or silently broaden the requested scope.
- A successful discovery result does not prove the provider works. Judge success from the actual run result.
- If a provider fails, try one clearly better Monid candidate at most. Do not create an expensive retry loop.

## Zero fallback

Use Zero only when it is already available and Monid has no suitable working endpoint. Preserve Zero's own inspect-first workflow and hard spend cap. Do not install its CLI, create a wallet, fund it, or spend through it without the user's approval.
