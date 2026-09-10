# Prompt launch parity

Worktree: `.worktrees/active/prompt-launch-parity`, branch `codex/prompt-launch-parity`.
Base: `b0a5b67dd` on canonical Artist OS `main`. Implementation is isolated on this feature branch; it is not a deployed runtime claim.

## Behavior

Direct chat launches now refresh verified track context and the campaign Release Kit before composing, just as server launches do. Failed safe persistence excludes the unsafe saved document. Caller-supplied context snapshots no longer bypass the chat refresh.

`packages/server-core/src/agent-launch/context.ts` owns refresh ordering, Scriptwriter HQ identity replacement, authorization/delivery selection, focus filtering, unsafe-document suppression and the Artist OS scope marker. Both `LIST_FOR_AGENT` and `SessionManager.resolveAgentSessionOptions` call it. Focus changes and Pulse already reuse that resolver.

`packages/shared/src/agent-definitions/references.ts` owns reference availability, explicit strict/lenient validation, warning descriptions and selection of declared installed skills to enable. Focused chat and default server execution reject unavailable required references. Unfocused interactive chat warns and omits them; unavailable optional connections do not block launch. An explicit lenient server request remains supported. Both transports retain sequential skill writes. Renderer RPC permission checks and change broadcasts remain intact; this change does not grant additional activation permissions.

Unfocused server Scriptwriter context now respects the same document delivery rules as chat. Disabled/private HQ identity cannot reappear through a stale campaign copy. Generic workspaces do not gain Artist OS refreshes or markers.

The old HANDOFF1 warning about duplicate prompt assembly was replaced with the current ownership and validation policy.

## Evidence

- Before the fix, `workspace-context-launch.isolated.ts` reproduced the actual chat RPC returning stale `mission-assets` and `release-kit` bodies. It passes with shared preparation wired in.
- Context tests cover tampered promoted audio, failed refresh persistence, thrown Release Kit refresh, safe-empty track fallback, HQ unsafe-slug exclusion, focus authorization/delivery, Scriptwriter HQ identity provenance and private/disabled overrides, Manager refresh ordering and generic workspace isolation.
- Shared reference and renderer tests cover strict/lenient behavior, required versus optional disconnected sources, aliases, unavailable skills, deduplicated activation and caller-cache bypass.
- All-package typecheck and Artist OS main/renderer builds pass. No app launch/restart or live provider invocation was performed.
- The first sandboxed full suite could not bind localhost ports. The unrestricted run exposed an inherited stale IPC inventory: base commit `8a5537d89` added `workflow-runs:durable-control` without updating its expected channel list. A separate run reproduced both assertions with the channel code/test unchanged from HEAD. The expected list was regenerated from `RPC_CHANNELS` (one added string); its five targeted tests pass. No RPC protocol was added or changed here.

- The initial unrestricted run also reproduced a stale Settings toggle style assertion in an unchanged base test (expected orange; the committed UI is neutral). Updated that single expectation to the existing UI. No settings UI code changed.

Final `bun run test` exited 0: 9,237 discovery tests passed; 10 skipped; 381 isolated tests passed across 30 separate processes; zero failures. Total: 9,618 passing tests. All-package typecheck, final Artist OS main build, renderer build and `git diff --check` passed. Tests/builds used dependencies installed in this worktree with the frozen lockfile; no dependency manifest versions or lockfile changed.

Live Electron/provider acceptance is not claimed. The canonical checkout and running app were not modified or restarted. This change has not been merged to main.
