# V1 Integration Review Checklist

Checked means reviewed with the evidence below, not merged to main or live-certified.

## Completed

- [x] Art Director font performance and tool-progress changes: `614752930`, `da85bc2b7`, `c9987ec7a`, `96912000d`; follow-up fixes `4258396c5`. Previous review: 104 tests and full typecheck passed.
- [x] Community email, imports, approval, retry and unsubscribe review. Fixes: `5420ca8c1`. Fresh evidence: 132 tests, full monorepo typecheck, renderer build. Live send/unsubscribe smoke and website redeployment remain required. See `community-email-v1-fixes.md`.
- [x] Canvas output isolation: reviewed `ca0850b6e` with later hardening in `1e9363b28`, on `claude/artist-os-onboarding-0f75bd`. Fresh 78 tests across protocol, preview, board model and OutputService passed. Hidden real Electron fixture passed iframe and Browser Pane isolation, same-bundle scripts/styles/data, legacy redirect and forged-path checks. No meaningful isolation defect found in this pass.

## Needs a Fix

- [ ] Board navigation can discard unsaved edits in `1e9363b28`. `VisualBoardSurface.tsx:46` resets drafts on scope changes; `:102` clears the pending 700ms save without flushing or retaining it. Reproduced with the actual React component in hidden Electron and a fake persistence hook: add note, navigate after 100ms, return after 900ms -> notes before: 1, save calls: 0, notes after: 0. Preserve pending drafts or finish the scoped save before discarding them. Also cover navigation while a save is in flight with newer edits pending. This is separate from the working backend merge guards.

## Next

- [ ] Website final integration scan: publish/rollback, approval binding, schedules and existing-site editing. Earlier website reviews are reported complete; final pass is still pending.
- [ ] Apply the reviewed branch commits to main and rerun destination-tree checks. No merge or push was performed in this review.
- [ ] Live board/PDF acceptance after integration. Isolated protocol evidence is not a full app UI acceptance test.

## Worktrees

- Community and checklist: `.worktrees/main/artist-os`, branch `codex/artist-website-engine`.
- Canvas/board review: `.claude/worktrees/artist-os-onboarding-0f75bd`, HEAD `1e9363b28`. Its unrelated `.claude-flow/` files were untouched.
- Unrelated creator-command-center specs in the working app tree were not included in either review commit.
