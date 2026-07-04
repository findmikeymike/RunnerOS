---
status: implemented-v1
owner: agent
last_verified: 2026-07-04
source_of_truth: true
---

# HQ State Of Play / Proactive Routing

## Purpose

HQ State of Play turns workspace context into a deterministic operating brief for Artist HQ.

Shared Intel answers:

```text
What should this worker know?
```

HQ State of Play answers:

```text
Given everything Artist HQ knows, what should happen next?
```

The first production slice is intentionally controlled. It does not background-run agents by itself. It generates a next move, exposes a proactive mode toggle, validates route safety, and lets the user start the route from Artist HQ Home.

## User-Facing Behavior

Artist HQ Home now has a `State of Play` panel.

The panel shows:

- the recommended next move
- why it matters
- attention items
- missing context gaps
- momentum
- route readiness
- proactive mode toggle
- `Start Route` action when launch-safe

`Start Route` is enabled only when:

- proactive mode is on for the current workspace
- the route targets an agent
- the target agent is active/available
- the route has no blocker
- all requested context docs still exist and are enabled

If not safe, the panel stays readable but the launch action is disabled or fails with a concrete reason.

## Data Flow

```text
Workspace context docs
  -> deterministic HQ composer
  -> generated context doc: hq-state-of-play
  -> Artist HQ Home parses generated state
  -> proactive route helper validates readiness
  -> Start Route opens/sends target agent session
```

Refresh triggers:

- workspace context upsert/delete
- Shared Intel writes
- Artist Vault manifest mirror
- Google Calendar context sync

Refresh is best-effort. A failed derived refresh does not break the original user action, but it now emits a warning for diagnostics.

## Generated Context Doc

Slug:

```text
hq-state-of-play
```

Package export:

```text
@craft-agent/shared/hq-state
```

The body contains human-readable summary text plus fenced JSON:

````text
```json hq-state-of-play
{ ...HqStateOfPlay }
```
````

Treat this doc as derived state. Do not hand-edit it as source of truth. Regenerate from source context docs.

## Route Contract

The generated `nextMove.route` is a hint, not an unconditional command.

Important fields:

- `target`: `agent` or `manual`
- `agentSlug`: suggested target worker when applicable
- `action`: `draft`, `review`, `schedule`, `research`, `outreach`, `refresh`, or `organize`
- `prompt`: launch prompt for the target worker
- `confidence`: `high`, `medium`, or `low`
- `contextDocSlugs`: workspace context docs the worker should receive
- `blockedReason`: why the route should not launch yet

Do not confuse `contextDocSlugs` with external source slugs. These are workspace context document slugs, not tool/source connection slugs.

Backward compatibility: parser still accepts old generated JSON with `sourceSlugs`, but new generated state writes `contextDocSlugs`.

## Safety Rules

The proactive route is deliberately conservative.

- Missing or disabled context docs block launch.
- Missing target agent blocks launch.
- Manual/review-needed recommendations block launch.
- The proactive toggle is scoped per workspace in local storage.
- `Start Route` sends the generated prompt only after opening the validated target agent session.
- External actions still need explicit user approval through the normal agent/tool permission model.

## Key Files

Composer and contract:

- `packages/shared/src/hq-state/types.ts`
- `packages/shared/src/hq-state/composer.ts`
- `packages/shared/src/hq-state/index.ts`
- `packages/shared/package.json`

Refresh integration:

- `packages/server-core/src/hq-state/refresh.ts`
- `packages/server-core/src/handlers/rpc/workspace-context.ts`
- `packages/server-core/src/handlers/rpc/shared-intel.ts`
- `packages/server-core/src/handlers/rpc/artist-vault.ts`
- `packages/server-core/src/handlers/rpc/google-workspace.ts`

UI and launch readiness:

- `apps/electron/src/renderer/components/app-shell/ArtistHQHome.tsx`
- `apps/electron/src/renderer/lib/artist-hq-proactive.ts`

Tests:

- `packages/shared/src/hq-state/composer.test.ts`
- `packages/server-core/src/hq-state/refresh.test.ts`
- `packages/server-core/src/handlers/rpc/google-workspace.test.ts`
- `apps/electron/src/renderer/lib/artist-hq-proactive.test.ts`

## Verification

Last verified on 2026-07-04 with:

```bash
/Users/michaelb.williams/.bun/bin/bun test apps/electron/src/renderer/lib/artist-hq-proactive.test.ts packages/shared/src/hq-state/composer.test.ts packages/server-core/src/hq-state/refresh.test.ts packages/server-core/src/handlers/rpc/google-workspace.test.ts
(cd packages/shared && ../../node_modules/.bin/tsc --noEmit)
(cd packages/server-core && ../../node_modules/.bin/tsc --noEmit)
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun run typecheck:electron
git diff --check
```

Result at verification time:

- `19 pass`
- shared typecheck passed
- server-core typecheck passed
- Electron typecheck passed
- diff hygiene passed

## Remaining Gaps

Not yet verified in a live Electron window:

- visual spacing across narrow/wide Artist HQ layouts
- click-through `Start Route` from the running app
- whether all target worker cards are active in a fresh workspace

Not yet implemented:

- automatic background route execution
- route history/audit trail in the UI
- explicit "regenerate now" button for HQ State of Play
- richer scoring/evaluation of competing next moves

The next agent should not build automatic execution until the current user-controlled route path is visually smoked in the app.
