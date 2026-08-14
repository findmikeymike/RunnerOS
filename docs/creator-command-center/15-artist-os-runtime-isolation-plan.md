---
status: current
owner: agent
last_verified: 2026-08-13
source_of_truth: true
---

# Artist OS Runtime Isolation Plan

## Decision

Artist OS and Runner are separate products. They may share source code and read-only bundled components, but they must never share mutable runtime state.

Both apps must be installable, runnable, updated, sold, and uninstalled independently on the same computer.

Runner's existing runtime and `~/.craft-agent` data remain untouched. Artist OS is added as a new, fail-closed product identity with no automatic fallback to Runner data.

## Implementation Status

The code boundary is implemented on `codex/artist-os-runtime-isolation`:

- Runner defaults remain unchanged; Artist OS mutable state resolves beneath `~/.artist-os`.
- Desktop, server, WebUI, subprocess, protocol, port, packaging, update, and RPC identities are separate.
- Artist OS clean startup and migration do not discover or transfer Runner credentials.
- The automated containment gate, identity tests, cross-product RPC rejection, both renderer variants, both WebUI variants, and a live two-server isolated-home smoke pass.

Release certification is not complete. A packaged macOS build currently stops in the existing Electron Builder dependency collector because `minimatch` is not found for `@eslint/eslintrc`. Clean-machine macOS/Windows/Linux, browser-account, update, and uninstall smokes remain mandatory before public release.

## Baseline Coupling Addressed

Before this work, Artist OS was a workspace/mode inside Runner rather than an isolated application. The coupling included:

- Runner app ID, product name, protocol, and single-instance process identity.
- The shared `~/.craft-agent` state root, including hardcoded consumers that bypass `CRAFT_CONFIG_DIR`.
- One workspace registry, credentials store, logs, audit trail, messaging state, and window state.
- Global mutable agent and workflow libraries under `~/.agents` and `~/.workflows`.
- Shared browser/session storage, scheduled jobs, connections, and app update behavior.

Changing UI labels or setting `CRAFT_CONFIG_DIR` alone is not sufficient isolation.

## Target Product Identity

| Boundary | Runner | Artist OS |
| --- | --- | --- |
| Variant | `runner` | `artist-os` |
| Product name | Runner | Artist OS |
| App ID | `com.findmikeymike.runner` | `com.findmikeymike.artistos` |
| URL protocol | `craftagents://` | `artistos://` |
| Mutable data root | Existing `~/.craft-agent` | `~/.artist-os` |
| Workspaces | Existing registry | `~/.artist-os/workspaces` |
| Credentials | Existing store/namespace | Artist-only file and keychain namespace |
| Agents, skills, workflows | Existing locations | Product-owned directories beneath `~/.artist-os` |
| Logs, cache, browser data | Existing locations | Product-owned directories beneath `~/.artist-os` |
| Updates and releases | Runner channel | Artist OS channel |
| Locks, sockets, ports | Runner namespace | Artist OS namespace |

Exact names may be adjusted before implementation, but every row must remain distinct.

## Central Runtime Authority

Create one shared `RuntimeIdentity` / `RuntimePaths` authority containing at least:

- variant, app ID, product name, protocol, and update channel;
- data, workspace, credential, log, cache, and browser roots;
- agent, skill, and workflow library roots;
- keychain service, RPC/service namespace, locks, sockets, and default ports.

It must resolve once, before any persistent service, Electron session, or subprocess starts. Services receive the resolved identity; they do not construct paths from the home directory themselves.

Artist OS must fail startup when its identity is absent or inconsistent. Runner can retain its current identity while the migration is performed additively.

The renderer sends workspace IDs or names, never authoritative filesystem paths. The backend validates every generated product-managed path against the active product root.

## Allowed Sharing

- Source packages, types, tests, and build-time utilities.
- Versioned, read-only bundled agent, skill, and workflow templates.
- User-selected media or source folders explicitly granted through a file picker.

## Forbidden Sharing

- Workspaces, credentials, keys, cookies, browser profiles, caches, logs, schedules, automations, notifications, mutable agents/workflows, updater state, locks, ports, or background daemons.
- Automatic discovery, reading, migration, or fallback from `~/.craft-agent` by Artist OS.
- Cross-product RPC. Every handshake must include and validate the product identity.

## Implementation Sequence

### Phase 0 — Preserve and Inventory

1. Commit or otherwise preserve the current Artist OS tree.
2. Create `codex/artist-os-runtime-isolation` from the exact intended Artist OS commit.
3. Record hashes and modification times for critical `~/.craft-agent` files. Do not move or delete anything.
4. Inventory every executable reference to `.craft-agent`, `craftagents://`, the Runner app ID/name, `~/.agents`, `~/.workflows`, fixed ports, keychain names, and browser partitions.

### Phase 1 — Centralize Identity and Paths

1. Add the central runtime identity/path resolver and a Runner/Artist OS product matrix.
2. Convert config, workspaces, credentials, logs, audit, messaging, window state, auth, interceptors, resources, and workspace defaults to injected paths.
3. Remove product path construction from executable modules.
4. Add unit tests proving both variants resolve to separate locations and namespaces.

### Phase 2 — Split App and Process Identity

1. Add a separate Artist OS entry point, package scripts, builder configuration, icons, bundle/app ID, product name, protocol, updater channel, and release artifact names.
2. Set Electron `userData` before sessions or single-instance locking initialize.
3. Separate server ports, webhook/trigger namespaces, service tokens, sockets, locks, subprocess environment, and keychain service names.
4. Require headless/server processes and MCP subprocesses to receive and validate the same product identity.

### Phase 3 — Isolate Libraries and Integrations

1. Seed product-owned agents, skills, and workflows from versioned read-only bundles.
2. Store all user edits beneath the active product root.
3. Isolate browser cookies, partitions, caches, OAuth sessions, LLM connections, social accounts, schedules, automations, and notification state.
4. Confirm no Artist OS worker can enumerate or execute Runner workspaces or jobs.

### Phase 4 — Explicit Migration Only

1. New Artist OS installs start clean.
2. If existing Artist OS users need old data, provide an explicit, dry-run-first copier from `~/.craft-agent` to `~/.artist-os`.
3. Copy only user-selected Artist HQ and Campaign workspaces. Do not infer that ambiguous general workspaces belong to Artist OS.
4. Copy, never move or delete. Produce a manifest, checksums, backup location, and audit receipt.
5. Credentials reconnect by default. Any credential transfer requires explicit consent and re-encryption into the Artist OS namespace.

### Phase 5 — Isolation Gates

Release is blocked until all gates pass:

1. **Canary:** place canary files in Runner state, exercise Artist OS fully, and prove Runner hashes and modification times did not change.
2. **Write containment:** prove every automatic Artist OS write lands under `~/.artist-os`, except explicit user-selected external media destinations.
3. **Read containment:** prove Artist OS does not read or enumerate Runner state during clean startup and normal use.
4. **Side-by-side:** install and run both apps simultaneously with no focus hijack, protocol collision, port collision, session crossover, job crossover, or account crossover.
5. **Browser/account:** connect different accounts in each app and prove cookies, OAuth state, and credentials remain isolated.
6. **Lifecycle:** updating or uninstalling either app must not modify the other app or its data.
7. **Clean machines:** pass packaged smoke tests on supported macOS, Windows, and Linux targets.
8. **Static CI:** fail if Artist OS executable code contains Runner-only roots, protocol, app ID, product name, or global mutable library paths.
9. **Identity mismatch:** backend, subprocess, and RPC handshakes reject a caller from the other product.

### Phase 6 — Rollout

1. Developer isolated-profile smoke.
2. Packaged local smoke.
3. Clean-machine side-by-side smoke.
4. Explicit migration smoke using copied test data.
5. Limited internal release, then public release only after all isolation evidence is saved.

## Rollback Safety

- Isolation work is additive; Runner retains its existing identity and data.
- No implementation step deletes, relocates, or rewrites `~/.craft-agent` data.
- Before public release, Artist OS can be removed by uninstalling it and deleting only `~/.artist-os` after explicit confirmation.
- Reverting the code branch must not require restoring Runner data.

## Acceptance Criteria

- Runner and Artist OS install and run simultaneously as visibly separate applications.
- Workspaces, credentials, browser sessions, connections, libraries, logs, automations, updates, and background processes are isolated.
- Artist OS makes no implicit read or write to Runner state.
- Shared code is build-time or read-only; mutable runtime state is product-owned.
- Any old-data migration is selective, explicit, auditable, and non-destructive.
- Automated and packaged tests prove the boundary rather than relying on naming or UI checks.

## Deliberate Non-Goals

- Renaming internal source packages such as `@craft-agent/*` when they do not control runtime identity.
- Forking or duplicating the entire codebase merely to create isolation.
- Sharing a live daemon, login, browser profile, or credential store to save resources.
- Automatically transferring users or accounts between the two products.

## First Implementation Slice

Build only the central runtime identity/path authority, the complete hardcoded-consumer inventory, and the canary containment test first. Do not change packaging or migrate user data until that foundation proves Artist OS can operate without touching Runner state.
