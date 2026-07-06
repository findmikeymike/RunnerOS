---
status: current
owner: agent
last_verified: 2026-07-05
source_of_truth: true
---

# Lab Workspace

Lab is the creative middle workspace between Artist HQ and Campaigns.

## Product Boundary

- Artist HQ = global artist context, planning, profile, voice, brand, vault, network, and state of play.
- Campaign = release execution space for a specific song, EP, rollout, or album.
- Lab = unfinished creative work: lyrics, references, research, song concepts, titles, themes, fragments, and idea pressure-testing.

Lab is not a campaign until the user decides the work is release-ready.

## First Slice

Lab workspaces are inferred from workspace name or slug:

- `lab`
- `song lab`
- `writing lab`
- `lyrics`
- `concept lab`
- `creative lab`
- `studio lab`

When active, a Lab workspace gets:

- `lab` route and Lab home overview surface.
- `lab/songs` route for the Songs tab.
- `lab/pad` route for the two-lane Song Pad.
- Lab-specific sidebar: Lab, Songs, Pad, Chat, Create, Drafts.
- Create group with Workers, Outputs, and Context.
- Home overview with one-click entry to Songs, Lyric Pad, Research, recent songs, and writing sparks.
- Songs tab with Song cards, `Add Song`, project filter, focus toggle, status filter, and recency sorting.
- Song Pad with editable Rough Pad, embedded Remember This area, and editable song structure sections.
- Lab default workers: Writer, Researcher, Content Genius, World Builder, Art Director, Record Doctor.
- Campaign detection excludes Lab so HQ project cards do not mistake Lab for the current release.
- Workspace rail anchors Artist HQ first, then Campaign spaces, then Lab spaces.
- Workspace rail add menu offers `New Campaign` and `New Creative Lab` with prefilled creation names.

## Current Code

- `apps/electron/src/renderer/lib/artist-workspace.ts`
- `apps/electron/src/shared/routes.ts`
- `apps/electron/src/shared/route-parser.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/renderer/components/app-shell/LabWorkspaceHome.tsx`
- `apps/electron/src/renderer/components/app-shell/LabSongsPage.tsx`
- `apps/electron/src/renderer/components/app-shell/LabSongPadPage.tsx`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/AgentsLaunchpad.tsx`

## Next Gaps

- Add explicit persisted workspace type instead of name inference.
- Replace prefilled-name workspace typing with explicit `campaign` / `lab` metadata when workspace type persistence exists.
- Replace placeholder song cards with real saved song docs.
- Replace placeholder Stories Worth Writing About with a research/trend source.
- Add Lab-scoped context templates for lyrics, references, concepts, and song notes.
- Add promotion path from Lab concept to Campaign mission brief.
