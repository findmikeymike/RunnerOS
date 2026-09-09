# T-06F small follow-up — actual Pi through the host factory

2026-09-09 · based on `43172a1ff` · included in this commit follow-up.

Extended the existing disposable default-factory probe with a host-lifecycle mode. It opens `DurableWorkflowHost`, runs the real Pi subprocess over authenticated IPC, reads a native fixture file, commits completion, closes the host, reopens the same journal and repeats the admission. The completed result is reused with the same model-attempt count and exactly two total simulated-provider requests.

The original workflow-adapter probe remains covered. Both run in child processes with disposable configuration and synthetic credentials. The host envelope adapter is synthetic; this does not certify OS secure storage. Admission is the internal certified read path without approval opt-in. This does not test approval controls or shutdown during an active model call.

Validation: 12 tests / 45 assertions passed across the default-factory and host-lifecycle suites; server-core typecheck and diff check passed. Local output: `/tmp/artist-os-host-live-factory.log`. Reviewed locally; no additional delegated review in this credit-limited slice.

This closes only the previously documented actual-Pi-through-new-factory proof gap for completed runs. Electron startup/quit wiring, stable actor authority, OS protection and live UI remain ahead. No product code, public admission, app restart or commit in this slice.
