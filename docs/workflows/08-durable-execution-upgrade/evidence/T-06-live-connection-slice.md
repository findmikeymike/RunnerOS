# Small startup prerequisite — authenticated live connection lookup

2026-09-09 · based on `a12a12ba4` · included in this commit.

Added a host-only `WsRpcServer.isAuthenticatedClientConnected(clientId)` lookup. It requires enforced handshake authentication and an open socket in the active connection map. Unknown IDs, unauthenticated server connections and disconnected records retained for reconnect are rejected. No identity is inferred from renderer window/workspace claims.

This proves connection authentication/liveness only, not a stable user identity, current token validity or workspace membership. The existing authority resolver still requires those host-owned checks. It is not yet wired to durable startup and changes no public admission behavior.

Verification: 14 real-loopback transport lifecycle/authorization tests passed; server-core typecheck and diff check passed. The disconnect test waits for the server-side disconnect callback, since the client's close event can precede the server processing it. No app restart, provider operation or push.
