# V1 Integration Review Checklist

Checked means reviewed with the evidence below, not live-certified. The reviewed website and Canvas/board branches were integrated into main in merge `ac0ab65ba` on 2026-09-04.

## Completed

- [x] Art Director font performance and tool-progress changes: `614752930`, `da85bc2b7`, `c9987ec7a`, `96912000d`; follow-up fixes `4258396c5`. Previous review: 104 tests and full typecheck passed.
- [x] Community email, imports, approval, retry and unsubscribe review. Fixes: `5420ca8c1`. Fresh evidence: 132 tests, full monorepo typecheck, renderer build. Live send/unsubscribe smoke and website redeployment remain required. See `community-email-v1-fixes.md`.
- [x] Canvas output isolation: reviewed `ca0850b6e` with later hardening in `1e9363b28`, on `claude/artist-os-onboarding-0f75bd`. Fresh 78 tests across protocol, preview, board model and OutputService passed. Hidden real Electron fixture passed iframe and Browser Pane isolation, same-bundle scripts/styles/data, legacy redirect and forged-path checks. No meaningful isolation defect found in this pass.

## Board Follow-up

- [x] Board navigation draft-loss fix committed as `cbc0db3d9` on `claude/artist-os-onboarding-0f75bd` (not yet integrated). Per-board save queues flush on navigation, serialize newer edits behind pending saves, and retain failed drafts for Retry. The actual React component and hook passed hidden Electron tests for quick navigation, return during a pending save with a second edit, failed-draft recovery, read-after-save ordering, and zero wrong-board writes. All 83 focused/controller/board/backend/protocol tests, Electron typecheck, and renderer build pass. Conflicting local drafts can be explicitly discarded through confirmed Reload saved board. The original repro lost a note with zero save calls.

## Next

- [x] Website final integration code review and all five fixes: verified snapshots/locking, unsubscribe routing, durable retries/approval cleanup, backend cadence transaction, and safe rollback retention. Targeted independent reviews clean after follow-ups; tests, shared/server/Electron typechecks and renderer build pass. See `website-final-integration-review.md` for exact evidence. Included in the website hardening fix commit; main integration and live acceptance are still pending.
- [x] Apply the reviewed branch commits to main and rerun destination-tree checks. Main includes `0f4138ec3` and `cbc0db3d9`; both ancestry checks pass. See destination evidence below.
- [ ] Live board/PDF acceptance after integration. Isolated protocol evidence is not a full app UI acceptance test.

## Worktrees

- Integrated main: `.worktrees/integration/artist-os-reviewed`. The active working app was not restarted or switched; its unfinished voice changes and untracked specs were excluded.

- Community and checklist: `.worktrees/main/artist-os`, branch `codex/artist-website-engine`.
- Canvas/board review: `.claude/worktrees/artist-os-onboarding-0f75bd`, HEAD `cbc0db3d9`. Its unrelated `.claude-flow/` files were untouched.
- Unrelated creator-command-center specs in the working app tree were not included in either review commit.

## Destination Evidence (2026-09-04)

- Website service, publish, routine, cadence, snapshots: 67 tests passed.
- Canvas protocol, preview, board drafts/model and OutputService: 83 tests passed.
- Community storage, imports, sending, tools and RPC: 75 tests passed.
- `bun run typecheck:all`: passed across all configured packages.
- `bun run build:renderer --outDir /tmp/artist-os-reviewed-main-renderer` from `apps/electron`: passed. Existing deprecation, eval and chunk-size warnings remain.
- `node scripts/verify-board-autosave.mjs`: quick navigation, in-flight navigation and failed-draft recovery passed; zero wrong-board writes.
- `node --experimental-strip-types scripts/verify-output-preview-isolation.ts`: isolated real Electron iframe and Browser Pane fixtures passed.
- `git diff --check`: passed. The only merge conflicts were documentation indexes; both feature histories were retained with stale unbuilt claims corrected.
- Dependency caveat: `bun install --frozen-lockfile --ignore-scripts` refused because two nested `@types/bun` latest-tag resolutions wanted 1.4.1 instead of 1.4.0. Checks used `bun install --no-save --ignore-scripts`; inspection showed only those two development type packages and their `bun-types` dependencies changed resolution. The committed lockfile was preserved, with no runtime dependency upgrade. Strict clean-install reproducibility remains a separate follow-up.
- This is destination code/build evidence, not live website publishing, fan-email delivery, full app UI acceptance, or signed packaging certification.
