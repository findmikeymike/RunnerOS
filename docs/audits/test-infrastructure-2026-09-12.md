# Test infrastructure audit — 2026-09-12

Scope: discovery, mock isolation, subprocess outcomes, skipped coverage, and the Phase 4 watcher failure. Started from canonical main `fd7f0887d` in `codex/test-infrastructure`. All changes are test infrastructure, fixtures, or documentation; no app restart, live provider action, licensing change, or approval change.

## Confirmed fixes

- Two regular test files replaced `os.homedir` globally and initialized cached configuration under temporary environment values. Moving secure-storage and skills-storage tests to `.isolated.ts` preserves their assertions while preventing shard neighbors from inheriting their mocks. A parser-based regression guard rejects direct filesystem/path/OS mocks in regular tests; embedded subprocess scripts are not mistaken for live mocks.
- Local `bun run test` used a single large process, while CI used six shards. Isolated discovery was a separately copied shell loop, split filenames on whitespace, did not exclude `dist`, and could silently succeed after empty discovery. Both now use `scripts/run-tests.ts`: six discovery-mode shards, sorted explicit isolated paths, the same generated-file exclusions, and failure on missing discovery roots or zero isolated files.
- The default suite ran with Runner identity, silently skipping Artist OS-specific managed-skill/security tests. Every runner subprocess now receives Artist OS identity, bundled assets, the Pango setting, and its own disposable configuration directory. Product-dependent fixtures use the current scheme/name; session fixtures explicitly authorize their own test instances so they reach the behavior under test. Existing product-boundary fixtures still exercise Runner in fresh subprocesses.
- Four video tests returned normally when FFmpeg/FFprobe was unavailable, reporting successful coverage without assertions. They now report explicit skips. Both tool-present and tool-missing paths were exercised.
- The watcher flake reproduced in a tiny direct Bun native-watcher probe: one of 30 immediate first writes was lost, versus zero of 30 with Node. Tests now require a bounded observable readiness event before the one-shot lifecycle assertions and always close watchers after failures. Production watcher code and timeout limits are unchanged.
- The CLI auth fixture used Bun.serve with an immediate close after its error frame. A stress probe lost the detailed rejection in seven of 2,000 attempts, while the production ws transport delivered it in all 2,000. The test now uses the real production server, retaining the exact message assertion and adding the rejection code/disconnected-state assertions.
- The shared runner retains any earlier failure even if later processes pass, reports signals/timeouts as failures, and terminates its owned process group on completion/cancellation/timeout. A real failed-parent/grandchild fixture verifies that local fixture servers do not survive the run.

## What was already correct

- CI already ran isolated files one process at a time with explicit `./` paths. The historical "isolated tests never ran" issue was already fixed; this audit removes remaining discovery differences and adds regressions.
- Reviewed existing migration and smoke subprocess harnesses propagate unsuccessful exits. No blanket rewrite was needed.
- No focused `.only` or unconditional `.skip`/`.todo` test declarations were found. Remaining installed-browser live opt-in and platform/permission skips have concrete prerequisites. This audit does not claim live browser or provider acceptance.

## Verification

- Storage isolation: 63 tests passed.
- Native video tooling: 18 tests passed with tools present; 14 passed and four explicitly skipped with tools unavailable.
- Previously gated Artist OS security groups: 56 tests passed, no skips.
- Product-specific fixtures: 53 tests / 208 assertions passed in each product; send durability additionally passed six tests / 13 assertions under Artist OS.
- Shared runner and mock-policy regressions: ten tests / 26 assertions passed, including real failing, signaled, timed-out, cancelled, and space-containing-path subprocesses.
- Final verification: all six discovery shards and all 46 isolated processes passed, totaling 10,438 tests / 41,373 assertions, with one intentional installed-browser live-contract skip. The full run exposed the CLI fixture race; after its test-only correction, the complete affected shard was rerun cleanly (1,574 tests / 6,591 assertions). Other final shards and isolated files required no changes.
- All-package typechecks, the CLI typecheck, standalone runner/policy typechecks, dependency containment, and whitespace checks passed.
- Evidence is local macOS/Bun 1.3.13. The updated workflow runs the same entry point on macOS and Linux; hosted CI results are separate from this local verification. No app build/restart was required for these test-only changes.
