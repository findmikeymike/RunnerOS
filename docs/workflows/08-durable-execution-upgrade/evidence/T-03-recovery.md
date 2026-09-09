# T-03 — workflow recovery proof

Revision r2 · 2026-09-09 · Isolated prototype only. Current source `6c631f8ad35cd954641905b14e077bdd3fbf60e9`. SHA-256 of sorted prototype relative paths + NUL + file bytes: `480f400254395a3ae9c0e36511539963b371f6b3def5c45785292a47776aa8ce`.

## Journey and results

An explicit fixture interpreter records a synthetic model turn, exact approval, logical required child with two reads, join and external effect. Child runs under the root owner, not a real agent session/subprocess. A separate HTTP simulator owns a persistent effect/call ledger; a third supervisor kills/restarts app workers. Production runner/SDKs are never invoked.

Ten boundaries, each repeated 25 times: committed model turn, waiting approval, child admission, first read result, child result before join, prepared effect, dispatch-intent commit, effect response before receipt, committed effect result, before final success. Together with 50 admission faults: **300 repeated SIGKILL cases**. Owner/lock/probe kills are additional cases.

Independent provider ledger assertions prove one recorded model call, one call per committed read, one effect and one parent join per repeated journey. Accept/drop-reply keyed effect reconciles without another POST; opaque effect stops unknown. Tests also cover changed identity/account/adapter, uncertified tool, stale/conflicting approval, same-process cancellation/pause/revocation/expiry, late completion without resurrection, first/duplicate approval preserving Pause, budget/deadline persistence and unrelated progress while one run is offline.

Command from canonical checkout:

```sh
PANGOCAIRO_BACKEND=fontconfig bun test \
  --path-ignore-patterns='**/release-artist-os/**' \
  --path-ignore-patterns='**/dist/**' \
  packages/server-core/src/workflows/__tests__/durability/storage-process.test.ts \
  packages/server-core/src/workflows/__tests__/durability/recovery-process.test.ts
```

**22 passed, 0 failed, 2448 assertions, 38.89 seconds**. Loopback binding needs sandbox escalation on this host; simulator binds 127.0.0.1 only. Temporary log: `/tmp/artist-os-durability-p01-tests.log`. Affected package `cd packages/server-core && bun run tsc --noEmit` passed. T-01 separately reran baseline: 248 passed, 869 assertions.

The first simulator pass exposed an automatic repeat of an accepted/drop-reply POST through Bun fetch (two provider calls). Fixed with non-pooled single-attempt Node HTTP requests. Only the interpreter owns retries. This is fixture evidence, not a change to production transport. Four subsequent rival findings were fixed and independently rechecked; see rival-review.md.

These *.test.ts cases participate in existing sharded PR CI discovery. Remote CI has not run uncommitted files. Scheduled randomized campaigns/soak remain P-06 requirements, not installed automations.

## Remaining coverage

P-01 subset only, not A-01–A-20 release acceptance. No actual SDK barrier/restore, partial model stream, real child session, concurrent child-budget enforcement, scheduler integration, boot-ID/lease protocol, complete control/version API, cancel-time background reconciliation, projection delivery/rebuild, artifact corruption/retention, 500-seed campaign, 24-hour soak or live-provider certification. Synthetic key transport is test-only. No production admission enabled.
