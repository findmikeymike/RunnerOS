# 01-04 Reactive-Config — Deferred Follow-ups

**Source:** Cold review (`01-04-REVIEW.md`) verified that the three services named in the original plan (`scheduler-service.ts`, `poll-service.ts`, `file-watch-service.ts`) do not consume `StoredConfig` today. They consume `AutomationMatcher[]` from `automations.json` via a separate refresh pipeline. The reactive-config module shipped as a clean primitive; the consumer wiring is deferred to the work below.

## Deferred work

1. **Hoist `gateConfig` into `StoredConfig.scheduler.gateConfig`**
   - Add a `scheduler?: { gateConfig?: GateConfig }` field to the `StoredConfig` type in `packages/shared/src/config/storage.ts`.
   - Default to the existing `DEFAULT_GATE_CONFIG` when absent.
   - Update `config-defaults-schema.ts` and any storage migrations.

2. **Wire `automation-system.ts:401` to read from reactive-config**
   - At scheduler construction in `AutomationSystem.startScheduler()`, read `getConfigCached().scheduler?.gateConfig` and pass it as the `gateConfig` constructor option.
   - Register a `subscribeConfigChanges` callback that calls `scheduler.setGateConfig(newCfg.scheduler?.gateConfig ?? DEFAULT_GATE_CONFIG)` on every push.
   - Add an integration test: edit config → scheduler reflects new gate within ≤ 10s without restart.

3. **`automations.json` reactive wrapper (optional, sibling pattern)**
   - `automations.json` is a *different file* from `~/.craft-agent/config.json`. The current `AutomationSystem.reloadConfig()` pipeline already handles its hot-reload via a separate `chokidar` (or `fs.watch`) watcher.
   - If we want a single reactive primitive across both files, either:
     a. Generalize `reactive-config.ts` into a factory: `createReactiveSource<T>({path, load})` returning the same `{getCached, subscribe, invalidate}` triple; refactor the existing `reactive-config` exports as one instance and create a sibling instance for `automations.json`.
     b. Build a parallel `reactive-automations.ts` using the same pattern.
   - Pick (a) only if a second consumer materializes — YAGNI otherwise.

4. **Plan-vs-implementation drift note**
   - The plan prototype showed `async getConfigCached`. The shipped implementation is synchronous (loadStoredConfig is sync). Add a note to the next plan revision that the sync API is intentional for tick-loop callers.

## Out of scope here

- Symlinked-config handling, config-dir-deletion-and-recreate edge cases (documented as known limitations in the review).
- WebSocket transport for reactive updates (the file-watcher is sufficient for local-process consumers).
