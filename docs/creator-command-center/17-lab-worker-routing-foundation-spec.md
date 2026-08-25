---
status: draft
owner: agent
last_verified: 2026-07-07
source_of_truth: true
---

# Lab Worker Routing Foundation

## Purpose

Creative Lab needs a routing layer before the final Lab agent roster is complete.

Do not hardcode today’s workers into the Song Pad workflow. More specialists are coming, including section-specific agents such as Chorus Writer. The foundation should let the app route by creative need, song section, user preference, and available workspace agents.

## Core Principle

```text
Song Pad actions target creative roles.
Workspace manifests decide which agents can fill those roles.
Users can override the route when choice matters.
```

This keeps the product flexible while the Lab roster grows.

## Non-Goals

- Do not build a permanent `Reverse Magic -> Legendary Writer` chain yet.
- Do not assume the final Lab roster is known.
- Do not make one generic hidden `lyric-agent` the long-term model.
- Do not show global library agents in Lab worker flows unless activated in that Lab workspace.
- Do not make the UI feel like Campaign planning.

## Routing Model

Introduce a small role contract independent of specific agent slugs.

Initial role keys:

- `lyrics.generate`
- `lyrics.review`
- `lyrics.rewrite`
- `lyrics.section.chorus`
- `lyrics.section.verse`
- `lyrics.section.bridge`
- `song.concept`
- `song.reference`
- `producer.handoff`
- `research.reference`

These are capabilities, not UI labels. They can map to current or future agents.

## Agent Capability Mapping

Each Lab worker should declare the Lab roles it can satisfy.

Current provisional mapping:

| Agent | Roles |
| --- | --- |
| `reverse-magic` | `lyrics.generate`, `song.reference`, `song.concept` |
| `legendary-writer` | `lyrics.review`, `lyrics.rewrite`, `lyrics.section.verse`, `lyrics.section.bridge` |
| `record-doctor` | `producer.handoff` |

Future examples:

| Future Agent | Likely Roles |
| --- | --- |
| `chorus-writer` | `lyrics.section.chorus`, `lyrics.rewrite` |
| `hook-doctor` | `lyrics.section.chorus`, `song.concept` |
| `bridge-builder` | `lyrics.section.bridge`, `lyrics.rewrite` |

The system should support multiple agents per role.

## Song Pad Behavior

Song Pad should ask for a role, not a fixed worker.

Examples:

- `Suggest lines` -> `lyrics.generate`
- `Review this` -> `lyrics.review`
- `Make stronger` -> `lyrics.rewrite`
- Chorus section actions -> prefer `lyrics.section.chorus`
- Bridge section actions -> prefer `lyrics.section.bridge`
- Producer handoff -> `producer.handoff`

If exactly one active Lab worker can handle the role, route directly.

If multiple active workers can handle it, show a compact chooser.

If no active worker handles it, show a clear empty state:

```text
No active Lab worker handles this yet.
Add one from Manage Library.
```

## User Choice

The chooser should be lightweight, not a big workflow builder.

Show:

- recommended worker
- alternate active workers
- short reason for each choice

Example:

```text
Polish Chorus
Recommended: Chorus Writer
Also available: Legendary Writer
```

The user should be able to set a default later, but the first pass can remember nothing.

## Context Packet

Every Lab route should receive the same compact context packet:

- workspace id
- workspace name
- song title
- target section id and label
- target section text
- full song sections
- rough pad text
- remember text
- artist profile summary from HQ, when available
- selected text, when available
- requested role
- requested action label

The context packet should be stable even if the receiving agent changes.

## Execution

Use saved Lab workers, not an anonymous custom prompt, when possible.

Preferred path:

1. Resolve role to active Lab worker candidates.
2. Pick direct route or show chooser.
3. Start a hidden child session for the chosen worker.
4. Send the context packet and action prompt.
5. Return output to the existing Song Pad result panel.
6. Let the user `Insert`, `Replace`, or `Remember`.

Longer term, this can use `message_agent` from an orchestrating Lab worker, but the UI should not require that chain until the roster is stable.

## Workspace Policy

Lab routing must respect workspace activation.

- Active Lab worker list comes from the Lab workspace manifest.
- Manage Library remains global.
- HQ and Campaign worker lists must not be changed by Lab routing.
- Global built-ins must not be force-injected into Lab.

## Implementation Shape

Likely files:

- `apps/electron/src/renderer/components/app-shell/LabSongPadPage.tsx`
- `apps/electron/src/renderer/components/app-shell/LabWorkspaceHome.tsx`
- `apps/electron/src/renderer/hooks/useAgents.ts`
- `apps/electron/src/renderer/lib/artist-workspace.ts`
- `packages/shared/src/agent-definitions/starter-templates.ts`

Likely new shared helper:

```text
lab-worker-routing.ts
```

Responsibilities:

- define role keys
- map agent slugs to roles
- resolve candidates from active workspace agents
- choose the best default for a section/action
- return chooser metadata for UI

## Acceptance Criteria

- Song Pad actions route through Lab roles, not hardcoded agent slugs.
- Current agents can be mapped without changing the visible UI much.
- Future agents can be added by mapping roles, not rewriting Song Pad logic.
- Multiple candidates produce a compact user choice.
- No candidate produces a clear Manage Library path.
- Lab worker scope still shows only workspace-activated Lab workers.
- Existing HQ and Campaign worker behavior remains unchanged.

## First Build Slice

Do this before adding more agent-specific flows:

1. Add route-role types and candidate resolution helper.
2. Replace the anonymous `lyric-agent` concept with role-based routing metadata.
3. Keep the existing Song Pad result popover.
4. Support one direct route and one chooser case.
5. Add tests for role resolution and Lab worker scope.
