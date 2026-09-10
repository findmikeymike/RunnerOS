# Tool wiring integrity

Worktree: `codex/tool-wiring-integrity`, based on main `bd3dd7684`. Independent of the earlier prompt-composition and registration branches.

## Product behavior

User direction: running an agent is authorization for its ordinary work. Avoid redundant per-tool prompts, while retaining approval points already explicitly defined by the product.

- Declared worker trust now uses the canonical session tool registry instead of a second four-name whitelist. All 38 distinct bundled declarations are effective, including Lab writes, artwork composition, website preparation, and internal replies.
- A declaration skips generic safe/ask interruptions only for that named session tool. It does not expose a tool, activate sources, alter delegation/scope restrictions, or skip its handler.
- Existing exact Release Kit approval checks remain unchanged. Research-plan approval, paid media requests, and the legacy finalize-output action retain their existing permission behavior; declarations cannot waive it. No new exact-action gate was added to the legacy path or to allow-all mode.
- Website deployment still uses the existing pending approval bound to target/build or explicit trusted-site setting. Community request-send still returns the existing approval request rather than sending. Declared browser operation remains autonomous subject to the existing Team and handler boundaries; no new per-click approval was added.
- Unknown trust names produce inline configuration notes. Save, load, startup, and agent use continue, and the declarations remain intact for future/custom tooling. Registry validation recognizes the session prefix and case-sensitive `SubmitPlan`.
- Claude and Pi share role/scope derivation. Variant flags, Pi's update_tasks, delegation filtering, and legacy Lab-call compatibility remain unchanged.
- SubmitPlan was not renamed. HANDOFF1 and agent-creation tool guidance now describe trust accurately.

## Validation

Focused tests exercise every bundled declaration in safe/ask mode, explicit approval preservation, prefixed names, custom-agent save/reload with diagnostics, and 40 role/scope/delegation parity combinations. Pure policy checks do not execute external tools. Existing integration tests cover website publishing and community sending.

All workspace typechecks passed. Both Artist OS main and renderer builds passed. The final full suite, including isolated tests, passed with 9,727 passing, 0 failing, and 10 skipped tests (exit 0). No app restart, live-provider action, commit, or merge was performed.

Two inherited test expectations were corrected to match existing main: the durable-control IPC channel and neutral SettingsGroupTabs styling. No production behavior changed for those corrections.
