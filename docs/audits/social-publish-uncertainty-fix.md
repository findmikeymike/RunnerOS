# Scheduled social publishing: uncertainty survives cancellation

Reviewed and fixed on canonical `main`, initially `cc0ed4d9e`. Concurrent social/Builder work landed as `03d0c711c` during verification; its changes were preserved. The publishing fix and test repairs were subsequently committed with user authorization as `94403e788`.

## Confirmed defects

1. An older-created queued post could win execution precedence over a newer matching post marked `execution-uncertain`. A disposable runner fixture reached the publish executor once instead of blocking.
2. Cancel/delete excluded an uncertain post from duplicate checks. Cancellation also erased its attention reason. A matching replacement therefore stopped conflicting even though the external submission might have succeeded.

## Changes

- One shared predicate identifies confirmed, in-flight, uncertain, and conservatively ambiguous historical social attempts. Execution evidence takes precedence over creation order and queue visibility.
- Canceled and deleted orders retain duplicate protection inside the existing account/content/time-window policy. No new global deduplication service or expanded duplicate window was added.
- Social cancellation retains its failure classification; cancel/delete of running social work records uncertainty. Known single pre-submit failures and never-started drafts remain replaceable.
- X Slate cancellation uses the shared mutation rather than clearing uncertainty separately.
- Legacy canceled attempts whose old code erased the failure classification are treated conservatively; no live data migration occurs.
- A test-only literal type annotation fixes the concurrent Composio guidance test's shared-typecheck error. Product behavior is unchanged by that annotation.
- Repository verification also exposed three fixture issues: insufficient Spotify content-test timing headroom, repeated Instagram interim counts that legitimately satisfied stability, and unawaited credential-test setup. These test-only corrections retain the outcome assertions and dedicated timeout coverage; no collector or credential production behavior changed.

## Verification

- 165 tests passed across conflict guard, ScheduledWorkRunner, and shared scheduled-work document tests.
- 37 RPC tests passed, including cancel/delete followed by a rejected equivalent replacement and X Slate cancellation preserving uncertainty.
- Shared and server-core typechecks passed; `git diff --check` passed.
- Independent read-only review found no blocking defect.
- Full repository regression run completed all 65 processes: 61 passed, four failed. The corrected Spotify and Instagram shards subsequently passed in full, and the credential-rotation isolated file passed all three tests with a disposable profile. Thus 64 of 65 groups have passing evidence; the entire suite is **not green** because the remaining group exposes the separate permission defect below. The full suite was not repeated after the test-only repairs.

Reproductions and test logs are under `/tmp/artist-os-cross-run-*` and `/tmp/artist-os-uncertainty-*`. New regression tests live alongside the owning code and include serialized document reloads, the actual runner boundary, and RPC handlers.

## Limits

No app restart, connected-account action, real publication, saved-profile mutation or push was performed by this task. These checks do not certify live browser behavior. General deduplication across manual chats, provider CLIs, independently created durable workflow runs and Calendar remains the separately parked shared-destination work.

## Separate defect discovered during initial verification

`packages/shared/src/agent/mode-manager.ts` matches every MCP allow-pattern against only the action-name segment. Documented workspace full-tool-name patterns and source patterns generated with an MCP/source prefix therefore fail to match. The existing Ask-mode permission regression fails with the suite's disposable profile; a normal isolated run can pass because existing app defaults mask it. This predates the publishing fixes (`228dee4045`). Do not rewrite the test to an action-only rule to conceal the failure.

Next bounded fix: support explicitly prefixed full-name patterns while retaining action-only matching for generic verb rules, with source-isolation and server-name-bypass regressions. Clean-profile reproduction: `/tmp/artist-os-uncertainty-ask-clean-profile.log`. This production path was deliberately left unchanged in the present fix.

## Follow-up: MCP permission matching

Implemented after the publishing commit; this follow-up remains uncommitted.

- Explicit MCP-prefixed workspace rules now match from the beginning of the full tool name. Generic action rules continue to ignore server names.
- Source rules retain exact source identity separately from their action regex. Regex alternatives and anchors cannot bypass that identity; inactive sources grant no permission.
- Regressions cover Ask and Explore, cross-source leakage, misleading server names, substring tricks, action anchors/alternatives, and repeated stateful-regex evaluation.
- Fresh-profile focused checks: 478 passed. Previously failing regular shard 6: 2,172 passed across 165 files, zero failures. Shared and server-core typechecks passed. Independent read-only review found no blocking defect.
- Combined with earlier reruns, all 65 original test groups now have passing evidence. This is accumulated evidence across focused reruns, not a new complete-suite run. No live app restart or smoke test was performed.

Logs: `/tmp/artist-os-mcp-focused.log`, `/tmp/artist-os-mcp-shard6.log`, `/tmp/artist-os-mcp-types.log`, `/tmp/artist-os-mcp-server-types.log`.
