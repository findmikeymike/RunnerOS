# Small Electron bootstrap and controls slice

2026-09-09 · based on `28add0635` · included in this commit.

Electron now invokes the prepared host factory only for Artist OS when the host environment explicitly contains `CRAFT_DURABLE_READ_HOST=1`. No flag was set during this task. The factory receives the actual RPC server, current shared-server policy, actual backend runtime paths and production read-binding resolver. Shared/external bindings still fail closed.

The existing handler dependency object receives durable controls only after successful host startup. Before that, explicit durable requests report unavailable and legacy attention remains unchanged. Startup failure leaves the durable dependency absent and logs a generic error without keychain/credential details. Public START remains legacy; this flag opens the internal host/control integration, not durable admission or general rollout.

Verification: 25 focused startup/authority/lifetime/storage/RPC tests passed (91 assertions). The real-journal RPC test now verifies registration before startup, refusal before attachment and successful commands after attachment. Electron typecheck and diff check passed.

No app restart, live keychain access or production runtime activation was performed. Actual flagged startup/quit/UI smoke is still unverified. Tool-approval policy integration, broader provider support and rollout remain separate work. This does not complete T-06 or P-03.
