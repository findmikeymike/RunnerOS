# P-02 production journal and Pi verification

Revision r3 · 2026-09-09 · canonical main based on `dfac3d512`.

## Implemented scope

Private encrypted SQLite journal with transactional admission/events/outbox, ownership fencing, saved model/tool responses, persisted bounds, cancellation and quarantined backups. Internal host runner freezes a supported single-step workflow and invokes the existing Pi backend. Core SDK listeners and native read wrappers await saved checkpoints. The first certified manifest is local `read/grep/find/ls`, with API-key/bearer transport identity pinned exactly. Unsupported workflow behavior, dynamic tools, auxiliary models, native OAuth/IAM, changed credentials and incompatible SDK manifests fail closed.

Public workflow/scheduler routing, migrations, writable/effectful adapters, children, approvals and recovery UI are not enabled by this change. Existing ordinary sessions retain their route.

## Fresh evidence

- Production journal real-SDK restart tests: **4 passed, 25 assertions**, 2.51 seconds. Real Pi core Agent, production journal, native read tool, HTTP model simulator outside the killed worker. Supervisor SIGKILLs before model commit, after model commit, after the first result in a two-read batch, and after completion. Committed responses avoid provider replay; committed first read stays original after file mutation while the unfinished second read observes the changed file. An already completed run cannot be claimed again. Log: `/tmp/artist-os-p02-process.log`.
- Copied packaged Electron probe: **pass**, Electron 44.2.0 / Node 24.20.0, `app.isPackaged=true`. Killed after saved model response; fresh process reclaimed epoch 2, reused response, completed and exported a quarantined backup. Log: `/tmp/artist-os-p02-electron.log`. Uses an injected disposable test key, so this is not certification of the real OS keychain or the complete Artist OS package.
- Existing workflow/scheduler regression plus initial journal/controller tests: **265 passed, 927 assertions**. Existing Pi regressions: **107 passed, 252 assertions** across 13 files. These runs preceded the final rival fixes; final targeted results are recorded below when complete.
- Shared, server-core and Pi TypeScript checks passed. Pi source bundled into `/tmp/artist-os-p02-pi-server.js`: 3024 modules, 27.1 MB. The app's existing build was not replaced or restarted.

Final consolidation: **42 passed, 0 failed, 166 assertions**. Main combined run: 40/161 across journal, controller, subprocess IPC, host runner, real default factory and SIGKILL suites; separate startup suite: 2/5. Logs: `/tmp/artist-os-p02-final.log`, `/tmp/artist-os-p02-startup.log`. IPC tests include refusal of credential/runtime drift before provider dispatch. The default-factory test exercises a real existing LoadedWorkflow through host admission, existing backend factory/runtime resolver, PiAgent, the Pi subprocess, authenticated localhost SSE and native file read. It commits completion with exactly two model attempts and two provider requests. Credentials are synthetic and isolated in a disposable configuration.

Independent `rival_phase1` accepted the internal single-step read-only foundation after all four findings were fixed, including the final host/Pi error-propagation regressions (13 independent tests, 40 assertions). See [review](P-02-rival-fix.md). No paid provider requests or actual Artist OS profile were used.

Final existing workflow/scheduler/Pi regression rerun: **355 passed / 1121 assertions**, 19 files, 6.89 seconds (`/tmp/artist-os-p02-final-existing.log`). Combined with the new suites: **397 passed / 1287 assertions**. All three final TypeScript checks, plan graph and diff whitespace checks passed. This focused verification does not claim the full release suite or production rollout certification.
