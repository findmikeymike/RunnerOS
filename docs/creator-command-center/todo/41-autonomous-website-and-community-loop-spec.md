---
status: proposed
owner: agent
last_verified: 2026-09-04
source_of_truth: true
related: ../39-artist-website-agent-spec.md, ./38-community-email-engine-spec.md, ../33-automations-input-aware-setup-spec.md, ../24-session-task-list-spec.md, ../13-scheduled-work-composer-execution-spec.md, ../26-agent-bound-messaging-spec.md, ../09-hq-state-of-play-proactive-routing.md
---

# The Autonomous Website And Community Loop

Master spec. Specs 38 and 39 each define one system. This one defines the
loop that runs across both without the artist watching, the contracts those
systems share, and the four slices that ship it.

## Decision

- **One loop, one card.** Every week the Website Agent updates the site, the
  capture door feeds the fan list, and the Community Agent proposes what to
  say to fans. The artist sees one Monday Brief in Needs You with the site
  change, the new subscribers, and the drafted email, and approves each with
  one click or lets the trusted parts run.
- **Two approvals, nothing else.** A public site change and the exact fan
  email about to go out. Research, edits, previews, audits, subscriber
  imports, segmentation, and drafting never wait on a human. Trusted mode
  lets the artist retire the site-change approval for content-only changes
  after the system has earned it.
- **Existing sites are joined, never replaced.** Inspect first. Domain cutover
  is the only destructive act and needs one explicit target approval with the
  way back written down before it happens.
- **Shared contracts live here.** The Change Receipt, the approval tiers, the
  Needs You entry, the subscriber handoff, and the agent-to-agent briefs are
  defined once in this spec. 38 and 39 keep their data models and reference
  these contracts by name.
- **Four slices, each shippable alone.** Publishing and capture, the Website
  Agent and its weekly routine, the Community Agent liaison, and existing-site
  connection. Each has acceptance tests that prove the visible autonomous
  behavior, not just a backend.

## The Product Judgement

The Site Builder that shipped in 39 Slice 1 can build, audit, and preview a
site. That is a worker, not the product. The product is an artist who does
nothing and still has a site that stays current, a fan list that grows from
it, and a note to fans that goes out when there is something to say. The
artist's job shrinks to reading a short card on Monday and pressing Approve.

Two things make or break this. The first is trust: the artist has to be able
to see what changed, why, what it looked like before, and how to undo it, in
one glance. The second is restraint: the moment the loop starts asking
permission for every edit or every draft, the artist stops reading the card
and the loop is dead. So the design puts exactly two human decisions in the
path and makes everything else visible but not blocking.

## Current State

Verified in tree on 2026-09-04, branch `codex/artist-website-engine`.

**Built (39 Slice 1)**

- `website/` HQ object, content contract, theme tokens, structured content
  operations (`packages/shared/src/website/`).
- `tools/site-builder` CLI: init, build, audit, serve, pack, doctor. Template
  engine, SEO scaffolding, structured data, credential scan.
- `WebsiteService` with loopback preview; six session tools:
  `website_get_manifest`, `website_create`, `website_set_content`,
  `website_build`, `website_preview`, `website_seo_audit`.
- `site-builder` starter agent with routing hints; skills
  `artist-website-builder` and `artist-website-playbook`.
- Manifest already carries `publishPolicy`, `targetApproval`, `capture`, and
  `history` fields, so the contracts below have somewhere to land.

**Built (elsewhere, reused here)**

- Spec 33 automations with declared inputs and the one list; Needs You on HQ
  home with `WAITING_WORK_STATUSES`.
- Scheduled work attention reasons including `needs-approval`,
  `changes-requested`, `approval-expired`, `approval-invalidated`,
  `execution-failed`, `asset-missing`, `provider-unavailable`
  (`packages/shared/src/scheduled-work/index.ts`).
- Spec 24 delegation return path and `message_agent` for bounded handoffs.
- Spec 26 agent-bound messaging, so the Monday Brief can also reach the artist
  on Telegram or WhatsApp.
- Community records with consent evidence, suppression, frozen audiences, and
  email jobs (`packages/shared/src/community/`). Sending is a stub.
- Starter agents `world-builder`, `branding-agent`, `comms-agent`,
  `outreach-agent`.

**Not built**

- Any deploy adapter, production publish, rollback, or domain connection.
- Any capture endpoint on the site; `capture.backend` is `none`.
- The Website Agent, the weekly routine, and the Website page.
- The Community Agent and every `community_*` tool.
- Any external-site mode: inspect, WordPress, static repo, closed builder.
- The Change Receipt, approval tiers, and Monday Brief defined below.

## Core Laws

1. **Runs free**: reading context, editing content and templates, building,
   auditing, previewing, importing consented subscribers, tagging and
   segmenting, drafting emails, and asking other agents for ideas. None of
   these wait on a human, ever.
2. **Needs one click**: publishing a change to the production site, and
   sending a fan email. Each shows exactly what will happen before the click.
3. **Trusted mode is earned, scoped, and revocable.** It applies only to
   content-only site changes. It is offered after five approved publishes with
   no rollback, it never covers design changes or emails, and one rollback
   turns it off.
4. **Every change carries a receipt.** No publish, no send, and no import
   happens without a Change Receipt the artist can open later.
5. **Never replace an existing site silently.** Inspect is read-only. A domain
   cutover requires target approval, and the receipt records the previous DNS
   so it can be undone.
6. **Consent travels with the subscriber.** A signup enters Community with
   source, form id, timestamp, and hashed IP. A subscriber without consent
   evidence never receives a broadcast.
7. **Agents brief each other, they do not command each other.** A handoff is a
   bounded brief with a return path. Ideas from World Builder are proposals in
   the Monday Brief, never actions.
8. **One card per week.** The routine produces one Needs You entry. Additional
   entries appear only for failures and expired approvals.
9. **Approval binds to a hash.** Approving a site change approves one build
   hash. Approving an email approves one job with a frozen audience. If either
   changes, the approval is invalidated and the card says so.
10. **Rollback is always one click** and is shown on every receipt.

## The Loop

```
   Monday 09:00 (or on demand)
   ┌──────────────────────────────────────────────────────────────┐
   │ Website Agent                                                │
   │  1. read: releases, calendar, Release Kit, State of Play,    │
   │     recent posts, last receipt                               │
   │  2. decide what is stale or missing                          │
   │  3. optional: brief World Builder for a campaign idea        │
   │  4. brief Site Builder with the change list                  │
   │  5. Site Builder edits → build → audit → preview Output      │
   │  6. drain capture door → new subscribers into Community      │
   │  7. brief Community Agent: new subscribers, segments, what   │
   │     changed on the site, upcoming dates                      │
   │  8. Community Agent drafts email job(s) → needs-owner-approval│
   │  9. compose ONE Monday Brief → Needs You (+ messaging)       │
   └──────────────────────────────────────────────────────────────┘
                              │
              artist reads the card, per item:
              [Publish] [Skip]   [Send] [Edit] [Skip]
                              │
   ┌──────────────────────────────────────────────────────────────┐
   │ 10. publish approved build hash → production → receipt       │
   │ 11. send approved job → per-recipient deliveries → receipt   │
   │ 12. write receipts; next week's brief starts from them       │
   └──────────────────────────────────────────────────────────────┘
```

Trusted mode short-circuits step 10 for content-only changes: the card still
shows the change, marked "published automatically", with Rollback.

## Shared Contracts

These are the only new shapes this spec introduces. Everything else reuses
38, 39, and scheduled work.

### Approval tiers

```ts
type ApprovalTier = 'free' | 'one-click' | 'trusted';

interface ApprovalPolicy {
  siteContentOnly: 'one-click' | 'trusted';   // default one-click
  siteDesign: 'one-click';                    // never trusted
  fanEmail: 'one-click';                      // never trusted; templates are the unattended path (38)
  domainCutover: 'one-click';                 // always, with target approval
  trustedEligibleAt?: string;                 // set after 5 clean publishes
  trustedRevokedAt?: string;                  // set on any rollback
}
```

Stored on the website manifest under `publishPolicy` (39 already reserves
the field) and mirrored on the Community provider config for `fanEmail`.

### Change Receipt

One receipt per publish, send, import, or cutover. Stored under
`records/receipts/website/` and `records/receipts/community/` as shared
records so team mode and sync apply.

```ts
interface ChangeReceipt {
  id: string;
  kind: 'site-publish' | 'site-rollback' | 'domain-cutover' | 'email-send' | 'subscriber-import';
  at: string;
  origin: { kind: 'user' | 'agent' | 'automation'; sessionId?: string; automationId?: string; agentSlug?: string };
  approval: { tier: ApprovalTier; approvedAt?: string; approvedBy?: 'user'; boundTo: string };  // build hash or job id
  summary: string;                     // one line, plain language
  why: string[];                       // the signals that triggered it
  changes: string[];                   // from applySiteContentOperations or the email job
  before?: { deployId?: string; url?: string; dns?: string[] };
  after?: { deployId?: string; url?: string; buildHash?: string; jobId?: string; sentCount?: number };
  preview?: { outputId: string };
  rollback?: { kind: 'deploy' | 'dns-steps' | 'none'; target?: string; steps?: string[] };
  audit?: { score: number; warnings: number };
  counts?: { imported?: number; skippedSuppressed?: number; duplicates?: number; recipients?: number };
}
```

### Monday Brief (the Needs You entry)

One scheduled-work order per routine run, status `needs-approval`, with a
structured attention payload the HQ home card and the messaging bridge both
render.

```ts
interface MondayBrief {
  runId: string;
  weekOf: string;
  site?: {
    buildHash: string;
    changeClass: 'content-only' | 'design';
    summary: string;              // "Added the Denver show, moved the new single to the hero"
    previewOutputId: string;
    auditScore: number;
    tier: ApprovalTier;           // 'trusted' means already published, show Rollback
    deployReceiptId?: string;
  };
  subscribers?: {
    imported: number;
    skippedSuppressed: number;
    duplicates: number;
    receiptId: string;
    topSources: Array<{ formId: string; count: number }>;
  };
  emails?: Array<{
    jobId: string;
    title: string;
    audienceLabel: string;        // "core-fans (61)"
    recipients: number;
    subjectPreview: string;
    fatigued: boolean;
  }>;
  ideas?: Array<{ from: 'world-builder' | 'community-agent' | 'website-agent'; title: string; oneLiner: string; briefOutputId?: string }>;
  nothingToDo?: true;            // the card still appears once, collapsed, then not again until something changes
}
```

Decisions map to existing scheduled-work review decisions: `approved` and
`changes-requested`, plus a per-item skip that resolves that item without
touching the others. Approving the site item calls `website_deploy` with the
bound hash. Approving an email item calls the 38 approve path with the bound
job id. A brief with nothing to approve resolves itself to `done`.

### Subscriber handoff

The capture door (39) and the Community sync (38) meet here. One contract,
two backends.

```ts
interface CapturedSubscriber {
  email: string;
  formId: string;
  capturedAt: string;
  ipHash?: string;
  firstName?: string;
  reward?: { kind: 'download' | 'stream'; delivered: boolean };
  siteUrl: string;
}
```

Import rules, applied by the drain regardless of backend:

- Dedupe by `emailHash`. An existing contact gains the form tag and, if its
  consent is `unknown`, keeps `unknown` until the double opt-in from 38
  confirms; a signup through the site's own form with `ipHash` present is
  treated as single opt-in and sets `opted-in` with evidence
  `{ source: 'website', formId, capturedAt, ipHash }`.
- Suppressed hashes are skipped and counted, never re-added.
- Every import writes one `subscriber-import` receipt with counts.
- Tags: `site-signup`, `form:<formId>`, and `sneak-peek-<releaseId>` when the
  form carries a release reward.

### Agent briefs

All handoffs use `message_agent` with a bounded brief and the spec 24 return
path. The brief shapes are the contract; the prose is generated.

```ts
interface SiteChangeBrief {          // Website Agent → Site Builder
  goal: string;
  operations: SiteContentOperation[]; // from 39; the builder may add design edits
  designAllowed: boolean;             // false in routines unless the artist asked
  mustPreserve: string[];             // "the hero stays on the new single until 09-20"
  returnWith: ['buildHash', 'previewOutputId', 'auditScore', 'changeClass'];
}

interface CommunityLiaisonBrief {    // Website Agent → Community Agent
  weekOf: string;
  siteChanges: string[];
  newSubscribers: { count: number; formIds: string[] };
  upcoming: Array<{ kind: 'release' | 'show'; date: string; label: string }>;
  askFor: Array<'segments' | 'email-draft' | 'engagement-ideas'>;
  returnWith: ['jobIds', 'segmentSummary', 'ideas'];
}

interface IdeaBrief {                // Website Agent or Community Agent → World Builder
  context: { release?: string; theme?: string; audienceSize: number; upcoming: string[] };
  constraints: { budget: 'none' | 'low'; channels: Array<'site' | 'email'> };
  askFor: 'one-idea' | 'three-ideas';
  returnWith: ['ideas'];            // each: title, oneLiner, whatSiteNeeds, whatEmailNeeds
}
```

Rules: a brief never grants tools or permissions; the receiving agent's own
permission mode applies. A brief that cannot be fulfilled returns a reason,
and the Website Agent puts that reason in the Monday Brief instead of failing
the run.

## The Website Agent

Defined in 39 and unchanged in shape. This spec adds what it does on its
own.

**Weekly signals it reads**, in order: Release Kit items promoted since the
last receipt; calendar events in the next 90 days tagged show or release;
State of Play opportunities that name the site; recent social posts from the
Printing Press Social catalog; the last three Change Receipts; the capture
counts since the last drain.

**What counts as stale**: a release with a date in the past still marked
presave; a show that happened still in upcoming; a featured release older
than the newest promoted one; a signup form with zero submissions in 30
days; an audit score under 70; a journal with nothing in 21 days while posts
went out.

**What it will not do alone**: change templates or theme (design class) in a
routine, publish anything, send anything, or connect anything. Those are
either one-click or the artist's own cue.

**Idle behavior**: if nothing is stale and no subscribers arrived, it writes
`nothingToDo` once, collapsed. It does not create a card the following week
unless something changed.

## The Community Agent

Defined in 38 and unchanged in shape. This spec adds the liaison duties.

- Receives the `CommunityLiaisonBrief` every run. Updates derived segments,
  tags new subscribers, and returns a segment summary.
- Drafts at most one broadcast per run unless the brief names two dated
  events inside 14 days. Drafts land in `needs-owner-approval` with a frozen
  audience and appear as email items in the Monday Brief.
- Never sends from a routine. The unattended path is an approved template
  (38): welcome, confirmed-welcome, and the drop-day reminder once the artist
  has approved each template once.
- May brief World Builder for a community idea when the list has grown 20
  percent in a month or a release is inside 30 days. Ideas return as
  proposals.
- Owns the fan inbox pass (38) independently of this loop.

## Existing Sites And Domains

Two different questions the artist might mean by "I already have a site."

**"I own a domain."** Handled in Slice A. The artist keeps the domain wherever
it is registered. Connecting it to the Artist OS site is a `domain-cutover`
receipt: the adapter returns exact DNS steps, the Website Agent guides them in
the browser pane, `website_domain_check` verifies, and the receipt stores the
previous records so the way back is one card. Nothing at the old host is
touched.

**"I have a live site."** Handled in Slice D. `website_inspect_external` runs
first and is read-only. The artist picks one mode:

| Mode | What the loop does each week | Capture door | Publishing approval |
| --- | --- | --- | --- |
| Rebuild on Artist OS | full loop; the old site stays live until cutover | Artist OS form | one-click, then cutover approval |
| Static repo (GitHub) | Site Builder edits their code; build uses their command if present | Artist OS function or their existing form via inspect | one-click on the push |
| WordPress | content operations map to posts and pages through the REST API | their plugin form if detected, else a sidecar page | one-click on the publish call |
| Closed builder (Squarespace, Wix, Bandzoogle) | Website Agent operates cued edits through `browser_tool`; weekly routine limited to sidecar pages | sidecar page on the managed subdomain | one-click for sidecar; browser edits only on the artist's cue |

Inspect output seeds `content/` so nothing is retyped. The mode is recorded
on the manifest and the Monday Brief says which mode it ran in.

## Implementation Slices

Ordering is by shared-contract leverage, not by the order the questions were
asked. Slice A makes both 38 and 39 real and gives every later slice a
receipt to write. Slice D is last because most first users have no site, and
it is the slice with the most one-off adapter code.

Each slice maps to the numbered slices in 38 and 39 so nothing is built
twice.

### Slice A — Publishing and subscriber capture

Covers 39 Slices 2, 4, and 5; 38 Slice 1 and the drain half of 38 Slice 3.

- `ChangeReceipt` records and the two receipt collections.
- `ApprovalPolicy` on the manifest; trusted-mode eligibility and revocation.
- Cloudflare Workers adapter, `website_connect_host`, `website_deploy`,
  `website_rollback`, `website_history`, `website_status`, target approval.
- Capture function with Resend or KV backend; `website_capture_sync`;
  the subscriber handoff into Community with consent evidence and receipts.
- Domain connection: `website_domain_set`, `website_domain_check`, cutover
  receipt with previous DNS.
- Website page: status, history with Rollback, doors.

Acceptance tests:

- A preview publish needs no approval and produces no receipt; a production
  publish without target approval fails with the exact message; with target
  approval and a human turn it deploys and writes a `site-publish` receipt
  whose `after.buildHash` matches the fetched site.
- Rollback restores the previous deploy id, writes a `site-rollback` receipt,
  and sets `trustedRevokedAt`.
- A signup through the site form appears in Community within one drain with
  `source: 'signup-form'`, form tag, `ipHash`, and a `subscriber-import`
  receipt counting one imported; a second signup with the same email counts
  as a duplicate and creates nothing; a suppressed email counts as skipped.
- Connecting a domain writes a `domain-cutover` receipt with `before.dns`
  populated before any DNS instruction is shown.

### Slice B — Website Agent and the weekly routine

Covers 39 Slice 3 and the Monday Brief.

- `website-agent` starter, routing hints, the `site-growth` and `artist-seo`
  skills, Artist Manager routing line.
- The weekly routine as a spec 33 automation with a workflow-run action:
  read signals, decide staleness, brief Site Builder, build, audit, preview,
  drain capture, compose the Monday Brief.
- `MondayBrief` attention payload, HQ home card with per-item Publish, Skip,
  Rollback; messaging bridge rendering through spec 26.
- Trusted mode offer after five clean publishes; auto-publish for
  content-only under trusted with the card marked accordingly.
- Approval binding to build hash with `approval-invalidated` when the hash
  changes before the click.

Acceptance tests:

- With a new calendar show and nothing else, the routine produces one
  `SiteChangeBrief` with one `upsert-show` operation, one build, one preview
  Output, and one Monday Brief with a `site` item and no `emails` item; no
  deploy occurs.
- Clicking Publish on the card deploys the bound hash and writes a receipt;
  a rebuild between brief and click invalidates the approval and the card
  shows `approval-invalidated`.
- Under trusted mode the same run deploys, writes a receipt with
  `approval.tier: 'trusted'`, and the card shows Rollback.
- A design-class diff under trusted mode still lands as `needs-approval`.
- Two consecutive idle weeks produce exactly one collapsed `nothingToDo`
  card.
- A Site Builder brief that fails returns a reason and the Monday Brief
  contains that reason with the run marked `execution-failed`, not lost.

### Slice C — Community Agent liaison

Covers 38 Slices 2, 4, and 6, and the send half of 38 Slice 2.

- `community-agent` starter and the `community_*` tools from 38.
- `CommunityLiaisonBrief` handling: segments, tags, one draft per run.
- Email items in the Monday Brief with frozen audience counts; Send and Edit
  and Skip; approval binds to job id; suppression re-checked at send.
- Approved templates and the welcome path from 38 Slice 6.
- `IdeaBrief` to World Builder from either agent; ideas as proposals.

Acceptance tests:

- A run with three new subscribers and a release in 10 days yields one email
  job in `needs-owner-approval`, an `emails` item on the brief with recipient
  count equal to the frozen audience, and no send.
- Clicking Send sends through 38's engine, writes an `email-send` receipt
  with `counts.recipients`, and a subscriber suppressed between draft and
  click is excluded and counted.
- A template the artist approved once sends the welcome email to a confirmed
  subscriber with no card.
- World Builder returns three ideas; the brief shows them under `ideas` and
  nothing on the site or in email changes because of them.
- The Community Agent never calls `website_deploy`; the Website Agent never
  calls `community_send_email`.

### Slice D — Existing-site connection

Covers 39 Slices 6 and 7.

- `website_inspect_external` and the mode picker on the Website page.
- WordPress adapter over the REST API with an application password.
- Static-repo mode through the GitHub source; Netlify adapter; zip export.
- Closed-builder mode: browser-operated cued edits, sidecar pages on the
  managed subdomain, Sidecar Sync in the weekly routine.
- Manifest `mode` and `external` populated; the Monday Brief names the mode.

Acceptance tests:

- Inspect on WordPress, Squarespace, and Netlify fixtures identifies the
  platform, inventories pages within the bound, flags missing capture, and
  writes nothing.
- WordPress mode: an `upsert-show` operation becomes one page update through
  the API and one `site-publish` receipt; the theme is untouched.
- Closed-builder mode: the weekly routine publishes only sidecar pages and
  never attempts a deploy to the external platform; a cued bio edit runs
  through the browser and writes a receipt with `rollback.kind: 'none'` and
  the previous text in `before`.
- Rebuild mode keeps the old site live until the cutover receipt exists.

## Visibility

- **HQ home**: the Monday Brief card at the top of Needs You while
  unresolved; receipts reachable from the Website page History and the
  Community page Sends.
- **Website page**: status, mode, last receipt summary, Rollback, trusted
  mode toggle with the eligibility line.
- **Messaging**: the brief renders as a short message with numbered items;
  replies `publish 1`, `send 2`, `skip 3` resolve items through the same
  decision path. Only the paired sender may decide (spec 26).
- **State of Play**: three rules from 39 and three from 38 stay; this spec
  adds one: a Monday Brief older than seven days with unresolved items.

## Compliance And Safety

- Receipts never contain subscriber emails, only counts and hashes.
- The capture function accepts only email, first name, and form id; it
  hashes IP and never stores the raw address.
- Trusted mode cannot be enabled by an agent. Only the toggle on the Website
  page sets it, and any rollback clears it.
- Browser-operated edits on closed builders run only in a session with a
  human turn, never from the routine, and the agent never enters credentials.
- The Website Agent and Community Agent each have `notFor` routing hints
  naming the other, so a misrouted request is handed off rather than
  attempted.

## Open Questions Resolved Here

- **Who owns the weekly cadence when 38 and 39 both define Monday
  routines?** This loop does. 39's Weekly Site Update and 38's Weekly Note
  become steps of this routine. Site Health, Signup Drain, Fan Inbox Pass,
  and Release Mode stay as their own automations because they run on
  different clocks.
- **What if the artist wants the site update and the email on different
  days?** The routine has two schedule inputs, site day and email day, and
  produces one brief per day that has items. Default is the same Monday.
- **Can trusted mode ever cover email?** No. The unattended email path is an
  approved template, which is a different thing: the artist approved that
  exact content once, and only the audience changes.

## Launch Criteria

- An artist with a Cloudflare key, a promoted release, and two shows on the
  calendar gets a Monday Brief with the site change and a drafted email,
  approves both from the HQ card, and the site and the send both complete
  with receipts, without opening a session.
- A fan who signs up on the site is in Community with consent evidence
  before the next brief and is counted in it.
- After five clean publishes the artist is offered trusted mode; with it on,
  a new show reaches the live site with no click and a Rollback on the card.
- One rollback turns trusted mode off and the next brief asks again.
- An artist with a Squarespace site gets an inspect report, keeps the site,
  and has a sneak-peek door on a sidecar page inside the same week, with the
  weekly brief naming closed-builder mode.
- No test can make an agent publish, send, or cut over without the matching
  approval tier.

## Product North Star

Monday, 9:12 AM. The card says: "Added the Denver and Boulder shows, moved
'Low Tide' to the hero. 14 new fans from the site, 2 from the sneak-peek.
Draft: 'Two Colorado nights' to core-fans (61)." The artist reads it in the
time it takes to make coffee, taps Publish and Send, and goes back to
writing. In October the card says "published automatically" and shows
Rollback. They never learn what a deploy is, and they never wonder whether
their fans heard about the show.
