# Suite repair — September 17, 2026

Canonical checkout: `.worktrees/main/artist-os`, branch `main`. Final validation base: `9beb05e95` plus these uncommitted repairs. The concurrent owning task landed the previously staged creative-worker/website changes while this work ran; this task did not stage, commit or push them.

## Repairs

- Signals shell test now checks the current accessible **Bookmark selection** label.
- Native Signals contract retains an oversized upstream fixture and verifies the actual `--top 10` bound: nine results are complete; ten capped results are incomplete.
- RPC inventories now cover seven Branding State wire strings (573 total) and six request handlers. Exact equality, duplicate detection and profile boundaries remain enforced. These omissions came from Branding State, not the concurrent Website feature.
- Reviewed all shipped core/reference documents for the two Branding skills changed by `fc91256fd`, then recertified their exact instruction-only revisions. No tools, sources or permissions were added. Added adversarial tests proving a self-consistent but unreviewed repackaged revision still fails closed.
- Automation maintenance assertions identify canceled/preserved jobs by ID instead of assuming serialized row order. The formerly intermittent test now explicitly places fresh work before stale work chronologically.
- Full-suite verification uncovered another timing-sensitive Spotify test: identical provisional counts could satisfy its five-millisecond stability threshold under load. The fixture now changes each provisional sample, allows adequate deadline headroom, and checks both one- and ten-millisecond polling. Production collector behavior is unchanged.
- The earlier GRAVITY voice-budget regression was already fixed before `3afd7ad2b`; it remains passing.

## Verification

- Targeted RPC: 9 passed; Signals: 54 passed; durable skill/native-start/recovery: 24 passed; automation: 10 passed; Spotify collector: 16 passed.
- `bun run typecheck:all`: passed (`/tmp/artist-os-types-sept17.log`).
- `bun run test`: all 63 processes ran; 62 passed, one failed on the Spotify fixture above (`/tmp/artist-os-suite-sept17.log`).
- After its repair, reran the entire affected regular shard with `bun run test --suite=regular --shard=2/6`: **1,581 tests passed, zero failed** (`/tmp/artist-os-shard2-sept17.log`). Across that run and the affected-shard rerun, every one of the 63 test groups now has a passing result. The entire suite was not repeated after this test-only fixture edit.
- `git diff --check`: passed. Test runner used disposable profiles; native contracts used loopback fixture servers. The deliberate failure sentinels inside runner tests are expected test fixtures, not additional failing app groups.

No app restart, saved-profile migration, live provider acceptance, commit, push or release was performed by this task. These results establish automated verification, not live app acceptance.
