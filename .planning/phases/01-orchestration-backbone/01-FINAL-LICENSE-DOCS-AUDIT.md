# Phase 1 — Final License + Documentation Audit

**Date:** 2026-05-20
**Auditor:** code-review-swarm (license/docs lane)
**Scope:** Hermes (MIT) ports R1/R2/R5/R6/R8 + OpenHuman (GPL-3.0) concept-only re-implementations R3/R4/R7. Verdict frames whether Phase 1 is **legally safe to ship commercially**.

**TL;DR Verdict:** 🟢 **GREEN — clear to ship.** No GPL contamination detected. License headers complete on every audited file. `THIRD_PARTY_NOTICES.md` accurately reflects both vendored ports and conceptual influences. One 🟡 paper-cut (no `01-SUMMARY.md`), one open TODO (`gate.ts:100`), and the previously-flagged R7 wire-up still pending — none are legal blockers.

---

## 1. Code-copy check — OpenHuman-derived files

Each GPL-3.0-touching file was read in full and compared against the OpenHuman Rust upstream at `.planning/research/upstream/openhuman/`.

| RunnerOS file | OpenHuman analogue | Verdict |
|---|---|---|
| `packages/shared/src/scheduler/gate.ts` | `src/openhuman/scheduler_gate/policy.rs` (437 LOC Rust) | 🟢 **Clean room.** Different return enum (`'run' \| 'throttle' \| 'pause'` vs `Aggressive \| Normal \| Throttled \| Paused{reason}`), different mode union (`auto \| always_on \| disabled` vs Rust `Off \| AlwaysOn \| Auto`), no `PauseReason` enum, no `server_mode` short-circuit, no `signed_out` path. Field names (`battery_floor`, `cpu_busy_threshold_pct`, `cpu_severe_pct`, `require_ac_power`) are config keys — facts per 01-03 review. Decision order in TS is `severe-CPU → ac-required → battery-floor → busy-CPU → run`; Rust is `mode → server_mode → ac-required → severe-CPU → battery → busy`. Different ordering, different shape, different language. No translation. |
| `packages/shared/src/scheduler/system-pressure.ts` | OpenHuman uses `battery` crate + Rust-side sampler | 🟢 **Clean room.** TS uses `systeminformation` npm pkg, adds last-known-battery cache, TTL/in-flight dedup — none of which the Rust signals module has. Behavior derived from prose spec only. |
| `packages/shared/src/config/reactive-config.ts` | OpenHuman `src/openhuman/heartbeat/` | 🟢 **Clean room.** Pull-with-TTL + opt-in push pattern. OpenHuman heartbeat is event-loop tick driven; TS uses `node:fs.watch` on the parent directory (atomic-rename-safe) with 200ms debounce. No code mirroring. |
| `packages/shared/src/agent/escalation-store.ts` | OpenHuman `src/openhuman/subconscious/` | 🟢 **Clean room.** TS uses `bun:sqlite` with a hand-written schema (`escalations` table, two indexes). OpenHuman uses Rust + sqlx. Different ORM, different schema, different status enum. Factory pattern is RunnerOS-native. |
| `packages/shared/src/agent/subconscious-mode.ts` | OpenHuman subconscious engine | 🟢 **Clean room.** Coordinator pattern + `WriteAttemptOutcome` discriminated union are TS idioms. The `pending Map<id, deferred>` + `subscribe()` mirroring strategy doesn't exist in the Rust upstream. |
| `packages/shared/src/agent/subconscious-permissions.ts` | OpenHuman approval policy | 🟢 **Clean room.** Read-tool allow-list + bash-verb regex pack are RunnerOS-authored (specifically the post-01-07 cold-review flip to "unknown tool = write"). No Rust counterpart. |

**No file in this set reads like a translation of Rust.** Variable names are TS-idiomatic camelCase, comments reference RunnerOS-internal concepts (`workflowRunId`, `taskId`, `assistantText`, AsyncLocalStorage) that have no upstream analogue. The Rust upstream lives at `.planning/research/upstream/openhuman/` and is **not imported by any source file** (confirmed: `grep openhuman packages/shared/src/**/*.ts` matches only the credit-header strings inside the audited files).

**GPL contamination risk: NONE.**

---

## 2. License header per file

All 19 new Phase 1 source files carry headers consistent with project policy.

**Hermes ports (MIT) — every file credits Hermes with the upstream file path:**
- `packages/shared/src/agent/spawn-session-isolation.ts` — credits `tools/delegate_tool.py`
- `packages/shared/src/agent/prompt-builder.ts` — credits `tools/cronjob_tools.py:43-141` + `cron/scheduler.py:1058-1131`
- `packages/shared/src/workflows/trigger-inputs.ts` — credits `cron/scheduler.py:60-88` + `cron/jobs.py:523,662`
- `packages/shared/src/automations/hooks/{consent,shell-hook-runner,allowlist-store,types}.ts` — all four credit `agent/shell_hooks.py`
- `packages/shared/src/automations/handlers/shell-hook-handler.ts` — credits `agent/shell_hooks.py`
- `packages/shared/src/automations/handlers/acp-spawn-handler.ts` — credits `hermes_acp/`
- `packages/shared/src/protocol/acp/{types,session,events,tools,permissions,client,server,spawn-bridge,index}.ts` — every file credits the specific `hermes_acp/*` source

**OpenHuman concepts (GPL-3.0) — every file carries the "concept-only, no code copied" disclaimer:**
- `packages/shared/src/scheduler/gate.ts` ✅
- `packages/shared/src/scheduler/system-pressure.ts` ✅
- `packages/shared/src/config/reactive-config.ts` ✅
- `packages/shared/src/agent/escalation-store.ts` ✅
- `packages/shared/src/agent/subconscious-mode.ts` ✅
- `packages/shared/src/agent/subconscious-permissions.ts` ✅

All six include the formula: *"Concept-only re-implementation from OpenHuman (GPL-3.0) — no source code copied. Behavior derived from research note `.planning/research/04-openhuman-concepts.md`."* This is the exact wording the SPEC requested.

🟢 **All headers present and correctly worded.**

Test-file headers: `scheduler/__tests__/gate.test.ts` and `config/__tests__/reactive-config.test.ts` carry abbreviated GPL-disclaimer headers; the others (Hermes-port tests) are plain. **Recommendation (🔵 nit, not a blocker):** add a one-line "Tests for Hermes port — see source file for attribution" to test files for parity.

---

## 3. `THIRD_PARTY_NOTICES.md` completeness

File audited end-to-end at repo root.

| Check | Status |
|---|---|
| Hermes (MIT) section present with GitHub URL | ✅ |
| Hermes table lists R1 (spawn-session-isolation), R2 (prompt-builder), R5 (trigger-inputs), R6 (hooks/), R8 (protocol/acp/) — **all 5 ports** | ✅ |
| Upstream file paths cited per row | ✅ |
| OpenHuman conceptual section labeled "not vendored" + "no source code copied" | ✅ |
| OpenHuman table lists R3 (gate + system-pressure), R4 (reactive-config), R7 (escalation/subconscious) — **all 3 concepts** | ✅ |
| Listed as inspiration, NOT as a dependency | ✅ — explicit "(not vendored)" header and "no source code copied" disclaimer per row |
| No "(planned)" tags remain | ✅ — all 8 requirements show as delivered |
| Upstream snapshot location documented | ✅ — `.planning/research/upstream/{hermes,openhuman}/` both flagged as "read-only; not shipped" |

🟢 **No issues.**

**Note on license text:** the notices file points at the upstream GitHub `LICENSE` rather than reproducing MIT text inline. This is acceptable for MIT (which does not strictly require text reproduction in derivative-work notice files if attribution + license name + link are present), but a paranoid commercial-ship review might prefer to inline the MIT text. 🔵 Optional follow-up — not a legal blocker.

---

## 4. Plan / Spec / Review parity

**SPEC vs implementation:**
- R4 (reactive-config) acceptance criterion explicitly notes the service-migration deferral and points at `01-04-FOLLOWUPS.md`. ✅ The follow-up file exists and lists 4 deferred items concretely. ✅
- All other R-numbered acceptance criteria in SPEC §Acceptance Criteria correspond to delivered code (verified by file existence + test presence).
- R7 acceptance "workflow with mode: subconscious pauses on write" is the one item flagged by 01-07 review as **CONDITIONAL PASS — not yet provable end-to-end** because the runner doesn't consume the `__subconsciousMode` hint. The machinery ships; the wire-up is open. SPEC acceptance for R7 should remain unchecked until that lands.

**REVIEW verdicts:**
| Req | Verdict | Status |
|---|---|---|
| 01-01 (R1) | FIX-AND-RESHIP | Fixes B1/B2/B3 should be confirmed applied; commit `625127c "Fix reliability review gaps"` suggests they were. Recommend planner spot-check. |
| 01-02 (R2) | FIX-AND-RESHIP (surgical) | Likely landed in same reliability commit. Spot-check. |
| 01-03 (R3) | FIX-AND-RESHIP | License posture in review: "✅ Clean. The TS gate is a behavioral re-implementation." 🟢 |
| 01-04 (R4) | "Shipping as-is is safe." | 🟢 Plus FOLLOWUPS.md captures deferred wiring. |
| 01-05 (R6) | REQUEST CHANGES — typecheck blocker + 3 security items | Need to confirm fixes landed. |
| 01-06 (R5) | APPROVE with 2 follow-ups | 🟢 |
| 01-07 (R7) | CONDITIONAL PASS — machinery only | Wire-up still owed. |
| 01-08 (R8) | (verdict section present) | Spot-check. |

🟡 **Three reviews (01-01, 01-02, 01-05) are FIX-AND-RESHIP with unverified fix status from this audit's vantage.** Git log shows `625127c "Fix reliability review gaps"`, which is plausibly the reship — but I did not re-run each REVIEW's checklist against the latest tree. **Recommendation:** truth-guardian pass before tagging Phase 1 complete.

**PLAN `files_modified` frontmatter:** all 8 plans have frontmatter present with sensible file lists. Earlier reviewer noted that 01-01..01-04 had some "false claims" in `files_modified`. I did not diff every plan against `git log --name-only`; minor frontmatter drift is not a legal-ship concern. 🔵.

---

## 5. Craft remnants in Phase 1 code

`grep -rn -E "craft-agents://|~/.craft-agent/|Craft Agents"` across all new Phase 1 files: **zero hits** in source. ✅

Notes:
- `packages/shared/CLAUDE.md` still names the package `@craft-agent/shared` and references `~/.craft-agent/config.json`. That is **pre-existing project naming**, out of Phase 1's scope (the legal-scrub pre-req is tracked separately per SPEC §Boundaries).
- `packages/shared/src/agent/escalation-store.ts:312` comment says "Honors `CRAFT_CONFIG_DIR`" — references the existing env-var name in `paths.ts`, not a Craft-the-product reference. Acceptable.

🟢 **No Craft contamination introduced by Phase 1.**

---

## 6. `~/.runneros/` on-disk path consistency

- `packages/shared/src/automations/hooks/allowlist-store.ts:34` — `path.join(homedir(), '.runneros', ALLOWLIST_FILENAME)` ✅
- `packages/shared/src/agent/escalation-store.ts` — uses `CONFIG_DIR` from `../config/paths.ts` (which is honored by `CRAFT_CONFIG_DIR` env var; project-wide rename is pre-req scrub, not Phase 1)

R6 honors the SPEC-mandated `~/.runneros/` path. R7's escalation DB rides on `CONFIG_DIR` (the global config dir resolver) — which means it will move when the legal-scrub pre-req renames the env var. That's the right layering. 🟢

---

## 7. `01-SUMMARY.md` for Phase 1

**Not present.** 🔵 Not required by SPEC, but valuable for handoff to Phase 2 and for the commercial-ship dossier. Recommend a 1-page summary capturing: 8 requirements delivered (+ R7 wire-up open), commit pointer, follow-up tickets, and a one-line legal posture statement.

---

## 8. TODO markers introduced by Phase 1

Single hit across the audited file set:

- `packages/shared/src/scheduler/gate.ts:100` — `TODO(phase-1): production wiring — a workflow runner should call setGateConfig(resolveGatePolicy(workflow.gateOverride ?? {})) before each dispatch. No caller does this today; follow-up in workflow integration.`

No `TODO(#3968)`, no other `TODO(phase-1)` tokens in new code. The single TODO is documented in `01-04-FOLLOWUPS.md` item #1 (hoist `gateConfig` into `StoredConfig.scheduler`).

🟡 **One open TODO. Tracked in FOLLOWUPS. Acceptable.**

---

## 9. Outstanding non-legal items (informational)

These do not affect commercial-ship safety but should be on the Phase 1 closeout list:

1. **R7 runner wire-up** (per 01-07 CONDITIONAL PASS) — the `gateWriteAttempt` coordinator is not yet consumed by the runner. Acceptance criterion for R7 cannot be proven end-to-end. Open follow-up plan recommended.
2. **R7 default escalate-on-unknown-tool flip** — landed in `subconscious-permissions.ts` per code comment, but the cold-review follow-up should be re-verified.
3. **01-01 / 01-02 / 01-05 reship verification** — confirm reviewer-flagged fixes are in `HEAD` (likely `625127c`).
4. **01-04 FOLLOWUPS deferrals** — `gateConfig` not yet hoisted into `StoredConfig.scheduler`; `automation-system.ts:401` not yet wired to reactive-config.

---

## 10. Final legal-ship verdict

🟢 **GREEN — Phase 1 is legally safe to ship commercially.**

- **No GPL contamination.** Six OpenHuman-derived files are unambiguously clean-room re-implementations from prose. Different type systems, different control flow, different language. Field names that match are config keys (facts, not copyrightable expression — 01-03 review concurs).
- **All MIT attribution complete.** Every Hermes-ported file carries an upstream-file citation in its header, and `THIRD_PARTY_NOTICES.md` lists all 5 ports with the same paths.
- **OpenHuman is correctly classified as "inspiration, not dependency"** in the notices file.
- **No Craft branding leaks** from Phase 1 work into the new code paths.
- **`~/.runneros/` path used for new on-disk state** (allowlist); escalation DB rides on the global config-dir resolver, which is the right call.

Open items (R7 wire-up, three reships, FOLLOWUPS deferrals, missing summary doc, single TODO) are **product/quality items, not legal items.** None block a commercial ship from a license/IP standpoint.

**Recommendation:** before tagging Phase 1 closed, run a truth-guardian pass on the three FIX-AND-RESHIP reviews (01-01, 01-02, 01-05) and draft an `01-SUMMARY.md` to crystallize the handoff. The legal posture itself does not require further action.
