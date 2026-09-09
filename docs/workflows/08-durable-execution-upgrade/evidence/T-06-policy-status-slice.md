# Approval recheck and startup failure notice

2026-09-09 · included in this commit with the pending bootstrap wiring.

Approval-bound tool starts now re-resolve the current host binding and recheck the existing safe-mode permission policy before and after the asynchronous authorization callback. Native Pi read/grep/find/ls names map to the existing policy tool names. Workspace/default permission caches are invalidated before the check. A changed binding or blocked read prevents dispatch, even if the callback returns an allowed decision; the journal persists the blocked state. Skipped superseded calls still follow the journal's existing disposition path.

Missing authorization policy remains fail-closed: this change does not invent an allow-all production approver or activate public durable admission. Existing principal, credential and policy-revision binding remains authoritative. The new checks apply to approval-bound runs; ordinary unbound certified reads retain their existing Pi permission path.

An explicitly enabled host that fails startup now presents a generic warning describing unavailable durable controls and secure-storage/local-server checks. Details from credential/keychain exceptions are not exposed. Existing workflows stay available. No notice appears when the host is disabled.

Validation: 56 focused runner/startup/RPC tests passed (271 assertions), including sensitive-path and credential-change denial; two actual Pi approval process-death/recovery tests passed (21 assertions). Server-core and Electron typechecks plus diff check passed. UI notice has not been viewed in a running app; no app restart or flag activation performed.
