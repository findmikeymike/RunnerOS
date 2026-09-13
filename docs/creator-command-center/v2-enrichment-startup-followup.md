# Parked V2: enrichment startup follow-up

This branch preserves a small startup-order repair and regression test. It is not part of Artist OS V1 and does not enable enrichment; the V2 flag remains false.

The headless host registers RPC before initializing Deep Research. Service construction now waits until that runner exists, while already initialized hosts retain immediate subscription. Re-registration disposes the previous listener.

Validation before parking: four headless smoke tests, four handler/service tests, and server-core typecheck passed. Reconcile with codex/profile-enrichment-review-fixes before any future V2 release; do not merge that branch wholesale into V1.

Separate unresolved V2 issue: DeepResearchRunner.recoverInterruptedRuns may emit completion before an enrichment listener subscribes, leaving the research status projection stale. This patch does not implement restart reconciliation.
