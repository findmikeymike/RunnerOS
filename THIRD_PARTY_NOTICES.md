# Third-Party Notices

This product incorporates components from third-party projects, listed below
with their licenses and the portions of this repository that derive from them.

The full text of each upstream license is reproduced in the upstream project's
own `LICENSE` file (see the GitHub URL referenced in each section). Where this
repository ports code from an upstream project, the relevant source files
include a header comment crediting the upstream module.

---

## Hermes Agent (MIT)

Upstream: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
License: MIT

Portions of the following modules are ports of Hermes Agent source files
(MIT-licensed). Each ported module retains a header comment pointing to the
upstream file it derives from. Concept-level inspiration (where no source code
was copied) is documented in `.planning/research/`.

| RunnerOS module | Upstream file | Notes |
|---|---|---|
| `packages/shared/src/agent/spawn-session-isolation.ts` | `tools/delegate_tool.py` | Subagent isolation: blocklist, AsyncLocalStorage approval callback, spawn-depth gate, toolset intersection. See `.planning/research/02-subagent-isolation.md`. |
| `packages/shared/src/automations/hooks/` (R6) | `agent/shell_hooks.py` | Polyglot shell-hook runner with sha256-keyed allowlist, first-use consent gate, sibling-flock cross-process locking, and dual response-shape normalisation (`{decision, reason}` and `{action, message}`) plus `{context}` injection. |
| `packages/shared/src/protocol/acp/` (R8) | `acp_adapter/` | ACP stdio JSON-RPC adapter, session bridge, permission notifications. |
| `packages/shared/src/workflows/trigger-inputs.ts` (R5) | `cron/scheduler.py` lines 60-88 (`_resolve_cron_enabled_toolsets`), `cron/jobs.py` lines 523, 662 | Three-tier precedence resolver for per-run toolset overrides: per-job `enabled_source_slugs` (with `[]` as explicit deny-all) > per-platform config > workspace default. Wired into `packages/server-core/src/workflows/runner.ts` (`applyTriggerToolsetOverride`) before session creation. Also ports the `permission_mode` per-run hint (`default | subconscious | yolo`). |
| `packages/shared/src/agent/prompt-builder.ts` (R2) | `tools/cronjob_tools.py`, `cron/scheduler.py` | Prompt-injection regex pack (8 threat + 5 exfil patterns), invisible-unicode + ZWJ emoji handling, fully-assembled-prompt scan that closes Hermes bug #3968. |

The Hermes upstream snapshot used as a reference lives under
`.planning/research/upstream/hermes/` (read-only; not shipped).

---

## Conceptual References (not vendored)

These projects influenced RunnerOS design but **no source code was copied**.
The modules below are clean-room re-implementations from prose research
notes. Listed for attribution clarity and to keep the licensing posture of
this repository (Apache-2.0) intact.

| Upstream project | License | RunnerOS module | Notes |
|---|---|---|---|
| [OpenHuman](https://github.com/openhuman-ai/openhuman) `heartbeat` loop | GPL-3.0 | `packages/shared/src/config/reactive-config.ts` (R4) | Hot-reload config pattern (TTL cache + file-watcher push). Behavior derived from `.planning/research/04-openhuman-concepts.md` Upgrade 6. **No GPL source code copied.** |
| OpenHuman `scheduler_gate` | GPL-3.0 | `packages/shared/src/scheduler/gate.ts` + `system-pressure.ts` (R3) | Battery + CPU pressure-aware throttling. Defaults (battery_floor 0.8, cpu_busy 70, cpu_severe 95, throttled_backoff 30s, paused_poll 60s) are facts taken from the upstream config schema; the policy engine is re-written from prose spec. **No GPL source code copied.** |
| OpenHuman `subconscious_engine` | GPL-3.0 | `packages/shared/src/agent/escalation-store.ts`, `subconscious-mode.ts`, `subconscious-permissions.ts` (R7) | `escalate-on-write` mode + `UnapprovedWrite` outcome shape. Behavior derived from prose in `.planning/research/04-openhuman-concepts.md` §Upgrade 5. **No GPL source code copied.** |

The OpenHuman upstream snapshot referenced in research notes lives under
`.planning/research/upstream/openhuman/` (read-only; not shipped; not
imported by any source file).
