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

Compare exact fit, request/response schema, read/write behavior, authentication, provider identity, availability, last success, reviews, stars, success rate, and price. Prefer a credible economical provider. Reject unclear, unhealthy, or suspicious providers when a credible option exists. For sensitive or high-stakes work, verify the provider through public sources or stop.

## Weekly allowance

Paid calls use the bundled guard. It stores one user-approved weekly limit, reserves each call before execution, tracks the week from Monday in local time, and refuses any call that could exceed the remaining balance.

Check it freely:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs status --json
```

If no limit exists, ask once for a weekly amount. After the user answers, configure it once; changing the amount also requires approval:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs configure --weekly-limit <usd> --json
```

Routine read-like calls inside the remaining allowance do not need a new spending prompt:

```bash
node ~/.artist-os/libraries/agents/skills/zero/scripts/zero-budget.mjs fetch --capability <exact-slug> --max-pay <per-call-usd> --read-only --json
```

Add `--method POST --data-json '<json>'` only when the inspected schema requires it. The guard accepts only the exact inspected capability slug, GET/POST, and inline JSON; it does not accept arbitrary URLs, headers, or local-file uploads. `--read-only` means the provider returns data or a generated artifact without changing an outside account, publishing, sending, purchasing, deleting, or accepting terms. Never label an external mutation read-only.

## Hard rules

- The weekly allowance is the sole standing approval for routine paid retrieval/generation. It is not approval for external mutations.
- Always set `--max-pay` to the inspected call price or a tight ceiling no greater than the remaining weekly balance.
- Never bypass the guard with direct `zero fetch` during automatic work.
- Never automatically retry a paid failure. Reinspect the receipt and decide whether a new call is justified.
- Never install the CLI, fund/import a wallet, store credentials, or accept provider terms without explicit approval.
- Send only data the provider actually needs; do not expose secrets or unnecessary personal information.
- Read success from `ok` in JSON. Report provider, capability, actual or conservatively reserved cost, remaining weekly balance, and limitations.
- Review completed paid calls when useful with `zero review <runId> ...`; do not fabricate a review.

Runner installations outside Artist OS use the corresponding installed Zero skill path under their agent library.
