# T-06E independent rival review

Revision r8 · 2026-09-09 · reviewer rival_phase1. Parent records the independent read-only review response.

Narrow T-06E accepted. No unresolved implementation findings. Reviewed strict authority/CAS validation, exact receipt lookup, duplicate behavior, redacted current projection, separate explicit routing and legacy isolation.

One confirmed defect required correction: actual runner Cancel/Deny awaited backend shutdown after committing the receipt, so a hung or rejecting abort could block/misreport a saved command. Independently reproduced. Fixed with prompt receipt return and separate observed shutdown promise. Four rejecting/hung-abort tests cover Cancel and Deny; another regression preserves no-op cancellation of an already successful draining run. Current-state guard prevents unnecessary abort.

Verified consolidated 150 tests / 848 assertions, actual control-service process recovery 3 / 51 (included in consolidated), transport 27 / 2779, existing regressions 355 / 1121 and copied packaged control journal proof. Parent confirmed four package typechecks, focused lint and diff checks passed. Shutdown acknowledgement is not provider cancellation certification.

Accepted r7-to-r8 historical prerequisite carry-forward; historical evidence remains historical. Service remains optional and unconfigured. Host lifecycle, live UI, admission and full T-06/P-03 completion remain outside acceptance. No user app restart or push.
