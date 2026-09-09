# Small startup prerequisite — local desktop owner authority

2026-09-09 · based on `e1789050f` · included in this commit.

Added an Electron authority factory connecting the existing installation identity store, current configured workspace list and RPC authenticated-live-connection lookup. Principal identity is `desktop-owner:<installation UUID>` and remains stable across reconnects and reconstruction. It identifies the single-owner local profile, not a remote account or credential.

Only explicit loopback bindings with shared-server mode disabled are eligible. Unknown/disconnected clients, external bindings, shared-server mode, missing installation identity and absent/deleted workspaces fail closed. Caller-provided principal/window/workspace claims never establish ownership. Current membership means the local owner's current configured workspace list; this does not implement multi-user ACLs.

Focused verification: 23 authority/control tests passed (116 assertions), Electron typecheck and diff check passed. Tests inject binding, installation ID and live-connection lookup; existing persisted installation store and real transport lookup are reused rather than reimplemented. No live OS identity-store access or app restart performed.

Startup must supply actual server and current binding policy to `createElectronDurableWorkflowAuthority`, then pass the resolver to the durable host. The factory does not activate the host or public admission. Shared/remote support remains disabled until distinct authenticated user authority exists.
