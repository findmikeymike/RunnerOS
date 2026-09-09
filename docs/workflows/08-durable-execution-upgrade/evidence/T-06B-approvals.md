# T-06B verification

Revision r5 · 2026-09-09 · canonical main based on dd1798b7b.

Implemented exact durable approval waits and decisions in the internal certified read runner. A trusted host resolver supplies current permission; decisions bind operation/input digest, principal, policy, credential identity and expiry. A valid grant is consumed atomically with its dispatch attempt. Duplicate decisions return historical receipts without reversing newer controls. Current policy is checked again before dispatch. Ordinary authorized reads retain their existing behavior.

Fresh verification:
- 87 durability tests, 437 assertions, across 11 files. Includes journal, actual Pi SDK, default backend and subprocess recovery.
- 355 existing workflow, scheduler and Pi regressions, 1121 assertions, across 19 files.
- Shared and server-core TypeScript plus Pi typecheck passed. Pi temporary bundle passed; no app build replaced.
- Actual default-host approval process tests kill while waiting and after decision commit. Restart reuses the saved model turn; changed policy prevents the read and requests a new approval.
- Copied packaged Electron approval probe passed: Electron 44.2.0 / Node 24.20.0, wait survived SIGKILL, duplicate decision stable, approval consumed with attempt, recovered epoch 2.

Logs: /tmp/artist-os-t06b-all.log, /tmp/artist-os-t06b-regression.log, /tmp/artist-os-t06b-electron.log, and /tmp/artist-os-t06b-{shared,server,pi}-tsc.log. Logs are disposable local evidence; test sources persist in this checkout.

Independent rival found and verified fixes for mutable authorization input and missing consumption rollback proof; the parent also fixed result acceptance before a dispatch attempt. See [review](T-06B-rival.md).

Limits: permission resolver is synthetic in these probes; provider is a local simulator; packaged journal key is injected. This proves neither real OS-keychain access nor live-provider authorization. No public routing, writable effects, steering or child delegation enabled. P-03 remains open. Artist OS was not restarted; no push.
