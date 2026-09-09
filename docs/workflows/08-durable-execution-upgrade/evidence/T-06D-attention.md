# T-06D attention integration verification

Revision r7 · 2026-09-09 · canonical main based on 9274f2041.

The optional DurableWorkflowControls service projects exact normalized approval inputs directly from the encrypted journal. Existing workflow attention RPC can merge these with legacy attention and route reserved durable identities to journal decisions. It never copies approval payloads into the separate legacy database or resolves durable work through legacy deferred promises. Host-supplied current-access/principal resolution is required; connection clientId is not treated as authentication.

Decision metadata includes command identity and expected version. Responses separate the immutable decision receipt from current approval state. Repeated decisions return the original receipt without restarting work, including after supersession/cancellation or an adapter upgrade. New decisions for missing review payloads or unsupported adapters are refused. Expired requests remain visible and can stop the workflow.

Renderer forwards a stable command ID across uncertain retries. Stale requests refresh the card without automatically approving the newly loaded state. Durable denial is labelled Stop workflow. Private normalized inputs are returned only after actor checks and notified only to the requesting client; no workspace-wide durable payload broadcast occurs.

Review findings fixed: legacy run filtering previously failed on missing journal IDs; durable payload notification previously crossed principal boundaries; stale cards could retry the same old version indefinitely; immutable receipts were previously conflated with current projections. Targeted regressions cover each.

Actual default-host Pi process probe passed two cases: attention-service decision survives SIGKILL after commit with duplicate acknowledgement, then real runner resumes from saved model work; changed policy still forces a new approval before the native read. This decision bridge fixture deliberately stops continuation after commit, then invokes the actual runner after restart. Local provider simulator and injected principal/key are explicit fixtures, not live authorization certification.

Copied packaged Electron approval journal probe passed: Electron 44.2.0 / Node 24.20.0, waitSurvivedSIGKILL, duplicateDecision, consumedWithAttempt, epoch 2. This is journal persistence evidence, not a packaged UI/attention-service journey.

**Final checks:** 135 affected tests / 723 assertions across 17 files; 355 existing regressions / 1121 assertions across 19 files. Shared, server-core, Pi and Electron typechecks passed. Focused renderer lint, temporary Pi bundle and diff checks passed. [Independent review](T-06D-rival.md) accepted the narrow slice with no unresolved blockers. Logs: /tmp/artist-os-t06d-all.log, /tmp/artist-os-t06d-regression.log, /tmp/artist-os-t06d-process.log, /tmp/artist-os-t06d-electron.log, /tmp/artist-os-t06d-lint.log and /tmp/artist-os-t06d-{shared,server,electron,pi}-tsc.log.

Limits: optional dependency is intentionally unconfigured in production bootstrap. No new workflow admission, journal key lifecycle or actor resolver is enabled for real users here. Pause/Resume/Cancel/steering RPC routing remains the next integration slice. T-06 and P-03 remain open; no live UI, writable effects, child delegation, full suite/release or live provider certification claimed. No app restart or push.
