# Campaign deletion — Area 7

Worktree: `codex/campaign-deletion`, started from main `c9c4b0c2d` and refreshed to `633e6df67` before final verification.
Provider work was committed separately as `a7fbf331e` on `codex/provider-recovery`.

## Vetting and decisions

- **F7.1 — Policy preference, not a confirmed defect.** Keep the existing explicit preview and destructive confirmation. No typed phrase or additional approval gate.
- **F7.2 — Confirmed, with a correctness issue beyond performance.** The post-publication full scan could adopt source edits made after the archived copy was verified. Preserve the previously verified campaign-content token and refresh only the Vault manifest digests. The main-process final inventory still rejects later source edits. This removes one complete content-hashing pass; no stat-based cache or skipped mutation checks.
- **F7.3 — Confirmed.** Record durable deletion intent and directory ownership before staging. After restart, restore still-registered campaigns or finish only verified, unregistered staging. Config and directory writes are synced before destructive cleanup. Retain journals/data on ambiguous registration, replaced identities, overlaps, or incomplete filesystem work. Never sweep arbitrary matching folders. Old unjournaled staging is not automatically deleted.
- **F7.4 — Confirmed dead metadata.** Remove the unused memory count from options, receipts, and fixtures. This does not change memory retention.
- **F7.5 — Evidence gap, not proof the path is broken.** Existing tests already covered cross-Vault links and output bundles, but used small text payloads. New tests use binary media and the actual controller/config/preservation/removal/journal path in a disposable profile. No artist campaign was deleted, and no live-app acceptance is claimed.

## Recovery integration

Recovery runs only after single-instance admission, before the early proxy config read or workspace startup can recreate staged paths. Unresolved recovery produces a nonblocking HQ bell notice and logs, not an approval request. Registered paths resolve symlink aliases and existing ancestors before overlap checks.

Adversarial review found and corrected startup ordering and symlink-alias overlap mistakes. The alias reproduction now preserves registered workspace data. A failed rollback now keeps the affected runtime paused and prevents normal config reads from recreating its staged root; unrelated workspaces still initialize. A subprocess regression proves failed rollback, a normal config read, then exact-data restoration on recovery. Other cases cover replaced ownership, malformed/missing registration, incomplete removal, registration durability, and real SIGKILL before/after registration commit.

## Verification

- Shared storage and verified-copy checks: 23 passed, including same-size/restored-mtime mutation and multi-Vault partial-publication retry.
- Old-code reproduction: post-publication mutation was incorrectly accepted; new token remains tied to archived content and final preview differs.
- Binary hash-pass evidence: a 3 MiB + 137 byte file is hashed twice during preservation instead of three times, saving one complete source read. This is not a GB-scale wall-clock benchmark.
- Disposable full deletion: 4 MiB + 333 byte media survives byte-for-byte; HQ/Lab links and HTML/CSS siblings resolve; source, registration, staging and journal are removed; external files and other-workspace sentinels remain. Runtime leases/messaging/private-state cleanup use no-op fixtures; filesystem/config/controller operations are real.
- Focused cleanup/recovery/config-guard tests: 39 passed, including process-kill, failed rollback, and alias cases.
- Browser harness: all 8 cleanup-dialog/Vault/menu checks passed using installed Chrome. The app was not restarted.
- Full current-tree suite: 9,882 passed, 10 skipped, zero failures (4,265 + 5,236 sharded; 381 isolated).
- All workspace typechecks and both Artist OS main/renderer builds passed. Renderer reports existing dependency/chunk-size warnings.
- Final fetch confirmed this branch includes local main `633e6df67` and origin/main. No app restart or hardware power-loss certification was performed.

The inherited main test-fixture repairs already verified with provider recovery are repeated here because the feature branches remain separate: current RPC/style expectations, credential mocks, and explicit-directory routing in scheduled-work mocks. No provider runtime feature was copied into this branch.
