---
status: draft
owner: agent
last_verified: 2026-07-01
source_of_truth: false
---

# HQ / Homebase — Global Space Architecture Spec

> Scope of this pass: vet the five existing global spaces (HQ, Calendar, Network, Vault, Workers),
> spec the new **Community** space, and — most importantly — define how everything gets *wired up*
> so the homebase is actually intelligent and agentic, not just a good-looking dashboard.
>
> Deliverable decisions locked with the owner:
> 1. Written spec doc in-repo (this file).
> 2. Tighten the existing 5 spaces + add Community (not a full taxonomy rethink this pass).
> 3. Intelligence goal = **the full loop**: the home briefs you on the single next move *and*
>    workers stand ready to execute it.

---

## 0. The one idea that makes this whole thing work

You already built the hard part. The app is not a dashboard app — it's a **context operating system**
(RunnerOS / `craft-agent`). Everything of value in it is a **Context Doc**: one markdown file per topic,
with YAML frontmatter that controls *who sees it* (`routing: broadcast | targeted:[agent-slugs]`) and,
optionally, *whether it's a goal* (`status` / `priority` / `deadline`).

Three primitives already exist and are the entire nervous system:

| Primitive | What it is | Where it lives (verified) |
|---|---|---|
| **Context Doc** | Per-topic markdown+frontmatter the agents read before acting. Routing is per-doc. The Concierge agent always sees every doc. | `packages/shared/src/workspace-context/types.ts` |
| **Goal** | A context doc with `status`/`priority`/`deadline` set. Nothing more. | same file (`ContextDocGoalStatus`) |
| **Pulse** | A scheduled "thinking heartbeat" (`SchedulerTick` → `pulse` action). Wakes on a cadence, reads goals + the *diff since last tick*, and decides `do_nothing` / `notify_user` / `kick_workflow`. | `docs/pulses/01-spec.md`, automations runtime |

And you already have the missing link between "raw data" and "intelligent action":
**`campaign-worker-context.ts`** — a composer that reads mission brief + artist profile + asset manifest
and emits a *readiness digest*: `{ ready, nextMove, missing[], essentials{} }`. That function is the
prototype of the entire intelligence layer. **The whole strategy below is: generalize that one pattern
across HQ, and let Pulses act on it.**

### The mental model to hold

```text
SPACES are lenses.        (HQ, Calendar, Network, Vault, Workers, Community)
CONTEXT DOCS are the spine. (one canonical doc per domain, routed to agents)
COMPOSERS are the brain.    (read many docs -> emit "state of play + next move")
PULSES + WORKERS are muscle. (watch goals, act, or tee up a one-click action)
```

A space is never a data silo. A space is a **view + editor** over a context doc. The same doc that
renders the Network tab is the doc a Worker reads when it drafts an outreach email. There is exactly
one source of truth per domain, and it's a file on disk. This is why it can be intelligent: the UI and
the agents are literally reading the same brain.

### The failure mode we are designing against

"Looks but doesn't work" happens when a space renders data that **no agent can read** and **no composer
turns into a next move**. Spotify numbers that only live in a React widget are decoration. Spotify
numbers written to `artist-spotify-snapshot` context doc, folded into an HQ composer, and watched by a
weekly Pulse are *intelligence*. Every space in this spec must pass the **Wiring Test** (§7).

---

## 1. Current state — verified inventory

What actually exists in the codebase today (not aspiration):

**Spaces / surfaces**
- `ArtistHQHome.tsx` — HQ home with tabs `home | profile | calendar | network | research`.
- `VaultPage.tsx` — Vault surface.
- `AgentsLaunchpad.tsx` — "Workers" surface (title literally renders "Workers").
- `MissionBriefDrawer.tsx` — right-side operator drawer for mission intake (per `01-mission-intake` spec), includes a Vault tab.
- HQ navigation is hash-routed: `#artist-hq/{home|calendar|network}`, dispatched from `AppShell.tsx` `handleArtistHQNavClick`.

**Data libs (the beginnings of the spine)**
- `artist-profile.ts` → `artist-profile` doc (global creator identity, `profileCompletion()`).
- `artist-spotify.ts` → `artist-spotify-snapshot` doc (metrics, geo, tracks, playlists; `dataSource`, `partial`, `errors`).
- `artist-network.ts` → `artist-network` doc (people, categories, relationship strength, `canHelpWith`, Google People sync state).
- `artist-calendar.ts` → `artist-calendar` doc (events).
- `mission-brief.ts` → mission brief (single/EP/album/other; completeness).
- `mission-asset-context.ts` → `mission-assets` doc (Vault manifest: master/lyrics/cover-art/etc., buckets).
- `campaign-worker-context.ts` → `campaign-worker-context` digest (the readiness composer).

**Engine**
- Automations with triggers: `SchedulerTick`, `WebhookReceive`, `FileWatch`, `PollUrl`, `MessageReceive`, `LabelAdd/Remove`, etc.
- Pulses spec (`docs/pulses/`) — scheduled reasoning, goal-anchored, diff-fed, notify/kick-workflow.
- Workspace context read/write via `useWorkspaceContext` hook + `listWorkspaceContextDocs` IPC.

**Verdict on current state:** the architecture is *ahead* of the UI. The pieces to be genuinely
agentic are present but applied only to the campaign/mission path. HQ (the global space) does not yet
have its own composer or its own pulses. That's the gap this spec closes.

> Out of scope but flagged: `docs/audits/2026-07-04/control-plane.md` (2026-06-30) found a **critical** browser→agent
> RCE bridge (no `Origin`/`Host` check on the loopback WS control plane). It is unrelated to this
> homebase work but should be fixed before any web-UI exposure. Do not let it ride under this spec.

---

## 2. The global data spine — canonical context docs

Everything hangs off a fixed registry of **HQ-global context docs** (workspace = the Artist HQ workspace,
which is distinct from per-mission/project workspaces — confirmed via `artist-workspace.ts` /
`findArtistHQWorkspace`). Global docs describe the *career*; mission docs describe *one release*.

| Slug | Owns | Written by | Read by |
|---|---|---|---|
| `artist-profile` | Identity, sound, audience, brand voice, links | Profile tab, intake agent | every worker + composer |
| `artist-spotify-snapshot` | Latest streaming analytics | Weekly Spotify Pulse / manual | HQ composer, analytics worker |
| `artist-network` | People, relationships, "can help with" | Network tab, Google sync | outreach worker, HQ composer |
| `artist-calendar` | Dates, releases, commitments | Calendar tab, calendar sync | HQ composer, planning worker |
| `artist-community` | **NEW** — fan list + broadcast history (see §5) | Community tab, import | fan-comms worker, HQ composer |
| `hq-goals/*` | Career goals (each a Goal-status context doc) | user, workers | HQ Pulse |
| `hq-state-of-play` | **NEW** — composed digest (see §3) | HQ Composer (generated) | Home hero, HQ Pulse, all workers |

Rules (carried from `01-mission-intake` reliability rules, generalized):

1. One canonical doc per domain. A space edits its doc; it does not keep private state that agents can't see.
2. Generated/composed docs (`hq-state-of-play`, `campaign-worker-context`) are **derived** — never hand-edited, always regenerable, and stamped with `updatedAt` + source list.
3. Every doc declares routing. Default `broadcast`. Narrow only with intent.
4. Missing data is explicit (`partial: true`, `missing[]`), never faked. No invented Spotify stats, ever (already a rule; keep it).
5. Docs are files under the workspace root so they diff, sync, and survive.

---

## 3. The brain — HQ Readiness Composer

Generalize `campaign-worker-context.ts` into an **HQ Composer** that produces `hq-state-of-play`.

**Input:** `artist-profile`, `artist-spotify-snapshot`, `artist-network`, `artist-calendar`,
`artist-community`, all `hq-goals/*`, plus a light "recent activity" delta (worker runs, new outputs,
calendar changes since last compose).

**Output (`hq-state-of-play` doc, JSON body + human summary):**

```ts
type HqStateOfPlay = {
  version: 1
  generatedAt: string
  sources: Record<string, string>      // slug -> updatedAt used
  headline: string                     // one line, chief-of-staff voice
  nextMove: {                          // THE single most important thing
    title: string
    why: string                        // grounded in a source doc
    worker?: string                    // slug of worker that can do it
    action?: 'draft' | 'review' | 'schedule' | 'research' | 'outreach'
    oneClick?: boolean                 // can a worker execute now?
  }
  attention: Array<{ kind: string; text: string; source: string }>  // <=3, ranked
  momentum: { up: string[]; down: string[] }   // from spotify/community deltas
  missing: string[]                    // context gaps blocking sharper advice
  goalProgress: Array<{ goal: string; status: string; note: string }>
}
```

**Why this is the load-bearing piece:** the Home hero stops being hardcoded widgets and instead renders
`hq-state-of-play.nextMove` + `attention`. The exact same doc is `broadcast` to every worker, so when a
worker runs it already knows the state of play. **One composer feeds both the eyes (Home) and the hands
(Workers).** That is the answer to "wired up correctly so it's actually intelligent."

**Freshness:** recompute on (a) any source-doc write, debounced; (b) each HQ Pulse tick; (c) manual
refresh. Never block the UI on it — render last-good with a staleness stamp (reuse the Spotify
`partial`/`updatedAt` idiom).

---

## 4. Vetting the five existing spaces

For each: **verdict**, what to keep, and the specific upgrade to make it agentic. Every upgrade routes
through the spine + composer, never a one-off widget.

### 4.1 HQ (home)
**Verdict: keep as the center, but re-found the hero on `hq-state-of-play`.**
Today the home shows tabs and widgets. The upgrade: the top of Home is the **Next Move card** (from the
composer) + up-to-3 **Attention items**, each with a one-click worker action. Below it, the existing
snapshots (Spotify, this week, active workers) stay — but as *evidence*, ranked under the brief, not as
the primary content. Follow the `01-mission-intake` rule: empty/light/full states, no fake widgets
before real data. Home answers one question on open: *"What's the most important thing right now, and
can you just do it?"*

### 4.2 Calendar
**Verdict: keep; wire it into the composer and give it a Pulse.**
`artist-calendar` already exists. Gaps to close: (1) two-way sync surface (Google Workspace context-sync
spec `03-...md` already drafted — build it so calendar reflects real commitments); (2) the composer must
read upcoming events so `nextMove` is date-aware ("master due in 5 days, no cover art yet"); (3) a
**Calendar Pulse** that looks ahead N days and raises `attention` items for anything approaching without
its prerequisites (cross-referencing Vault + mission readiness). Calendar becomes a *deadline conscience*,
not a static month grid.

### 4.3 Network
**Verdict: strongest data model of the five; underused. Make it act.**
`artist-network.ts` is rich (relationship strength, `canHelpWith`, `lastTouch`, Google People sync,
per-person workspace links). Right now it's a CRM view. Upgrades: (1) the composer surfaces
relationship-driven next moves ("you haven't touched [warm A&R] in 90 days; you have a single dropping —
draft a note?"); (2) an **Outreach Worker** that drafts context-aware messages using profile + mission +
this person's `canHelpWith`; (3) a lightweight **stale-relationship Pulse**. Keep it dead simple in the
UI — the intelligence lives in the composer/worker, not in more buttons on the card.

### 4.4 Vault
**Verdict: keep; it's already the most "wired" space — extend the manifest, don't rebuild.**
`mission-asset-context.ts` already turns files into an agent-readable manifest with kinds
(master/lyrics/cover-art/stem/press-photo/…) and buckets, and `campaign-worker-context` already reads it
for readiness. Upgrades: (1) a **global Vault** layer for career-level assets (EPK, logo, press shots,
bio variants) separate from per-mission vaults; (2) auto-tagging on `FileWatch` (drop a file → an
automation classifies its `kind` and updates the manifest); (3) Vault gaps flow into `attention`
("release in 2 weeks, no press photos"). Vault's job is to make assets *legible to workers*, which it
already half-does — finish it.

### 4.5 Workers
**Verdict: right concept, needs a defined roster + the composer as shared context.**
`AgentsLaunchpad` renders "Workers." The key architectural fit: Workers are agent definitions (slugs) and
they consume context docs by routing. Because `hq-state-of-play` is `broadcast`, **every worker
automatically inherits the brief** — no per-worker plumbing. Define a small, holistic HQ worker roster
(career-view, not song-view), each with a clear trigger and the docs it reads. See §6.

---

## 5. NEW space — Community

**Purpose:** own the direct-to-fan relationship — a fan list and the ability to broadcast (email now;
SMS/DM later). Keep it as simple as Network: a list + a compose action. All power comes from wiring, not
UI surface area.

**Data:** new `artist-community` context doc.

```ts
type ArtistCommunity = {
  version: 1
  audience: {
    total: number
    segments: Array<{ id: string; label: string; size: number; rule?: string }>  // e.g. superfans, city:LA, new-30d
    source?: 'import' | 'signup-form' | 'manual'
  }
  contacts?: Array<{                  // optional; may live in an external ESP instead
    id: string; email?: string; name?: string
    location?: string; joinedAt?: string; tags: string[]
    engagement?: 'new' | 'active' | 'lapsed'
  }>
  broadcasts: Array<{                 // history — feeds momentum + "don't over-email"
    id: string; sentAt: string; subject: string
    segment?: string; sent?: number; opens?: number; clicks?: number
  }>
  cadence?: { lastSentAt?: string; recommendedMinDays?: number }  // fatigue guard
  updatedAt: string
}
```

**Space UI (minimal):** audience number + segments; broadcast history; one **Compose** button that opens
the Operator Drawer in a `fan-broadcast` mode (reuse the drawer shell from `01-mission-intake`, not a new
modal).

**The intelligence (this is why it's not just a form):**
- A **Fan-Comms Worker** drafts broadcasts using `artist-profile` (voice), the current mission/release,
  and community `cadence` (so it never proposes emailing a fatigued list).
- The composer surfaces fan moments as `nextMove`/`attention`: "single out Friday, list of 1,200 not
  emailed in 40 days — draft the announcement?"
- Growth shows up in `momentum` (list up/down since last snapshot).

**Sending — decision required (see §9):** do NOT build an email-sending engine inside the app in V1.
Route sending through an existing ESP connector (e.g. Klaviyo/Mailchimp/Resend via MCP) or draft →
user-approves → send. The app owns the *audience doc, the draft, and the decision to send*; the ESP owns
deliverability. This keeps V1 shippable and compliant (unsubscribe/CAN-SPAM handled by the ESP).

**Guardrails:** fan email is high-trust. Every broadcast is **draft-first, human-approved** — never a
fully autonomous send. Respect cadence fatigue. Segment consent must be explicit.

---

## 6. The muscle — HQ worker roster + Pulses

Keep the roster **small and holistic** (career-view, matching the owner's framing of Workers as big-picture,
not per-song). Each worker: one job, reads named docs, has a defined trigger, drafts-not-sends for anything
outbound.

| Worker (agent slug) | Job | Reads | Trigger | Outputs |
|---|---|---|---|---|
| `hq-chief-of-staff` | Runs the HQ Composer; produces the brief | all global docs | Pulse tick + on-write | `hq-state-of-play` |
| `hq-analyst` | Interprets Spotify/community deltas, explains momentum | snapshot, community | weekly Pulse | attention items, plain-English readout |
| `hq-outreach` | Drafts network messages | profile, network, mission | one-click from Network / attention | draft message |
| `hq-fan-comms` | Drafts fan broadcasts | profile, community, mission | one-click from Community / attention | draft broadcast |
| `hq-planner` | Keeps calendar honest vs. readiness | calendar, mission, vault | Calendar Pulse | schedule suggestions, deadline flags |

**Pulses (the proactive engine — reuse `docs/pulses` runtime, no new nav):**
- **Morning HQ Pulse** (daily): recompute state-of-play; if there's a real next move, `notify_user` via
  bell + optional bound channel. 95% of ticks decide "nothing" — that's correct and by design.
- **Weekly Spotify Pulse**: already scaffolded (`Weekly Spotify Snapshot`, cron `0 9 * * 1`). Extend it to
  hand off to `hq-analyst` after refreshing the snapshot.
- **Deadline/Calendar Pulse**: look ahead; raise attention for approaching dates missing prerequisites.
- **Stale-relationship Pulse** (weekly): warm/strong contacts past a touch threshold → attention (opt-in).

Goals anchor all of this: each `hq-goals/*` doc (career goal with `status`/`deadline`) is what the Pulse
reasons *against*, so the system pursues the artist's actual objectives instead of drifting.

---

## 7. The Wiring Test (apply to every space, existing and future)

A space is only "done" (and only honestly agentic) when all five hold:

1. **Canonical doc** — it reads/writes exactly one registry context doc; no agent-invisible state.
2. **Routed** — that doc is `broadcast` (or intentionally targeted) so workers can read it.
3. **Composed** — the HQ Composer folds it into `hq-state-of-play` (feeds Home + all workers).
4. **Actionable** — at least one worker can act on it, surfaced as a one-click action on the space and in `attention`.
5. **Watched** — a Pulse or automation reacts to change in it (or an explicit decision that none is needed).

If a space fails any line, it's decoration. This is the checklist that prevents "looks but doesn't work."

---

## 8. Simplicity guardrails (so power doesn't become clutter)

- **No new top-level nav beyond the six spaces.** Goals live under Workspace Context (per pulses spec);
  Pulses live as a tab in Automations. Community is the only new header.
- **One drawer, many modes.** Reuse the Operator Drawer (`mission-brief`, add `fan-broadcast`,
  `outreach`, `context-inspector`) instead of bespoke modals — already the decision in `01-mission-intake`.
- **Home shows one next move, not ten widgets.** Depth is one click away (open the space), not on the hero.
- **Drafts, not sends.** Every outbound worker (outreach, fan-comms) proposes; the human commits.
- **Progressive disclosure by completeness.** Empty → light → full, reusing the mission-intake pattern at
  the HQ level. Never unlock a widget before its source doc has real data.

---

## 9. Open decisions (need owner input before/with build)

1. **Community sending path** — which ESP connector do we route through (Klaviyo, Mailchimp, Resend,
   other), or draft-only + manual send in V1? Affects the Compose flow and compliance surface.
2. **Spotify data source** — `spotify-web-api` (public metrics, easy) vs. `spotify-for-artists`
   (real streams/listeners, harder auth). `artist-spotify.ts` already models both + `manual`. Which for V1?
3. **Global vs. mission Vault** — confirm the two-layer split (career assets vs. per-release assets) is
   the model you want, or keep one Vault with a scope filter.
4. **Pulse cadence defaults** — daily morning + weekly analyst a sane default? All Pulses ship
   **disabled by default** (per pulses spec) — confirm.
5. **Goals UX** — are career goals a first-class thing the artist edits in HQ, or seeded by the
   chief-of-staff worker from the profile? (Recommend: worker proposes, user confirms.)

---

## 10. Build order

**Phase 1 — Spine (unlocks everything, low risk)**
- Freeze the context-doc registry (§2). Add `artist-community` + `hq-state-of-play` slugs/types.
- Ensure every existing space reads/writes its canonical doc (audit against the Wiring Test).

**Phase 2 — Brain**
- Generalize `campaign-worker-context.ts` into the **HQ Composer** → `hq-state-of-play`.
- Re-found the Home hero on `nextMove` + `attention` (replace hardcoded widget priority).

**Phase 3 — Muscle**
- Ship the worker roster (§6) as agent definitions; confirm `broadcast` gives them the brief for free.
- Wire one-click actions from Home attention + Network/Community into `hq-outreach` / `hq-fan-comms`.

**Phase 4 — Proactive**
- Morning HQ Pulse + Weekly Spotify→Analyst handoff (extend existing automation).
- Deadline + stale-relationship Pulses. All disabled by default; user opts in.

**Phase 5 — Community**
- `artist-community` doc + minimal space UI + `fan-broadcast` drawer mode.
- Fan-Comms worker (draft-first) + chosen ESP connector for send.

**Phase 6 — Verify**
- Run every space through the Wiring Test. Confirm the brief the Home shows is the same brief a worker
  receives (open a worker, check it cites `hq-state-of-play`). No faked data anywhere.

---

## 11. Acceptance criteria

- Opening HQ shows exactly one **Next Move** with a grounded *why* and, where possible, a one-click worker action.
- The Home brief and any worker run read the **same** `hq-state-of-play` doc (verifiable).
- Each of the six spaces passes the **Wiring Test** (§7) or has an explicit, recorded exception.
- No space renders data that no agent can read and no composer can act on.
- Fan and outreach messages are **draft-first, human-approved** — never autonomous sends.
- Missing context is shown as missing (`missing[]` / `partial`), never invented.
- Pulses ship disabled by default; enabling one produces real, goal-anchored notifications (not noise).
- Adding a new space later means: add a doc to the registry, teach the composer to read it, give it a
  worker + a pulse. No new architecture required — proof the wiring is right.

---

## 12. Why this is honestly agentic and not a skin

The test the owner set — "actually intelligent and works agentically, not just looks" — is met by one
structural fact: **the UI and the agents read the same files.** A space is a lens on a context doc; a
worker is a consumer of the same context doc; a composer turns those docs into a next move that feeds both
the Home hero and every worker; a pulse watches the goals and acts. There is no separate "display data"
and "agent data." That single-source-of-truth spine, which the codebase already uses for the campaign
path, is what makes the homebase think instead of merely show — and generalizing it to HQ is the whole job.
