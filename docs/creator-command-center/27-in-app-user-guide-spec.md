---
status: proposed
owner: agent
last_verified: 2026-08-31
source_of_truth: true
---

# In-App Artist OS User Guide

## Decision

Replace the top-right `?` documentation dropdown with a large in-app guide called **Artist OS Guide**.

The guide has three tabs:

1. **General** — setup, shared concepts, safety, and common actions.
2. **HQ** — the artist-wide home base and reusable artist knowledge.
3. **Campaigns** — release planning, unfinished work, approved assets, jobs, and approvals.

This is a fast-start guide, not an exhaustive manual. It should teach enough for a new user to complete setup, understand where work belongs, and begin using Artist OS without leaving the app.

## Product Goal

A first-time user should be able to answer these questions in under five minutes:

- What must I connect before agents can work?
- What belongs in HQ versus a Campaign?
- Where do I talk to the manager or a specialist?
- Where do I plan work, see unfinished work, and find approved assets?
- What can the app do automatically, and what still needs approval?

## Surface And Layout

### Desktop

- Open from the existing top-right `?` button.
- Render as a dialog-backed floating panel aligned near the top-right of the app.
- Target width: `720–760px`.
- Target height: `min(82vh, 760px)`.
- Use the established dark Artist OS glass surface, restrained border, and one internal scroll area.
- Do not cover the entire window on a normal desktop display.

### Compact windows

- At widths below `760px`, use a full-window sheet/dialog with safe edge padding.
- Keep the tab bar and close control visible while content scrolls.

### Structure

The panel contains:

1. Sticky header: **Artist OS Guide**, one-line purpose, close button.
2. Sticky segmented tabs: **General / HQ / Campaigns**.
3. Tab body with three predictable sections:
   - **Start here** — a short ordered checklist.
   - **Where to go** — compact page/action rows with a direct button.
   - **Common questions** — small accordions for the few concepts that need explanation.
4. Footer: one **Still stuck? Ask Command** action.

Avoid oversized cards, nested boxes, screenshot carousels, long prose, and hover-only explanations. Each row should have an icon, title, one short sentence, and optional action.

## Opening Behavior

- From an HQ workspace, first open defaults to **HQ**.
- From a Campaign workspace, first open defaults to **Campaigns**.
- From Lab or another workspace, first open defaults to **General**.
- After a user manually selects a tab, remember it for the rest of the app session.
- Reopening the guide returns each tab to the top. Do not preserve deep scroll positions.
- `Escape` closes the guide. Clicking a guide action closes it and navigates to the destination.

## Content Rules

- Lead with the action, then explain why.
- Use the exact current UI labels: `AI`, `Connections`, `Social Accounts`, `HQ`, `People`, `Work`, `Command`, `Brain`, `Campaign`, `Plan`, `Essentials`, and `Release Kit`.
- Keep explanations to one or two sentences.
- Show no more than six primary items in one section.
- Define product terms once in plain language.
- Never imply that adding a connection grants permission to publish, spend, send, or delete.
- Never claim a provider is ready from the presence of a saved field alone.
- Do not teach hidden or unfinished navigation. In particular, do not present HQ Plan as a sidebar destination while `SHOW_HQ_PLAN_NAV` is false.

## General Tab

### Start here

1. **Connect an AI model**  
   Open `Settings → AI`. Add at least one supported provider, verify it, and choose the model you want agents to use.

2. **Connect only the services you use**  
   Open `Settings → Connections`. Explain that API keys and tools unlock specific abilities; users do not need every integration.

3. **Connect artist accounts**  
   Provide separate actions for `Social Accounts`, `Spotify`, and `Ad Accounts`. State that an account must be verified before dependent work can run.

4. **Choose safety and approval behavior**  
   Open `Settings → Permissions`. Explain in one sentence that reading and drafting can be low-risk while public posts, sends, spending, deletion, and other external actions require the configured approval boundary.

5. **Give agents the artist truth**  
   Send the user to HQ `Profile`, `Voice`, and `Branding`. Explain that these are reusable instructions and facts agents should use across campaigns.

### Where to go

| Item | Guide copy | Action |
| --- | --- | --- |
| Command | Talk to the manager, ask questions, or begin a job in a normal chat. | Open Command |
| Workers | Browse specialists. Selecting one starts a chat with that worker. | Open Workers |
| Workflows | Run or inspect a repeatable multi-step process. | Open Workflows |
| Automations | Schedule or trigger repeatable work. | Open Automations |
| Outputs | Find durable work produced by agents and workflows. | Open Outputs |
| Creative Lab | Develop songs and projects before they become campaign work. | Open Lab when available |

### Common questions

- **Worker, Workflow, or Automation?**  
  A Worker is a specialist you talk to. A Workflow is a saved sequence. An Automation decides when a repeatable action runs.

- **Where did my work go?**  
  Chats preserve the conversation; Outputs hold durable deliverables. Approved campaign assets belong in that campaign's Release Kit.

- **What does connecting a tool allow?**  
  It makes the capability available. Permission and approval rules still decide whether an external action may execute.

- **What is Goal Mode?**  
  A bounded long-running objective inside one chat. It can continue in rounds, but external or public actions still obey approval rules.

## HQ Tab

### Start here

1. Complete **Profile** with artist identity, positioning, audience, and current priorities.
2. Define **Voice** so agents know how the artist should sound.
3. Add reusable **Branding** and **Intel Docs**.
4. Add important relationships in **People**.
5. Connect Spotify, social, and research sources before using the related Pulse features.
6. Create or open a Campaign when work becomes specific to one release.

### Where to go

| Page | What it is for | Action |
| --- | --- | --- |
| HQ | Artist-wide status, next moves, release horizon, signals, and active work. | Open HQ |
| People | Managers, collaborators, press, partners, and other useful relationships. | Open People |
| Work → Workers | Artist-wide specialists available across releases. | Open Workers |
| Work → Workflows | Reusable processes that are not tied to one campaign. | Open Workflows |
| Work → Automations | Ongoing or recurring artist-wide work. | Open Automations |
| Command | The HQ manager chat for routing, questions, and delegation. | Open Command |
| Brain | Profile, Voice, Intel Docs, Branding, and Vault — the reusable artist truth. | Expand Brain |

### Essential concepts

- **HQ versus Campaign**  
  Put reusable artist identity, relationships, long-term direction, and shared assets in HQ. Put one release's dates, jobs, unfinished work, and approved release assets in its Campaign.

- **Pulse panels**  
  Spotify, social, and intel panels depend on their connections. Starting a Pulse begins work; it does not mean the result is already complete.

- **Vault**  
  The HQ Vault contains reusable artist assets and references. It is not the same as a campaign Release Kit.

- **Release horizon**  
  HQ gives a compact strategic view of current and upcoming releases. Detailed day-to-day scheduling belongs in each Campaign.

## Campaigns Tab

### Start here

1. **Set the campaign context and release date.**  
   The release date powers the countdown and helps the campaign surface what matters next.

2. **Review Campaign overview.**  
   Check days to release, team, active workers, and approvals without turning the overview into a second work board.

3. **Build the Plan.**  
   Put operational dates, events, agent jobs, and scheduled work on the campaign calendar.

4. **Finish Essentials.**  
   Use Essentials as the release checklist. Cue the relevant worker from an unfinished item where available.

5. **Approve finished assets into Release Kit.**  
   Release Kit is the trusted source for approved campaign audio, Single Art, videos, press/social images, and plans.

6. **Watch approvals and attention states.**  
   Review sensitive actions, failed jobs, and work that needs a decision before assuming the campaign is finished.

### Where to go

| Page | What it is for | Action |
| --- | --- | --- |
| Campaign | Compact release overview: countdown, team, active workers, and approvals. | Open Campaign |
| Plan | Operational calendar for events, jobs, deadlines, and scheduled work. | Open Plan |
| Essentials | Unfinished release requirements and worker cues. | Open Essentials |
| Release Kit | Approved, hashed campaign assets agents can trust and use. | Open Release Kit |
| Work → Workers | Specialists available in the current campaign context. | Open Workers |
| Workflows / Automations | Repeatable campaign processes and scheduled triggers. | Open Workflows or Automations |
| Command | Campaign-aware manager chat. | Open Command |

### Calendar and jobs

- Click a day and choose **Add event** for a date or reminder that does not run an agent.
- Choose **Add job** for scheduled work performed by an agent or workflow.
- A job needs a title and time. The composer collects the worker/workflow, instructions, inputs, review behavior, and schedule.
- Click an existing calendar item to open its details. Manual items can be edited; scheduled work exposes the controls appropriate to its current state.
- `Needs approval`, `Awaiting review`, `Failed`, and `Missed` are attention states, not successful completion.
- Deleting a calendar item must not be described as deleting its underlying output or Release Kit asset.

### Essential concepts

- **Essentials versus Release Kit**  
  Essentials shows what is unfinished. Release Kit contains what has been explicitly approved as final.

- **Plan versus Automation**  
  Plan contains dated campaign events and jobs. Automations are reusable triggers or schedules; they are not a second campaign calendar.

- **Approved asset use**  
  Agents should use the verified Release Kit snapshot, not a mutable draft or Output. A changed or missing file must be shown as needing review, not ready.

- **Sensitive execution**  
  Scheduling, posting, outreach, spending, or other external work must show the exact account, content, timing, and required authorization before execution.

## Setup Status

The first version may show status chips only when readiness can be verified through an existing source of truth:

- `Ready` — a real validation or account-ready result exists.
- `Needs setup` — the product can prove the required configuration is absent.
- `Check setup` — configuration exists but has not been verified.

Do not infer `Ready` merely because a key, model name, or account row exists. If a dependable readiness API is unavailable, omit the status and show the navigation action instead.

## Architecture

Keep guide content data-driven rather than embedding a large manual directly in JSX.

```ts
type ArtistGuideTabId = 'general' | 'hq' | 'campaigns'

type ArtistGuideActionId =
  | 'settings.ai'
  | 'settings.connections'
  | 'settings.social-accounts'
  | 'settings.spotify'
  | 'settings.ad-accounts'
  | 'settings.permissions'
  | 'hq.home'
  | 'hq.people'
  | 'hq.profile'
  | 'hq.voice'
  | 'hq.branding'
  | 'hq.vault'
  | 'campaign.home'
  | 'campaign.plan'
  | 'campaign.essentials'
  | 'campaign.release-kit'
  | 'workspace.workers'
  | 'workspace.workflows'
  | 'workspace.automations'
  | 'workspace.command'
  | 'app.outputs'

type ArtistGuideItem = {
  id: string
  title: string
  body: string
  action?: ArtistGuideActionId
  actionLabel?: string
}
```

Suggested ownership:

- `ArtistGuideDialog.tsx` — dialog, tabs, responsive behavior, focus management.
- `artist-guide-content.ts` — typed guide copy and ordering.
- `artist-guide-navigation.ts` — action IDs mapped to existing routes/callbacks.
- `artist-guide-readiness.ts` — optional, honest setup checks only.
- `AppShell.tsx` — owns open state, derives workspace context, executes navigation.
- `TopBar.tsx` — changes the current `?` dropdown into one `onOpenUserGuide` button.

The guide is not a directory of utility links. Existing documentation and shortcut settings can remain available elsewhere in the product, but they do not appear inside this essential guide.

## Accessibility

- Use dialog semantics with a labelled title and description.
- Trap focus while open and restore focus to the `?` button on close.
- Use proper tab/list/tab-panel semantics; arrow keys move between tabs.
- All actions must work by keyboard and expose visible focus.
- Do not rely on color alone for readiness or warnings.
- Announce asynchronous readiness changes without stealing focus.
- No instruction may require hover to understand or use.

## Non-Goals For V1

- A searchable documentation website inside the app.
- A forced onboarding tour or blocking first-run wizard.
- Screenshot or video walkthroughs that quickly become stale.
- Documentation for every integration, advanced setting, worker, or workflow.
- Generic documentation and keyboard-shortcut link lists.
- Analytics, completion gamification, or a permanent unread badge.
- A fourth Lab tab. Lab receives a concise General entry until its guide scope warrants a separate decision.
- Implementing capabilities that the guide discovers are missing.

## Delivery Slices

### Slice 1 — Shell and navigation

- Add typed content and action registry.
- Add `ArtistGuideDialog`.
- Replace the top-right help dropdown with the guide trigger.
- End the guide with one clear `Ask Command` escape hatch.

### Slice 2 — General setup

- Add General content and direct settings links.
- Add only readiness checks backed by existing verified state.
- Add the Command help action.

### Slice 3 — HQ and Campaigns

- Add the grounded page descriptions above.
- Add contextual default-tab behavior.
- Wire every navigation action to current routes.

### Slice 4 — Hardening

- Keyboard and screen-reader tests.
- Compact-window behavior.
- Route/action regression tests.
- Live Electron smoke in HQ, Campaign, and Lab workspaces.

## Acceptance Criteria

1. The top-right `?` opens the Artist OS Guide instead of the old external-link dropdown.
2. HQ, Campaign, and other workspaces open the correct contextual tab on first use.
3. General, HQ, and Campaigns are fully usable by mouse and keyboard.
4. Every visible action navigates to a real current destination and closes the guide.
5. The guide never teaches hidden HQ Plan navigation.
6. Setup statuses never report `Ready` without a dependable validation signal.
7. The copy clearly distinguishes HQ from Campaign, Worker from Workflow from Automation, and Essentials from Release Kit.
8. The guide contains no peripheral utility-link clutter; its only footer action is `Ask Command`.
9. The panel remains readable in a compact Electron window without clipped controls or nested page scrolling.
10. A manual smoke confirms open, close, tab switching, focus return, settings deep links, HQ links, Campaign links, and Ask Command in the running canonical Artist OS build.
