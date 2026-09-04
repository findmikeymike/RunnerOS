---
status: proposed
owner: agent
last_verified: 2026-09-03
source_of_truth: true
related: ../26-agent-bound-messaging-spec.md, ../33-automations-input-aware-setup-spec.md, ../13-scheduled-work-composer-execution-spec.md, ../09-hq-state-of-play-proactive-routing.md
---

# Community Email Engine And The Community Agent

## Decision

Artist OS becomes the artist's fan-relationship system, not a contact list with
a disabled send button.

- **Resend is the fan lane.** Every fan-facing email, every blast, every reply
  to fan mail goes out through the artist's own Resend account, from a verified
  artist domain. The artist brings their own API key.
- **Gmail is the personal lane.** When the user asks for a specific email to go
  to a specific person as themselves, it goes through their connected Gmail.
- **Agents know which lane is which.** The rule is a law in the Artist Manager
  and the Community Agent, not a judgement call per email.
- **A Community Agent is a first-class starter agent.** It reads the fan list,
  grows it, segments it, drafts newsletters and drops, triages the fan inbox,
  and replies. "Create a Community Agent" is one click from the Community tab.
- **Approval is the one click that already exists in the data model.** A
  broadcast to real people gets one Approve on the job. Everything else the
  user cues in a session is already approved by the cue.
- **No hosted infrastructure in V1.** Resend exposes sent-email status, inbound
  mail, and contacts as pollable list endpoints, so the desktop app closes the
  loop by pulling. Webhooks and a hosted signup function are V2 accelerators,
  not prerequisites.

## The Product Judgement

An artist with two thousand emails and no way to talk to them has nothing. An
artist with two hundred emails, a weekly note that gets opened, and an agent
that answers fan mail the same day has a career asset that no platform can
throttle.

The system already models fans well: consent with evidence, suppression,
frozen audiences, fatigue tracking. What is missing is everything downstream of
the record: sending, hearing back, learning who the real fans are, and letting
an agent do the work. This spec finishes the loop.

The failure mode to avoid is a wall of prompts. A fan email is not a wire
transfer. The design puts exactly one human confirm where the blast radius is
real (a broadcast to many humans) and nowhere else.

## Current State

Verified in tree on 2026-09-03.

**Built and solid**

- Fan records: `CommunityContactRecord` with `emailHash`, `consentStatus`,
  `consentEvidence { source, capturedAt, ipHash, formId }`, `segments`, `tags`,
  `lastContactedAt` (`packages/shared/src/community/types.ts:14-34`).
- Suppression: `CommunitySuppressionRecord` with reasons unsubscribed, bounced,
  complained, manual-block and sources manual, gmail, esp, import
  (`types.ts:36-41`).
- Email jobs: `CommunityEmailJobRecord` with frozen audience, compliance block,
  cadence and fatigue, `idempotencyKey`, `transport.provider`, `approval`,
  `send` counters, and a ten-value `EmailJobStatus` (`types.ts:66-124`).
- Audience math excludes suppressed and unknown-consent contacts for
  newsletters and announcements; personal outreach may include unknown consent
  (`storage.ts:512-545`).
- Default job status is `draft` when the caller may send, otherwise
  `needs-owner-approval` (`storage.ts:547-555`). In solo mode every permission
  is allowed (`workspaces/team-mode.ts:575`).
- RPC: get, add contact, import CSV with consent attestation, create email job,
  suppress (`packages/server-core/src/handlers/rpc/community.ts`).
- Community tab on the People page: segment pills, Add Fan, CSV import, Draft
  Email, Email Queue list
  (`apps/electron/src/renderer/components/app-shell/CommunityPage.tsx`).
- Generated `artist-community` summary doc consumed by the State of Play
  composer (`packages/shared/src/hq-state/types.ts:15`) and readable by HNIC
  through `get_artist_context topic:'community'`.
- `RESEND_API_KEY` app-level secret preset and a Community Email connection
  card (`SecretsSettingsPage.tsx:125-132, 618-624`).
- Gmail source with readonly and compose scopes; list calls capped at 25 and
  require an intent (`sources/api-tools.ts:21-39`); every Gmail send fails
  closed into an exact-approval prompt
  (`agent/core/pre-tool-use.ts:1020-1039`).
- Outreach Agent and Comms Agent draft through Gmail; neither touches the
  community module (`agent-definitions/starter-templates.ts:1402-1500`).

**Shell only**

- The Resend send handler is a stub that always returns an error
  (`packages/server-core/src/handlers/rpc/community-email.ts:25-30`). No Resend
  API call exists anywhere in the tree.
- No code transitions an existing job's status. `approved`, `queued`,
  `sending`, `sent`, `failed`, `cancelled` are declared and never written.
- The Email Queue renders status text and has no Approve, Schedule, or Cancel.
- Agents have no community write tools. Nothing lets an agent add a fan, tag,
  segment, draft a job, or read the list beyond the summary counts.
- Segments are a fixed five-value union (`types.ts:10`). No custom or derived
  segments.
- The `signup-form`, `esp-sync`, and `gmail-import` sources are declared and
  nothing produces them.
- No inbound mail. No engagement data. No reason a fan ever becomes "core".
- The in-app guide and Secrets copy promise Resend sending that does not work
  (`artist-guide-content.ts:195-199`).

## Core Laws

1. **Two lanes, no exceptions.** Fan-facing mail and anything addressed to more
   than one person goes through Resend from the artist domain. Mail the user
   asks to send as themselves to a named person goes through their Gmail. An
   agent never sends a fan blast from Gmail and never sends the user's personal
   correspondence from the Resend address.
2. **Consent is the audience.** Broadcasts include `opted-in` only. Personal
   outreach may include `unknown` and `transactional-only`. Suppressed hashes
   never receive anything, from either lane, ever.
3. **One click for a broadcast, none for a reply.** A job addressed to many
   people needs one Approve from the owner. A reply or single fan email cued by
   the user in a session sends on the cue. Automations may send only through
   an approved template.
4. **Artist OS is the system of record.** Resend segments and contacts are a
   mirror for delivery and unsubscribe hosting. Sync is one-directional per
   field: consent and suppression flow in from Resend, everything else flows
   out.
5. **Never send blind.** A send runs only after a suppression and consent sync
   younger than fifteen minutes. Bounces and complaints suppress on the next
   pull. Unsubscribes take effect locally within one sync interval, well inside
   the 48-hour obligation.
6. **Every send leaves a receipt.** Per-recipient delivery records carry the
   provider email id and last event. A job cannot reach `sent` without them.
7. **Fatigue warns, it does not block.** The existing seven-day cadence flag
   surfaces on the job and in the Approve dialog. The owner may override, and
   the override is recorded.
8. **Agents read the list, never the hashes.** Tools return contact ids,
   names, emails only when the caller is drafting a personal email, segments,
   tags, and engagement. Bulk export is a human action in the UI.

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │  Artist OS (desktop, system of record)       │
                 │                                              │
  Community tab ─┤  records/community/{contacts,segments,       │
  Needs You      │    email-jobs,deliveries,inbox,suppression}  │
  Community Agent┤                                              │
  Artist Manager │  CommunityMailService (server-core)          │
                 │   ├─ ResendClient (typed, key from secrets)  │
                 │   ├─ Sender: broadcast | direct              │
                 │   ├─ Sync: contacts | deliveries | inbox     │
                 │   └─ Doors: inbound JOIN, signup kit         │
                 └───────────────┬──────────────────────────────┘
                                 │ pull every 15 min while open,
                                 │ and before every send
                 ┌───────────────▼──────────────────────────────┐
                 │  Resend (artist's own account)               │
                 │  segments + contacts (mirror)                │
                 │  broadcasts (hosted unsubscribe, topics)     │
                 │  emails API (replies, personal, welcome)     │
                 │  receiving (fan mail in, JOIN door)          │
                 └──────────────────────────────────────────────┘

  Gmail lane: unchanged. api_gmail draft + exact-approval send.
```

### Why broadcasts for blasts and the Emails API for everything else

Gmail and Yahoo require one-click unsubscribe headers pointing at a URL that
accepts a POST. A local desktop app has no such URL. Resend Broadcasts host the
unsubscribe page and a preferences page with Topics, and inject the link via
`{{{RESEND_UNSUBSCRIBE_URL}}}`. So newsletters and announcements go out as
Broadcasts against a mirrored Resend segment.

Replies, welcome emails, personal outreach through the artist domain, and
transactional mail go through the Emails API (single or batch of up to 100)
with an `Idempotency-Key`, tags carrying the job and contact ids, a `reply_to`
of the receiving address, and `In-Reply-To` and `References` headers when
answering a thread. These are one-to-one and carry no bulk-unsubscribe
obligation.

Resend rate limit is ten requests per second per team. The client queues with
a token bucket at eight per second and retries on 429 with backoff.

## Data Model

All new records extend `SharedEntityMeta` and live under `records/community/`
using the existing shared-record writer, so team mode, conflicts, and sync
behave exactly as they do for contacts today.

### Provider configuration

Stored in workspace settings, not in records, because it is per-workspace
configuration and contains no fan data.

```ts
interface CommunityMailProviderConfig {
  provider: 'resend';
  from: { name: string; email: string };          // must be on a verified domain
  replyTo?: string;                                 // defaults to receiving address
  receiving?: {
    address: string;                                // hello@artist.com or <id>.resend.app
    mode: 'resend-app-subdomain' | 'custom-domain';
  };
  postalAddress?: string;                           // CAN-SPAM footer, required for broadcasts
  topics?: { newsletter?: string; drops?: string; shows?: string };  // Resend topic ids
  segmentMirror: Record<string, string>;            // local segment id -> Resend segment id
  cursors: { sentEmails?: string; receivedEmails?: string; contacts?: string };
  lastSyncAt?: string;
  domainStatus?: { checkedAt: string; verified: boolean; domain: string };
  autoReply: {
    enabled: boolean;
    categories: InboxCategory[];                    // categories an approved template may answer
    templateJobId?: string;
  };
}
```

### Segments become records

```ts
type CommunitySegmentKind = 'manual' | 'derived';

interface CommunitySegmentRecord extends SharedEntityMeta {
  id: string;               // slug; the five built-ins keep their ids
  label: string;
  kind: CommunitySegmentKind;
  rule?: DerivedSegmentRule;
  resendSegmentId?: string;
  memberCount: number;      // recomputed on load
}

type DerivedSegmentRule =
  | { type: 'engagement-score'; min: number }              // core-fans
  | { type: 'joined-within-days'; days: number }           // new-30d
  | { type: 'no-open-since-days'; days: number }           // dormant
  | { type: 'tag'; tag: string }
  | { type: 'city'; city: string };
```

Built-in derived segments shipped on first load: `core-fans`
(engagement-score ≥ 60), `new-30d`, `dormant-90d`. Derived membership is
computed, never stored on the contact, so it is always current.

### Contact additions

```ts
interface CommunityContactRecord {
  // existing fields unchanged, plus:
  firstName?: string;
  lastName?: string;
  resendContactId?: string;        // replaces ad-hoc use of espExternalId
  engagement?: {
    score: number;                 // 0-100, decays; see Engagement
    opens30d: number;
    clicks30d: number;
    replies90d: number;
    lastOpenedAt?: string;
    lastClickedAt?: string;
    lastRepliedAt?: string;
  };
  joinedAt?: string;               // first consent capture; defaults to createdAt
}
```

### Email job additions

```ts
interface CommunityEmailJobRecord {
  // existing fields unchanged, plus:
  transport: {
    provider: 'resend' | 'gmail' | 'manual-export';   // 'esp' retired by migration
    mode?: 'broadcast' | 'direct';                     // resolved from purpose
    resendBroadcastId?: string;
    topicId?: string;
  };
  template?: {
    approvedAt?: string;
    approvedByMachineId?: string;
    variables: string[];            // e.g. ['first_name']
  };
  send?: {
    // existing counters, plus:
    scheduledFor?: string;
    batches?: Array<{ index: number; idempotencyKey: string; emailIds: string[]; at: string }>;
    lastError?: string;
  };
  origin?: { kind: 'user' | 'agent' | 'automation'; sessionId?: string; automationId?: string };
}
```

Mode resolution: `newsletter` and `announcement` are `broadcast`.
`personal-outreach` and `transactional` are `direct`. A `direct` job with more
than 100 frozen members is refused at creation with the message "Use a
newsletter or announcement for this many people."

### Delivery records

One per recipient per job. Collection `community/deliveries`.

```ts
interface CommunityDeliveryRecord extends SharedEntityMeta {
  jobId: string;
  contactId: string;
  emailHash: string;
  resendEmailId?: string;
  lastEvent?: 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained'
            | 'opened' | 'clicked' | 'failed' | 'suppressed';
  lastEventAt?: string;
  error?: string;
}
```

Broadcast sends produce one delivery record per frozen member with
`resendEmailId` unset until per-recipient events can be attributed (see Open
Verifications). The job's `send.sentCount` for a broadcast is the frozen
member count minus contacts Resend reports as unsubscribed at send time.

### Inbox records

Collection `community/inbox`.

```ts
type InboxCategory = 'fan-love' | 'question' | 'booking' | 'press' | 'business'
                   | 'support' | 'unsubscribe-request' | 'spam' | 'other';

interface CommunityInboxRecord extends SharedEntityMeta {
  resendReceivedId: string;
  messageId: string;
  inReplyTo?: string;
  fromEmail: string;
  fromName?: string;
  contactId?: string;              // matched by email hash
  subject: string;
  textPreview: string;             // first 600 chars; full body fetched on demand
  hasAttachments: boolean;
  receivedAt: string;
  triage?: { category: InboxCategory; confidence: number; by: 'agent' | 'user'; at: string };
  status: 'new' | 'needs-reply' | 'drafted' | 'replied' | 'archived' | 'auto-replied';
  reply?: { jobId?: string; resendEmailId?: string; at: string; by: 'user' | 'agent' | 'automation' };
  handoff?: { agentSlug: string; sessionId?: string };   // e.g. booking -> outreach-agent
}
```

### Summary doc (agent-visible) extension

`CommunitySummaryDoc` gains `growth { new7d, new30d, unsubscribed30d }`,
`engagement { coreFans, dormant, avgOpenRate30d? }`, `inbox { new, needsReply }`,
and `provider { connected, fromVerified, receivingEnabled }`. The State of Play
composer already reads this doc; it gains three opportunity rules (below).

## The Send Engine

`CommunityMailService` lives in server-core beside the existing handlers. It is
the only code that holds a `ResendClient`. Session tools and RPC call it; the
renderer never touches Resend.

### Job lifecycle

```
draft ──(needs provider?)──> needs-provider
draft ──(broadcast)────────> needs-owner-approval ──Approve──> approved
draft ──(direct, cued)─────> approved
approved ──(scheduledFor in future)──> queued ──(tick)──> sending
approved ──(now)───────────> sending
sending ──> sent | failed
any pre-sending ──Cancel──> cancelled
```

Transitions are backend-owned and atomic, following the scheduled-work
pattern. The renderer only calls `community.APPROVE_JOB`, `community.CANCEL_JOB`,
`community.SCHEDULE_JOB`, and `community.SEND_NOW`.

### Pre-flight (every send, both modes)

1. Provider config present, `from` on a domain Resend reports verified within
   the last 24 hours. Otherwise `needs-provider` with a specific message.
2. Sync suppression and contacts from Resend if `lastSyncAt` is older than
   fifteen minutes.
3. Re-derive the audience from `frozenMemberHashes` minus any hash suppressed
   since freeze. Record the delta on the job.
4. Broadcast only: `postalAddress` present, `compliance.requiresUnsubscribe`
   satisfied by the footer template, `senderIdentityConfirmed` true.
5. Fatigue check: if `lastBroadcastAt` is inside `minDaysBetweenBroadcasts`,
   mark `cadence.fatigued`. Blocks nothing; the Approve dialog shows it.

### Broadcast send

1. Ensure a Resend segment exists for the job (one per job, named
   `aos-job-<id>`), or reuse the mirrored segment when the audience equals a
   whole local segment.
2. Upsert every audience member as a Resend contact with `first_name`,
   `properties { aos_contact_id, aos_segments }`, and add to the segment.
   Contacts already mirrored are skipped unless changed.
3. Render markdown to HTML with the footer: postal address and
   `{{{RESEND_UNSUBSCRIBE_URL}}}`. Merge `{{{contact.first_name|there}}}`.
4. Create the broadcast with `segment_id`, `from`, `reply_to`, `subject`,
   `preview_text`, `html`, `text`, optional `topic_id`, and either `send: true`
   or `scheduled_at`. Store `resendBroadcastId`.
5. Write delivery records, set `sending`, then poll the broadcast until
   `status` is `sent`; set `sent`, `send.completedAt`, and stamp
   `lastContactedAt` on every member.

### Direct send

1. Build one Emails API request per recipient: `from`, `to`, `reply_to`,
   `subject`, `html`, `text`, `tags [{ name: 'aos_job', value }, { name: 'aos_contact', value }]`,
   and thread headers when replying.
2. Send in batches of up to 100 with `Idempotency-Key` =
   `${job.idempotencyKey}-b${index}`. Store returned ids on delivery records.
3. Set `sent` when every batch has ids; `failed` with `lastError` if any batch
   fails after three retries, keeping partial ids so a retry never double-sends.

### Approved templates (the only way automations send)

A job may be promoted to a template by the owner once. A template has fixed
subject and body with merge variables and a fixed audience rule. An automation
or the auto-reply policy may instantiate and send a template without a new
Approve. Editing a template clears `approvedAt`. This is how a welcome email,
a drop-day reminder, or a "thanks for writing" acknowledgment runs unattended
without a wall of prompts and without an agent improvising a blast.

## Sync (pull, no webhooks)

`community.SYNC` runs every fifteen minutes while the app is open, on Community
tab open, and as pre-flight. Each pass is bounded to 500 items per list and
resumes from cursors.

- **Contacts** — `GET /contacts` paginated. New contacts not matched by hash
  become local contacts with `source: 'esp-sync'` (or `'signup-form'` when the
  contact carries `properties.aos_form_id`), consent `opted-in` with evidence
  `{ source: 'resend', formId, ipHash }` when present. `unsubscribed: true`
  writes a suppression `{ reason: 'unsubscribed', source: 'esp' }` and sets
  consent `unsubscribed`.
- **Sent emails** — `GET /emails` after cursor. Match `tags.aos_job` and
  `tags.aos_contact` to delivery records; write `lastEvent`. `bounced` and
  `complained` write suppressions and set consent. `opened`, `clicked`
  update engagement.
- **Received emails** — `GET /emails/receiving` after cursor. Create inbox
  records, match contact by hash, fetch the body on demand via
  `GET /emails/receiving/{id}`. A subject or first line matching the JOIN
  door (below) is routed there instead of the inbox.
- **Domain** — `GET /domains` daily; store `domainStatus`.

Sync never deletes local data. Conflicts resolve by law 4.

## Engagement

Score is computed on load from delivery and inbox records, not stored as
truth:

```
score = min(100,
  15 * opens(30d, cap 4)
+ 25 * clicks(30d, cap 2)
+ 30 * replies(90d, cap 1)
+ 10 * (joined within 30d ? 1 : 0))
decayed by 0.85 per 30 days since last event
```

Engagement feeds `core-fans` and `dormant-90d`, the contact drawer, and the
summary doc. A newsletter with an open rate below 15 percent over two sends
raises a State of Play opportunity ("Your newsletter is not landing").

## Capture Doors

Two doors ship in V1. Neither needs hosting.

### The JOIN door (inbound email, double opt-in)

The artist advertises one address: "email JOIN to hello@artist.com" on the
site, in bios, in captions, on merch. Sync sees a received email whose subject
or first line is `join` (case-insensitive, plus `subscribe`, `sign me up`).
The service:

1. Creates or updates the contact with `source: 'signup-form'`, consent
   `unknown`, evidence `{ source: 'inbound-join', capturedAt, formId: 'join-door' }`.
2. Sends the approved **Welcome template** through the direct lane, with a
   line "Reply YES to confirm you want emails from <artist>."
3. On the next received email from that address in a thread matching the
   welcome `message_id` (or any reply containing `yes`), sets consent
   `opted-in` with evidence `{ source: 'inbound-join-confirm', capturedAt }`
   and sends the confirmed-welcome template if one exists.

Unconfirmed contacts age out of the funnel after 14 days and stay
`unknown`, which means they never receive a broadcast.

### The gated-audio door (site form, generated kit)

The Community Agent can generate a **Signup Door kit** as an Output: a
single-file serverless function (Netlify, Vercel, or Cloudflare) plus a form
snippet. The function holds the artist's Resend key as an environment
variable, validates the email, hashes the IP, and calls Resend
`POST /contacts` with `properties { aos_form_id, aos_ip_hash, aos_download }`
and adds to the mirrored `general` segment, then returns the gated file URL.
Sync picks the contact up within fifteen minutes with source `signup-form`
and full consent evidence.

The kit is generated, reviewed, and deployed by the user. The app never holds
a hosted endpoint. Where the artist's site is already run by a Runner, the
same function is the recommended target.

## The Community Agent

### Starter template

```ts
{
  slug: 'community-agent',
  metadata: {
    name: 'Community Agent',
    description: 'Grows and runs the artist\'s fan list: signups, segments, newsletters, drops, and the fan inbox, all through the artist\'s own Resend domain.',
    avatar: '💌',
    permissionMode: 'ask',
    thinkingLevel: 'medium',
    greeting: 'Want to grow the list, send something, or go through fan mail?',
    inputs: 'A goal (grow, announce, re-engage, reply), a segment or audience, and any release or event context.',
    outputs: 'Drafted and approval-ready broadcasts, sent replies, updated segments and tags, and a growth or engagement readout.',
    tags: ['community', 'email', 'fans', 'newsletter', 'resend', 'inbox', 'growth'],
    skills: ['artist-comms-strategist', 'community-growth'],
    sources: [],
    optionalSources: ['gmail'],
    trustedWorkerTools: [
      'community_list_contacts', 'community_get_contact', 'community_upsert_contact',
      'community_tag_contacts', 'community_set_segment', 'community_create_segment',
      'community_draft_email', 'community_update_email_draft', 'community_send_email',
      'community_inbox_list', 'community_inbox_get', 'community_inbox_triage',
      'community_reply', 'community_sync_now', 'community_stats',
    ],
    routing: {
      bestFor: [
        'newsletters, drop announcements, show reminders, and re-engagement emails to fans',
        'replying to fan mail and triaging the fan inbox',
        'growing the email list: signup doors, gated downloads, giveaways',
        'segmenting fans by city, engagement, or purchase and reporting list health',
      ],
      notFor: [
        'a personal email the user wants sent as themselves to one named person (outreach-agent or comms-agent through Gmail)',
        'press, label, or industry outreach (outreach-agent)',
        'social posts (social-publisher)',
      ],
      handsOffTo: ['outreach-agent', 'comms-agent', 'social-publisher', 'release-manager'],
    },
  },
  systemPrompt: /* see below */,
}
```

### System prompt (laws the agent carries)

- The two lanes, stated exactly as Core Law 1.
- "Draft first, send on the cue." For a broadcast: create the job, show the
  audience math and fatigue state, and tell the user it is waiting for their
  Approve on the Community tab or in Needs You. For a reply or a single fan
  email the user asked for: send it and report the receipt.
- "Never invent a list." Only `community_list_contacts` decides who is in an
  audience. Never paste addresses into a Gmail call.
- Voice comes from `artist-comms-strategist`, profile, and voice context. A
  newsletter is short, personal, one call to action, no marketing filler.
- Inbox triage categories and their routing: `booking` and `business` hand
  off to `outreach-agent` with the thread; `press` to `comms-agent`;
  `unsubscribe-request` suppresses immediately and confirms; `spam` archives.
- Growth playbook it knows without being told: JOIN door copy for bios and
  captions, gated-audio kit, giveaway mechanics (tag entrants, pick winners
  from a segment, announce via broadcast), post-show city blasts using the
  `city` derived rule, and "core fans first" early access before public
  announcements.
- Memory scope: `agent` for voice and cadence preferences; `user` only for
  facts every agent needs.

### Skill: `community-growth`

A starter skill holding the playbooks above as procedures with copy
templates: welcome sequence, drop-day sequence, show-week sequence,
re-engagement note, giveaway rules, and the JOIN door copy set. Kept in the
skill so the system prompt stays short and the user can edit playbooks.

### "Create a Community Agent"

- The Community tab shows a card when no active agent has the `community`
  tag: "Create a Community Agent" with two options. **Use the starter**
  activates `community-agent` as-is. **Customize** opens the agent-creator
  interview seeded with the starter and the Community context, so the user
  can rename it, set voice, and pick which automations to turn on.
- Activation checks provider setup and offers the setup card inline when the
  Resend key or `from` is missing. It does not block activation.
- After activation the card is replaced by the agent's row: last run, next
  scheduled routine, and an "Ask" field that opens a session bound to it,
  the same pattern as Ask Manager on HQ home.
- The Artist Manager's routing prose gains one line: fan email and community
  work go to `@community-agent`; if it is not activated, offer to create it.

### Session tools

All under `packages/session-tools-core`, `executionMode: 'registry'`, handlers
delegating to `SessionToolContext` callbacks that server-core binds to
`CommunityMailService`, exactly as `get_artist_context` does today.

| Tool | Safe mode | Read-only | Notes |
| --- | --- | --- | --- |
| `community_list_contacts` | allow | yes | filters: segment, tag, consent, minScore, city, q; limit ≤ 200; returns ids, names, segments, tags, score; emails only when `forPersonalEmail: true` and limit ≤ 10 |
| `community_get_contact` | allow | yes | full record minus hash; engagement timeline |
| `community_stats` | allow | yes | growth, engagement, inbox counts, last sends, provider status |
| `community_inbox_list` | allow | yes | status, category, since; limit ≤ 50 |
| `community_inbox_get` | allow | yes | fetches full body on demand |
| `community_upsert_contact` | block | no | requires `consentStatus` and `consentEvidence.source` |
| `community_tag_contacts` | block | no | add or remove tags; ≤ 500 ids |
| `community_set_segment` | block | no | add or remove membership; manual segments only |
| `community_create_segment` | block | no | manual or derived with rule |
| `community_draft_email` | block | no | creates job; returns audience math, fatigue, mode, and what happens next |
| `community_update_email_draft` | block | no | subject, body, audience, scheduledFor; refused once `approved` |
| `community_send_email` | block | no | broadcast: moves to `needs-owner-approval` and raises Needs You. direct: sends now when the session has a human turn; otherwise requires an approved template |
| `community_reply` | block | no | replies to an inbox record through Resend, threaded; sends now when human-cued |
| `community_inbox_triage` | block | no | sets category, status, handoff |
| `community_sync_now` | block | no | bounded sync pass |

"Has a human turn" is the same signal spec 33 uses for answer evidence: the
current session contains a user message that is not an automation seed.

### Gmail lane behavior (unchanged, stated for completeness)

Personal email keeps the current path: `api_gmail` draft, then the exact
approval prompt on send. This spec does not relax that prompt. If the user
later decides a session cue should also cover Gmail sends, that is a one-line
change in `pre-tool-use.ts` and a separate decision.

## Routines (spec 33 automations, all opt-in)

Each is a normal automation the user turns on from the Community tab or that
the Community Agent proposes. Each declares its inputs so the setup flow can
fill them. Runs land in the one list with the `community` tag.

| Routine | Schedule | Agent | Output |
| --- | --- | --- | --- |
| Weekly Note | Mon 09:00 local, staggered like Spotify Snapshot | community-agent, safe | one newsletter job in `needs-owner-approval`, Needs You entry with audience math and preview |
| Fan Inbox Pass | every 30 min while open | community-agent, safe | triage new inbox records; draft replies as `drafted`; auto-reply only for enabled categories through the approved template |
| Drop Day | on release date from Release Manager, 09:00 | community-agent | announcement job to `core-fans` 24h early, `general` on the day; both need Approve |
| Show Week | 7 days before any calendar event tagged show | community-agent | city-segment announcement job |
| Re-engage | first Monday monthly | community-agent | note to `dormant-90d`, needs Approve; suggests pruning after two unopened sends |
| Welcome | event: new confirmed contact | service, no agent | approved Welcome template through direct lane |
| Community Sync | 15 min | service, no agent | not shown as a run; surfaces only on failure |

Every routine's job carries `origin.automationId`, and the Needs You entry
deep-links to the job drawer.

## UI

Community tab, in order:

1. **Provider card** (collapsed when healthy): Resend key state, `from`,
   domain verified, receiving address, postal address, last sync. Broken
   state explains exactly what to do in Resend and links there.
2. **Community Agent card**: create, or the activated agent's row with Ask.
3. **Segments**: manual and derived, counts, add segment, derived rule
   editor for the three rule types.
4. **Fans**: existing list with engagement dot, score sort, and a contact
   drawer showing consent evidence, tags, segments, delivery timeline, and
   inbox threads.
5. **Inbox**: new, needs reply, drafted, replied. Row opens the thread with
   the drafted reply editable and a Send button. Booking and press rows show
   the handoff.
6. **Sends** (replaces Email Queue): every job with status, audience count,
   fatigue flag, scheduled time. Row opens the job drawer: rendered preview
   with the footer, audience math including post-freeze exclusions,
   compliance checklist, and the actions Approve, Schedule, Send now,
   Cancel. Approve is a single click with the fatigue warning inline.
7. **Templates**: approved templates and which routines use them.

HQ home: Needs You gains "Approve: <job title> to <n> fans" and "<n> fan
emails need a reply". State of Play gains three rules: list growth stalled
30 days, newsletter open rate under 15 percent over two sends, and inbox
replies older than three days.

## Compliance Built In

- Broadcasts always carry the hosted unsubscribe link and the postal address.
- Suppression syncs every fifteen minutes and before every send.
- Imported lists keep the existing consent attestation; `unknown` never
  receives a broadcast.
- JOIN door is double opt-in by construction.
- If a broadcast's complaint count exceeds three or bounce count exceeds five
  percent of recipients on the next sync, further broadcasts move to
  `needs-owner-approval` with an attention note explaining the numbers, and
  State of Play raises it. This is a warning gate, not a lock.
- The receiving address is never used as a Gmail alias, and the Gmail address
  is never used as a broadcast `from`.

## Migration

- `transport.provider: 'esp'` on existing jobs becomes `'resend'`.
- The five built-in segment ids become `CommunitySegmentRecord`s of kind
  `manual`; contact `segments` arrays are unchanged.
- `espExternalId` copies into `resendContactId` when present.
- Guide and Secrets copy update to describe what actually works at each
  slice.

## Implementation Slices

### Slice 1 — Resend client and provider config
`ResendClient` with typed methods used by this spec, token bucket, retry,
idempotency. Provider config read and write, domain check, setup card.
Replace the stub handler. Guide copy honest.

### Slice 2 — Job lifecycle and the broadcast sender
Backend-owned transitions, Approve, Schedule, Send now, Cancel RPCs. Segment
mirror, contact upsert, broadcast create and poll, delivery records,
`lastContactedAt`. Sends drawer with the Approve flow. This is the slice that
makes the feature real.

### Slice 3 — Sync and engagement
Contacts, sent emails, and domain pulls with cursors. Suppression from
unsubscribes, bounces, complaints. Engagement score, derived segments,
segment records, contact drawer.

### Slice 4 — Agent hands
All fifteen session tools, the Community Agent starter, the
`community-growth` skill, the Artist Manager routing line, "Create a
Community Agent" card, routing hints. Direct sender for `community_send_email`
and personal outreach.

### Slice 5 — Inbox and replies
Received-email pull, inbox records, triage, threaded reply, handoffs, Inbox
section, Fan Inbox Pass routine.

### Slice 6 — Doors and templates
Approved templates, Welcome routine, JOIN door with double opt-in, Signup
Door kit generator, giveaway playbook in the skill.

### Slice 7 — Routines and State of Play
Weekly Note, Drop Day, Show Week, Re-engage as spec 33 automations with
declared inputs. Needs You entries, summary doc extension, three State of
Play rules, complaint and bounce warning gate.

Slices 1 through 3 need no agent work and can ship behind the Sends drawer.
Slice 4 is where the user feels it.

## Required Tests

### Lanes and audience
- A broadcast job built from a segment containing unknown-consent and
  suppressed contacts excludes both and reports the counts.
- A direct job with 101 members is refused; 100 is accepted.
- A hash suppressed after freeze is excluded at send and the delta is
  recorded on the job.
- `community_list_contacts` never returns emails unless `forPersonalEmail`
  with limit ≤ 10.

### Send engine
- Broadcast send creates exactly one Resend segment, upserts each member
  once, creates one broadcast, and reaches `sent` after the poll reports
  sent. Re-running after a crash between steps does not create a second
  broadcast (idempotency by job).
- Direct batches use distinct idempotency keys; a failed third batch leaves
  the first two ids intact and the job `failed`; retry sends only the third.
- Pre-flight with an unverified domain moves the job to `needs-provider`
  and never calls send.
- Fatigue sets the flag and does not block; the override is recorded.

### Sync
- A Resend contact with `unsubscribed: true` produces a suppression with
  source `esp` and consent `unsubscribed`; a later local edit cannot flip it
  back to `opted-in` without new evidence.
- Bounced and complained events suppress; opened and clicked update
  engagement and the score decays correctly across 30-day windows.
- Cursors resume; a sync interrupted mid-page does not skip items.

### Doors
- A received email with subject `JOIN` creates an `unknown` contact and sends
  the welcome template; a reply `yes` flips consent to `opted-in` with
  evidence; no reply within 14 days leaves consent `unknown` and the contact
  out of every broadcast audience.

### Agent behavior
- `community_send_email` on a broadcast job moves it to `needs-owner-approval`
  and raises a Needs You entry; it never calls Resend.
- `community_reply` in a session with a human turn sends immediately; in an
  automation-only session without an approved template it returns "drafted,
  waiting for you" and writes `drafted`.
- Auto-reply sends only for enabled categories and only the approved
  template; editing the template clears approval and stops auto-reply.
- The Artist Manager routes "send the fans a note about the show" to
  `community-agent` and "email Sarah at the venue about load-in" to the Gmail
  lane.

### Compliance gate
- Three complaints on a broadcast move the next broadcast to
  `needs-owner-approval` with the explanatory note.

## Launch Criteria

- An artist with a Resend key, verified domain, and a CSV of opted-in fans
  can, from a single session with the Community Agent, have a newsletter
  drafted, approve it in one click, and see it reach `sent` with delivery
  records.
- A fan who emails JOIN and replies yes is opted in without the artist
  touching anything, and receives the next broadcast.
- A fan who unsubscribes through the hosted page is suppressed locally within
  fifteen minutes and is absent from the next audience.
- A fan reply in the inbox can be answered by the agent on the user's cue with
  no prompt, and the thread is visible in the contact drawer.
- Personal outreach still goes through Gmail with its existing approval, and
  no test can make an agent send a blast through Gmail.

## Open Verifications During Implementation

These are facts about Resend to confirm in Slice 1 before the design above is
frozen. Each has a fallback.

1. Whether emails sent by a Broadcast appear in `GET /emails` with
   `last_event`, so per-recipient engagement can be attributed without
   webhooks. Fallback: broadcast-level engagement stays dashboard-only in V1
   and V2 adds a webhook receiver.
2. Whether `topic_id` on the Emails API injects an unsubscribe link or only
   filters recipients. If it injects, direct-mode sequences may use it.
3. Whether contacts can be added to a segment at create time via `segments`
   or need a second call. Both are cheap.
4. Receiving-domain plan limits and whether the `.resend.app` subdomain is
   available without a custom domain, so the JOIN door works on day one.
5. Whether `In-Reply-To` and `References` through `headers` are honored for
   threading on replies to received mail.

## V2

- Webhook receiver as an optional hosted function, giving real-time events
  and broadcast-level opens and clicks.
- SMS lane through the same job model.
- Fan profiles merged with Shopify buyers (`buyers` becomes derived from
  orders).
- Team inbox: multiple humans replying, tied to spec 26's V2 team-chat note.

## Product North Star

The artist opens Artist OS on a Monday. Needs You says: "Approve: Weekly Note
to 412 fans" and "3 fan emails need a reply." They read the note, hit Approve,
skim the three replies the Community Agent already drafted, send two, and
tell the agent to hand the booking one to Outreach. Total time: four minutes.
Their list grew by 31 people this week from the JOIN address in their TikTok
bio, and the agent already knows which 60 of them are core fans for the drop
next Friday.
