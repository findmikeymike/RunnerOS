# September 18 accumulated-work verification

Canonical checkout, branch `main`, starting HEAD `cc0ed4d9e`.

The full isolated-profile runner completed all 65 processes: 62 passed and 3 failed. The initial sandboxed attempt was stopped because local fixture servers could not bind; these results are from the subsequent run with local-server access.

- Regular shard 3: an obsolete Release Kit versions-menu assertion failed. Commit `e2351465f` had removed that menu. Updated the assertion to cover current final-audio playback/replacement controls. The full shard rerun passed: 1,790 tests, zero failures. The individual chrome file also passed all 37 tests.
- Regular shard 6: `packages/shared/src/agent/core/__tests__/ask-source-policy.test.ts` failed its workspace MCP allowance case. Reproduced alone with a fresh temporary profile: one pass, one failure. Source-level fixture allows an inspection tool but Ask mode still requests mutation approval. Root cause remains open; no permission behavior was changed in this commit.
- Isolated Claude rotation: `packages/shared/src/auth/__tests__/claude-rotation-fencing.isolated.ts` reproduced alone: one pass, two failures. Delayed-refresh test times out; the following test receives null expected credentials. Fixture seeding uses unawaited asynchronous credential writes and needs investigation before attributing this to production rotation behavior.

Logs: `/tmp/artist-os-precommit-20260918-unrestricted.log`, `/tmp/artist-os-precommit-shard3-fixed-20260918.log`, `/tmp/artist-os-ask-policy-recheck.log`, `/tmp/artist-os-rotation-recheck.log`.

All planned test processes ran, but the repository suite is **not green**. Remaining permission/rotation failures are the next bounded test-maintenance slice. This is not release certification. Social posting's separate live acceptance remains parked.
