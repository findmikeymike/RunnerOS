# Handoff: Creator Command Center + Social Publisher

Last updated: 2026-07-08 17:55 CDT

## Current Priority

Primary ready PR:

- PR #9: https://github.com/findmikeymike/RunnerOS/pull/9
- Branch: `codex/creator-social-integration`
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`
- Status: ready for review/merge candidate.

Hold/draft PR:

- PR #10: https://github.com/findmikeymike/RunnerOS/pull/10
- Branch: `codex/team-mode-phase-1`
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center/.worktrees/team-mode-phase-1`
- Status: real feature work, but hold until PR #9 lands or final base is settled.

Do not merge Creative Lab yet:

- Branch: `codex/lab-workspace`
- Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/lab-workspace`
- Status: clean/pushed, intentionally held.

## What PR #9 Contains

PR #9 integrates:

- Creator Command Center campaign/HQ UI cleanup.
- Chat sidebar/session-history UX cleanup.
- Social Publisher / Printing Press Social hardening.
- Social Accounts settings page.
- Multi-account account sets.
- Per-profile browser/session isolation.
- Profile login/verification flow.
- Account catalog injection for `@social-publisher`.
- Approval-safe social execute handoff.
- Payload-digest idempotency fallback.
- Paperclip app-file picker improvements.
- Output file naming by manifest title.

Important branches preserved:

- `codex/creator-command-center`: pushed and clean.
- `codex/post-agents`: pushed and clean.
- `codex/creator-social-integration`: pushed and clean; created from `creator-command-center` plus cherry-picked social/file-picker commits.

Conflict note:

- Only cherry-pick conflict was in the four social platform CLI files.
- Resolved by taking the already-tested `codex/post-agents` versions.

## PR #9 Verification

Passed in `/Users/michaelb.williams/RunnerOS/.worktrees/integration/creator-social-integration`:

```bash
bun run typecheck:electron
```

Passed in `tools/printing-press-social`:

```bash
npm test
```

Passed in repo root:

```bash
bun test packages/shared/src/sources/__tests__/storage.test.ts packages/shared/tests/permissions-craft-agent-sync.test.ts
```

## Team Mode: Hold, But Preserve

Team Mode is not trash. It is substantial work:

- Shared-folder Team Mode.
- Owner/editor roles.
- One runner machine for background automations.
- Runner heartbeat and handoff.
- Safe workspace migration to shared folders.
- Secrets/session exclusion.
- Shared records with conflict detection.
- Community records migration.
- RPC write guards for sensitive actions.
- Team Settings UI.

PR #10 is a draft stacked on PR #9:

- Base: `codex/creator-social-integration`
- Head: `codex/team-mode-phase-1`
- Draft because it needs real shared-folder smoke and rebase after PR #9.

Team Mode verification already passed:

```bash
bun run typecheck:electron
bun test packages/shared/src/workspaces/__tests__/team-mode.test.ts packages/shared/src/workspaces/__tests__/team-migration.test.ts packages/shared/src/workspaces/__tests__/shared-paths.test.ts packages/shared/src/records/storage.test.ts packages/shared/src/community/storage.test.ts packages/server-core/src/handlers/rpc/team-permission-helpers.test.ts
bun test packages/shared/src/automations/automation-system.test.ts packages/server-core/src/workflows/runner.test.ts packages/server-core/src/sessions/sendmessage-durability.test.ts packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/sources/__tests__/storage.test.ts
git diff --check
```

Before merging Team Mode:

1. Land or finalize PR #9.
2. Rebase Team Mode onto the accepted base.
3. Smoke with a real shared folder and two machines/profiles.
4. Verify secrets, private sessions, runner-only automations, editor restrictions, and conflict surfacing.

## Social Publisher Safety Rules

Keep these invariants:

- Do not store passwords, cookies, tokens, or 2FA codes.
- One social profile maps to one isolated browser session.
- User logs in manually once per profile.
- Agents receive non-secret account/profile catalog only.
- All live social writes require exact chat approval.
- Do not ask for a second browser approval if the user already approved the exact dry-run action in chat and the visible account/draft match.
- Stop on mismatch, ambiguity, wrong account, login/2FA/CAPTCHA, upload/UI failure, unexpected platform choice, or payload mismatch.

## Current Worktree Triage

Clean/pushed:

- `codex/creator-social-integration`
- `codex/creator-command-center`
- `codex/post-agents`
- `codex/team-mode-phase-1`
- `codex/lab-workspace` (hold)
- `codex/app-action-layer`

Needs future attention:

- `codex/agent-adds`: dirty and diverged from remote.
- `codex/voice-hnic-v1`: dirty and no upstream.
- `codex/personal-ops`: has local dirt.
- Archived `claude/sad-clarke-10a760`: dirty archive worktree, not active priority.

## Next Best Move

1. Review/merge PR #9 first.
2. After PR #9 lands, rebase PR #10 and smoke Team Mode.
3. Keep Creative Lab held.
4. Then triage dirty `agent-adds`, `voice-hnic-v1`, and `personal-ops`.
