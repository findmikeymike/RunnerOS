# Creative Lab Integration Hardening

Status: implementation contract  
Target branch: `codex/lab-integration-hardening`  
Integration base: `codex/artist-os-runtime-isolation` at `5e2aa0ea7`  
Feature source: `codex/lab-workspace` at `f2c63bfbc`

## Purpose

Integrate Creative Lab into Artist OS without weakening product isolation, creating split song data, overriding user choices, or exposing Lab-only actions in unrelated workspaces.

This document is the source of truth for the repair. The old Lab branch is a feature reference, not a merge authority. When its implementation conflicts with this contract or the current Artist OS runtime contract, this contract and current Artist OS behavior win.

## Required Outcome

Creative Lab is a first-class Artist OS workspace where a user can:

1. Open a real song library backed by durable workspace files.
2. Create and edit songs from the Songs, Sequence, and Song Pad surfaces.
3. Ask an activated Lab worker for help from the Song Pad.
4. Save exact agent output into the same song the UI displays.
5. Activate or deactivate Lab workers without startup silently undoing the choice.
6. Use rhyme/prosody help with clear first-run and failure behavior.
7. Keep all Lab state inside the Artist OS runtime and workspace root.

## Non-Negotiable Boundaries

### Product isolation

- Artist OS remains rooted under its product-aware runtime root.
- No new `.craft-agent` default, fallback, migration, read, or write path may be introduced.
- Workspace creation retains explicit Artist OS purpose/type metadata.
- Lab identity must be persisted as workspace purpose/scope, not inferred from a mutable display name.
- A name/slug inference helper may exist only as a one-time compatibility migration for legacy Lab workspaces.
- ScriptOS, Trade God, general Runner, and other forks remain untouched.

### Integration discipline

- Do not merge or cherry-pick the full Lab branch wholesale.
- Port feature slices onto the current Artist OS base.
- Preserve target-branch behavior in shared shell, workspace creation, routing, sessions, provider, and identity files.
- Do not import the old generated `bundled.generated.ts`; regenerate it from source after the final skill set is present.
- Do not hand-edit generated system maps.

## Canonical Domain Model

### Workspace identity

Creative Lab is represented by the explicit workspace purpose `lab` within the Artist OS product scope.

Required behavior:

- Artist OS owns exactly one Creative Lab.
- `Add Creative Lab` creates that Lab immediately at the Artist OS default workspace root with no generic type or location form.
- Once the Lab exists, the add action disappears and the existing Lab remains available in the top workspace header after a visual divider.
- Backend creation rejects any second Lab, including stale or concurrent UI requests.
- The Lab persists `purpose: "lab"` at creation.
- Existing campaign and HQ workspaces retain their current purposes.
- UI routing, worker defaults, tool availability, and Lab navigation read the same persisted purpose.
- Legacy workspaces may be recognized by the old name/slug rule once, then upgraded to explicit purpose without relocating their files.
- Renaming a Lab workspace must not stop it from being a Lab.

### Song storage

There is one canonical song repository:

`<workspaceRoot>/lab/songs.json`

The shared Lab song model is the authority for:

- song ID and title
- project
- status and focus state
- notes
- rough pad
- remember-this material
- structured sections
- capture provenance
- created and updated timestamps

Renderer-only `localStorage` song records are legacy data, not an ongoing store.

### Projects and sequence

Project/sequence state must also be durable and workspace-scoped. It may use either:

- `<workspaceRoot>/lab/projects.json`, or
- a versioned field in a single Lab state document.

It must not remain browser-only if it changes user work.

## Persistence API

The renderer must use typed preload/IPC calls; it must never access workspace filesystem paths directly.

Minimum API:

- `listLabSongs(workspaceId, filters?)`
- `getLabSong(workspaceId, songId)`
- `createLabSong(workspaceId, input)`
- `updateLabSong(workspaceId, songId, patch)`
- `saveLabLyrics(workspaceId, input)`
- `getLabProjectState(workspaceId)`
- `saveLabProjectState(workspaceId, input)`

Rules:

- Main/server resolves `workspaceId` to its registered root.
- Every operation verifies the workspace belongs to Artist OS and has Lab purpose.
- Updates are atomic and preserve unknown forward-compatible fields.
- Invalid or missing IDs produce typed errors; they never silently create a second song unless `createIfMissing` is explicit.
- Concurrent writes serialize per workspace or use an equivalent atomic-update guard.
- Writes use temp-file plus rename or the repository's established atomic JSON helper.

## Legacy Browser Data Migration

On the first Lab load after integration:

1. Read legacy `lab:songs:v1:<workspaceId>` and project/selection keys.
2. Ask the canonical store whether real data already exists.
3. If the canonical store is empty, import valid legacy records once.
4. If both stores contain data, preserve the canonical store and import only non-colliding legacy song IDs as clearly migrated records.
5. Record a versioned migration receipt.
6. Keep the old browser data until the migration receipt is durable; then it may be removed.

Seed/demo songs must never be written into a real user workspace automatically. Empty state should be honest and offer `Add Song`.

## UI Contract

### Songs

- Shows canonical songs, not `SAMPLE_SONGS`.
- Search, filter, focus, project, status, and timestamps operate on real data.
- Selecting a row opens that exact song.
- `Add Song` creates a canonical record, then opens it.
- Loading, empty, error, and retry states are explicit.

### Sequence

- Uses canonical songs and durable project/sequence state.
- Reordering or assigning songs persists across reload and app restart.
- Deleted/missing song references are pruned safely.

### Song Pad

- Route or selected-state identifies one canonical song ID.
- Autosave is debounced, visible, and recoverable.
- Agent actions use the currently loaded canonical song snapshot.
- Agent save tools update the same record and refresh the UI.
- A failed worker or save never discards unsaved user text.

### Lab navigation

- Lab appears only for explicit Lab workspaces.
- Artist OS orders the top workspace header as HQ, Campaign workspaces, add workspace, divider, then Creative Lab.
- Sidebar visibility is a separate lower-left control and must not compete with workspace switching.
- Native macOS window controls remain visible while Artist OS overlays are open.
- HQ and campaign navigation remain unchanged.
- Shared shell changes preserve current Artist OS header, chat, background-worker, approvals, and runtime-isolation behavior.

## Worker Contract

- Lab has recommended starter workers, not a permanently forced exact list.
- Defaults apply only when a new Lab workspace has never recorded an activation choice.
- Once activation state exists, startup must preserve it exactly.
- User deactivation is durable.
- Newly added future workers are discoverable through Manage Library; startup does not auto-activate them.
- Worker routing considers only activated workers in the current Lab workspace.
- Multiple eligible workers produce a chooser; zero eligible workers produce a clear Manage Library path.
- No fixed multi-agent chain is introduced for ordinary Song Pad actions.

## Tool Authorization Contract

Lab song tools are registered only when all conditions are true:

1. Session belongs to the current Artist OS runtime.
2. Workspace purpose is `lab`.
3. Workspace is local and registered.
4. The agent is trusted for the requested Lab tool.

Defense in depth:

- Tool discovery/registration omits Lab tools outside Lab workspaces.
- Handler context refuses execution if scope is wrong.
- Shared persistence refuses a non-Lab workspace root/context.
- Audit logs record workspace ID, song ID, session ID, agent slug, action, and result without lyric contents unless needed for an error.

Mutation approval behavior follows the existing internal-file rule: saving drafts inside the user's Lab workspace does not require public-action approval. Publishing, posting, spending, sending, or external uploads still require the existing explicit approval gates.

## Prosody Contract

The packaged app must not silently depend on an unexplained network install.

Required behavior:

- Prosody engine assets are included in packaged resources.
- Supported platforms are explicit: macOS arm64/x64 and Windows x64 for the current release lane; Linux only where the packaged runtime is proven.
- First use shows a compact `Preparing rhyme tools…` state.
- If dependency installation is retained, it is one-time, bounded, cancellable where practical, and reports offline/network failure in plain language.
- No shell execution is used; process arguments remain separated.
- Selection and line limits remain enforced in both renderer and main process.
- Missing Python/uv/dependencies returns a recoverable UI error; Song Pad editing remains usable.
- Runtime setup is cached and concurrent requests share one setup operation.
- Packaging validation confirms the engine script and required binary paths exist in the built artifact.

Preferred release direction: prepackage the small required Python dependencies or replace the runtime dependency with a bundled JS/data implementation. Network installation is acceptable only as a documented interim state with honest UI and tests.

## Data and Failure Safety

- Song saves are atomic.
- Malformed JSON is quarantined or backed up before recovery; never overwritten silently.
- Schema normalization is versioned.
- A valid song index cannot produce `undefined`; persistence code narrows after lookup and fails clearly if the record disappears.
- Stale async worker/prosody results cannot overwrite a newer selection or song.
- Closing or navigating during a save either flushes pending changes or retains a recoverable local draft.
- No user-created song is replaced by demo data.

## Implementation Slices

### Slice 1 — foundation and identity

- Add explicit Lab purpose to current Artist OS workspace types and creation flow.
- Add compatibility migration from legacy name inference.
- Port Lab routes/navigation without replacing current shell behavior.

### Slice 2 — canonical persistence

- Port and repair shared Lab song types/repository.
- Add project/sequence repository.
- Add typed IPC/preload APIs.
- Add renderer query/state layer.

### Slice 3 — truthful UI

- Port Lab home, Songs, Sequence, and Song Pad.
- Remove sample/seed runtime data.
- Wire exact-song routing, saving, errors, and reload behavior.
- Add one-time legacy browser migration.

### Slice 4 — workers and tools

- Port Lab worker definitions and role routing.
- Apply defaults only on first initialization.
- Scope tool registration and handlers to Lab.
- Refresh UI after agent tool writes.

### Slice 5 — prosody

- Port IPC, preload, engine, resources, and Song Pad UI.
- Add first-run and recoverable failure states.
- Validate supported packaged paths.

### Slice 6 — generated assets and docs

- Port only required source skills/references.
- Regenerate bundled skills.
- Regenerate system maps.
- Update `docs/CURRENT.md`, handoff, and backlog truth from the live branch.

## Verification Gates

### Automated

- Shared Lab repository unit tests.
- Atomic write and malformed-store recovery tests.
- Browser-data migration tests: empty, canonical-only, legacy-only, collision, rerun/idempotence.
- Workspace-purpose migration and rename-stability tests.
- Creation-flow tests proving Artist OS root and explicit Lab purpose.
- Tool tests proving Lab allow and HQ/campaign deny at registration and handler layers.
- Worker activation tests proving first-run defaults and preserved user deactivation.
- Song UI state tests proving exact-song selection and canonical refresh after agent save.
- Sequence persistence/reload tests.
- Prosody selection, cancellation, missing-runtime, offline-install, and packaged-path tests.
- Route parser and channel-map parity tests.
- Full `bun run typecheck:all`.
- Full relevant test suites with zero failures.
- Main, preload, renderer, resources, and asset validation builds.
- `bun run lint:ipc-sends`.
- `git diff --check`.

### Integration regression

- HQ and campaign workspaces do not show Lab UI or Lab tools.
- Existing Artist OS profile packs, agents, automations, outputs, approvals, and background workers remain available.
- Workspace creation writes only beneath the Artist OS runtime root.
- No executable code introduces `.craft-agent` as a runtime path or fallback.
- Existing dirty work in the original Artist OS worktree is not modified or lost.

### Manual smoke

1. Click `Add Creative Lab`; confirm it creates and opens the one Lab directly under the Artist OS root, the add action disappears, a second Lab cannot be created, and Lab identity survives rename/restart.
2. Create a song, edit every pad area, reload, and restart; content survives.
3. Add songs to a project/sequence, reorder, reload; order survives.
4. Activate and deactivate a worker, restart; the choice survives.
5. Run a worker on one section, save an exact result, and confirm the same open song updates.
6. Open HQ/campaign and confirm Lab actions are absent.
7. Use prosody on first run, subsequent run, offline failure, and cancellation.
8. Confirm no files appear under general Runner, ScriptOS, Trade God, or `.craft-agent` roots.

## Definition of Ready to Integrate

The branch is ready only when:

- every critical contract above is implemented;
- full typecheck and required automated gates pass fresh;
- the original Artist OS isolation behavior is preserved by regression tests;
- an independent code review reports no critical or important integration blocker;
- remaining manual or packaged-platform checks are listed honestly as external smoke gates;
- the diff is split into reviewable commits and contains no unrelated worktree changes.
