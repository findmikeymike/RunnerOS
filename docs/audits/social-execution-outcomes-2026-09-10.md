# Scheduled social execution outcomes — Area 8

Base: main `3d925d030`, refreshed to `eee1fce12` before final verification; worktree `codex/social-execution-outcomes`.

## Decisions and changes

- F8.1 confirmed: browser click attempts and TryPost/Postiz publish requests can reach the platform even when their promises reject. Wrap the submit-to-receipt boundary in a shared uncertainty error. The runner persists the existing `execution-uncertain` reason, preserving the existing replacement suppression. Failures before submission remain ordinary failures. A verified publish followed by receipt-persistence failure is also uncertain; a subsequent scan never resubmits it. No new approval steps or automatic reposts.
- F8.2 clarified: five seconds remains the default for clearing stale success evidence. `cleanBaselineTimeoutMs` is a separate, explicitly configurable budget; receipt timeout no longer silently controls it. Tests exercise stale evidence beyond five seconds and independence from a longer receipt timeout.
- F8.3: selector errors already identify platform, step, and missing/ambiguous targets. Preserve those diagnostics. No selector-system redesign or new telemetry is justified by a demonstrated defect.
- Additional concrete receipt defect: Postiz's caption/account fallback could accept an older identical post. Require the post identity returned by the create request. Internal `postId`/list `id` are distinct from external `releaseId`: [create](https://docs.postiz.com/public-api/posts/create), [list](https://docs.postiz.com/public-api/posts/list), [release ID](https://docs.postiz.com/public-api/posts/update-release-id).

## Acceptance boundary

F8.4 remains a live-platform validation gap. Fixtures prove local contracts and uncertainty handling, not current live X/Instagram/TikTok/YouTube DOM compatibility. No real publishing, external account mutation, or app restart was performed. A future live acceptance run must retain the approved tuple, account identity, actual publication ID/URL, and exactly one matching post per tested platform. This is test evidence, not an additional product approval flow.

## Validation

Final suite after the main refresh: **9,950 passed, 10 skipped, zero failures** (4,274 + 5,296 sharded and 380 isolated). All workspace typechecks and both Artist OS main/renderer builds passed. Browser regression: 15 passed. Provider/route regression: 17 passed. Runner regression: 69 passed, including persisted outcomes, failed receipt writes, preserved selector diagnostics, and fresh-runner scans without resubmission. Independent review found no remaining must-fix issues.


The renderer build exposed an inherited `3d925d030` import regression: AI Settings loaded the whole config barrel and transitively the Claude SDK. A dedicated browser-safe model-fallback export and type-only barrel import fix that boundary.

After the trunk refresh, an ordered test reproduction exposed a permission-spy restoration leak in the durable workflow fixture. Replacing that spy with real solo-workspace authorization changed the exact reproduction from 81 passed/2 failed to 83 passed/0 failed. Production team permissions were unchanged.

Six existing test-fixture corrections from the separate provider-recovery work are repeated because this worktree starts from main: current RPC/style expectations, credential mocks, and scheduled-work mocks honoring explicit directories. No provider-recovery runtime feature is copied into this branch.
