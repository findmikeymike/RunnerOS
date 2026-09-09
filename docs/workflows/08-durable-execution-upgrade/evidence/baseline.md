# Baseline evidence and limits

Plan revision r1. Source baseline: `8ce9f5c11782caa3c46713df8a9b7150513c95eb`, canonical Artist OS main checkout.

The preceding read-only audit in this task reported:

- Workflow runner + workflow storage: 140 tests passed, 0 failed, 600 assertions. Temporary log: `/tmp/artist-os-workflow-durability-audit-tests.log`.
- Scheduler catch-up/state/system + ScheduledWorkRunner: 108 tests passed, 0 failed, 269 assertions. Temporary log: `/tmp/artist-os-scheduler-durability-audit-tests.log`.

Those are historical observations from the immediately preceding audit, not tests of the proposed implementation. Temporary logs are not durable release artifacts. The original commands did not include the repository's standard packaged-output ignore flags; explicit test files limited their scope. Future verification must follow AGENTS.md.

The current source inspection verifies a custom TypeScript main workflow runner, atomic JSON run snapshots, persisted scheduler checkpoint, SQLite escalation records with an in-memory wait, and optional DBOS Python production shell. It does not prove live enabling of that shell.

No upgraded engine, real SIGKILL recovery harness, physical power-loss result, performance benchmark, migration rehearsal, soak, or live-provider certification exists from writing this specification. Planned A-01–A-20 evidence must be gathered during implementation.
