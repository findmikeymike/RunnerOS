---
status: current
owner: team
last_verified: 2026-07-11
source_of_truth: true
---

# RunnerOS Foundation Safety Baseline

## Trade God Isolation

- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/trade-god-foundation`
- Branch: `codex/trade-god-foundation`
- Base ref: `origin/main`
- Frozen base SHA: `e7e96be32a5be394aefaf5712bdd711b96ad9d15`
- Base subject: `Harden Keys connection verification`
- Created: 2026-07-11

The branch was created directly from the remote-tracking commit. No existing worktree was switched, reset, cleaned, rebased, merged, or committed.

## Remote State at Creation

- `origin/main`: `e7e96be32a5be394aefaf5712bdd711b96ad9d15`
- `upstream/main`: `4289b16097322e9911d3078d8a64bd8c830717c3` (`v0.11.1`)
- Divergence: origin has 609 unique commits; upstream has 15 unique commits.
- Decision: freeze Trade God on `origin/main`; assess upstream-only commits in a separate review before any selective port.

## Protected Worktrees Captured Before Creation

`dirty` means local modifications/untracked files existed and must be preserved.

| Worktree / branch | Starting SHA | State |
|---|---|---|
| RunnerOS / `codex/agent-adds` | `6bb0efad` | dirty; ahead 2, behind 25 |
| `/private/tmp/runner-agent-adds-fix` / detached | `bfff3521` | clean |
| archive `claude/sad-clarke-10a760` | `625127c3` | heavily dirty |
| integration `creator-social-integration` | `38ef61db` | dirty pitch docs; ahead 11 |
| integration `team-mode-social-integration` | `c9025ebb` | clean |
| integration `upstream-0-10-core` | `69330af5` | clean |
| integration `upstream-0-10-personal` | `23660b75` | clean |
| personal `runneros-personal` | `9a4fe218` | dirty |
| progress `app-action-layer` | `8f67e957` | clean |
| progress `core-agent-adds-secrets` | `15c3ed3b` | clean |
| progress `creator-command-center` | `d4e3b031` | clean |
| nested `agent-work-continued` | `b156d49e` | clean; ahead 1 |
| nested `audit-agents-auth-fixes` | `bde64da5` | clean |
| nested `community-tab` | `69c3a0a6` | clean |
| nested `post-agents` | `a60bf565` | clean |
| nested `team-mode-phase-1` | `617191bb` | clean |
| nested `work-products-output-architecture` | `46b67d60` | clean |
| progress `lab-workspace` | `f2c63bfb` | clean |
| progress `secrets-settings-presets` | `100797f1` | clean |
| progress `social-agent-adds` | `ef85269a` | clean |
| progress `squad-video-director` | `55c8ce79` | clean |
| progress `video-agent-tools` | `abca0442` | clean |
| progress `voice-hnic-v1` | `1c2c5ca7` | heavily dirty |

Full file-level dirty state was captured in the creating session before the worktree operation. The post-creation audit must compare each protected worktree's HEAD and porcelain status byte-for-byte against that capture.

## Protection Rules

- Never run reset, clean, rebase, checkout/switch, merge, or broad formatting from another worktree to support Trade God.
- Never use another branch's dirty checkout as a donor. Read from it; port deliberate code through reviewed patches/commits.
- Never force-push shared RunnerOS branches.
- Before cross-tree Git work, record HEAD and status of every affected tree.
- Keep Trade God commits small, coherent, and reversible.
- Evaluate upstream upgrades on a separate branch/worktree, then cherry-pick or merge only after tests and contract review.

## Baseline Verification Results

- Frozen-lockfile dependency installation: passed with Bun 1.3.13; 1,710 packages installed; install reported zero vulnerabilities.
- Focused control-plane suite: 232 passed, 0 failed across agent messaging, workflows, automations, scheduled work, workspace context, Outputs/Finals, and server services.
- Full `bun run typecheck:all`: failed in pre-existing creator-domain code before reaching later packages.
  - `packages/shared/src/campaign-calendar/index.ts:632`: `Array.findLast` unavailable under the package target library.
  - Same line: callback parameter `approval` inferred as implicit `any`.
- Protected-tree post-audit: all 23 pre-existing worktrees retained byte-identical `git status --short --branch` plus HEAD output.
- New Trade God tree contains only intentional documentation changes; no trading runtime code exists yet.

The typecheck failure is baseline debt, not caused by Trade God. Fix it only in a separate coherent commit if it blocks Phase 0 verification.
