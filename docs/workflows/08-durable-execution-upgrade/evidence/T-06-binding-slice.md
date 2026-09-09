# Small startup prerequisite — production read binding resolver

2026-09-09 · based on `b66237485` · included in this commit.

Added a resolver using current configured workspaces, the existing backend-context resolver and the credential manager. It requires an exact workspace ID, local workspace, exact connection/model and explicit Pi API-key authentication. Missing credentials and route substitution fail closed. Configuration is copied before asynchronous credential loading and rechecked afterward.

Only a transport credential fingerprint is returned; the API key is not included in the binding. OpenRouter and explicit custom endpoints use the same custom-endpoint fingerprint provider as the existing Pi driver. Rotation changes identity, allowing the runner's existing admission/recovery checks to reject incompatible reuse.

Conservative scope: OAuth, IAM/environment credentials and keyless local endpoints are not resolved by this adapter. No paid dispatch, model fallback, host activation or public admission is added. Startup can use this resolver as runnerOptions.resolveBinding in a later wiring slice.

Verification: four focused resolver tests plus 39 runner regressions passed (43 tests / 222 assertions); server-core typecheck and diff check passed. Tests use injected host records and synthetic credentials. Real credential-store/provider verification remains separate; no user credentials read.
