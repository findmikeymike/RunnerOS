# Steering reliability

Isolated branch `codex/steering-reliability`, based on main `62c70cfba`.

## Changes

- Pending Claude updates retain individual message IDs through injection, normal completion, abort, handoff, and model fallback. The host drains pending updates before exiting on `complete`; the generator's trailing recovery event alone was insufficient.
- Replays reuse the original transcript entry, attachment references, input origin, badges, hidden/display intent, and skill choices. Queue merging follows transcript arrival order and deduplicates by ID, never by text.
- Pending updates are persisted before provider dispatch and acceptance. Queue recovery now has a real `isQueued` marker. Failed initial persistence cannot silently dispatch the rejected update later.
- Stop restores pending text, removes pending transcript entries, and prevents deferred replay. Workflow/delegation cancellation uses the same stop path. Existing auth/plan/source-retry boundaries preserve pending work until continuation; no new approval boundary was introduced.
- A missed steering window no longer fabricates an interruption reminder. Rich updates use a regular queued turn so their attachments and skill choices are retained.
- Pi refuses false acceptance when its subprocess transport is unwritable or throws. A successful write remains transport acceptance, not proof of model consumption.
- Renderer receipts preserve queued status until delivery and preserve distinct IDs for identical corrections. Completion no longer clears unrelated queued messages.

## Limits

Crash recovery provides replay of persisted pending input; it does not promise exactly-once provider consumption across a crash at the delivery/persistence boundary. Pi provider-consumption acknowledgments are not added. Explicit Stop restores text using the existing composer restoration behavior.

Main has other agents' unfinished workflow changes. They are untouched. This branch is not committed, merged, or loaded into the running app. Live provider/UI verification requires an authorized restart.

## Validation

- Final complete sharded inventory: 9,318 passed, 0 failed, 10 skipped across 832 files (5,050 + 4,268 passed in disjoint shards).
- Every isolated-process test: 397 passed, 0 failed, including 17 steering host tests. Combined: **9,715 passed, 0 failed, 10 skipped**.
- All workspace typechecks passed. Shared and server typechecks passed again after test-fixture corrections.
- Artist OS main and renderer builds passed; renderer reports its existing large-chunk warning.
- `git diff --check` passed. Temporary profiles and fake provider transports are used; no real provider execution or external publishing was required.

Inherited IPC inventory and SettingsGroupTabs test expectations are synchronized with main's existing durable-control channel and neutral selected-tab styling. Sharded validation also exposed incomplete credential test doubles and a scheduled-work mock intercepting another test's explicit agent fixture directory. The doubles now include `getUserSecret`, and the agent mock delegates explicit fixture directories to the real implementation. The exact previously failing ordered migration sequence passes (153 tests); assertions and production code are unchanged by these fixture corrections.

An unsharded run hit a native filesystem-watcher delivery timeout. The same watcher tests passed separately (3 tests). Final broad validation uses both disjoint CI-style shards and every isolated-process test.
