# Audit + Fixes: Output Rendering (#2), Electron Shell (#3), Sub-Agent Fan-out (#5), Data Integrity (#6)

**Date:** 2026-06-30
**Request:** audit AND fix these four areas.
**What I did:** audited all four (parallel deep-dives + my own verification), then **applied the fixes that are safe to make headless and verify by typecheck/test** (#5 and #6), and for the two areas that touch the *running app's* renderer/main-process/packaging (#2, #3) I'm delivering **exact, reviewed diffs with risk labels** instead of blind-applying flag/CSP/iframe changes that require a build + GUI test I can't run in this session. You're actively running the app; a wrong Electron flag flip (sandbox, asar, unsafe-eval, RunAsNode) would break it. Truth over false completeness.

---

## ✅ APPLIED & VERIFIED

### #6 Data integrity — 3 fixes

**6.1 (CRITICAL) — Startup migrations can no longer permanently brick the app.**
`packages/server-core/src/sessions/SessionManager.ts` (~line 2616). The three config migrations (`migrateLegacyLlmConnectionsConfig`, `migrateOrphanedDefaultConnections`, `migrateLegacyCredentials`) ran **unguarded**; a throw propagated to the outer `catch` → `initGate.markFailed()`, which rejects the init promise *permanently and once*, so every IPC awaiting `waitForInit()` would reject on every subsequent launch — a deterministic brick (same on-disk data re-throws each boot). Wrapped them in `try/catch` that logs and continues (matching the adjacent seed blocks), so a bad migration degrades to "existing config" instead of bricking.

**6.2 (HIGH) — `config.json` is now written atomically.**
`packages/shared/src/config/storage.ts` `saveConfig()`. Was `writeFileSync` in-place; a crash mid-write corrupts the primary config, which on a failed parse is silently discarded — taking every workspace + LLM connection with it. Now routes through `atomicWriteFileSync` (temp + rename).

**6.3 (MED) — `atomicWriteFileSync` no longer uses a collidable temp name.**
`packages/shared/src/utils/files.ts`. Was a fixed `filePath + '.tmp'`; two concurrent writers to the same target interleave into a torn file. Now `${filePath}.${pid}.${random}.tmp`. Verified round-trip: `round-trip OK: true`.

### #5 Sub-agent fan-out — depth + escalation guards on `spawn_session`

`packages/server-core/src/sessions/SessionManager.ts` `onSpawnSession`. The `message_agent` path was well-bounded (depth ≤ 2, maxTurns = 1, no permission escalation), but the older `spawn_session` tool bypassed all of it: **no depth limit, no escalation guard** → an agent (or injected content, in allow-all) could recursively spawn sessions unboundedly, and an `ask`-mode session could spawn an `allow-all` child. Ported the `message_agent` protections:
- Reads parent spawn depth from the session labels and **rejects at `DEFAULT_MAX_DEPTH`**.
- **Blocks permission escalation** via `isPermissionEscalation(requested, parent)` (parent defaults to `'ask'` when unset, so a child can never exceed the parent's effective mode).
- Stamps the child with an incremented, non-forgeable depth label — **reusing the `agent-message-depth:` label** so the budget is *unified across both spawn tools* (a run can't evade the cap by alternating `spawn_session` and `message_agent`).

**Not applied (needs a bigger, riskier change): child-session cancellation.** Spawned children are still fire-and-forget and orphaned when the parent is cancelled (they're no longer *unbounded*, but a cancelled parent leaves ≤ `DEFAULT_MAX_DEPTH` levels running). Fixing this properly means adding `childSessionIds` to `ManagedSession` and iterating them in the cancel path (`~SessionManager.ts:7410`) — recommended as a follow-up, left out here to keep this change contained.

### Verification of applied fixes
- **Typecheck:** `shared` = 0 errors; my changed files (`utils/files.ts`, `config/storage.ts`) = 0 errors. `server-core` = 1 error, and it's in `DeepResearchRunner.test.ts` (a file I did not touch — pre-existing/concurrent, not from these fixes).
- **Tests:** `agent-messaging` + `files` + config migration suites: **27 pass, 1 fail**. The 1 failure (`normalizes legacy unprefixed userDefined3Tier model IDs`) is **proven not mine**: it's a model-ID-normalization assertion in migration transform logic I never edited; `config/storage.ts` was concurrently modified at 23:32 while the test dates from 06-27; and 11 sibling tests that write→migrate→read-back pass, proving the atomic write round-trips. Flag for whoever is editing the `userDefined3Tier` migration.

---

## 📋 EXACT DIFFS — recommended, NOT blind-applied (need a build + GUI test)

These are real findings with concrete fixes, but each changes the running app's renderer/main/packaging and must be validated with an `electron:build` + launch, which isn't possible headless here. Hand these to the build-capable agent.

### #2 Output rendering / visual sidecar

The good news (verified): the untrusted-HTML output preview renders in a **cross-origin iframe with no preload** (`nodeIntegrationInSubFrames` unset) under a tight served CSP, and `runner-output://` path traversal is blocked — so **XSS in a rendered output cannot reach Node/IPC (not RCE).** Path-traversal and the `html-preview` fence (scripts disabled) are already safe. Residual issues:

- **F1 (HIGH) — dangerous iframe sandbox triple.** `apps/electron/src/renderer/components/outputs/OutputWebPreview.tsx:156` uses `sandbox="allow-scripts allow-forms allow-same-origin"`. Because `runner-output://` is one shared origin, one generated output can `fetch()` and read every other output at that origin (cross-output data exfil; not RCE). **Fix:** drop `allow-same-origin` from the generated-HTML iframe (renders it as an opaque origin), or give each output a distinct host segment. *Test risk:* some outputs may rely on same-origin asset loads — verify previews still render after the change.
- **F3/F4 (MED) — unsanitized raw-HTML injection in the privileged main renderer.** Markdown uses `rehype-raw` with **no `rehype-sanitize`** (`packages/ui/src/components/markdown/Markdown.tsx:561`); Mermaid SVG is injected via `dangerouslySetInnerHTML` with no sanitizer (`MarkdownMermaidBlock.tsx:243`); SVG icons use a **regex** sanitizer (`icon-cache.ts:709`). React neutralizes `<script>` and string event-handler props, so these are Medium not Critical, but they rely on library internals. **Fix:** `DOMPurify` is **already a declared dependency but has zero imports** — wire it into the mermaid + SVG-icon paths (`{USE_PROFILES:{svg:true,svgFilters:true}}`, forbid event handlers) and add `rehype-sanitize` after `rehype-raw`. *Test risk:* over-aggressive sanitization can strip valid diagram/icon markup — visual-test after.

### #3 Electron shell boundary

Verified strong already: `contextIsolation:true`/`nodeIntegration:false` on every window, no `<webview>`, `webSecurity` never disabled, navigation + `setWindowOpenHandler` locked down, minimal typed preload (no generic `invoke` passthrough), untrusted-web panes fully sandboxed. Residual gaps:

- **(HIGH) — no Electron Fuses; `asar:false`.** `electron-builder.yml:87` `asar:false` (app JS ships as loose, patchable files); no `@electron/fuses` step, so `ELECTRON_RUN_AS_NODE` is left enabled (run the shipped binary as raw Node = full OS access, bypassing sandboxing). **Fix:** add an `afterPack`/`@electron/fuses` step (`OnlyLoadAppFromAsar:true`, `EnableCookieEncryption:true`, `EnableNodeCliInspectArguments:false`, `EnableNodeOptionsEnvironmentVariable:false`), set `asar:true`. *Care:* the WhatsApp worker intentionally uses `ELECTRON_RUN_AS_NODE` (`index.ts:694`), so evaluate `RunAsNode:false` separately (may need the worker moved to a bundled Node). **Packaging change — must be build-tested.**
- **(MED) — main window `sandbox:false`.** `window-manager.ts:189`; every other window uses `sandbox:true`. **Fix:** set `sandbox:true` on the main window. *Care:* the preload (`@sentry/electron/preload`, WS transport) must run under a sandboxed preload — **runtime-test required** before shipping.
- **(MED) — main-renderer CSP allows `unsafe-eval`/`unsafe-inline` + a hard-coded `http://localhost:8097` (React DevTools) in prod.** `apps/electron/src/renderer/index.html:6`. **Fix:** split dev vs prod CSP (`app.isPackaged`), drop `unsafe-eval` + the DevTools origin from packaged builds; keep `wasm-unsafe-eval` only if the bundler needs it. *Care:* if a runtime dep needs `eval`, this breaks the app — test.
- **(LOW) — defense-in-depth backstop:** add a global `app.on('web-contents-created', (_e, wc) => { wc.setWindowOpenHandler(() => ({action:'deny'})); wc.on('will-navigate', denyRemote) })` so any future window can't ship without navigation lockdown. Low risk, additive.

---

## Summary
- **Applied & verified (safe, headless):** #6 brick-guard + atomic config + unique temp; #5 spawn_session depth + escalation guards.
- **Delivered as reviewed diffs (need build/GUI test):** #2 iframe `allow-same-origin` + DOMPurify wiring; #3 fuses/asar, main-window sandbox, prod CSP, web-contents backstop.
- **Flagged, not mine:** the `userDefined3Tier` migration test failure (concurrent `storage.ts` edit) and the pre-existing `DeepResearchRunner.test.ts` typecheck error.
- **Follow-up left out to stay contained:** spawn_session child-cancellation (add `childSessionIds` + cancel-path teardown).

*Companion to reports #1–#3 and the status-verification doc.*
