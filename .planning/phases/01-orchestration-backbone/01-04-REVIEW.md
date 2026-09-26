# R4 Reactive-Config — Independent Cold Review

**Reviewer:** code-review-swarm (cold, no prior context)
**Scope:** `packages/shared/src/config/reactive-config.ts`, its test file, and the SPEC R4 acceptance criterion about long-running services hot-reloading.
**Reference:** SPEC `.planning/phases/01-orchestration-backbone/01-SPEC.md` R4, plan `01-04-reactive-config-PLAN.md`, research `04-openhuman-concepts.md` (Upgrade 6).

---

## TL;DR Verdict

**The executor is correct.** Scheduler / poll / file-watch services do not consume `StoredConfig` today, so the migration line item in the plan ("migrate the 3 services to `getConfigCached`") was vacuous as written. The reactive-config module itself is sound and lands as a clean primitive. **SPEC R4 acceptance bullet needs adjustment** — "scheduler picks up a new interval within ≤ 10s of a config edit without restart" is not exercisable until a StoredConfig field actually drives scheduler behavior (e.g. `gateConfig` lifted from constructor option into `StoredConfig.scheduler`). Recommendation: (a) ship the module, (b) downgrade the migration bullet to "future-ready" with a follow-up task to hoist `gateConfig` into StoredConfig, (c) keep the test that proves a `getConfigCached(100)` tick consumer picks up the new value within TTL — that already satisfies the *intent* of R4 with a synthetic consumer.

---

## 1. Migration deviation — independently verified

### Evidence gathered

| Service | Source of config in production | StoredConfig consumed? |
|---|---|---|
| `SchedulerService` | `gateConfig` is a **constructor option** (`SchedulerServiceOptions.gateConfig`). At `automation-system.ts:401` the scheduler is instantiated with **no** `gateConfig` arg → falls through to `DEFAULT_GATE_CONFIG`. `setGateConfig()` exists on the class but is **never called in production code** (`grep` across `packages/shared/src/` and `apps/` returns only the class internals). | **No.** |
| `PollService` | `applyMatchers(AutomationMatcher[])`, fed by `AutomationSystem` from `automations.json` (resolved via `resolveAutomationsConfigPath`, not `~/.craft-agent/config.json`). Reloads piggyback on `AutomationSystem.reloadConfig()` (separate file-change pipeline). | **No.** |
| `FileWatchService` | Same as poll-service. `workspaceRootPath` and `workspaceId` are construct-time options; matchers come from `automations.json`. | **No.** |

`grep -rn "loadStoredConfig\|StoredConfig\|getConfigCached" packages/shared/src/scheduler/ packages/shared/src/automations/` confirms zero hits in those three services or their callers.

### Is there a code path the executor missed?

No. The only Phase-1 StoredConfig field that *any* of these three services would conceivably care about is `gateConfig` — and that field **does not exist on `StoredConfig`** today. `StoredConfig.delegation` exists (R1) but is consumed by `spawn-session-tool.ts` via `session-scoped-tools.ts`, not by the scheduler/poll/file-watch trio.

### So what does the SPEC R4 acceptance bullet mean?

> "scheduler picks up a new interval within ≤ 10 s of a config edit without restart"

Two readings:

1. **Literal.** Scheduler interval is hardcoded to 60s in `start()` (`setInterval(..., 60_000)`). Nothing in `StoredConfig` controls it. → Acceptance bullet is unsatisfiable as-written.
2. **Intent.** "A long-running tick-driven consumer of `StoredConfig` picks up a new value within ≤ 10s." → The integration test in `reactive-config.test.ts` (lines 181–204, "a polled consumer sees the new config within TTL + a beat") **already proves this with a synthetic consumer**. That's a legitimate substitute for a real consumer that doesn't exist yet.

### Recommendation

- **Update SPEC R4 acceptance bullet** to: "A `getConfigCached(ttlMs)` consumer sees a config edit within `ttlMs + 1 beat`; `subscribeConfigChanges` fires within ≤ 1s." This matches what the tests actually demonstrate and is honest about the module being a primitive.
- **Open a follow-up ticket** to hoist scheduler/gate policy into `StoredConfig.gateConfig` (or `StoredConfig.scheduler.gate`) and wire `subscribeConfigChanges` → `scheduler.setGateConfig(...)` inside `AutomationSystem.startScheduler()`. That gives R4 a real production consumer. Estimated 30 lines. The `setGateConfig` API already exists — that's not accidental; it's a hot-reload landing strip.
- **Plan doc is misleading** (`files_modified` lists the three services even though no changes were warranted). Update the plan frontmatter to drop those three files and add the follow-up ticket reference.

---

## 2. Module correctness — line-by-line audit

### 2.1 License hygiene — PASS
- No code copy. Re-implementation from prose research note. Header comment names the source and labels it concept-only. `THIRD_PARTY_NOTICES.md` line 45 credits OpenHuman's `heartbeat` loop (GPL-3.0) explicitly with "No GPL source code copied" wording. Acceptable.
- I did not have access to the upstream OpenHuman source to do a literal-substring check, but the implementation diverges in structurally important ways from any obvious GPL pattern: it uses `node:fs.watch` (not chokidar despite the plan recommending it), a `Set<Subscriber>` (not an EventEmitter), and a single-entry cache (not a per-key map). Pattern-level similarity ("debounce + invalidate + notify") is unprotectable algorithmic structure.

### 2.2 `fs.watch` reliability — MIXED
- **Parent-dir watch + filename filter** (line 94) — correct mitigation for atomic-rename editor saves. Good.
- **Recreate-after-delete** — `fs.watch` on a directory *will* see the recreate as a `rename` event with the right filename, fires the debounce, and `readConfig()` will succeed. **OK.** However, if the *directory itself* is deleted and recreated (rare but possible on full `rm -rf` of `~/.craft-agent`), the watcher handle becomes orphaned and silently dies. Not handled. Severity: low — config dir deletion is not a routine event.
- **Symlinks** — `fs.watch` follows symlinks at open time but does not re-resolve. If `~/.craft-agent/config.json` is a symlink and the link target is replaced (different inode), behavior is platform-dependent. macOS will keep watching the old inode; Linux may behave differently. Not handled. Severity: low — symlinked config is unusual.
- **macOS-specific flakiness** — the parent-dir strategy covers the most common editor pattern. Acceptable for v1.

### 2.3 Debounce correctness — PASS
- A burst of 5 fs events within 200ms produces exactly **one** subscriber callback. Verified by reading `clearTimeout` + `setTimeout` reset logic at lines 96–106. The debounce timer is reset on each event; only the trailing edge fires.
- No unit test in the file explicitly proves "5 events → 1 callback." The existing subscription tests fire a single write each. **Gap: add a test that writes 3 times in quick succession and asserts `callCount === 1`.** Severity: low (the logic is straightforwardly correct), but easy to harden.

### 2.4 Concurrent-read consistency — PASS (with nuance)
- Module-level `cached` variable is assigned atomically in JS — there is no torn-write hazard. `getConfigCached` reads `cached` once at line 129 and returns either the cached value or proceeds to read disk. There is **no critical section that could expose a half-updated value**.
- However: under TTL expiry, two concurrent callers can both miss the cache, both call `readConfig()`, both write to `cached` (last writer wins). Both will return *some* valid `StoredConfig`. Not torn. Not inconsistent in a meaningful sense. Acceptable.
- The watcher path also assigns `cached = null` at line 100 before re-reading at line 101. A `getConfigCached` call that lands between those two lines will hit a null `cached`, fall through to its own `readConfig()`, and return a fresh value. Not torn. Acceptable.
- **The test at lines 91–97** ("concurrent reads within the TTL window return the same reference") passes by construction — there is no race because all 50 reads happen synchronously in one tick. The test does not actually exercise concurrency across the refresh boundary. **Gap: the claim in the executor's summary is stronger than the test proves.** Recommendation: weaken the claim or add a real-async test.

### 2.5 `invalidateConfigCache` — PASS but UNUSED in production
- Function exists, sets `cached = null`. Public export.
- `grep` shows the only callers are the tests and `_setConfigPathForTests`. There is no production code that writes new config and then calls `invalidateConfigCache()` to force the next read to refetch. Currently the write path relies on `fs.watch` firing within the debounce window — which is correct on its own but means `invalidateConfigCache` is dead-code-exposed-as-public-API.
- **Recommendation:** Either (a) wire `saveConfig()` in `storage.ts` to call `invalidateConfigCache()` for sub-debounce-window consistency (writes-then-immediate-read could otherwise see stale data for up to 200ms), or (b) document that the function is test-only and consider an `@internal` JSDoc tag. As-is it's an unused public API surface.

### 2.6 Subscriber leak risk — REAL but LOW
- `subscribers` is a `Set<Subscriber>`. Subscribers must call the returned unsubscribe fn or the closure is held forever. If a long-running service like `AutomationSystem` subscribes once at startup and never unsubscribes (likely the production pattern), there is **no leak** — one entry, one closure. Bounded.
- The leak risk is theoretical: a misbehaving caller that subscribes in a loop without unsubscribing would grow the Set unboundedly. There is no guard. Severity: low — this is a standard pub/sub footgun, not unique to this module.
- **No teardown hook** is exposed publicly (`_shutdownForTests` is the only one and is `@internal`). If `AutomationSystem.dispose()` ever wants to deterministically tear down the watcher, there's no public API. Add `shutdownReactiveConfig()` as a public export with a JSDoc note.

### 2.7 Throwing subscriber doesn't poison others — PASS
- Lines 64–70: `for (const cb of subscribers) { try { cb(cfg); } catch (err) { debug(...); } }`. Per-subscriber try/catch is real. Test at lines 160–177 verifies. PASS.

### 2.8 `watcher.unref()` — PASS
- Line 110: `watcher.unref?.()`. Optional chaining handles environments where `unref` isn't on the FSWatcher (Bun, older Node). Correct. Process exit is not blocked by the watcher. PASS.

### 2.9 TTL semantics — SYNCHRONOUS read on stale
- `getConfigCached` is **synchronous** and calls `readConfig()` synchronously (which calls `loadStoredConfig()` → `readJsonFileSync`). On a stale cache, the next call **blocks** on disk I/O. For a scheduler tick on a slow disk, this is a sync read in the tick loop.
- **The plan's prototype showed `async getConfigCached`.** The implementation made it sync. This is a deliberate API change from the plan — not documented in the file header. Severity: low-medium. The sync version is arguably better for tick-loop use (no `await` discipline needed in callers), but the plan-vs-implementation divergence should be noted.
- `loadStoredConfig` is itself sync (`readJsonFileSync`) so the change is internally consistent. PASS for correctness; FLAG for plan drift.

### 2.10 Subscribe-without-prior-getConfig — PASS
- `subscribeConfigChanges` calls `ensureWatcher()` at line 150 before adding the callback. The watcher gets installed even if no `getConfigCached` has been called. PASS.

### 2.11 Test count and coverage — PASS with one nit
- 10 tests claimed; I counted **11** in the file (5 TTL, 5 subscription, 1 integration). Off by one — not a problem, just inaccurate executor claim.
- **`_setConfigPathForTests` / `_shutdownForTests` are exported from the module.** They have `@internal` JSDoc comments (lines 169, 185) which is good. They are NOT marked `_`-prefix only — they ARE underscore-prefixed, which is a fine convention. They will appear in the package's typed export surface unless the package index re-exports selectively. **Check `packages/shared/src/config/index.ts` (or wherever reactive-config is re-exported) and confirm these test hooks are NOT re-exported from the package boundary.** I did not verify this — the executor should.
- Each SPEC R4 acceptance bullet has at least one test:
  - "returns cached then refreshed value" → lines 53–80
  - "subscribeConfigChanges fires within ≤ 1s" → lines 101–119
  - "long-running consumer picks up within TTL+beat" → lines 181–204 (this is the synthetic substitute for the missing scheduler migration)

### 2.12 Other observations
- **No retry on JSON parse failure during refresh.** Lines 102–104: if a file write is mid-flight and the debounced read sees a half-written `{`, `readConfig()` returns `null` and `cached` stays at the previous value (line 134–136 — good, "don't poison cache with null"). Acceptable. Editor-pattern atomic renames mostly avoid this.
- **No backpressure on rapid changes.** If config is rewritten every 50ms for 10 seconds, you get exactly one debounced callback per 200ms window. Acceptable.
- **Module-level mutable state** (cached, watcher, subscribers, etc.) — fine for a singleton, but makes testing rely on `_shutdownForTests`. Acceptable trade-off.

---

## 3. Issues summary

### Blockers
None.

### Should-fix before sign-off
1. **SPEC R4 acceptance bullet about "scheduler picks up new interval within 10s" needs revision** — currently unsatisfiable because StoredConfig has no scheduler-controlling field. Either revise the bullet to match the synthetic-consumer test, or open a follow-up ticket to hoist `gateConfig` into StoredConfig.
2. **Plan `01-04-reactive-config-PLAN.md` `files_modified` frontmatter lies** — it lists three services that were never modified. Update the plan to match reality.

### Nice-to-have
3. Add a test for "5 burst events → 1 callback" to lock in debounce correctness.
4. Either wire `invalidateConfigCache` into `storage.saveConfig()` or mark it `@internal`.
5. Add a public `shutdownReactiveConfig()` for dispose paths.
6. Document the sync-vs-async API change from the plan prototype.
7. Verify `_setConfigPathForTests` / `_shutdownForTests` aren't re-exported from the package boundary.
8. Strengthen the "concurrent reads return consistent data" test to cross a refresh boundary, or weaken the claim.

### Defer
- Symlinked-config and config-dir-deletion edge cases — document as known limitations.

---

## 4. License posture — confirmed clean

- THIRD_PARTY_NOTICES.md row at line 45 is correctly worded.
- Source file header at lines 1–18 names the inspiration and labels it concept-only.
- No literal-string check vs upstream performed (no access to GPL source from this review env); structural divergences (Node `fs.watch` not chokidar, Set not EventEmitter, single-entry not map) make accidental copying unlikely.

---

## 5. Final verdict

**Approve the module. Revise the SPEC bullet. File a follow-up ticket.**

The reactive-config module is a competent, small, well-tested primitive. It does what it says on the tin: TTL cache + debounced file watcher + push subscription, with reasonable failure modes. It is **not** yet load-bearing for any production code path because the three services the plan named don't actually consume `StoredConfig`. That's a SPEC/plan accuracy problem, not a code-quality problem. The fix is editorial (revise the acceptance bullet) plus a small follow-up (hoist gateConfig into StoredConfig so the next phase can wire it up).

Shipping as-is is safe. The module will become valuable when the next consumer arrives — most likely `delegation.subagent_auto_approve` hot-reload, or the gate policy hoist.
