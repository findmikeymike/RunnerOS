# T-06E explicit control integration

Revision r8 · 2026-09-09 · canonical main based on 8dba3c438.

Implemented dedicated workflow-runs:durable-control RPC and Electron transport method for Pause, same-run Resume, Cancel and ordered updates. Existing legacy Resume still reruns from a step. The durable path requires its optional host service and never falls back to legacy execution after a durable error.

Service validates a strict command shape, freezes input before async identity lookup, verifies current trusted principal/workspace and requires a persisted matching principal. Unbound historical runs cannot be adopted by a caller. Exact duplicate command lookup returns an immutable receipt without repeating runtime calls; current redacted state is separate. Pending update count includes boundary-selected messages until the successor model is reserved. No prompt/results/update text/credential data are returned in control state or broadcast.

Rival found that actual runner Cancel/Deny waited for backend abort after committing the journal. A hung abort could hang acknowledgement, and rejection could report a successful stop as failure. Fixed by returning the committed receipt immediately with a separately observed shutdown promise. Rejecting and non-settling abort tests cover both Cancel and Deny. A no-op Cancel on an already completed run does not abort its draining backend. Late failures cannot revive cancelled work. Receipt acknowledgement is not proof that an issued provider operation has stopped.

Actual control-service process proof passed three cases: persist Pause and ordered updates, persist Resume, kill after each command boundary, recover the same run through the real Pi backend; repeat with unused approval supersession; persist Cancel then restart and prove no further model dispatch. The simulator sees exactly two model requests for resumed runs and one for cancelled work. Superseded native reads retain zero attempts.

Copied packaged Electron control journal proof passed: Electron 44.2.0, pausedAfterSIGKILL, duplicateReceipt, epoch 2, controlRevision 2 and cachedModelReused. This is journal proof, not packaged user-interface activation.

**Final verification:** 150 affected tests / 848 assertions across 18 files; 27 transport/routing tests / 2779 assertions; 355 existing regressions / 1121 assertions. Shared, server-core, Pi and Electron typechecks passed, as did focused lint and diff checks. [Independent rival](T-06E-rival.md) accepted the narrow slice with no remaining blockers. Logs: /tmp/artist-os-t06e-all.log, /tmp/artist-os-t06e-process.log, /tmp/artist-os-t06e-transport.log, /tmp/artist-os-t06e-regression.log, /tmp/artist-os-t06e-electron.log, /tmp/artist-os-t06e-lint.log and /tmp/artist-os-t06e-{shared,server,electron,pi}-tsc.log.

Limits: host service remains unconfigured in production bootstrap. No new admission or control buttons enabled for actual users. Host actor/key lifecycle and run projections remain ahead, as do effects, children, schedules, migration and release certification. T-06/P-03 remain open. No live UI/provider certification or full repository suite claim. No app restart or push.
