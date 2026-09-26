---
phase: 01-orchestration-backbone
plan: 04
type: tdd
wave: 2
depends_on: []
files_modified:
  - packages/shared/src/config/reactive-config.ts
  - packages/shared/src/config/__tests__/reactive-config.test.ts
# Service migration deferred — see 01-04-FOLLOWUPS.md. scheduler-service /
# poll-service / file-watch-service do not currently consume StoredConfig.
autonomous: true
requirements: [R4]
must_haves:
  truths:
    - "getConfigCached(ttlMs) returns cached value within TTL window without re-reading disk"
    - "getConfigCached returns fresh value after TTL expires"
    - "subscribeConfigChanges(cb) fires the callback within 1s of a config file change on disk"
    - "scheduler-service picks up a new dispatch interval within 10s of config edit without restart"
    - "poll-service picks up new config within 10s"
    - "file-watch-service picks up new config within 10s"
    - "Existing single-read consumers of storage.ts continue to work unchanged"
  artifacts:
    - path: "packages/shared/src/config/reactive-config.ts"
      provides: "getConfigCached + subscribeConfigChanges built on top of storage.ts"
      exports: ["getConfigCached", "subscribeConfigChanges", "invalidateConfigCache"]
  key_links:
    - from: "packages/shared/src/scheduler/scheduler-service.ts"
      to: "packages/shared/src/config/reactive-config.ts"
      via: "getConfigCached at tick boundaries"
      pattern: "getConfigCached"
    - from: "packages/shared/src/automations/poll-service.ts"
      to: "packages/shared/src/config/reactive-config.ts"
      via: "getConfigCached at tick boundaries"
      pattern: "getConfigCached"
    - from: "packages/shared/src/automations/file-watch-service.ts"
      to: "packages/shared/src/config/reactive-config.ts"
      via: "getConfigCached at tick boundaries"
      pattern: "getConfigCached"
---

<objective>
Build a hot-reload wrapper around existing `config/storage.ts`. TTL-based cache (10s default) + chokidar-based file watcher pushes invalidation events. Long-running services (scheduler, poll, file-watch) read via `getConfigCached` at tick boundaries instead of holding a startup snapshot.

Purpose: Eliminate restart-to-pick-up-config-changes friction. Critical foundation for runtime per-workflow tuning of scheduler gate, polling cadences, and feature flags.

License: OpenHuman GPL concept (re-implemented from spec). NO code copy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/04-openhuman-concepts.md
@packages/shared/src/config/storage.ts
@packages/shared/src/scheduler/scheduler-service.ts
@packages/shared/src/automations/poll-service.ts
@packages/shared/src/automations/file-watch-service.ts

<interfaces>
Existing: storage.ts exposes a synchronous or async read of the workspace config (~/.runneros/config.json or similar — locate path via grep).

New surface:
- getConfigCached<T>(ttlMs?: number): Promise<T> — defaults ttlMs to 10000
- subscribeConfigChanges(cb: (newConfig: T) => void): () => void  (returns unsubscribe)
- invalidateConfigCache(): void  (test hook)

Internals:
- module-level mutable: { value, fetchedAt, watcher }
- on first call: load, start chokidar.watch(configPath) → on 'change': invalidate + fire subscribers (debounced 50ms)
- on each call: if Date.now() - fetchedAt < ttlMs → return cached; else reload
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — TTL cache and watcher tests</name>
  <files>packages/shared/src/config/__tests__/reactive-config.test.ts</files>
  <behavior>
    - Two getConfigCached() calls within 10s return identical reference (no re-read)
    - After 10s + 1ms, getConfigCached() refetches and returns updated value
    - invalidateConfigCache() forces next call to refetch
    - subscribeConfigChanges fires within 1s of file mtime change (use real fs + chokidar in a temp dir)
    - Unsubscribe handle stops further callbacks
  </behavior>
  <action>Create test file using `bun test` + `os.tmpdir()` for an isolated config path. Inject configPath via factory function or env override so tests don't touch real ~/.runneros/. Run — must fail (module missing).</action>
  <verify>
    <automated>bun test packages/shared/src/config/__tests__/reactive-config.test.ts 2>&1 | grep -q "fail\|cannot find module"</automated>
  </verify>
  <done>RED.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement reactive-config.ts</name>
  <files>packages/shared/src/config/reactive-config.ts, package.json</files>
  <action>
    1. Verify chokidar is already a dependency (grep package.json). If not, `bun add chokidar`.

    2. Create `packages/shared/src/config/reactive-config.ts`:
       ```ts
       import chokidar from "chokidar";
       import { loadConfig, getConfigPath } from "./storage"; // adapt to actual export names

       let cached: { value: unknown; fetchedAt: number } | null = null;
       let watcher: chokidar.FSWatcher | null = null;
       const subscribers = new Set<(v: unknown) => void>();
       let debounceTimer: NodeJS.Timeout | null = null;

       function ensureWatcher() {
         if (watcher) return;
         watcher = chokidar.watch(getConfigPath(), { persistent: false, ignoreInitial: true });
         watcher.on("change", () => {
           if (debounceTimer) clearTimeout(debounceTimer);
           debounceTimer = setTimeout(async () => {
             cached = null;
             const fresh = await loadConfig();
             cached = { value: fresh, fetchedAt: Date.now() };
             subscribers.forEach((cb) => { try { cb(fresh); } catch (e) { /* swallow */ } });
           }, 50);
         });
       }

       export async function getConfigCached<T = unknown>(ttlMs = 10_000): Promise<T> {
         ensureWatcher();
         if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.value as T;
         const fresh = await loadConfig();
         cached = { value: fresh, fetchedAt: Date.now() };
         return fresh as T;
       }

       export function subscribeConfigChanges<T = unknown>(cb: (v: T) => void): () => void {
         ensureWatcher();
         subscribers.add(cb as (v: unknown) => void);
         return () => subscribers.delete(cb as (v: unknown) => void);
       }

       export function invalidateConfigCache(): void { cached = null; }
       export async function _shutdownForTests(): Promise<void> {
         if (watcher) { await watcher.close(); watcher = null; }
         subscribers.clear(); cached = null;
       }
       ```
    3. Run tests — pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/config/__tests__/reactive-config.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>Cache + subscription verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Migrate scheduler-service, poll-service, file-watch-service</name>
  <files>packages/shared/src/scheduler/scheduler-service.ts, packages/shared/src/automations/poll-service.ts, packages/shared/src/automations/file-watch-service.ts, packages/shared/src/config/__tests__/reactive-config.test.ts</files>
  <behavior>
    - Each service reads config via getConfigCached at the start of each tick (not at construction time)
    - End-to-end test: write a new dispatch interval to the config file; within 10s, scheduler-service uses the new interval
  </behavior>
  <action>
    1. For each of the three services:
       - Find where config is currently read (likely once at construct/start). Refactor to call `await getConfigCached()` inside the tick handler.
       - Keep the existing config shape — do NOT change consumer signatures. Just swap the source.
    2. Add an integration test in reactive-config.test.ts that:
       - Spins up scheduler-service with a temp config
       - Writes new interval to config file
       - Asserts scheduler picks up new interval within 10s
    3. Run full validate: `bun run validate:ci` or `bun test && bun run typecheck:all && bun run lint`.
  </action>
  <verify>
    <automated>bun test packages/shared/src/config/ packages/shared/src/scheduler/ packages/shared/src/automations/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>All three services hot-reload; integration test green.</done>
</task>

</tasks>

<verification>
- TTL behavior precise (no re-read within window)
- chokidar watcher fires within 1s
- Three services migrated
</verification>

<success_criteria>
Edit ~/.runneros/config.json → scheduler picks up new cadence on next tick without restart.
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-04-SUMMARY.md`.
</output>
