# Audit #2: Execution Boundary, MCP/API Lifecycle & SessionManager — RunnerOS

**Date:** 2026-06-28
**Scope:** the three highest-risk areas identified after audit #1 — (1) the tool-execution permission boundary, (2) MCP/API source lifecycle, (3) the `SessionManager` launch path & concurrency.
**Method:** three parallel deep-dive passes (each adversarial, read-only), then independent re-verification of the headline claims against live code — including running the actual allowlist regex and confirming the parser/validator/permission-mode behavior. Findings are tagged **VERIFIED** (I or a sub-pass read the exact code, and I re-ran the critical one) vs **TRACED** (a sub-pass read it; I reviewed the evidence but did not independently re-execute) vs **INFERRED**.

> Honesty notes: (1) This is a **local, single-user desktop app** — the OS user is the trust boundary. That caps the severity of "an attacker who can write config files" issues (they'd already have local access), but does **not** cap prompt-injection issues, because the agent ingests untrusted web/file content by design. I weight severity accordingly. (2) I could not run the app end-to-end (no display/credentials), so runtime *exploitability* of the concurrency races is structurally demonstrated, not reproduced. (3) A sub-pass wrote a harmless probe file at repo root `_probe.cjs` that I could not delete (read-only mount) — please `rm` it. (4) There is a sibling `.worktrees/audit-agents-auth-fixes/` worktree in the tree, apparently fixes-in-progress from audit #1.

---

## Verdict

The permission architecture is **well-designed in shape** — the SDK's own permissions are disabled and everything funnels through one trusted-process `PreToolUse` hook with an AST-based bash validator, a human-approval mode, and a real privileged-execution broker. That's the right design. But it has **one verified Critical bypass** (argument injection through the allowlisted `git`) that becomes **silent remote code execution under prompt injection in the default mode**, plus a class of "read-verb" classification weaknesses. The MCP/API layer is missing basic robustness (no timeouts, shutdown leaks, an unpinned `@latest` supply-chain hole). `SessionManager` is a genuine god-module whose size has already produced real correctness bugs (split-brain source state, a memory-injection inconsistency, and TOCTOU concurrency gaps).

Net: the bones are good; the sharp edges are real and a couple are serious. The git bypass should be treated as a **fix-now** item.

---

## Master findings (severity-ranked)

| ID | Sev | Area | One-line | Evidence |
|---|---|---|---|---|
| EXE-1 | **Critical** | Execution | `git -c core.pager=<cmd>`/`sshCommand`/`fsmonitor`/`diff.external` passes the bash allowlist → silent RCE, no prompt in default `ask` mode | `bash-validator.ts:415-418`; `default.json:205`; `mode-manager.ts:1850-1851`; re-verified live |
| MCP-1 | **High** | Supply chain | `npx -y notebooklm-mcp@latest` executes an unpinned third-party package on every connect | `sources/notebooklm/config.json` |
| EXE-2 | **High** | Execution | Read-only allowlist (`cat`/`grep`/`find`) allows silent exfil of `.ssh`/`.aws`/`.env` with no prompt; chains with always-allowed WebFetch | `default.json` read-only patterns; `mode-manager.ts:1595-1602` |
| SM-1 | **High** | SessionManager | Memory injected for workflow/automation/spawn launches but **not** interactive chat; and frozen at create-time when it is | `SessionManager.ts:2064` (sole caller of `buildWorkflowAgentPrompt`) vs `:3981` |
| SM-2 | **High** | Concurrency | No per-session lock; TOCTOU between `isProcessing` check (`:6797`) and set (`:6948`) → two concurrent streams for one session | `SessionManager.ts:6797,6948,1502` |
| SM-3 | **High** | Persistence | Debounced-timer write path bypasses the `writeInProgress` guard → torn-file/ENOENT race on the `.tmp` | `persistence-queue.ts:80` vs `:185` |
| SM-4 | **High** | SessionManager | `enabledSourceSlugs` persisted-enabled *before* server build; build failure leaves source enabled with no server, no rollback | `SessionManager.ts:7016-7018,7035,7051` |
| SM-5 | **High** | SessionManager | Source-build errors swallowed (`warn`+continue); user gets a normal-looking turn silently missing tools | `SessionManager.ts:7051-7053` |
| MCP-2 | **High** | Robustness | No timeout on MCP connect/list/call or API `fetch`; a hanging server stalls awaited `sync()` → blocks session startup | `mcp/client.ts:127-160`; `api-tools.ts:248` |
| MCP-3 | **High** | Resource | App-shutdown `cleanup()` never disposes live sessions → orphaned stdio MCP subprocesses on quit | `SessionManager.ts:9291-9329` |
| EXE-3 | **Med** | Execution | Unanchored MCP "read-only" substring patterns (`get`/`list`/`read`/`view`) auto-allow mutating tools like `forget_user`, `purge_listings` | `mode-manager.ts:1740-1741`; `default.json allowedMcpPatterns` |
| MCP-4 | **Med** | Concurrency | Credential-store writes are full read-modify-write with no lock/atomic-rename → cross-source concurrent refresh = lost-update (drops rotated refresh token) | `secure-storage.ts:132-151,303` |
| MCP-5 | **Med** | Injection | Arbitrary stdio `command` from source config, no validation/allowlist/first-run confirm | `server-builder.ts:90-101`; `rpc/sources.ts:240-253`; `storage.ts:1072` |
| MCP-6 | **Med** | Network | MCP HTTP/SSE URL not scheme/host-validated; bearer token sent to any host (SSRF/token-exfil if config is attacker-supplied) | `server-builder.ts:340`; `mcp/client.ts:101` |
| SM-6 | **Med** | Consistency | Two divergent source-build code paths (`getOrCreateAgent` vs `sendMessage`); only one does OAuth refresh | `SessionManager.ts:3823` vs `:7050-7075` |
| SM-7 | **Med** | Consistency | Permission-mode default resolved by 3 different fallback chains (automation `safe`, spawn inherit, chat persisted) | `SessionManager.ts:8833,4619` |
| MCP-7 | **Med** | Auth | OAuth relay state envelope is unsigned; `returnTo` forgeable (relay-side open-redirect/code-interception risk; relay not in repo) | `oauth-relay.ts:38-45` |
| SM-8 | **Med** | Persistence | Dangling persisted references to deleted sources/agents; silent filtering on load masks them | `SessionManager.ts:3818,3263` |
| EXE-4 | **Low** | Execution | `bash-parser@0.5.0` is stale; throws on ANSI-C `$'...'` (caught, fails closed) — availability/latent-divergence risk | `bash-validator.ts:160` |
| MCP-8 | **Low** | Robustness | No reactive 401→refresh+retry; server-side revocation before local expiry → 401s until expiry window | `api-tools.ts:268-279` |
| SM-9 | **Low** | UX | Spawned-session send failures only `log.error`, invisible to user | `SessionManager.ts:4666-4668` |

---

## The Critical, in detail — EXE-1 (verified live)

**Design (good):** the Claude SDK runs with `permissionMode: 'bypassPermissions'` and all gating is done in a trusted-process `PreToolUse` hook (`claude-agent.ts:988-990,1002`). The permission mode is re-derived server-side from session state, so the agent/renderer cannot spoof it. Bash commands in `safe` mode (and the *auto-allow* decision in the default `ask` mode) are checked by an AST validator (`bash-parser`) against anchored allowlist regexes in `apps/electron/resources/permissions/default.json`. The validator correctly handles classic shell injection: `;`, `&&`, `|`, newlines split into separate command nodes (each re-validated); `$()`/backticks/`$VAR`/write-redirects are blocked. The CRITICAL `shell-quote` CVE from audit #1 is **not reachable** on this path (shell-quote isn't used to build/parse agent bash).

**The hole:** the allowlist authorizes commands by matching the *joined argv string* (`bash-validator.ts:415: const commandStr = commandParts.join(' ')`, `:418: patterns.some(p => p.regex.test(commandStr))`). The `git` pattern (`default.json:205`) permits an arbitrary flag group before the read-only verb:

```
^git\s+((-[A-Za-z]|--[a-z][-a-z]*)(\s+[^\s-][^\s]*)?\s+)*(status|log|diff|show|...|ls-remote|...)\b
```

`-c` matches `-[A-Za-z]` and its value `core.pager=/tmp/x.sh` matches the optional argument `[^\s-][^\s]*`. I re-ran the exact regex:

```
MATCH  "git -c core.pager=id status"
MATCH  "git -c core.pager=/tmp/x.sh log"
MATCH  "git -c core.sshCommand=id ls-remote"
MATCH  "git -c diff.external=id diff"
```

`git -c core.pager=<cmd> log` runs `<cmd>` when output paginates (log paginates by default); `core.sshCommand` runs on `ls-remote`; `core.fsmonitor` runs on `status`; `diff.external` runs on `diff`. These are real arbitrary-command-execution primitives. Because `git log`/`status`/`diff` classify as **read-only**, they are **auto-allowed with no human prompt in the default `ask` mode** (`mode-manager.ts:1850-1851` allows all in ask; read-only bash skips the prompt via `isReadOnlyBashCommandWithConfig`, `:1595-1602`), and they pass `safe` mode outright. The SDK then executes the **original** string, so git honors the `-c` override.

**Why it's Critical, not theoretical:** an agent ingests untrusted content (web pages, transcripts, file text). A prompt-injection payload that gets the model to emit `git -c core.pager=/tmp/x.sh log` (or write a one-liner and point `core.pager` at an existing interpreter) achieves **silent code execution in the default mode** — the one control that's supposed to catch dangerous bash (the human prompt) never fires because git-log looks read-only.

**Precision correction to the sub-pass:** its list included `git -c alias.x=!id status`. The regex matches it, but git would run `status`, not the alias `x`, so that particular payload does **not** fire. The live vectors are `core.pager` (with a paginating verb), `core.sshCommand` (with `ls-remote`), `core.fsmonitor` (with `status`), and `diff.external` (with `diff`).

**Fix:** add a git-specific dangerous-flag rejection in `bash-validator.ts` (mirror the existing `DANGEROUS_COMMAND_ARGS` mechanism): reject any `git` invocation containing `-c`, `-P`, `--exec-path`, `--upload-pack`, `--receive-pack`, `--output`, or `-c <key>=` where key ∈ {`core.pager`,`core.sshCommand`,`core.fsmonitor`,`core.editor`,`diff.external`,`*.command`}; and tighten the `^git` regex to forbid `-c`. More broadly: the read-only classifier should not treat any command carrying a `-c key=value`/`--config`-style arbitrary-config flag as read-only.

---

## The other High items, briefly

**MCP-1 — `npx -y notebooklm-mcp@latest` (supply chain).** `sources/notebooklm/config.json` spawns this on every connect; `-y` auto-installs and `@latest` re-resolves each time, with no pin/lockfile/integrity hash. One compromised publish of that package = silent code execution for every user with the source enabled. Fix: pin an exact version + integrity, drop `@latest`, ideally vendor or sandbox it. (Note: stdio MCP spawn itself is `shell:false` and strips a blocklist of secret env vars — that part is good.)

**EXE-2 — read-only exfil.** `cat`/`grep`/`head`/`find`/`less` are allowlisted and read-only, so `cat ~/.ssh/id_rsa` or `grep -r AWS_SECRET ~` runs with no prompt in `ask` mode. `$VAR`/`$HOME` expansion is blocked but literal absolute paths aren't. Combined with always-allowed WebFetch it's a silent read-and-exfil chain. Fix: a sensitive-path denylist (`.ssh`, `.aws`, `.config`, `.env`, keychains, credential files) that forces a prompt even for read tools.

**SM-1 — memory-injection divergence.** `buildWorkflowAgentPrompt` (which injects user + agent memory) is only called inside `resolveAgentSessionOptions` (`:2064`), which serves workflows, automations, and spawned sessions. Interactive **chat** builds its prompt in `getOrCreateAgent` and passes `managed.customSystemPrompt` straight through (`:3981`) — so chat does not inject memory the same way, and when memory *is* injected it's frozen at session-create time (later memory edits never re-read). This is a correctness/consistency bug, not a security one, but it means the same agent behaves differently depending on how it was launched — exactly the "Memory OS" risk HANDOFF.md warned about. Fix: one `composeSystemPrompt(managed)` shared by all launch paths; rebuild the memory section per turn.

**SM-2 / SM-3 — concurrency.** There is no per-session mutex; serialization rests on an `isProcessing` boolean checked at `:6797` and set at `:6948` with several `await`s in between, so two sends for one session can both pass the check and both stream (and both run `getOrCreateAgent`, building two pools — the loser leaks). Separately, the persistence queue's debounced-timer write (`persistence-queue.ts:80`) doesn't register in the `writeInProgress` guard that `flush()` uses (`:185`), so a timer-write and a concurrent flush can both touch the same `.tmp` → torn write/ENOENT. The class comment claims per-session serialization that doesn't hold for the timer path. Fix: set `isProcessing` synchronously before any await (or use the per-session mutex pattern that already exists for config libs at `:524`); route the timer through the guarded write path. *Caveat:* an upstream RPC/IPC layer might single-flight sends per session — I did not audit that layer, so the race is structurally present but its runtime reachability needs confirmation there.

**SM-4 / SM-5 — split-brain source state.** `sendMessage` persists `enabledSourceSlugs` (`:7016-7018`) in an early phase, then builds the servers in a later phase (`:7045-7093`) whose errors are only `warn`ed and swallowed (`:7051-7053`). If the build fails or `getOrCreateAgent` throws, the session is persisted with a source enabled that has no server; nothing rolls back, and the next turn silently filters it out (`:3818`) — permanent quiet disagreement between persisted and actual state, and the user gets a normal-looking turn missing tools. Fix: build servers first, persist enablement only after a successful apply, surface a typed "tools degraded" event on failure.

**MCP-2 / MCP-3 — robustness.** No timeout anywhere on MCP connect/list/call or API `fetch`, and `sync()` is awaited before the SDK connects, so one hanging server stalls session startup. And app-shutdown `cleanup()` (`:9291-9329`) tears down watchers/timers but never iterates live sessions to `dispose()` their MCP pools, orphaning stdio subprocesses (e.g. the notebooklm browser process) on quit. (The `deleteSession` path *does* dispose correctly — it's only the shutdown path that leaks.) Fix: add `AbortSignal.timeout` to all MCP/API calls; dispose all live sessions in `cleanup()`.

---

## Cross-cutting theme

The same root issue shows up in all three areas: **authorization/validation decisions are made on a normalized or partial view, then the original/raw thing is acted on.** The bash allowlist matches a joined argv but git executes the raw flags (EXE-1); MCP "read-only" is decided by a substring of the tool name but the real tool may mutate (EXE-3); source enablement is persisted before the thing it authorizes is actually built (SM-4). And `SessionManager`'s size is the force multiplier — the memory gap, the double source-build, and the 3 permission-mode fallbacks all exist because the same logical operation is implemented in multiple places that drifted. The structural fixes (extract a single validator, a single `composeSystemPrompt`, a single `applySourceServers`, a per-session mutex) would close several findings at once.

---

## What I could NOT determine
- **Whether the RPC/IPC layer single-flights `sendMessage` per session** — if it does, SM-2's race is masked in practice. Needs an audit of the IPC handler (out of this scope).
- **The OAuth relay service itself** (external, not in repo) — whether it honors an unvalidated `returnTo` (true open-redirect/code-interception). The unsigned envelope (MCP-7) is the in-repo enabler.
- **Whether an agent definition can set its own `permissionMode: 'allow-all'`** (self-elevation). `initialMode` flows from `config.session?.permissionMode` (`claude-agent.ts:601`); I did not trace whether agent YAML can populate that field. Worth confirming — if yes, a malicious/auto-generated agent could disable the prompt gate entirely.
- **Whether the non-Claude backends (Pi/etc.) execute the post-approval bash identically** to the Claude SDK Bash tool, or via a path that could reintroduce a parse/exec mismatch. The gate is shared; the executors were not each read.
- **Runtime reproduction** of the concurrency races and the `npx` runtime behavior (no app execution available).

---

## Recommended remediation order
1. **EXE-1** — fix the `git -c` argument-injection (Critical; silent RCE under prompt injection in the default mode).
2. **EXE-2 + EXE-3** — sensitive-path denylist for read tools; anchor the MCP read-only patterns. (Same prompt-injection blast radius.)
3. **MCP-1** — pin/vendor the `notebooklm` MCP; drop `@latest`.
4. **SM-4/SM-5** — build-before-persist + surface source-build failures (data-integrity + user-trust).
5. **SM-2/SM-3** — per-session mutex + fix the persistence timer/flush race (after confirming the IPC layer doesn't already serialize).
6. **MCP-2/MCP-3** — timeouts everywhere; dispose sessions on shutdown.
7. **SM-1** — unify system-prompt/memory composition across launch paths.
8. **MCP-4/5/6, SM-6/7/8, MCP-7** — credential-store atomic writes, source-config validation, URL scheme checks, unify the divergent paths, sign the relay envelope.
9. Low items (EXE-4, MCP-8, SM-9) as cleanup.

---
*Companion to `AUDIT_AGENTS_AUTH_CONNECTIONS.md` (audit #1). Housekeeping: delete the stray `_probe.cjs` at repo root left by a sub-pass.*
