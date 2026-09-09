# Small authority slice — current user and workspace

2026-09-09 · included in this commit.

Added `createDurableWorkflowAuthority`, a resolver compatible with the existing host `resolvePrincipal` option. It reads the current stable principal from a host-owned authentication lookup, checks current workspace existence/membership and rejects missing identity, mismatched workspace or revoked access. It never derives identity from a connection ID, window ID or caller principal field. Each invocation reads current records rather than caching permissions.

Focused tests cover reconnects, spoofed principal fields, disconnects, workspace mismatch/removal, membership revocation, account changes, malformed inputs and lookup failure. A real-journal controls-service regression proves revoked access blocks both approval and control commands without journal mutation.

Verification: 19 tests / 102 assertions passed across authority and controls suites; server-core typecheck passed; diff check passed. Locally reviewed to keep this user-requested slice small. Earlier included in this commit host-factory test work preserved.

Integration contract: supply trusted synchronous authentication and membership lookups via the host resolver option. Transport handshake workspace/window claims alone are insufficient. This helper does not create that authentication registry or register the production host; startup integration remains pending. It checks access when resolution occurs and does not introduce transactional revocation across later asynchronous execution. Existing exact run-principal and current tool-permission checks remain in place.
