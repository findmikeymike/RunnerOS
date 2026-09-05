# Website Final Integration Review

## Fix Verification - 2026-09-04

All five findings below are addressed in this fix commit; not yet deployed or integrated into main.

- [x] Publish uses a private byte-verified snapshot, shared cross-instance site locking, and latest-manifest merges. Changed build bytes are refused. Retained bytes match uploaded bytes. Slow domain/capture updates no longer erase publish history.
- [x] `/unsubscribe` is explicitly worker-first. The adapter test checks emitted routing metadata and executes browser-navigation form handling. A real Cloudflare deployment/browser acceptance check remains required.
- [x] Routine changes carry durable retry state across build/preview/publish failure and restart. Quiet runs retain unanswered approvals; stale previews are refreshed, and superseded preview IDs survive failures so duplicate pending approvals are settled.
- [x] Cadence updates are backend-owned, retain a stable automation identity, and use validated atomic config replacement under the existing config mutex. A transaction journal recovers interrupted manifest/config updates; status refuses to invent a cadence if recovery cannot verify state.
- [x] Rollback records live history and revokes trusted mode before optional retention/receipt writes. Warnings surface without claiming the remote rollback failed. Retention stages and verifies complete bytes before promotion, so partial backups are never offered as rollback targets.

Fresh evidence:

- Combined website/shared/builder run: 229 pass, 0 fail. The service files were then run separately because Bun's combined invocation did not list their individual assertions.
- Explicit `publish.test.ts`, `routine-run.test.ts`, `WebsiteService.test.ts`: 53 pass, 0 fail, including isolated localhost previews.
- Final `deploy-snapshots.test.ts` plus `publish.test.ts`: 24 pass, 0 fail after retention hardening.
- Backend cadence failure/concurrency suite: 11 pass, 0 fail. Snapshot/lock suite: 2 pass, 0 fail. Capture/adapter suite: 28 pass, 0 fail. These counts overlap the combined run; do not sum them as unique tests.
- `bun run typecheck` in server-core and Electron, plus root `bun run typecheck:shared`: pass.
- Electron `bun run build:renderer --outDir /tmp/artist-os-website-fixes-renderer`: pass, 1m37s. Existing Jotai deprecation, gray-matter eval, and bundle warnings remain.
- Independent targeted review found follow-up stale manifest, retry/approval, and partial-retention issues; all fixed with regression tests. Final targeted routine and rollback reviews found no remaining meaningful defects.
- `git diff --check`: pass. No app restart, external publish, email send, domain change, commit, or push. Other agents' voice changes and unrelated specs were preserved.

## Original Findings (History)

Reviewed on `codex/artist-website-engine`, code at `4faf3f454`. Review only; no production code changed or live host contacted.

## Necessary Fixes

1. **P1: Publishing can upload a different build than the artist approved.** `packages/server-core/src/website/publish.ts:129` awaits adapter resolution and deploys mutable `dist/` after checking the manifest only once. `WebsiteService.deploy` does not participate in its build lock. A deterministic injected-adapter probe completed another build during resolution: publish returned success, uploaded `unapproved B`, recorded build `A`, and overwrote the newer manifest's lastBuild back to `A`. Freeze and verify the upload bytes, serialize shared mutations across service instances, and preserve intervening manifest changes. Retained rollback bytes must match the uploaded snapshot too.

2. **P1: The generated unsubscribe page is omitted from Cloudflare's worker-first routes.** `packages/server-core/src/website/adapters/cloudflare.ts:219` configures only `/api/*`, with `not_found_handling: '404-page'` and compatibility date `2026-09-01`. The worker handles `/unsubscribe`, but browser navigation to it follows static-asset/404 handling instead. A non-navigation health fetch is not proof the fan-facing page opens. Route `/unsubscribe` explicitly and add a deployment-routing/browser-navigation check, not only a direct worker.fetch test. Cloudflare documents this navigation behavior: https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/ . No live deployment was tested.

3. **P2: A failed routine build is not retried on the next run.** `WebsiteService.ts:1226` saves content before building. If build fails, the next plan sees those operations already applied and takes the no-operations return, replacing the failed brief. Probe: first result false, second true, only one build invocation total, no lastBuild and no site preview in the second brief. Persist pending work or detect content/build divergence and retry before declaring no work. Also preserve unresolved preview/approval work rather than replacing it with a quiet brief.

4. **P2: Changing cadence can delete the working schedule before its replacement exists.** `apps/electron/src/renderer/components/app-shell/WebsitePage.tsx:193` deletes the old automation, then creates the replacement; cadence was already saved at line 338. A failed create leaves the manifest claiming a weekly/monthly routine with no actual schedule. Use a backend update/transaction with a stable automation identity and expose truthful state on failure. This is a source-verified failure path, not a live scheduler reproduction.

5. **P2: Rollback can succeed remotely but fail before recording the result or disabling trusted mode.** `publish.ts:263` calls `retainDeploySnapshot` without handling failure, before saving live history and revoking trusted mode. A local copy/disk failure after successful deploy leaves the app reporting the old live version and keeps auto-publishing enabled. Normal publish already handles this class of snapshot failure; apply equivalent post-deploy bookkeeping to rollback. Source-verified; no disk failure injected. Preserve the restored designHash as part of the new record as well.

## Evidence

- `bun test packages/shared/src/website packages/server-core/src/website tools/site-builder`: 206 pass, 0 fail, 15 files. Bun directory discovery omitted three tracked service/publish test files, so those were run explicitly.
- `env CRAFT_CONFIG_DIR=/tmp/website-review-test-config bun test ./packages/server-core/src/website/publish.test.ts ./packages/server-core/src/website/routine-run.test.ts ./packages/server-core/src/website/WebsiteService.test.ts`: 44 pass, 0 fail. Initial sandbox run failed three loopback preview cases; permitted localhost rerun passed all 44.
- Local scratch probes reproduced findings 1 and 3. No artist files, credentials, messages, or external deployment used. Probe script removed after review.
- Cadence UI does create a real automation on its happy path; the claim that it only saves a label is rejected.
- Existing-site support was not live-certified against a real CMS. Domain cutover, signup delivery, unsubscribe navigation, and production rollback still require deliberate live acceptance after fixes.

Code fixes are checked above. Live hosting/capture acceptance and integration into main remain separate gates.
