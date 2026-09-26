# R6 Shell Hooks — Cold Senior Review

Reviewer: adversarial 30-year senior dev (assume rival authored this).
Scope: `packages/shared/src/automations/hooks/**`, `automations/handlers/shell-hook-handler.{ts,test.ts}`, `automations/handlers/index.ts`, `packages/shared/package.json`, `THIRD_PARTY_NOTICES.md`.
Verification on disk:
- `bun test packages/shared/src/automations/hooks/__tests__ packages/shared/src/automations/handlers/shell-hook-handler.test.ts` → **42 pass / 0 fail** (4 files, 75 expects, 506 ms).
- `cd packages/shared && bun run tsc --noEmit` → **clean** (shim picked up via package-local `include`).
- `bun run typecheck:all` (repo root) → **FAILS**: `../shared/src/automations/hooks/allowlist-store.ts(23,22): error TS7016: Could not find a declaration file for module 'proper-lockfile'`.

Verdict: **REQUEST CHANGES — BLOCKER on typecheck:all.** Implementation quality is good, security posture is solid, but Phase 1 done-criteria (`typecheck:all` clean) is not met. Plus three additional findings worth fixing before merge.

---

## 1. BLOCKER — `typecheck:all` is not clean (shim is invisible to dependent projects)

**Evidence.** From repo root:
```
$ bun run typecheck:all
../shared/src/automations/hooks/allowlist-store.ts(23,22): error TS7016: …'proper-lockfile'…
error: "tsc" exited with code 2
```
The failure is in the `packages/core` leg of the chained `tsc` invocations in the root `typecheck:all` script. `packages/core` reaches into `packages/shared` via path mapping (`@craft-agent/shared`) and compiles `allowlist-store.ts`, but tsc only auto-includes `.d.ts` files rooted under the *current project's* `include` glob. The shim lives at `packages/shared/src/automations/hooks/proper-lockfile.d.ts`, which is outside `packages/core`'s `include`, so its `declare module 'proper-lockfile'` is never registered for that compilation. Result: every upstream consumer of `@craft-agent/shared` typechecks dirty.

Notably, `bun run tsc --noEmit` *inside* `packages/shared` is clean because the shim is in-include there. The prior agents who said "shim handles it" only tested the shared-package leg.

**Two prior agents flagged this exact symptom.** They were right; the shim does not in fact resolve the typecheck error across the workspace.

**Fix (do this).** Install real types — they exist:
```
npm view @types/proper-lockfile name version
name = '@types/proper-lockfile'
version = '4.1.4'
```
Action:
1. Add `"@types/proper-lockfile": "^4.1.4"` to `packages/shared/devDependencies`.
2. Delete `packages/shared/src/automations/hooks/proper-lockfile.d.ts`.
3. Re-run `bun run typecheck:all`.

Acceptable alternative: move the shim to a workspace-typeroots location that all packages pick up (e.g. `packages/shared/types/proper-lockfile.d.ts` with `typeRoots` added in every dependent tsconfig). The shim path inside `src/automations/hooks/` was a bad location regardless — keep ambient module shims under `types/` or `typings/` so the *intent* (workspace-wide module declaration) is obvious.

Phase 1 is **not done** until this is green.

---

## 2. SECURITY — TOCTOU between consent and execution

**Finding.** `requestConsent()` hashes the script content (`computeScriptContentHash`) and writes the hash into the allowlist. `runShellHook()` then calls `runChild(argv, …)` which spawns the original `argv[0]`. Between consent acceptance and spawn, there is no re-hash. After consent is granted, a subsequent run trusts the allowlist entry whose `scriptContentHash` matches `computeScriptContentHash(scriptPath)` *at the time of the next call*. That's mostly fine because `findEntry` requires the live hash to match the stored hash.

But within a single `runShellHook` invocation there is still a TOCTOU window: `requestConsent` hashes the script, then `runChild` spawns argv — an attacker who can write to `scriptPath` between those two `await` boundaries can swap content after approval. On a multi-tenant box or with a compromised low-priv process, this is exploitable.

**Severity.** Medium. The attacker already needs write access to a script the user has previously authorized; in that world they could have replaced the body before consent was even asked. But the TOCTOU is real and easy to close.

**Fix.** After consent passes, re-hash the script and verify it equals the just-recorded entry hash before `runChild`. If it differs, log + fail-open with `{action:'allow', message:'hook content changed after consent (TOCTOU)'}`. Cheap: it's the same `createHash('sha256').update(buf)` you already wrote, called once per run.

---

## 3. SECURITY — No symlink resolution / no canonicalization of `scriptPath`

**Finding.** `resolveScriptPath` does `path.resolve()` (lexical) but never `fs.realpath`. The allowlist key is the lexical absolute path. Two attacks:

1. **Symlink swap.** User approves `~/.runneros/hooks/firewall.sh` which is a symlink to `/opt/team/firewall.sh`. Hash is computed by `fs.readFile(scriptPath)` (Node follows symlinks by default, so the hash is over the *target*). Stored `scriptPath` is the link path. Tomorrow attacker repoints the symlink to `/opt/team/evil.sh`. Next run: `findEntry(event, '/Users/.../firewall.sh', sha256(evil.sh))` → no hit → consent re-prompts. **Good.** *However*, if the user is non-TTY with `RUNNEROS_ACCEPT_HOOKS=1` (the CI mode), the new entry is silently approved — the attacker just got code exec.
2. **Path aliasing.** Two paths refer to the same file via different links (e.g. `/private/tmp/x` vs `/tmp/x` on macOS where `/tmp -> private/tmp`). Each gets its own allowlist entry. Not a security hole per se, just allowlist bloat and a confusing UX.

**Severity.** Medium for #1 in CI/`accept_hooks` mode; Low otherwise.

**Fix.** Resolve symlinks: `scriptPath = await fs.realpath(path.resolve(expandTilde(picked)))`. Document the consequence (a symlink swap will look like a brand-new entry that re-prompts at the TTY, and is *silently approved* under `RUNNEROS_ACCEPT_HOOKS`).

Stronger fix: when running under `RUNNEROS_ACCEPT_HOOKS=1`, require either an explicit per-hook `acceptHooks: true` in the DSL **or** a pre-seeded allowlist file. The current env var is a global RCE switch — anyone who can set `RUNNEROS_ACCEPT_HOOKS=1` and arrange for a hook event gets code exec. CI is the obvious legitimate use case, but the env var deserves a louder log line on every silent approval.

---

## 4. CORRECTNESS — `MIN_TIMEOUT_MS = 50` is a production footgun

**Finding.** Constant is exported, called from `clampTimeout`, and floors *every* timeout — including production. Any caller who passes `timeoutMs: 10` gets a 50 ms hook that almost certainly SIGTERMs itself before stdout is drained. The comment says "kept tiny so tests can drive SIGKILL", but the implementation makes it a real production floor.

**Severity.** Low (no security impact; just reliability/UX).

**Fix (preferred).** Keep `MIN_TIMEOUT_MS = 1000` for production. Tests should inject a timeout override via the `RunShellHookOptions` API (add `minTimeoutMsOverride?: number` for test-only use) instead of pulling the production floor down to 50 ms. The current test `hook-sleep.sh` test asserts `elapsed < 4500`, which works fine with a 1 s floor too.

If you don't want a second knob, at minimum rename to `MIN_TIMEOUT_MS_FOR_TESTS` and gate on `process.env.NODE_ENV === 'test'` to fall back to 1000 in production. The shipped constant is a sharp edge waiting to draw blood.

---

## 5. CORRECTNESS — Output capping is wrong direction

**Finding.** `STREAM_CAPTURE_BYTES = 4096`. Doc claims "stdout/stderr capped at … 4 KB each before logging." Implementation caps at `STREAM_CAPTURE_BYTES * 2 = 8 KB` in memory (the `<` check in `onStdout`/`onStderr`), then `truncate(result.stderr, 400)` in the *log line*. So the in-memory cap is 8 KB / stream, and only the log gets clipped further.

Two issues:
1. **`stdout += chunk`** is unbounded *within* a single chunk. If the child writes one 10 MB blob before the 8 KB check evaluates, you've captured 10 MB. `child_process` chunks tend to be small (highWaterMark 64 KB), so worst case ~72 KB per stream — still bounded enough not to matter in practice, but the doc and code disagree.
2. **Truncated `stdout` may break `JSON.parse`.** If a chatty hook writes 9 KB of valid JSON, the captured `stdout` is truncated at ~8 KB mid-token → `parseHookStdout` logs a warning and returns null → fail-open allow. A malicious hook author could deliberately bloat their stdout to silently downgrade `block` decisions. **Real, exploitable.**

**Severity.** Medium. Combine with #2: a hook that detects RunnerOS is checking it can pad its block payload past 8 KB to force fail-open.

**Fix.** Either (a) raise the JSON capture budget to something much larger (256 KB) and only truncate for *logging*, or (b) implement a streaming JSON detector — find the first balanced-brace span, parse that, discard the rest. (a) is simpler. Update the doc comment to match reality either way.

---

## 6. CORRECTNESS — `parseHookStdout` accepts `{action:'allow'}` from Claude-Code wire only via `decision` field

**Finding.** Spec says Claude-Code emits `{decision:'block', reason}`. The code also handles `{decision:'allow'}`. What about `{decision:'approve'}`? Real Claude Code (as of late 2024) actually emits `'approve' | 'block' | undefined`. `approve` is *not* recognised by `parseHookStdout` → falls through to the final `return null` → defaults to allow. Functionally identical (`approve` and `allow` both pass the workflow), but it means a hook that genuinely wanted to log "approved" via the decision field loses its `reason` string in the outcome.

**Severity.** Low (cosmetic / log fidelity).

**Fix.** Treat `decision === 'approve'` as `{action: 'allow', message: reason}`. Add a test.

---

## 7. CORRECTNESS — Process-group kill works on POSIX, silently degrades on Windows

`detached: true` is gated on `process.platform !== 'win32'`. On Windows, `child.kill(signal)` only signals the immediate child, not its descendants. Documented inline; matches Hermes's posture. Acceptable for now; flag for follow-up if Windows ever becomes a supported deploy target.

**Verified PID negation logic.** `process.kill(-child.pid, 'SIGTERM')` is the textbook POSIX process-group signal; correct on macOS (kqueue) and Linux (epoll). `detached: true` makes Node call `setsid()`-equivalent so the child becomes process group leader, so `-pid` == `-pgid`. Good.

**SIGTERM → 100 ms → SIGKILL race.** The settle() runs immediately after SIGTERM is sent (`settle({...timedOut:true})` is on the same tick as the kill), so the test elapsed-time bound passes even if SIGKILL hasn't fired yet. The 100 ms grace + `.unref()` ensures we don't keep the event loop alive. Fine.

No fixture exercises a fork-and-orphan child (e.g. bash that backgrounds a `sleep`). Worth adding to prove the process-group kill actually reaps grandchildren. Suggested fixture: `hook-fork.sh` that does `sleep 10 &; sleep 10` — assert both PIDs are dead within 500 ms of timeout.

---

## 8. CORRECTNESS — `isShellHookAction` silently swallows typos

`isShellHookAction` requires `type === 'shell-hook'`. A config typo like `type: 'shellhook'` is silently ignored (no warning, no error). User stares at logs wondering why their hook never runs.

**Severity.** Low (UX).

**Fix.** In `dispatchMatcher`, when an action's `type` ends in `hook` or contains `shell` but the guard fails, emit a `log.warn` with the offending type so misconfigurations surface. Don't throw — keep the no-op behaviour for unrelated action types — just log when the shape *looks* close.

---

## 9. CORRECTNESS — `defaultHookEventName` regex bug for multi-cap inputs

```ts
return event.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`));
```
Argument `i` to `String.prototype.replace` callback is the **offset of the match in the string**, not the iteration index. For `'XYZ'`: matches at 0,1,2 → produces `'x_y_z'`. For `'AbCd'`: matches at 0,2 → `'a_b_d'` with the `C→_c` becoming `_c` because offset 2 ≠ 0 — actually that's the intended behaviour by coincidence. But the *intent* (camelCase → snake_case) is `'XMLHttpRequest' → 'xml_http_request'` and this produces `'x_m_l_http_request'`. The default branch is only hit for *unknown* event names not in the switch, so the bug is dormant unless someone adds a new event without updating the switch. Still wrong.

**Severity.** Low.

**Fix.** Standard camelToSnake regex: `event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()`.

---

## 10. LICENSE / ATTRIBUTION

- File-level headers in `types.ts`, `allowlist-store.ts`, `consent.ts`, `shell-hook-runner.ts`, `shell-hook-handler.ts` correctly cite Hermes Agent (MIT) and point to upstream filenames. Good.
- `THIRD_PARTY_NOTICES.md` updated: row added for `packages/shared/src/automations/hooks/` (R6) → `agent/shell_hooks.py`. Good.
- Notes column accurately describes what was ported (sha256-keyed allowlist, consent gate, sibling-flock cross-process locking, dual response-shape normalisation, context injection). Good.

No license concerns.

---

## 11. TESTS — coverage assessment

- 42 tests across 4 files; all green.
- All 7 fixtures (`hook-allow.sh`, `hook-bad-json.sh`, `hook-block-claude.sh`, `hook-block-hermes.sh`, `hook-context.py`, `hook-nonzero.sh`, `hook-sleep.sh`) are exercised.
- Wire normalisation: Claude and Hermes block/allow + context injection all asserted.
- Safety invariant: a test captures the spawn call args and asserts `opts.shell === false`. Good.
- Consent: TTY/no-TTY × acceptHooks matrix covered. Env var bypass tested.
- Allowlist round-trip + script-mutation invalidation tested.
- Handler: DSL routing tested for block, context, and "not-a-shell-hook" no-op.
- Re-export from `handlers/index.ts` verified.

**Gaps worth filling:**
1. No test passes a malicious command string through `parseCommand` and asserts rejection (covered partially — `'echo hi | grep h'`, `'$(date)'`, `'echo hi > /tmp/x'`). Add: backticks, `&&`, `;`, `<` for completeness.
2. No fork-bomb fixture verifying process-group kill (see §7).
3. No test exercises `findEntry` against a *symlinked* `scriptPath` (see §3).
4. No test forces stdout >8 KB to demonstrate the JSON-truncation downgrade (see §5).

Fixtures are bash + python; the bash ones use `#!/usr/bin/env bash` and standard POSIX constructs — portable across macOS and Linux. `chmod +x` is set on disk.

---

## Required actions before merge

| # | Severity | Action |
|---|---|---|
| 1 | **BLOCKER** | Install `@types/proper-lockfile`, delete local shim, `bun run typecheck:all` must be clean. |
| 2 | Medium | Close TOCTOU: re-hash script post-consent, pre-spawn. |
| 3 | Medium | `fs.realpath` the script path before allowlisting + spawning; document `RUNNEROS_ACCEPT_HOOKS` risks. |
| 4 | Low | Raise `MIN_TIMEOUT_MS` back to 1000 in prod; expose a test-only override. |
| 5 | Medium | Increase JSON capture budget (≥256 KB) or stream-detect first JSON object so a verbose hook can't silently downgrade `block`. |
| 6 | Low | Recognise `decision: 'approve'` from Claude Code wire. |
| 7 | Low | Add fork-and-orphan fixture; confirm process-group kill reaps grandchildren. |
| 8 | Low | Log warnings on hook-action type typos that *look* like `shell-hook`. |
| 9 | Low | Fix `defaultHookEventName` camel→snake regex. |
| 10 | n/a | Add tests for: extra metacharacter rejection, symlinked scriptPath, stdout-truncation block downgrade. |

## Verdict

**REQUEST CHANGES.** Implementation is well-structured and the core security invariants (`shell:false`, argv-not-string, shell-quote rejection of operators, sha256-keyed allowlist with re-consent on body change, process-group SIGKILL, fail-open on infra errors) are all correctly enforced. License attribution is clean. Tests are real (run real subprocesses), green, and broadly cover the wire-protocol matrix.

But Phase 1 done-criteria require `typecheck:all` to pass, and it does not. The local `.d.ts` shim is a band-aid that only works for the package that owns it; every dependent package re-hits the original TS7016. `@types/proper-lockfile@4.1.4` exists on npm — install it and delete the shim. That's the one mandatory change.

Findings 2, 3, and 5 are real security improvements (TOCTOU, symlink, stdout-truncation block downgrade). 2 and 5 are exploitable in adversarial scenarios; fix before this ships to users running untrusted shell hooks. The rest are polish.
