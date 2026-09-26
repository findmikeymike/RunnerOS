# Phase 1 — Final Security Audit

Scope: R1 subagent isolation, R2 injection scan, R6 shell hooks, R7
subconscious/escalation, R8 ACP adapter, plus config/persistence + privilege
boundary review. Evidence-based on the production code paths, not unit tests.

---

## Verified strengths

- **R6 shell hook spawn chain is hardened end-to-end.** `runShellHook`
  (`shell-hook-runner.ts:273-372`) calls `resolveRealScriptPath` (realpath
  canonicalization), `computeScriptContentHash` BEFORE consent, `requestConsent`,
  re-hashes immediately before spawn (TOCTOU defence at lines 321-337), and only
  then calls `runChild`. `runChild` (lines 65-159) is invoked with
  `shell: false`, `windowsHide: true`, `detached: true` (POSIX) so SIGKILL hits
  the whole process group on timeout. `parseCommand` (`allowlist-store.ts:146`)
  rejects any non-string token from `shell-quote` — operators/substitutions
  cannot smuggle past argv. The streaming first-balanced-JSON parser
  (`findFirstBalancedJsonEnd` / `extractFirstJsonValue`) is in the production
  path, so output-bloat-downgrade is closed.
- **R6 event payload is delivered via STDIN, not argv.** `runChild` writes
  `JSON.stringify(event)` to `child.stdin` (line 152). No argv injection
  surface from the event JSON.
- **R6 allowlist file persisted with 0600.** Both atomic write (`atomicWrite`,
  `allowlist-store.ts:70`) and initial touch (line 86) explicitly pass
  `mode: 0o600`. Verified.
- **R1 blocklist is at the tool-name layer.** `SPAWN_SESSION_BLOCKED_TOOLS`
  (`spawn-session-isolation.ts:54-80`) is a frozen set used by
  `stripBlockedTools`; the B3 review fix held — slug intersection
  (`intersectSourceSlugs`) is a separate function and the comments + code in
  `spawn-session-tool.ts:200-212` explicitly do NOT intersect slugs with the
  tool blocklist.
- **R1 depth gate is AsyncLocalStorage-scoped.** `spawnDepthStorage.run(depth+1,…)`
  (`spawn-session-tool.ts:221`) wraps the child execution; the depth counter
  is read via `getCurrentSpawnDepth` (`AsyncLocalStorage.getStore() ?? 0`) so
  a subagent cannot reset its own counter. `getMaxSpawnDepth` clamps to
  [1,3]; default 1 (leaf cannot spawn).
- **R1 approval callback isolation.** `approvalCallbackStorage` is per-async
  scope; the child gets `subagentAutoDeny` by default. `subagent_auto_approve`
  is read from the injected `getDelegationConfig` resolver (stored config),
  not from the trigger input map — agent-provided args cannot override it.
- **R2 injection scan runs on the assembled prompt at runtime.** Both call
  sites (`prompt-handler.ts:103-104` and `runner.ts:796-797`) call
  `assemblePrompt(...)` then `scanForInjection(...)`. The pattern id is
  logged server-side only; user-visible code paths drop the prompt without
  echoing the matched pattern.
- **R7 default classification is allowlist-of-reads.** `isWriteTool`
  (`subconscious-permissions.ts:183-211`) explicitly inverts the prior
  default — unknown tool → write → escalate in subconscious mode. SPEC §R7
  monotonicity preserved.
- **R7 `permission_mode` is run-level, not agent-controllable.** Resolved at
  trigger time by `resolvePermissionMode`; agent tool calls flow through
  `gateWriteAttempt` which only consults the `mode` argument supplied by the
  runner, not by the model. The model cannot rewrite its own gate.
- **R7 escalation rows have schema-level state-machine checks.** `CHECK(status
  IN (...))` (escalation-store.ts:98) + `resolve()` (line 248) refuses any
  flip out of `pending`. Replay of the same `workflowRunId` cannot resurrect a
  resolved escalation.
- **R8 ACP server keeps stdout clean.** `acpStderrPrint` (server.ts:41) sends
  every log to stderr; only `writeFrame` writes JSON-RPC to stdout. Parse
  errors emit a spec-compliant Parse Error frame (line 137) rather than
  silently mixing log lines onto the wire.
- **R8 sensitive paths always prompt.** `shouldAutoApproveEdit`
  (`permissions.ts:159-167`) returns false on `isSensitivePath` BEFORE the
  workspace prefix check. Sensitive set covers `.env*`, `id_rsa`, `id_dsa`,
  `id_ecdsa`, `id_ed25519`, and any path with `.ssh`/`.git` directory parts.
- **R8 WSL translation at edit approval.** `makeAcpEditApprovalRequester`
  (`permissions.ts:206-209`) calls `translateAcpCwd(proposal.path)` BEFORE
  the auto-approve check — the 01-08 reviewer's flag is closed.
- **R8 remote crash fails closed.** `ACPClient.failAll` (client.ts:210-218)
  rejects every in-flight waiter on either `'error'` or `'close'`; the
  early-connectivity gate in `open()` races initialize against lifecycle
  errors so a missing binary surfaces immediately rather than hanging.

---

## 🔴 High severity

**H1. ACP edit-approval path-traversal collapse is incomplete.**
`shouldAutoApproveEdit` calls `path.resolve(proposal.path)` (permissions.ts:167)
and then prefix-checks against `resolve(cwd)`. `path.resolve` does collapse
`..` segments for absolute results, so this part is fine — BUT
`isSensitivePath` runs on `normalize(path)` (line 149) which only collapses
`..` lexically and does NOT call `realpath`. A symlink inside the workspace
pointing to `~/.ssh/id_rsa` does not match the sensitive-path heuristic, and
the diff body would be auto-approved when policy is `session`/`workspace`.
Recommendation: `fs.realpath` the proposal before BOTH the sensitive-path
check and the prefix check, or refuse to follow symlinks during edit
application. (OWASP A01:2021 — Broken Access Control.)

**H2. R6 shell hook inherits full parent environment.** `runChild`
(`shell-hook-runner.ts:90-95`) passes no `env` option to `spawn`, so the
child inherits `process.env` wholesale — including OAuth tokens, vendor API
keys, and `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` set on the runner. A user-
approved hook script can exfiltrate them with a single `printenv >
/tmp/x`. Consent prose ("Commands run with your full user credentials")
covers this verbally but the user is almost certainly thinking "my shell
prompt", not "every workflow secret in the process". Recommendation: pass
an explicit allowlisted env (`PATH`, `HOME`, `LANG`, `RUNNEROS_HOOK_*`) and
strip everything else. At minimum strip variables matching `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|BEARER/i`.

**H3. Escalation SQLite DB has no explicit file mode.** `escalation-store.ts:173`
opens the DB via `new Database(dbPath)` without setting `umask` or chmod;
SQLite default file mode honours process umask (typically 0644 on macOS,
0664 on many Linux). Pending-write recommendation strings often contain
secrets ("PR body with API token", paths to `.env`) — these are world-
readable by other local users on shared systems. Same issue applies to
`acp_sessions` DB (session.ts:85) which persists prompt history. Recommendation:
`fs.chmod(dbPath, 0o600)` after `new Database`, or set `process.umask(0o077)`
before opening.

---

## 🟡 Medium severity

**M1. R2 patterns are not NFC/NFKC normalized.** `scanForInjection`
(prompt-builder.ts:214) only strips invisibles, then runs regex. A payload
using NFD-decomposed characters (e.g. compatibility ligatures, fullwidth
Latin `ｉｇｎｏｒｅ`) bypasses every pattern. Reviewer's flagged gap is
still open. Recommendation: `assembled.normalize('NFKC')` before `findInvisibleChar`.

**M2. R6 hook consent banner doesn't show the full argv.** Banner
(`consent.ts:96-101`) prints `command:` (the raw user string) and `scriptPath:`
(the realpath'd script). If `command = "/usr/bin/env python3 /innocent.py
--cfg ~/.aws/credentials"`, the argv is parsed but the consent prompt shows
only the script path, not the argv tail. A user approving from a small TTY
prompt may not realise the script is being handed a sensitive flag. Show
the full parsed argv in the banner.

**M3. R6 spawn fail-open is broad.** Lines 286, 297, 311, 325, 350, 355 all
return `{action:'allow'}` on infrastructure failure. SPEC explicitly
documents fail-open for broken hook scripts. The risk is that an attacker
who can make the script crash (write a 5MB binary into the path right after
consent, fill `/tmp`, etc.) reliably bypasses the `block` decision. The
TOCTOU re-hash catches the common case, but failure-mode review (item 8 in
the brief): for a tool whose purpose is *blocking dangerous actions*, fail-
closed should be the default with an explicit opt-in. Recommendation: at
minimum, fail-closed on `result.error.code === 'EACCES'` and on post-consent
hash mismatch (which currently fails open at line 334 — comment claims
"refuse" but the action emitted is still `allow`).

**M4. ACP `spawn-bridge` lacks env scrubbing.** `delegateToAcpEndpoint`
calls `ACPClient.open` which `spawn`s the remote with inherited env
(`client.ts:85`). Same data-exfiltration concern as H2. The remote ACP
agent could be a third-party binary (Zed, Cline, etc.) the user did not
audit. Recommendation: explicit env allowlist mirroring the shell-hook fix.

**M5. ACP stdio endpoint parsing uses naive whitespace split.**
`endpoint.split(/\s+/)` (client.ts:80) does not respect quoting — a config
value `stdio:/usr/bin/agent "--workspace=/path with spaces"` is split into
three argv tokens. Lower severity because the endpoint is operator-supplied,
not user-trigger-supplied, but it's a footgun. Use `shell-quote` parse the
same way the hook runner does.

**M6. R7 escalation rows are not cryptographically tamper-evident.** Any
local user with read+write to the DB file can flip a row from `pending`
to `approved` outside the API. The CHECK constraint only protects from
the API layer. For Phase 1 this is in-scope-of-trust-model (user-level
process), but if the runner is ever run with elevated privileges or shared,
this becomes a privilege escalation. Document the trust model explicitly,
or add HMAC over the row payload keyed by a runner-startup secret.

---

## 🔵 Low / informational

**L1.** `client.ts:80` accepts any string after `stdio:` as the executable.
The host config layer (not in scope here) should ensure operators cannot
inject arbitrary endpoints via a webhook trigger. Confirm at the config
schema layer.

**L2.** R7 `extractRecommendation` will happily serialize `toolArgs`
containing secrets (tokens, credentials in Bash `env=VAR`) and store them
in `recommendation` text. Truncated to 240 chars but a 32-char token fits.
Consider scrubbing the same secret-regex used in the injection scanner.

**L3.** `isWriteTool` matches `mcp__*` as a write because no prefix matches.
That is the intended safe-by-default behaviour but worth documenting — a
read-only MCP `get_status` invocation will needlessly escalate. Acceptable.

**L4.** ACP server emits `error.code -32603` (Internal error) for any
dispatch throw (server.ts:174). The error message is forwarded verbatim,
which may leak path information or stack-trace fragments to a remote
peer. Sanitize before forwarding.

**L5.** No rate limit on `ACPClient` permission-prompt loop. A malicious
remote ACP agent can DOS the local user with infinite permission prompts.
Bound the queue.

**L6.** Failure-mode matrix per brief item 8 (worth codifying in docs):
R1 isolation sampler n/a (synchronous); R2 scanner regex throw — not
caught, would bubble (fail-closed at runner). R3 gate sampler — fail-open
run CPU, last-known battery (per review). R4 config read — defaults
applied. R5 toolset resolver — try/catch returns default (fail-open).
R6 hook spawn — fail-open allow (debated, see M3). R7 escalation create
— bubbles, run fails (fail-closed). R8 ACP client crash — fail-closed via
failAll.

---

## Privilege boundary

A webhook trigger → workflow → prompt → tool dispatch chain is gated by
(a) `resolvePermissionMode` (run-level), (b) the workspace Safe-Mode policy,
and (c) `gateWriteAttempt` for write classification. A webhook CANNOT
register a new shell hook without going through `requestConsent`, which
either prompts at the TTY or requires the `RUNNEROS_ACCEPT_HOOKS` env
var / `acceptHooks=true` field. The `acceptHooks` field is on the action
DSL — verify at the config schema layer that webhook-supplied automation
configs cannot set `acceptHooks: true` without operator review. This is
the most important defense to lock down before opening webhook triggers
to the public internet.

---

## Verdict

Phase 1 ships with a defensible security posture for a user-level CLI/desktop
agent. The TOCTOU + symlink + output-bloat defences on R6 are well-engineered
and present in the production path. R1/R7 isolation invariants are
AsyncLocalStorage-scoped correctly. R8's stdout/stderr separation and
sensitive-path always-prompt rule are right.

Three issues should block a public webhook trigger landing without further
work: **H1 (symlink-realpath gap in edit approval)**, **H2 (full-env
inheritance into shell hooks)**, and **H3 (escalation/ACP DB file modes)**.
None of the three blocks Phase 1 internal use; all three should be addressed
before Phase 2 opens external trigger surface.

NFKC normalization (M1) and consent banner argv display (M2) are the highest-
leverage quick wins.
