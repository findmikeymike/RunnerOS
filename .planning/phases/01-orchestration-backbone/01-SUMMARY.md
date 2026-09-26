# Phase 1: Orchestration Backbone — Final Summary

**Completed:** 2026-05-20
**Status:** ✅ Ship-ready (pending commit)
**Goal:** Land Hermes-derived safety + orchestration primitives and OpenHuman-inspired system-awareness, with cross-vendor ACP delegation.

## Requirements landed (8/8)

| # | Requirement | Source | New code | Tests |
|---|---|---|---|---|
| R1 | Subagent isolation (blocklist + depth + AsyncLocalStorage approval + toolset intersection) | Hermes MIT | `agent/spawn-session-isolation.ts` | 45 |
| R2 | Prompt-injection scan on assembled prompt (closes Hermes bug #3968) | Hermes MIT | `agent/prompt-builder.ts` | 32 |
| R3 | Scheduler gate — battery + CPU throttling with 5s pressure cache + battery-state preservation | OpenHuman concept | `scheduler/{system-pressure,gate}.ts` | 21 |
| R4 | Hot-reload config (reactive-config, TTL + push subscription) | OpenHuman concept | `config/reactive-config.ts` | 14 |
| R5 | Per-job toolset overrides + permission_mode plumbing (per-job > per-platform > default) | Hermes MIT | `workflows/trigger-inputs.ts` extensions + runner integration | 34 |
| R6 | Polyglot shell hooks (sha256-keyed allowlist, TOCTOU re-hash, realpath, env-scrub, streaming JSON parse) | Hermes MIT | `automations/hooks/*` + `shell-hook-handler` | 47 |
| R7 | Subconscious mode + escalation store (allowlist-of-reads default, SQLite-backed, runner-wired) | OpenHuman concept | `agent/{escalation-store,subconscious-mode,subconscious-permissions}.ts` | 27 |
| R8 | ACP adapter (stdio JSON-RPC, AsyncLocalStorage edit binding, SQLite session restore, sensitive-path always-prompt, WSL translation) | Hermes MIT | `protocol/acp/*` (9 files) | 52 |

**Total new tests:** ~272 across 18 files. **Phase 1 directories: 1202/1202 pass.** No regression to pre-existing suites.

## Cold reviews + fixes

Each requirement got an independent rival audit. Blockers found and fixed:
- **01-01**: 3 blockers (production wiring, phantom blocklist, namespace conflation) → fixed
- **01-02**: 2 fixes (pattern-id leak, TODO markers for skill-loader) → fixed
- **01-03**: 4 fixes (mode rename, pressure cache, battery preservation, override TODO) → fixed
- **01-04**: SPEC R4 revised (migration deferred — services don't consume StoredConfig); module ships as clean primitive; followups in `01-04-FOLLOWUPS.md`
- **01-05**: 1 blocker (proper-lockfile typecheck) + 3 exploitable security findings (TOCTOU, symlink swap, output-bloat downgrade) + 4 nits → fixed
- **01-06**: approved with 2 non-blocking follow-ups (consumed by 01-07)
- **01-07**: critical wiring gap (feature was invisible — gateWriteAttempt never invoked) + unsafe default classifier → fixed; wired into `claude-agent.ts:1070-1102` PreToolUse hook
- **01-08**: 2 blockers (NOTICES label, ACPClient hang-forever race) + 7 non-blockers (JSON-RPC parse error, notification branch, WSL at edit-approval, acpTimeoutMs, remote stderr, docstring, SENSITIVE_FILES additions) → fixed

## Holistic audit (4 parallel axes)

| Axis | Verdict | Action |
|---|---|---|
| Integration + wiring | 🔴 4 blockers → fixed (handler registry, R1+R8 ordering, R7+R8 forward, R6→R2 scan) | All landed |
| Security | 🔴 3 high → fixed (ACP realpath, shell-hook env scrub, SQLite chmod 0600) | All landed |
| Tests + verification | 🔴 2 → both NOT-ISSUE on re-verification (SessionManager narrowing already in place; ACP fast-reject passes) | Resolved |
| License + docs | 🟢 GREEN | No GPL contamination; MIT attribution complete; no Craft remnants in Phase 1 code |

## Gate status

- `bun run typecheck:all` from worktree root → **exit 0** ✅
- `bun test` packages/shared → 3313 pass / 1 fail (unrelated MCP transport test, outside Phase 1 surface)
- `bun test` packages/server-core → 166 pass / 0 fail ✅
- Phase 1 directories only → **1202/1202 pass** ✅
- License: clean-room for GPL-derived files, MIT attribution complete for Hermes ports

## What did NOT land in Phase 1 (intentional)

- **R4 migration of scheduler/poll/file-watch services to `reactive-config`** — those services consume `automations.json` matchers (separate refresh pipeline), not `StoredConfig`. Followups in `01-04-FOLLOWUPS.md`: hoist `gateConfig` into `StoredConfig.scheduler`, then subscribe.
- **Phase-1.1 follow-ups identified by the final fixer**:
  - Dedicated tests for the shell-hook outcome scanner wrapper, ACP-subconscious refusal branch, and `resolveRealPath` edge cases (the existing 1202 tests cover the paths but explicit unit tests are recommended)
  - Wire `setSubconsciousMode` into the runner's `createSession` path (currently the runner promotes the field on `CreateSessionOptions`; the agent's `setSubconsciousMode` consumes it but the integration is one-step removed from real-SDK end-to-end)
- **NFC/NFKC normalization in prompt-injection scan** — known Hermes parity gap; tracked as a non-blocker
- **Phase 2 product surface (connector cards, MCP browser, OAuth broker, cost accounting, memory tree, operational CLI)** — out of scope per SPEC
- **WebSocket transport for ACP** — explicitly deferred; stdio JSON-RPC ships now
- **Distributed execution, workflow versioning, cost accounting per workflow** — SPEC open questions, not Phase 1 deliverables

## License posture (ship-safe)

- **Hermes (MIT) ports** — R1, R2, R5, R6, R8 — every file carries a header citing the upstream Python source; `THIRD_PARTY_NOTICES.md` lists all five ports with file-level citations.
- **OpenHuman (GPL-3.0) concepts** — R3, R4, R7 — clean-room re-implementations from English prose in `.planning/research/04-openhuman-concepts.md`. License auditor verified no code-copy patterns.
- **No `~/.craft-agent/` or `craftagents://` references** introduced by Phase 1 code. All new on-disk state uses `~/.runneros/`.

## Followup tickets

- `01-04-FOLLOWUPS.md` — reactive-config wiring + `StoredConfig.scheduler` hoist
- TODOs in code: `TODO(#3968)` at injection-scan call sites (skill loader), `TODO(phase-1)` at `gate.ts:99` (workflow gateConfig override wiring), various non-blocker followups in the four FINAL-* audit reports

---

*Next phase: `/gsd-discuss-phase 2` (product surface — connector cards, MCP browser, OAuth broker)*
