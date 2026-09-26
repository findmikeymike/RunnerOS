# ToMerge

Branches that have landed work but are NOT yet merged into `main`.
Update this list when a branch is created and remove the row when it's merged.

| Branch | Worktree path | Status | Scope | Tests | Notes |
|---|---|---|---|---|---|
| `claude/sad-clarke-10a760` | `.claude/worktrees/sad-clarke-10a760/` | ✅ Ship-ready | **Phase 1: Orchestration Backbone** — 8 features (subagent isolation, prompt-injection scan, scheduler gate, reactive-config, per-job toolsets, polyglot shell hooks, subconscious mode, ACP adapter). All Phase 1 cold-reviewed, fixed, holistically audited (integration + security + tests + license). See [.planning/phases/01-orchestration-backbone/01-SUMMARY.md](.planning/phases/01-orchestration-backbone/01-SUMMARY.md) | Phase 1 dirs: 1202/1202 · `typecheck:all` exit 0 | Not yet committed at time of writing — commit + push when ready. |

**Scrapped:** `ui-launchpads` (forked from `codex/runneros-ui-pass`) — first SourcesLaunchpad pass didn't land the design language; worktree + branch removed. Re-approach pending.

---

## How to use

1. **When you create a new branch with meaningful work, add a row.**
2. **When you merge a branch into `main`, delete its row.**
3. **Keep the Status column honest:**
   - 🟡 In progress — still being built
   - 🔵 Review — awaiting cold review or PR review
   - ✅ Ship-ready — passed gates, ready to merge
   - 🔴 Blocked — has open issues that must land first
4. **Order rows by ship-readiness** (✅ first), so the merge queue is obvious.
