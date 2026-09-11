# Build provenance and dependency containment — Areas 10–11

Branch: `codex/build-provenance`, based on canonical main `3b6d847c0`.

## Changes

- About exposes embedded identities for the loaded main, preload, and compiled renderer: commit, working-source fingerprint, modified state, build time, and product. Local IPC keeps desktop provenance local even in thin-client mode. Older components report unavailable; no identity is inferred from the current checkout or file timestamps.
- Main/preload watch builds recompute identities when rebuilt. Vite serve deliberately reports renderer identity unavailable: partial HMR does not represent one immutable whole-renderer build.
- The fingerprint covers current tracked and relevant untracked source, lockfiles, dependency patches, tools, and vendor inputs. Environment/credential files and generated outputs are excluded. It identifies source inputs, not a cryptographic attestation of every compiler/environment input or a transactional source snapshot during concurrent edits.
- Renderer compilation writes a sibling staging directory and publishes only completed output. Compilation failure preserves the previous renderer. Failed publication rename attempts rollback; cleanup failure retains an old directory with a diagnostic. This is not certified hard-crash recovery or a guarantee that already-open lazy chunks survive replacement.
- Developer/CI validation checks canonical real paths for TypeScript programs, installed dependency locations, runtime manifest entries, and literal build-tool imports. Normal checkout-local hoisting remains valid. Computed imports and every platform/export condition are outside the check.
- TypeScript ambient lookup is bounded to checkout-local roots, and UI declares its intended ambient types instead of auto-loading stub packages. Exact-version SDK declaration patches remove ancestor `node_modules` probes while preserving local/bare imports and all runtime code. These cover Anthropic SDK 0.91.1 and 0.106.0 and Google GenAI 1.52.0; no dependency version was upgraded.
- `typecheck:staged` now exists and runs containment plus the full consumer typecheck graph for staged source/config changes. Isolated test discovery includes scripts in both local and CI entry points.

## Verification

Six discovery shards plus isolated tests: **10,181 passed, 10 skipped, zero failures** (9,771 sharded + 410 isolated). All workspace typechecks passed; the UI check was rerun after its final explicit ambient-type correction. Containment and final stamped main/preload/renderer builds passed after that configuration correction. A fresh disposable frozen reinstall reproduced all seven patched SDK declaration files; the lockfile only adds three patch registrations. Tests include dirty/untracked source identity, Release Kit and patch inputs, watch rebuilds, real failed Vite compilation, publishing rollback, parent/symlink dependency escapes, and staged paths containing spaces and `.mjs`/`.cjs` suffixes.

No running app restart, canonical build replacement, live artist-data change, or provider action was performed. No new agent approval or runtime execution gate was added.
