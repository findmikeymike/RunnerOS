# Audit: Local Control-Plane Boundary (WS RPC + HTTP MCP pool server)

**Date:** 2026-06-30
**Why this one:** every prior finding pointed at it. The Electron-shell audit concluded the *real* privilege boundary isn't the preload — it's the local RPC server: whoever completes its handshake can invoke any channel, which can start an agent, which runs Bash. That was flagged "out of scope" twice. This audit opened it. It found the highest-severity issue of the whole engagement.

**Method:** two parallel deep-dives (WS control plane; HTTP MCP pool server), then independent verification of the linchpin claims against current code.

---

## Verdict

**CRITICAL — the loopback WebSocket control plane has no `Origin` check and no `Host`/DNS-rebinding defense.** A web page in the user's normal browser can open `ws://127.0.0.1:<port>` and complete the transport handshake. For a loopback control plane that can execute Bash, `Origin` is the primary trust boundary, and it is entirely absent. Exploitability depends on how the connection authenticates (below) — but the missing check is a Critical-class defect regardless, and the fix is small and safe.

The second target — the HTTP MCP "pool" server — is **unauthenticated and browser-reachable by design, but currently dead code** (never started by the shipping `anthropic`/`pi` backends). It's a loaded gun, not a live wound.

---

## The Critical, verified

**No Origin/verifyClient on the WS upgrade.** `packages/server-core/src/transport/server.ts:265,281,296` create `new WebSocketServer({ server })` / `({ host, port })` with **no `verifyClient` and no `handleUpgrade`**. `ws@8.19.0` (verified installed) does not validate `Origin` without `verifyClient`. A repo-wide grep for `origin`/`verifyClient`/`handleUpgrade` across `packages/server-core/src/transport/` returns **zero** matches. So the upgrade accepts any cross-origin browser connection. Browsers do **not** apply same-origin policy to WebSockets, so `https://evil.com` can freely `new WebSocket('ws://127.0.0.1:<port>')`.

**Bind + token (the mitigations that exist).** Default desktop mode binds **loopback + random OS-assigned port** (`apps/electron/src/main/index.ts:600-604`, `transport/server.ts:296`). The token is strong (192-bit hex / `randomUUID`, `headless-start.ts:106`) and delivered to the renderer over in-process Electron IPC (`__get-ws-token`), then sent **in the handshake message body** (`transport/client.ts:408`) — i.e. it is **not** a browser-auto-attached cookie, so a blind browser attacker must *know* the token.

**The two attack chains (honest exploitability):**
1. **Bearer path — needs the token.** `transport/server.ts:414-420` authenticates a body `token`. A browser attacker needs to obtain it. Leak vectors verified: printed to stdout unconditionally in Electron *headless* mode (`index.ts:1095`) and behind `CRAFT_PRINT_SERVER_TOKEN=1` in standalone (`packages/server/src/index.ts:360`), and returned by the Settings `GET_SERVER_STATUS` (`index.ts:1066`). Random port adds friction (a JS port-scan of the loopback ephemeral range, feasible but not instant). **Not** trivially exploitable in default windowed mode without a token leak.
2. **Cookie path — NO token needed, when the web UI is enabled (worse).** `transport/server.ts:422-425` falls back to `validateSessionCookie(upgradeRequestCookie)` — a cookie the **browser auto-attaches** to the `127.0.0.1` upgrade request. There is no `Origin`/CSRF check before honoring it. So if the web-UI login is in use and a valid session cookie exists for `127.0.0.1:<port>`, a malicious page performs a **cross-site WebSocket hijack with no token knowledge at all**. This is the classic CSWSH pattern and is the scariest variant; it's gated on the web UI being enabled.

Either way, once the handshake completes the connection can drive the agent to Bash execution.

### Supporting issues (same file)
- **No per-channel authorization (High).** `transport/server.ts:624-664` dispatches any registered `channel` to its handler with no ACL and no renderer-vs-arbitrary-client distinction. Worse, `RequestContext.workspaceId`/`webContentsId` come from the client's own handshake envelope (`:544-546,638-642`) and handlers consume them as identity — so a malicious client spoofs any workspace. Privileged channels (session start → Bash, `settings.SET_SERVER_CONFIG`) sit behind the same single gate as reads.
- **Token to stdout in Electron headless (Med).** `index.ts:1095` prints it unconditionally; gate it behind the same opt-in used in standalone.
- **Non-constant-time token compare (Low).** `headless-start.ts:295` `t === serverToken` → use `crypto.timingSafeEqual`.
- **`0.0.0.0` "server mode" in Electron only warns on cleartext (Med)** (`index.ts:1074-1082`) vs the hard block in standalone (`packages/server/src/index.ts:379-389`).

### The fix (small, safe, high-value)
Add a `verifyClient` (or `handleUpgrade` gate) to the `WebSocketServer` that:
1. **Rejects any upgrade whose `Origin` header is present and not in an allowlist.** For a purely-local control plane, reject *all* real browser origins outright. The legit Electron renderer loads from `file://` (Origin `null`) or the Vite dev origin — allowlist exactly those. **(Quick runtime check needed: confirm what `Origin` the renderer's WS actually sends so the allowlist doesn't lock out the app.)**
2. **Rejects upgrades whose `Host` isn't `127.0.0.1:<port>`/`localhost:<port>`** (DNS-rebinding defense).
3. **Enforces the Origin allowlist *before* honoring the session cookie** (kills CSWSH), and/or binds the web-UI cookie to a CSRF token echoed in the handshake body.

This single `verifyClient` closes the browser bridge. It's additive (only rejects connections that shouldn't exist), but must allowlist the renderer's real origin — so it wants a 60-second runtime confirmation before shipping, which is why I'm delivering it as a spec rather than blind-applying it to your running app.

---

## The HTTP MCP pool server — dead but armed (Low today)

`packages/shared/src/mcp/pool-server.ts` is a real HTTP MCP endpoint that proxies the session's **entire aggregated source-tool surface** (every enabled source's tools, using the user's live OAuth creds) with **no auth and no Origin/Host check** (`pool-server.ts:73-96`, loopback + random port `listen(0,'127.0.0.1')`). If reachable, a browser or any local process could POST `tools/call` and act as the user on Linear/GitHub/Notion/Gmail.

**But it is never started in the shipping build.** `SessionManager.ts:3870` gates start on `backendContext.capabilities.needsHttpPoolServer`, which is `false` for **both** registered providers (`anthropic`, `pi` — the only members of `AgentProvider`; `factory.ts:589`). Claude/Pi reach pool tools via *in-process* SDK MCP servers (in-memory transport), never over HTTP. So today: no port, no exposure — **Low**. The risk is that a one-line capability flip (or re-enabling the legacy `codex`/`copilot` external-subprocess backend, references to which still exist) ships an open, browser-reachable tool-execution port. Note: the higher-privilege session tools (`spawn_session`, `call_llm`, file writes) live in a **stdio** server (`session-mcp-server`), pipe-bound not port-bound — not exposed by this endpoint.

**Fix:** either delete the `McpPoolServer` + `needsHttpPoolServer` branch until an external backend actually returns, or land per-session bearer-token + Origin/Host hardening on it *now* so it can't ship open by omission.

---

## What I verified vs. couldn't
- **Verified (code-level):** no `verifyClient`/Origin/Host check on the WS upgrade; `ws@8.19.0`; token-in-body vs cookie-auto-attached auth paths; no per-channel authz; token stdout prints; pool server unauthenticated + not-started (`needsHttpPoolServer:false` for both providers).
- **Not done:** a live PoC (couldn't run the Electron app + a browser here). The code path is unambiguous, so browser-reachability is verified at the code level; only the running exploit is inferred. Also did not confirm the exact `Origin` value the renderer's WS sends — needed to build the allowlist for the fix.

---

## Bottom line / recommended order
1. **WS `verifyClient` (Origin allowlist + Host check + cookie-before-Origin fix)** — closes a browser→agent RCE bridge. Highest severity found this whole engagement. Wants a 60-sec runtime check of the renderer's Origin, then apply.
2. **Per-channel authorization** — stop trusting client-supplied `workspaceId`/`webContentsId`; scope privileged channels to the real renderer.
3. Token-stdout gating, constant-time compare, Electron cleartext block.
4. **Pool server** — delete-or-harden the dead-but-armed HTTP endpoint before any external backend returns.

*Sixth report in the series. Companion to reports #1–#3, the status-verification doc, and the #2/#3/#5/#6 fixes doc.*
