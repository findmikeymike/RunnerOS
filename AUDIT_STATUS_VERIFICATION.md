# Audit Status — Independent Fix Verification

**Date:** 2026-06-29 (evening)
**Purpose:** independently re-verify, against current code, which findings from audit reports #1–#3 have actually been fixed by the parallel remediation work — versus what's still open. Every line below was re-read on the live tree; this is a rival-reviewer check, not a status taken on trust.

**Headline:** the remediation is real and substantial. Of the items I re-checked, **14 are verified fixed** (including every Critical), **2 are partial**, **3 are confirmed still open**, and the rest weren't in this pass. The dependency tree went from **49 vulns (1 critical, 13 high) → 2 moderate**.

---

## ✅ Verified FIXED

| ID | Finding | What I verified now | Evidence |
|---|---|---|---|
| EXE-1 | `git -c core.pager=<cmd>` allowlist bypass (was Critical) | `git` now in `DANGEROUS_COMMAND_ARGS` + `getDangerousGitReason` blocks `-c`/`--config`/`--exec-path`/`--upload-pack`/`--receive-pack`/`--output` **before** the allowlist; fires on tokenized form | `bash-validator.ts:136-143,178-210,478-489` |
| EXE-2 | read-only `cat`/`grep` exfil of `.ssh`/`.env` (was High) | `SENSITIVE_READ_COMMANDS` + `getSensitivePathReason` block credential-path reads | `bash-validator.ts:147,216-224,494` |
| SEC-1 | OAuth secrets baked into build (was High) | Secret `--define`s removed from `package.json` build:main; `getBuildDefines()` now public IDs only; **`assertNoBundledSecretValues()` fails the build if a real secret value lands in the bundle** | `electron-build-main.ts:50-65,124-139`; `package.json:19` |
| SEC-3 | `shell.openExternal` blocklist (was Med) | Replaced with an **allowlist** (`https:`/`http:`/`mailto:` …); comment now "Only explicitly allowed schemes" | `utils/url-safety.ts:1-16` |
| AG-1 | `hypermotion-agent` → non-existent `remotion-production` skill (was High) | Reference removed from the starter template (no match) | `starter-templates.ts` (no hit) |
| SRC-1 | `meta-ads` referenced but not registered (was High) | Now a real builtin source: `META_ADS_SLUG`, `builtin-meta-ads`, in `isBuiltinSource()` | `builtin-sources.ts:20,670-672,1199` |
| MCP-1 | `npx -y notebooklm-mcp@latest` supply chain (was High) | Pinned to `notebooklm-mcp@2.0.0` | `sources/notebooklm/config.json:13` |
| MCP-2 | No timeouts on MCP/API calls (was High) | API fetch wrapped in `AbortController`+`API_FETCH_TIMEOUT_MS`; MCP client has `timeoutError` + `Promise.race` | `api-tools.ts:231,277`; `mcp/client.ts:68-78` |
| MCP-3 | Shutdown `cleanup()` leaked MCP subprocesses (was High) | `cleanup()` now disposes agents and calls `mcpPool.disconnectAll()` per session | `SessionManager.ts:9375,9380` |
| WF-1 | Workflow step sessions never closed (was High) | `deleteSession` dep added and called for hidden step sessions in `finally` | `workflows/runner.ts:115,854-859,698/825/957` |
| WF-2 | No mandatory step timeout / runaway (was High) | `DEFAULT_STEP_TIMEOUT_SECONDS = 20m`, capped at `MAX_STEP_TIMEOUT_SECONDS = 60m`, applied via `Math.min` | `runner.ts:156-157,184` |
| DR-1 | Deep Research auto-mode `allow-all` + Bash → silent exec (was **Critical**) | Auto mode now runs **`safe`**, not `allow-all`; bash is gated by the (now-hardened) validator | `DeepResearchRunner.ts:373` |
| TRG-1 | `allow-all` automations auto-run on inbound triggers (was High) | `EXTERNAL_INPUT_EVENTS` set + `if (mode==='allow-all' && EXTERNAL_INPUT_EVENTS.has(event)) return 'ask'` | `prompt-handler.ts:17,38` |
| DEP-1 | 49 dependency vulns, 1 critical/13 high (was Med) | `bun audit` now reports **2 vulnerabilities (2 moderate)** | `bun audit` (re-run today) |

---

## ◐ PARTIAL

| ID | Finding | Fixed part | Still open part |
|---|---|---|---|
| MSG-1 | Telegram remote drive + self-approval (was High) | **Remote self-approval closed:** `requiresAppApproval()` now returns true for **telegram** (not just WhatsApp), so a remote sender can no longer approve a run's tool prompts — approval requires the desktop app. `types.ts:217-219` | **Per-sender authorization still absent** — no `(channelId, senderId)` allowlist found in `messaging-gateway/`. Anyone who finds the bot can still DM it, `/new`, and trigger runs (now limited to non-prompting tools / desktop-approved ones). Sender allowlist still recommended. |
| SEC-2 | Credential key derived from hardware UUID; no OS keychain (was High) | Storage refactored: there's now a **separately stored, encrypted key file** (`CREDENTIALS_KEY_FILE`, `secure-storage.ts:414`) rather than a pure hardware-UUID-derived key — likely an improvement | Not fully traced; **OS keychain (`safeStorage`) still not used** as far as I verified. Worth a focused re-read to confirm the new key model's strength. |

---

## ✗ Confirmed STILL OPEN

| ID | Finding | Evidence it's still open | Fix |
|---|---|---|---|
| EXE-3 | MCP "read-only" classifier uses **unanchored substrings** → mutating tools like `purge_listings`/`forget_user` auto-allowed (was Med) | `mode-manager.ts:1789-1790` still `patterns.some(p => p.test(toolName))`; `default.json:901+` patterns are bare `"search"`,`"list"`,`"get"`,`"read"`,`"info"` with no `^`/boundary | Anchor patterns to the tool's action segment, or use explicit per-source read-only allowlists |
| SM-2 | No per-session lock on `sendMessage`; TOCTOU on `isProcessing` allows two concurrent streams (was High) | Still just an `isProcessing` boolean (`SessionManager.ts:1132,1507`); no mutex/queue added. **Open dependency:** whether the IPC layer single-flights sends per session is still unconfirmed | Set `isProcessing` synchronously before any await, or wrap per-session work in a mutex (pattern exists for config libs). First confirm the IPC layer doesn't already serialize |
| MCP-4 | Credential-store write is non-atomic, no lock → cross-source concurrent refresh can drop a rotated token (was Med) | `secure-storage.ts:329` still `writeFileSync(CREDENTIALS_FILE, …)` directly — no temp-file+rename, no write mutex | Single async write mutex + temp-file+`rename`; merge-under-lock |

---

## Not re-checked this pass (status unknown)
These weren't in this sweep — could be fixed, partial, or open: **SM-1** (memory injection divergence chat vs workflow), **SM-3** (persistence timer/flush race), **SM-4/SM-5** (source split-brain / swallowed source-build errors), **DR-2** (Deep Research budget/maxTurns), **DR-4** (brittle tool-use guard that may fail successful runs), **MSG-2/3** (WhatsApp self-chat-off gate, inbound rate-limit), **AUTH-1** (Slack relay var undocumented), **AUTH-2** (Canva dead config — appeared to have no consumer), **SRC-2** (YouTube `connectionStatus` path-resolution test), **WF-3/4/5** (onFailure:ask, in-memory concurrency guard, retry backoff).

---

## Verification caveats (truth-in-labeling)
- "Fixed" = I read the current code and the guard/logic is present and correct for the cases I checked. I did **not** re-run the full test suite or build after each fix this pass (one prior `bun audit` re-run is the exception). A green typecheck/test run across the changed packages would harden these claims.
- SEC-1 "fixed" depends on the `assertNoBundledSecretValues` guard actually running in the release pipeline — verified the function exists and is wired into the build script; did not observe a real release build.
- SEC-2's new key-file model is reported as "likely improved" from a single read; treat as needs-confirmation, not verified-strong.
- The IPC single-flight question (gating SM-2) remains genuinely open.

---

## Suggested next steps
1. **EXE-3, MCP-4** — two small, clearly-open items with concrete fixes; quick wins.
2. **SM-2** — first answer the IPC single-flight question, then decide if a mutex is needed.
3. **MSG-1 (remainder)** — add the Telegram per-sender allowlist.
4. **Re-check the "unknown" batch** — especially SM-1 (memory divergence), DR-2/DR-4 (Deep Research budget + the tool-use guard that likely fails on first real run), since Deep Research is the never-smoke-tested path.
5. **Run `typecheck:all` + targeted tests + a build** to harden all the "fixed" claims and exercise `assertNoBundledSecretValues`.
6. Housekeeping: delete the stray `_probe.cjs` at repo root.

*Companion to AUDIT_AGENTS_AUTH_CONNECTIONS.md (#1), AUDIT_EXECUTION_MCP_SESSIONMANAGER.md (#2), AUDIT_TRIGGERS_WORKFLOWS_DEEPRESEARCH.md (#3).*
