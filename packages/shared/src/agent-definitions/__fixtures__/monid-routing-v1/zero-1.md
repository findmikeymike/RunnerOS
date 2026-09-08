---
name: Zero
description: Discover and call external API capabilities through Zero when RunnerOS has no healthy native connector or dedicated specialist.
requiredSources:
  - zero
tags: [tools, api, marketplace, paid]
---

# Zero

Use Zero as a gap closer, not the first choice. Prefer a healthy native connector, built-in tool, or dedicated worker when one fits. Do not use Zero for code edits, local files, shell work, math, or ordinary model answers.

## Discover

Check setup without spending:

```bash
command -v zero && zero --version
```

Search narrowly at run time. Use at most three searches and inspect at most three finalists:

```bash
zero search "<specific capability>" --agent anything-agent --limit 5 --status healthy --json
zero get <exact-capability-slug> --agent anything-agent --formatted
```

Always use the exact slug returned by search. Positional numbers can refer to stale search state. Never use `--all` by default, reuse a remembered schema or price, or invent fields when a schema is missing.

A domain skill may name one preferred capability slug and a strict price ceiling. In that case, run `zero get` for that exact slug on every run. Skip marketplace search only when this live preflight confirms the capability is healthy, its current request schema exactly fits the intended operation, and its current price is within the named ceiling. If any check fails, search and vet a replacement normally. A preferred slug never permits reusing remembered health, schema, or price.

Compare exact fit, request/response schema, read/write behavior, authentication, provider identity, availability, last success, reviews, stars, success rate, and price. Prefer a credible economical provider. Reject unclear, unhealthy, or suspicious providers when a credible option exists. For sensitive or high-stakes work, verify the provider through public sources or stop.

## Weekly allowance

Paid calls use the bundled guard. It stores one user-approved weekly limit, reserves each call before execution, tracks the week from Monday in local time, and refuses any call that could exceed the remaining balance. Locate the installed skill with `craft-agent skill where zero`; the examples below use the normal production path.

Check it freely:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs status --json
```

If no limit exists, ask once for a weekly amount. After the user answers, configure it once; changing the amount also requires approval:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs configure --weekly-limit <usd> --json
```

GET retrieval inside the remaining allowance does not need another approval:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs fetch --capability <exact-slug> --max-pay <per-call-usd> --json
```

For POST, PUT, PATCH, or DELETE, turn the whole user-requested job or saved workflow into one bounded authorization. This is one approval for the batch, not one approval per API call:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs authorize --capability <exact-slug> --method <method> --max-calls <count> --max-total-pay <usd> --expires-in-hours <hours> --purpose "<plain-language job>" --json
```

Then reuse its returned ID for every matching call inside those limits:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs fetch --capability <exact-slug> --method <method> --data-json '<json>' --max-pay <per-call-usd> --authorization <zero_auth_id> --json
```

For a scheduled workflow, create this authorization during setup and bind the ID into the workflow. Choose a realistic call count and expiration for the agreed recurrence. The guard re-inspects the capability before every call and stops if its provider URL or method changed. It accepts inline JSON only; no arbitrary URLs, caller-supplied headers, or local-file uploads.

Revoke unused standing authorization when the user cancels the job:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs revoke --authorization <zero_auth_id> --json
```

## Hard rules

- The weekly allowance controls total spend. A bounded job authorization controls non-GET work.
- Group the user's complete requested batch into one authorization. Never ask once per item or once per small call.
- Always set `--max-pay` to the inspected call price or a tight ceiling no greater than the remaining weekly balance.
- Never bypass the guard with direct `zero fetch` during automatic work.
- Never automatically retry a paid failure. Reinspect the receipt and decide whether a new call is justified.
- Never install the CLI, fund/import a wallet, store credentials, or accept provider terms without explicit approval.
- Send only data the provider actually needs; do not expose secrets or unnecessary personal information.
- Read success from `ok` in JSON. Report provider, capability, actual or conservatively reserved cost, remaining weekly balance, and limitations.
- Review completed paid calls when useful with `zero review <runId> ...`; do not fabricate a review.

Development installations normally use `~/.artist-os-dev/...`; Runner installations use their own agent library. Always use the exact directory reported by `craft-agent skill where zero`.
