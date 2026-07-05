---
status: backlog
owner: product
last_verified: 2026-07-05
source_of_truth: false
---

# Multi-World Artist Spaces Future Spec

## Current Decision

Do not build this yet.

RunnerOS / Creator Command Center should first finish the single-world experience:

- HQ feels clear.
- Campaign workspace feels clear.
- Workers page is useful.
- Work Products and approvals show up in widgets.
- State of Play knows what matters.
- Agents can create durable Outputs.
- Service keys and account bindings are understandable.

Only after that should we add multiple worlds.

Reason: multi-world support multiplies every core system. If HQ, campaigns, workers, outputs, approvals,
context, and keys are not solid in one world, duplicating them across many worlds will create confusion.

## Product Thesis

The user should be able to run multiple artist lives, side projects, brands, or managed clients inside one
app without cloning the whole app or mixing context.

The app should feel like:

```text
Portfolio App
  World / Artist Space
    HQ
    Campaigns
    Vault
    Workers
    Outputs
```

Not:

```text
One giant chat list with labels
```

Not:

```text
Separate app install per artist
```

Not:

```text
Copy every API key and agent setup into every artist
```

The clean model is:

```text
Global shell = switch between worlds.
World = one artist, brand, side project, or managed client.
Bottom-left folder nav = move inside the current world.
```

## Naming

Use `World` in technical architecture if it stays simple.

Use `Artist Space` or `Workspace` in user-facing copy if `World` feels too abstract.

Recommended user-facing hierarchy:

```text
All Worlds
  Artist Space
    HQ
    Campaigns
```

Examples:

- Mikey Williams
- Side Project A
- Client: Luna Vale
- Band: Night Archive
- Label Roster

## Core Mental Model

### Top-left control

The existing small top-left plus / new-chat area from the original Craft Agents shell should eventually
become the World Switcher.

It should answer:

```text
Which world am I operating in?
Where can I jump next?
What needs attention across all worlds?
```

### Bottom-left folder nav

The existing bottom-left folder nav stays.

It should answer:

```text
Inside this world, where do I want to work?
```

Examples:

- HQ
- Campaigns
- Vault
- Workers
- Outputs
- Automations
- Sources

This nav should not become the world switcher. It is already useful for flipping HQ to campaign and back.

### Scope badge

Every major screen should quietly show the current scope:

```text
Mikey Williams > HQ
Mikey Williams > Campaign: Blue Moon
Luna Vale > Workers
```

The user should never wonder which artist or project an agent is using.

## Why This Is Future Work

Multi-world support touches:

- data model
- credentials
- agent context
- Outputs
- approvals
- State of Play
- campaign routing
- automations
- worker runs
- file storage
- team permissions
- billing / usage attribution
- search
- recents
- deletion / export

If built too early, it becomes a mess of scope bugs.

The right move is to first make one world excellent, then make world scope a first-class layer underneath.

## Related Current Specs

This spec builds on these existing docs:

- [HQ State Of Play / Proactive Routing](../creator-command-center/09-hq-state-of-play-proactive-routing.md)
- [Work Products / Output Architecture](../creator-command-center/10-work-products-output-architecture-spec.md)
- [HQ Homebase Architecture](../creator-command-center/04-hq-homebase-architecture-spec.md)
- [Project Spaces Spec](../project-spaces/01-spec.md)
- [Shared Intel Context Router](../creator-command-center/08-shared-intel-context-router-spec.md)
- [Artist Vault Architecture](../creator-command-center/07-artist-vault-architecture-spec.md)
- [Global Sources](../global-sources/00-README.md)
- [Workflows](../workflows/README.md)

## Definitions

### Portfolio App

The top-level app the user logs into.

It owns:

- user account
- global service credentials
- global skill catalog
- global worker templates
- all worlds
- cross-world search
- cross-world approvals
- all running work
- billing / usage

### World / Artist Space

A self-contained operating realm for one artist, brand, side project, client, or managed entity.

It owns:

- artist profile
- voice / brand context
- campaigns
- world-level Vault
- world-level workers
- world-level memories
- world-level Outputs
- world-level State of Play
- account bindings for that artist

### HQ

The main command surface inside one world.

It answers:

```text
What matters right now for this artist?
What needs approval?
What was recently made?
Which worker should I use?
```

### Campaign

A child operating space inside a world.

It owns:

- campaign brief
- campaign assets
- campaign workers
- campaign Outputs
- campaign approvals
- campaign State of Play

### Session

A chat or agent run conversation.

Sessions are audit trails and working rooms. They are not the durable product surface.

### Work Product / Output

A durable deliverable created by a session, worker, workflow, automation, or tool.

Outputs are what the user returns to, approves, exports, posts, previews, or hands to another worker.

### Approval

A decision state on an Output.

Approval is not a separate product object in V1. It is an Output state.

### Agent / Worker

A worker is an activated agent inside a world or campaign.

A worker template can be global. A worker activation is scoped.

## Non-Goals

Do not do these in the first multi-world pass:

- Do not duplicate the full app folder per artist.
- Do not rely on chat-session labels as the main world model.
- Do not copy API keys into each world.
- Do not let worlds silently share memory.
- Do not make every campaign its own world.
- Do not add a heavy organization admin console before the solo/manager use case works.
- Do not make world switching replace HQ/campaign navigation.
- Do not make approvals live inside old chats.
- Do not expose raw technical IDs in the UI.
- Do not build a complex taxonomy before the simple world/campaign/output model works.

## Core Product Laws

1. A world is a hard context boundary.
2. Bottom-left nav moves inside the current world.
3. Top-left switcher changes worlds.
4. Agents always know the active world.
5. Outputs always know their world.
6. Approvals always show where they will act.
7. Credentials are global; account bindings are scoped.
8. Memory does not cross worlds by default.
9. Portfolio views summarize; world views operate.
10. No important work should be trapped in an old chat.

## User Stories

### Artist with side project

The user has a main artist identity and a separate side project.

They need:

- separate HQs
- separate campaigns
- separate voice / brand memory
- separate social account bindings
- ability to reuse some global tools and keys
- optional link between the two identities

The app should support:

```text
Mikey Williams
Side Project: Tape Ghost
```

The two should not leak voice, captions, contacts, or assets unless explicitly shared.

### Manager with multiple artists

The user manages several artists.

They need:

- fast switching
- global approval tray
- global running-work tray
- per-artist account bindings
- one credential vault
- team access by artist
- usage/cost visibility by artist

The app should support:

```text
All Worlds
  Mikey Williams
  Luna Vale
  Night Archive
```

### Agency / label operator

The user may have a roster.

They need:

- portfolio-level dashboard
- filters by artist, campaign, urgency, worker, approval state
- concurrent background work
- strict permissions
- audit trails

This is later than solo/manager, but the architecture should not block it.

## UX Architecture

### App frame

Recommended layout:

```text
Top-left:  World Switcher
Left nav:   Current world's surfaces
Main:       Active surface
Right rail: Optional contextual widgets
Global tray: approvals / running work / notifications
```

### World Switcher

The top-left switcher should show:

- current world avatar or initials
- current world name
- chevron

Dropdown sections:

- Search worlds
- Recently opened
- Favorites
- Needs approval
- Running now
- All worlds
- Add world
- Archived worlds

It should not be a generic new-session menu anymore.

### World Switcher row design

Each world row should show:

- world name
- type: artist, side project, client, roster, brand
- active campaign count
- pending approvals count
- running workers count
- stale warning if context is old

Example:

```text
Mikey Williams
2 approvals - 1 worker running - Campaign: Blue Moon
```

### Add World wizard

Keep this short.

Step 1:

```text
What is this world?
Artist / Side Project / Client / Brand / Other
```

Step 2:

```text
Name
Avatar optional
```

Step 3:

```text
Starter setup
Blank / Artist HQ starter / Import from another world
```

Step 4:

```text
Connect accounts now?
Skip / Connect later / Use existing credential
```

Do not force service setup during world creation.

### All Worlds page

The All Worlds page is the portfolio dashboard.

It should show:

- worlds list
- recent activity
- pending approvals
- active workers
- upcoming campaign dates
- failed/stuck automations
- stale context warnings

This page is for scanning across worlds, not doing deep work.

Clicking a world opens that world's HQ.

### Current world home

Each world opens to HQ by default.

HQ should show:

- State of Play
- Needs Approval
- Recent Work Products
- active campaigns
- starter workers
- context gaps

### Campaign switching

Inside a world, the bottom-left folder nav or campaign surface handles campaign switching.

World switcher should not show every campaign by default, unless the campaign has urgent work.

### Recents

Recents should include:

- recently opened worlds
- recently opened campaigns
- recently viewed Outputs
- recently used workers

Rows should include scope:

```text
Blue Moon campaign - Mikey Williams
Cover Art v2 - Luna Vale
```

### Search

Search defaults to the current world.

It should include an escape:

```text
Search all worlds
```

Global search results must show world badges.

Never show a result without its world.

## Data Architecture

### Scope IDs

Every important object needs explicit scope.

Minimum:

```ts
type ScopeRef = {
  worldId: string
  campaignId?: string
}
```

For global-only records:

```ts
type GlobalScope = {
  scope: 'global'
}
```

For world-level records:

```ts
type WorldScope = {
  scope: 'world'
  worldId: string
}
```

For campaign-level records:

```ts
type CampaignScope = {
  scope: 'campaign'
  worldId: string
  campaignId: string
}
```

### Records that need world scope

Add `worldId` to:

- sessions
- agent runs
- workflow runs
- automation runs
- Outputs
- approvals
- context docs
- memory entries
- Vault assets
- campaign records
- account bindings
- source bindings
- worker activations
- notifications
- audit events
- locks
- background jobs

Add `campaignId` only when the record is campaign-specific.

### Records that stay global

These can stay global:

- user account
- installed skill catalog
- worker templates
- service credentials
- provider definitions
- global app settings
- billing subscription
- global usage ledger
- global feature flags

### Suggested file layout

Current RunnerOS is workspace/file friendly. A future local layout could be:

```text
app-root/
  worlds/
    <world-id>/
      world.json
      context/
      memory/
      vault/
      outputs/
      workers/
      campaigns/
        <campaign-id>/
          campaign.json
          context/
          vault/
          outputs/
          workers/
  global/
    credentials/
    worker-templates/
    skill-catalog/
    usage/
```

If the actual runtime uses a DB, the same shape still applies logically.

### World manifest

Each world needs one durable manifest:

```json
{
  "schemaVersion": 1,
  "id": "world_mikey",
  "name": "Mikey Williams",
  "kind": "artist",
  "status": "active",
  "avatar": null,
  "createdAt": "2026-07-05T00:00:00.000Z",
  "updatedAt": "2026-07-05T00:00:00.000Z",
  "favorite": true,
  "linkedWorldIds": [],
  "starterTeam": "artist-hq",
  "defaultCampaignId": null
}
```

### Campaign manifest

Campaigns stay children of worlds:

```json
{
  "schemaVersion": 1,
  "id": "campaign_blue_moon",
  "worldId": "world_mikey",
  "name": "Blue Moon",
  "kind": "single-release",
  "status": "active",
  "createdAt": "2026-07-05T00:00:00.000Z",
  "updatedAt": "2026-07-05T00:00:00.000Z"
}
```

### Why not use labels only

Labels are useful for organizing sessions.

They are not enough for worlds because worlds require:

- credentials
- memory boundaries
- permissions
- account bindings
- Outputs
- approvals
- folder roots
- active worker rosters
- State of Play
- lifecycle state

Labels can remain helpful under the hood, but `worldId` must be first-class.

## Credentials And Service Accounts

### Core rule

Credentials are stored once globally.

Worlds receive scoped bindings to those credentials.

Example:

```text
Google OAuth credential: global
Mikey Drive folder binding: world_mikey
Luna Drive folder binding: world_luna
```

### Credential vault

The global encrypted vault owns:

- OpenAI key
- Anthropic key
- Fal key
- Google OAuth
- Resend key
- Inworld key
- Meta token
- TikTok token
- Shopify token
- other provider credentials

Worlds should not duplicate secret values.

### Account binding

Each world stores account/profile choices:

```json
{
  "worldId": "world_mikey",
  "provider": "instagram",
  "credentialId": "cred_meta_main",
  "externalAccountId": "178414...",
  "displayName": "@mikey",
  "status": "connected",
  "permissions": ["read", "draft", "publish_requires_approval"]
}
```

### Approval copy

Any approval that can touch the outside world must show:

```text
World: Mikey Williams
Destination: Instagram @mikey
Action: Schedule post
```

This prevents wrong-artist posting.

### Shared manager accounts

A manager may use one Gmail or Google account across many artists.

That is fine if each world has its own binding:

- sender alias
- Drive folder
- Calendar
- contact group
- brand profile

The app should never assume one OAuth account means one world.

## Agents, Workers, And Skills

### Global templates

Skills and worker templates are global app assets.

Examples:

- Content Genius
- Captions and Overlays
- Artist Comms Strategist
- Industry Hunter
- Art Director
- HNIC

### Scoped activation

Activating a worker creates a scoped worker instance.

Example:

```json
{
  "activationId": "worker_activation_123",
  "worldId": "world_mikey",
  "campaignId": "campaign_blue_moon",
  "agentSlug": "content-genius",
  "skills": ["captions-and-overlays"],
  "status": "active"
}
```

### Starter teams

Creator Command Center can provide starter teams.

Example world starter team:

- HNIC / Chief of Staff
- Content Genius
- Artist Comms Strategist
- Artist Visual World Director
- Industry Hunter
- Record Doctor

Example campaign starter team:

- Campaign Strategist
- Content Genius
- Captions and Overlays
- Art Director
- Outreach / Comms

The Workers page should show activated workers for the current world or campaign.

### Worker context packet

Every agent run should receive a compact scope packet:

```text
Current world: Mikey Williams
World id: world_mikey
Current surface: Campaign
Campaign: Blue Moon
Campaign id: campaign_blue_moon
Allowed accounts: Instagram @mikey, Gmail mikey@...
Do not use context from other worlds unless explicitly provided.
```

### HNIC awareness

HNIC should know:

- current world State of Play
- current campaign State of Play if inside a campaign
- pending approvals in scope
- recent Outputs in scope
- active worker runs in scope
- relevant context docs

HNIC should not receive:

- every Output in every world
- every memory across all artists
- global credential secrets
- other worlds by default

For cross-world views, use a compact portfolio summary.

## Context, Memory, And State Of Play

### Memory scopes

Recommended hierarchy:

```text
Global user preferences
  World memory
    Campaign memory
      Session memory
```

Default behavior:

- global preferences can inform all worlds
- world memory stays inside the world
- campaign memory stays inside the campaign
- session memory stays in the session unless promoted

### Shared Intel

Shared Intel defaults to the current world and current campaign.

If the user wants to share across worlds, they should explicitly choose:

```text
Share to another world
Share to linked world
Share globally
```

Do not auto-share.

### State of Play

Each world gets its own:

```text
hq-state-of-play
```

Each campaign can have its own:

```text
campaign-state-of-play
```

Later, portfolio can have:

```text
portfolio-state-of-play
```

Portfolio State of Play should be a summary only:

- urgent approvals
- running work
- upcoming deadlines
- blocked automations
- stale worlds

It should not merge artist strategy.

## Outputs, Approvals, And Artifacts

### Output scope

The current Output model should expand from:

```ts
context?: {
  scope: 'hq' | 'campaign'
  campaignId?: string
}
```

To:

```ts
context: {
  worldId: string
  scope: 'hq' | 'campaign'
  campaignId?: string
}
```

### Where Outputs live

Options:

1. Store Outputs under each world folder.
2. Store all Outputs globally and index by `worldId`.

Recommended local-first model:

```text
worlds/<world-id>/outputs/<output-id>/
```

Reason: export, archive, and backup are easier when a world owns its deliverables.

If the runtime uses shared storage later, preserve the logical ownership with `worldId`.

### Widgets

Current world HQ widget:

- Needs Approval for current world
- Recent Work for current world
- optionally newest campaign Outputs from that world

Campaign widget:

- Needs Approval for current campaign
- Recent Work for current campaign

Portfolio widget:

- Needs Approval across all worlds
- Running work across all worlds
- newest high-signal Outputs across all worlds

### Same widget or different widgets

Inside HQ and campaign:

Use one Work Products widget with two sections:

```text
Needs Approval
Recent Work
```

Across all worlds:

Use a global tray or portfolio panel:

```text
Needs Approval
Running Now
Recent Work
```

This keeps the product simple.

### Click behavior

Clicking an Output should open an in-place drawer.

Do not send the user to old chat by default.

Drawer shows:

- preview
- title
- world
- campaign if any
- producing worker
- approval state
- files/assets
- receipts
- open in Canvas if visual
- link to session history as secondary action

### Visual artifacts

If visual:

- image
- video
- deck
- web preview
- canvas layout
- cover art

The drawer should show a large preview.

`Open in Canvas` should route it to the Artifact Canvas / visual display surface.

The Output remains the durable object. Canvas is the inspection/editing surface.

### Approvals

Approvals should never require opening past chat sessions.

Approval surfaces:

- world HQ Work Products widget
- campaign Work Products widget
- global portfolio approval tray

Approval actions:

- approve
- request changes
- reject / archive
- publish / schedule after approval, if applicable

Publishing is separate from approval unless policy explicitly allows auto-send.

### Output index

Each world should have a compact `output-index` context doc.

Each campaign can have a compact campaign output index.

Portfolio can have a global summary index.

Agents read indexes, not every full output manifest.

## Concurrent Agents And Background Work

### Run identity

Every run needs:

```ts
type AgentRunScope = {
  runId: string
  worldId: string
  campaignId?: string
  sessionId?: string
  agentSlug: string
  startedBy: 'user' | 'automation' | 'workflow' | 'agent'
}
```

### Running work views

Per-world HQ:

- workers running in this world
- workers running in this world's campaigns

Campaign:

- workers running in this campaign

Portfolio:

- all running work
- grouped by world
- urgent/stuck first

### Resource locks

Concurrent work is powerful only if writes are guarded.

Lock resources such as:

- Instagram account
- TikTok account
- Gmail sender
- Google Drive folder
- campaign brief
- output being revised
- publish queue
- calendar event
- Shopify store

Reads can run in parallel.

Writes should lock, queue, or require approval.

Example:

```text
Two agents can research the same campaign.
Only one agent can schedule to @mikey Instagram at a time.
```

### Lock display

If a resource is locked, show plain copy:

```text
Content Genius is preparing an Instagram draft for Mikey Williams.
Art Director can keep working, but publishing is waiting.
```

Do not expose raw lock IDs.

### Stuck work

A global tray should surface:

- failed run
- waiting for approval
- waiting for credential
- waiting for account binding
- locked too long
- retry exhausted

The user should not have to hunt through agent sessions.

## Automations And Triggers

### Trigger scope

Every trigger must carry scope.

Examples:

```text
Calendar date reached -> world_mikey / campaign_blue_moon
File added to Vault -> world_luna
New Output pending approval -> world_mikey
Weekly pulse -> world_mikey
Portfolio daily brief -> global
```

### Automation scopes

Supported scopes:

- global portfolio automation
- world automation
- campaign automation

### Global automation examples

- daily portfolio brief
- all pending approvals reminder
- failed jobs digest
- credential health check
- usage/cost digest

### World automation examples

- weekly artist State of Play
- stale network follow-up reminder
- Vault intake
- new fan/community digest
- account sync

### Campaign automation examples

- release checklist pulse
- missing assets warning
- content calendar reminder
- approval follow-up
- campaign output index refresh

### Automation safety

Automations can:

- update state
- create draft Outputs
- request approval
- notify user
- start safe research
- refresh indexes

Automations should not silently:

- publish
- spend money
- send messages
- delete data
- modify external accounts
- change campaign strategy

unless the world policy explicitly allows it.

## Team And Permissions

### World permissions

Later team mode needs per-world access.

Roles:

- owner
- admin
- collaborator
- viewer

Permissions should apply at world level first.

Campaign-level permissions can come later.

### Private worlds

A manager may have private worlds not visible to assistants.

Search, approvals, recents, and running work must obey permission filters.

### Audit trail

Every external action should record:

- world
- campaign if any
- user / agent
- credential binding
- destination account
- time
- receipt

## Side Projects And Linked Worlds

### Separate by default

A side project should usually be a separate world.

Reason:

- different voice
- different accounts
- different campaigns
- different audience
- different memory

### Linked worlds

Some worlds can be linked.

Example:

```text
Mikey Williams
  linked to: Tape Ghost
```

Linked does not mean shared memory.

It means the app can offer explicit actions:

- share asset
- reuse contact
- compare calendar
- mention relationship
- clone campaign structure

### Collab campaigns

A campaign may involve two worlds.

First version:

- pick one owning world
- attach collaborator world references
- do not run the campaign as two owners

Later:

- shared campaign object
- per-world Outputs
- per-world approvals
- per-world account bindings

Do not build shared campaigns in the first multi-world pass.

## Search And Retrieval

### Default

Search current world first.

### Global search

Global search must include filters:

- world
- campaign
- type
- worker
- Output / session / context / asset
- approval state

### Result rows

Every result row must show:

- title
- kind
- world
- campaign if any
- updated date

This prevents cross-world confusion.

## Deletion, Archive, Export

### Archive world

Archive should:

- hide world from default switcher
- stop scheduled automations
- keep Outputs and sessions searchable if user includes archived
- preserve credentials globally
- disable account bindings unless reactivated

### Delete world

Deletion is dangerous.

Require:

- confirmation
- export offer
- active run check
- pending approval check
- external action warning

### Export world

Export should include:

- world manifest
- campaigns
- context docs
- memory
- Outputs
- Vault assets
- receipts
- worker activations
- account binding metadata without secrets

Do not export raw API keys.

## Edge Cases To Anticipate

### Same artist name

Two worlds may have the same display name.

Use avatar, kind, and created date to distinguish internally.

Never rely on name as ID.

### Wrong account posting

The most dangerous failure.

Mitigation:

- approvals show destination account
- run scope includes world
- publishing tools require account binding
- account binding belongs to one world unless explicitly shared
- receipt records destination

### OAuth revoked

If a credential is revoked:

- mark all dependent bindings unhealthy
- show impacted worlds
- block publish/send actions
- allow read-only views where possible

### External profile changed

If Instagram/TikTok/Google account display name changes externally:

- refresh binding metadata
- show "account changed" warning
- require confirmation before publish if identity looks different

### Shared Gmail

One Gmail can be used for several artists.

Mitigation:

- per-world sender alias
- per-world Drive folder
- per-world contact group
- approval copy shows sender and world

### Archived world with active run

Archiving should pause or cancel active runs.

The user must choose:

- let current runs finish
- pause runs
- cancel runs

### Pending approvals in archived world

Archived worlds can still have pending approvals.

Portfolio tray should either:

- show them under archived
- or ask user to resolve before archive

Recommended first version: require resolving or dismissing pending approvals before archive.

### Duplicate campaign names

Campaign names only need to be unique inside a world.

Global views always show:

```text
Campaign name - World name
```

### Agent launched from wrong scope

If the user starts a worker while viewing a global/portfolio surface, ask for world.

If viewing a world, default to that world.

If viewing a campaign, default to that campaign.

### Stale State of Play

State of Play should show last generated time.

If source docs changed and refresh failed, show:

```text
State of Play may be stale. Refresh failed 12 minutes ago.
```

### Cross-world memory leak

Never inject another world's memory unless:

- user explicitly shares it
- world is linked
- the action has a visible cross-world context badge

### File asset reused across worlds

If an asset is reused:

- copy it into receiving world, or
- create a shared asset reference with rights/ownership note

Do not silently point one world's campaign to another world's private asset.

### Provider rate limits

Rate limits may be global even if worlds are separate.

Portfolio should show:

- provider throttled
- impacted worlds
- retry time

### Billing / cost attribution

Usage should record:

- provider
- worldId
- campaignId if any
- worker
- runId

This enables per-artist cost visibility later.

### Offline local app

If the app is local-first and offline:

- keep world switching local
- queue sync actions
- block external publish/send
- show stale account binding status

### Backup and restore

Backups should preserve worlds as separate units.

Restore should detect:

- duplicate world IDs
- missing credential bindings
- missing files
- outdated schema

### User changes folder manually

If user changes working folder inside a campaign:

- allow session-only override
- offer update campaign/world folder only if relevant
- do not silently change world root

## Implementation Phases

### Phase 0 - Do nothing yet

Finish the single-world app first.

Readiness gates:

- HQ State of Play visually smoked.
- Work Products widget works.
- Approval drawer works.
- Campaign workspace has recent Outputs and approval widget.
- Content Genius and starter workers are visible and functional.
- Skills are shipped in-app, not local-only.
- Service key setup is documented and smoke-tested.
- HNIC knows recent Outputs through compact indexes.
- User can understand HQ vs campaign without explanation.

### Phase 1 - Add scope IDs quietly

Goal: prepare the model without changing UX much.

Add:

- `worldId` field support
- default world creation
- migration of current single-world data into default world
- scope helpers
- tests that prevent unscoped new records

User experience still feels like one world.

### Phase 2 - World Switcher

Goal: add visible multiple worlds.

Build:

- top-left World Switcher
- All Worlds page
- Add World wizard
- recent worlds
- archive basics
- current world badge

Keep bottom-left nav unchanged.

### Phase 3 - Scope the major systems

Goal: make real data separation work.

Scope:

- context docs
- memory
- sessions
- worker activations
- campaigns
- Outputs
- approvals
- Vault assets
- State of Play

Add cross-world search only after scoped data works.

### Phase 4 - Credentials and account bindings

Goal: reuse keys safely across worlds.

Build:

- global credential vault
- per-world account bindings
- binding health
- approval destination display
- publish/send guardrails

### Phase 5 - Concurrent runs and locks

Goal: multiple worlds can stay alive at once.

Build:

- all running work tray
- scoped run IDs
- resource locks
- stuck run handling
- per-world and portfolio run views

### Phase 6 - Team, permissions, and collaboration

Goal: manager/agency support.

Build:

- per-world access
- private worlds
- audit filters
- export/archive maturity
- collab campaign references

## Migration Strategy

### Current single-world app

Create one default world:

```text
Default Artist Space
```

or use the artist profile name if available.

Map existing records:

- HQ docs -> default world
- campaigns -> default world
- Outputs -> default world
- workers -> default world
- sessions -> default world
- Vault -> default world
- State of Play -> default world

### Existing labels

Keep labels.

Labels may help derive projects or campaigns, but they should not define world ownership.

### Existing Outputs

If an Output lacks `worldId`, assign the default world during migration.

If it has campaign context, resolve campaign under default world.

### Existing credentials

Keep credentials global.

Create default bindings only when account identity is clear.

If unclear, show "needs binding" instead of guessing.

## Testing Strategy

### Unit tests

- new scoped record requires `worldId`
- campaign record requires matching `worldId`
- Output filters by world and campaign
- approval query filters by world
- memory retrieval respects world
- account binding lookup requires world
- State of Play reads only world docs
- global search returns scope badges

### Integration tests

- create two worlds
- create campaign in each
- create Output in each
- verify HQ widgets do not mix
- run worker in each
- verify running tray groups correctly
- add same provider credential to both via bindings
- verify approval shows correct destination

### Smoke tests

1. Create Artist A and Artist B.
2. Add different artist context to each.
3. Activate Content Genius in both.
4. Create a campaign in each.
5. Generate captions in each.
6. Verify each Output lands in the correct campaign widget.
7. Verify portfolio approval tray shows both with world names.
8. Approve one Output.
9. Verify the other stays pending.
10. Search globally for the caption and confirm world badges.

### Failure tests

- try to publish with no account binding
- try to read another world's memory from worker prompt
- archive world with active run
- revoke credential and verify impacted bindings
- duplicate campaign names across worlds
- duplicate artist names across worlds

## Acceptance Criteria

Multi-world support is ready when:

- user can switch worlds without losing current work
- bottom-left nav still moves within current world
- top-left switcher changes worlds
- each world has its own HQ
- each world has its own campaigns
- workers activate per world/campaign
- Outputs appear only in correct scope
- approvals appear in local widgets and global tray
- approval copy always shows world and destination account
- memory does not leak across worlds by default
- global keys can be reused through scoped bindings
- agents can run concurrently in different worlds
- global running-work tray shows all active work
- State of Play works per world
- search clearly labels world/campaign
- archived worlds do not keep running unattended automations
- export does not include raw secrets

## UI Copy Rules

Prefer simple language:

- "World" or "Artist Space"
- "Switch world"
- "Add world"
- "Current world"
- "Needs approval"
- "Running now"
- "Recent work"
- "Connected account"
- "Used by this world"

Avoid:

- tenant
- namespace
- entity graph
- multi-tenant runtime
- scoped resource binding
- vector memory boundary

Those are implementation details.

## Build Readiness Checklist Before Starting

Do not begin this feature until these are true:

- Single-world HQ is stable.
- Campaign workspace is stable.
- Work Products are implemented.
- Output drawer is implemented.
- Approval flow is implemented.
- HNIC sees compact Output/approval state.
- Content Genius and starter workers show in Workers page.
- Global skills are bundled in the app.
- Service key setup is documented.
- Smoke test can run with real keys without shipping private values.
- There is a clear default world migration plan.

## Open Questions

- Should user-facing copy say `World`, `Artist Space`, or `Workspace`?
- Should a manager-level portfolio dashboard be first release or second release?
- Should every user start with one default world automatically?
- Should side projects appear as linked worlds or independent worlds with optional links?
- Should archived world approvals block archive?
- Should campaign-level permissions exist in V1 or wait?
- Should global search search archived worlds by default?
- Should shared assets copy or reference by default?
- Should portfolio State of Play be a real composer or just a query summary?

## Final Rule

Build one world until it feels inevitable.

Then add many worlds by adding scope, not by duplicating the app.
