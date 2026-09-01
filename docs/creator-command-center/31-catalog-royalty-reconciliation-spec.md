---
status: proposed
owner: agent
last_verified: 2026-09-01
source_of_truth: true
related: ./07-artist-vault-architecture-spec.md, ./23-release-kit-architecture-spec.md, ./30-release-manager-essentials-execution-spec.md
---

# Catalog & Royalty Reconciliation

## Briefing For The Implementing Agent

Read this first. It contains the legal constraints that shape every design decision below, and they are non-obvious.

### What this is

An artist has released music over several years. Some of it is registered with the right royalty organizations; some of it almost certainly is not. Unregistered work earns money that sits unclaimed and is eventually redistributed to someone else.

This agent builds the artist's complete released catalog, checks it against what they can prove is registered, and produces a **gap list** plus a **filing packet**. It never files anything.

### The one hard constraint

**Every relevant royalty organization prohibits automated access to their databases.** This was verified directly against their live terms, not assumed:

| Org | Automated access | Evidence |
| --- | --- | --- |
| ASCAP | **Prohibited** | "webcrawler, spidering or other automated means"; "screen scraping"; "database scraping"; data "expressly opted out from use for text and data mining"; explicitly names "artificial intelligence and/or machine learning platforms, systems, applications, models or algorithms" as requiring prior written consent |
| BMI | **Prohibited (broadest)** | "any robot, spider, **script**, technology or **processes that send automated queries**"; database-specific section adds "You will only run manual queries through the interface that BMI provides" and "You will not capture, scrape, download or otherwise copy or store any query results" — violation terminates database access |
| SoundExchange | **Prohibited** | "You may not systematically or automatically collect, scrape, harvest, or use other means to copy data from the ISRC Search Site" |
| MLC | Prohibited by default, **but has a sanctioned path** | Standard robot/scraper prohibition, *and* an official Public Search API plus Bulk Data Access program |

So: **no scraping, no headless automation, no "read-only guarded" portal login.** The prohibition is on the *means*, not the purpose. Artist-owned account, user-directed, read-only — none of it changes the analysis, and BMI's language reaches even a simple script sending queries.

This is not a risk-tolerance question. The account in question is the one the artist's royalties flow through, and losing database access is an explicit stated consequence.

### What that leaves, and why it's enough

The valuable work does not require touching a PRO site:

1. **Catalog** comes from the artist's own distributor export (authoritative) and optionally the Spotify Web API (sanctioned, for completeness checking).
2. **MLC registration status** comes from the **MLC Public Search API** — an officially sanctioned, documented programmatic path.
3. **PRO and SoundExchange status** comes from the artist looking, with the agent reading what is already on their screen. The human drives; the agent interprets.
4. **Reconciliation** — where nearly all the value is — is pure local logic requiring no third-party access at all.

### Second constraint: Spotify storage

Spotify Developer Terms (v10, May 2025): *"you may not store, aggregate or create compilations or databases of Spotify Content, other than as strictly necessary to operate your SDA."*

There is no carve-out for an artist's own catalog. Therefore **Spotify is a completeness check, not the system of record.** The distributor export is the durable catalog. Spotify data is used transiently to find gaps in it and is not persisted as a Spotify-derived database.

### Third constraint: ISRC ≠ ISWC

- **ISRC** identifies a *sound recording*. One per version — studio, live, remix, remaster each get their own.
- **ISWC** identifies a *composition*. One per song, regardless of how many recordings exist.

Spotify and distributors speak ISRC. PROs and the MLC register compositions. **One ISWC maps to many ISRCs.** This means the agent's output is *"this recording exists and I cannot find a matching composition registration"* — a flag to check, never a verdict. Say so in the output.

### Why this is urgent, specifically

Not vague "you might be missing money." Under 37 CFR 382.5 and the MMA, MLC unmatched royalties are held for a **minimum of three years**, after which *"no claim to distribution shall be valid"* and the money is redistributed to existing members **by market share** — which overwhelmingly means major publishers. The MLC is expected to begin those redistributions in **2027**, starting with January 2021 usage.

Separately, **SoundExchange back-pays up to three years** on registration, so a registration today can recover accrued royalties.

That is the honest urgency hook: a statutory deadline after which unclaimed money is permanently forfeited to other parties.

### What you must not do

- **Do not scrape or automate** ASCAP, BMI, SESAC, Songview, or SoundExchange. Not headless, not "read-only," not with the artist's credentials.
- **Do not handle PRO credentials.** The agent never sees, stores, or enters a password.
- **Do not file, submit, or register anything.** Registration is a legal act; a work registered with wrong splits is worse than an unregistered one and takes years to unwind.
- **Do not persist a Spotify-derived catalog database.**
- **Do not state a registration gap as fact.** ISRC/ISWC asymmetry makes every gap a *probable* gap.

### Start here

Slice 1 (catalog from distributor export) and Slice 2 (reconciliation) deliver the entire core value with **zero external API dependencies** and no legal ambiguity. Everything after is enhancement.

---

## Purpose

Artist OS knows an artist's future — the Vault holds unreleased masters, the Release Kit holds approved campaign assets. It knows nothing about their past.

The back catalog is where royalty money is lost, and it is lost silently. There is no notification when a song fails to match, no alert when a claim window closes. The artist finds out years later, or never.

## User Promise

Point the agent at your catalog. It tells you which of your released songs appear to be registered nowhere, ranked by how much they are probably earning, with a filled-in filing packet for each and a plain statement of what it could and could not verify.

You file. It never files for you.

## Non-Goals

- No automated access to any PRO, SoundExchange, or Songview.
- No credential handling for any royalty organization.
- No filing, submission, or registration of any kind.
- No legal advice. This flags gaps and prepares data; it does not opine on ownership, splits, or entitlement.
- No royalty *accounting* or audit of payment amounts in V1 — this is about registration existence, not whether payments were correct.
- No persistent Spotify-derived catalog database.

## Core Laws

```text
Automated access to royalty databases is prohibited. Honor it.
The artist's own data is always the preferred source.
A gap is a flag to check, never a verdict.
Prepare filings; never submit them.
Say plainly what was verified and what was assumed.
```

## The Four Registrations

The agent must understand these are distinct and independently missable. Most artists conflate them.

| Registration | Covers | Pays for | Commonly missed because |
| --- | --- | --- | --- |
| **PRO** (ASCAP/BMI/SESAC/GMR) | Composition | Public performance — radio, TV, venues, streaming performance share | Artist registers as *writer* only and forfeits the *publisher* share (50% of performance royalties) |
| **MLC** | Composition | US mechanical royalties from on-demand streaming and downloads | Artists assume their PRO covers all streaming. It does not. MLC launched Jan 2021; pre-2021 artists often never registered |
| **SoundExchange** | Sound recording | Digital performance on *non-interactive* platforms — SiriusXM, Pandora radio, internet radio | Most missed of all. Self-releasing artists who own masters can claim both owner (50%) and featured artist (45%) shares, but only if registered in **both** capacities |
| **Copyright Office** | Legal record | Nothing — it enables statutory damages in litigation | Not a royalty source; include for completeness, mark clearly as legal-not-revenue |

All four are free to join except Copyright Office registration.

## Catalog Sources

In priority order. The agent uses the highest-quality source available and states which it used.

### 1. Distributor export (preferred, authoritative)

The artist's own data, unambiguous to use, and it contains ISRCs.

- **TuneCore** — Sales Reports export as CSV including ISRC columns. The cleanest documented bulk path.
- **DistroKid** — ISRCs are per-release in the dashboard; no confirmed one-click bulk CSV. Guide the artist to per-release lookup or support request.
- **CD Baby** — per-release lookup. Note: CD Baby retains administrative rights over ISRCs it assigns, which complicates later distributor migration.
- **UnitedMasters** — per-release; paid tier required.

The agent provides distributor-specific instructions rather than attempting any automated retrieval.

### 2. Spotify Web API (optional, completeness check only)

Used to find releases missing from the distributor export — older work, label releases, features under another artist profile.

Retrieval chain, with call-volume consequences:

```
GET /v1/artists/{id}/albums        → simplified albums, 50/page, paginate
                                     query each include_group separately
                                     (combining types has known offset bugs)
GET /v1/albums/{id}/tracks         → simplified tracks — NO ISRC at this level
GET /v1/tracks?ids=<up to 50>      → full tracks — external_ids.isrc HERE
```

**ISRC requires the third call.** A 200-track catalog needs ~4 batch `/tracks` calls on top of album discovery. Budget accordingly.

- **Client Credentials flow is sufficient** — no user OAuth, no callback URL. Setup is pasting two values.
- Rate limits are a rolling 30-second window; handle `429` with `Retry-After`.
- Per the storage constraint above, Spotify results inform the catalog but are **not persisted as a Spotify database**. Confirmed catalog entries live in Artist OS records.

**Multiple artist profiles must be supported.** Features, alternate names, and label-released work sit under different Spotify artist IDs. A single-ID assumption silently under-reports the catalog — which produces false "you have no gaps" confidence, the worst possible failure here.

### 3. Manual entry

Always available. Some catalog predates digital distribution entirely.

## Registration Status Sources

### MLC — sanctioned API

The **MLC Public Search API** is the one officially sanctioned programmatic lookup in this entire domain. Register at `themlc.com/dataprograms`; access is via `bulk.data@themlc.com`.

Eligibility as published names *"music publishers and administrators, DSPs, CMOs, music technology companies, and others"* — **Artist OS registers as a music technology company**, once, not per artist. Independent songwriters are not explicitly named on that list; do not assume individual-artist eligibility.

**Bulk Data Access** (DDEX BWARM) also exists and is statutorily mandated, but the MLC's own materials reference *pricing* — do not assume it is free. Evaluate Public Search API first; it is the better fit for per-work lookups.

### PRO and SoundExchange — human-driven capture

No automated path exists or is permitted. The supported flow:

1. Agent explains exactly what to look for and where.
2. **Artist navigates and logs in themselves.** The agent never handles credentials.
3. Agent reads what is on screen and structures it — the existing `chrome-cdp` pattern.
4. Artist confirms the captured list before it is stored.

This is assistive interpretation of a human-driven session, not automated access. Alternatively the artist pastes or uploads a works list; both paths must be supported, and the paste path must never be treated as second-class.

## Reconciliation

Pure local logic. No third-party access. This is where the value is.

### Matching

- **ISRC-exact** when both sides have ISRCs — high confidence.
- **Title + writer fuzzy** otherwise — normalized for case, punctuation, "Pt./Part", parenthetical suffixes (Remix, Live, Acoustic, Radio Edit), and feature credits.

Fuzzy matching is unreliable in *both* directions: it misses real registrations (producing false gaps) and matches wrong ones (producing false comfort). Every fuzzy result carries that caveat into the output.

### Output confidence, stated honestly

| Situation | What the agent says |
| --- | --- |
| ISRC-matched, registration found | "Registered with MLC" |
| ISRC-matched, no registration found | "No MLC registration found — verify and file" |
| Title-matched only | "Possible match by title — ISRC unavailable, verify manually" |
| No registration data supplied for an org | "Not checked — you have not provided your ASCAP works list" |

That last row matters most. **Never present "not checked" as "not registered."** Telling an artist a registered song is missing sends them to file a duplicate, which creates a conflict.

### Prioritization

Rank gaps by likely money at stake, not alphabetically:

1. Recent releases with meaningful streams — actively accruing
2. Older releases within the MLC three-year window — recoverable but expiring
3. Everything else

Surface the 2027 redistribution deadline against the specific songs it applies to.

## Filing Packet

For each gap, prepare — never submit:

- Which organization is missing the registration
- Every field that filing requires: title, alternate titles, ISRC(s), writers with IPI/CAE where known, splits, publisher, shares, release date
- **Explicitly flagged: missing or non-summing splits.** Splits that do not total 100% must block the packet with a clear statement rather than being silently normalized.
- A deep link to the correct filing page
- What the artist must decide (publisher entity, share allocation)

Pull known values from the Release Kit's `rights-and-credits` data where present, and say which fields came from Artist OS versus which the artist must supply.

**Splits are the highest-risk field.** Filing wrong splits creates a dispute requiring every other writer's agreement to fix. When splits are uncertain, the packet must say so and stop.

## Agent Definition

- **Slug:** `catalog-royalty-agent`
- **`permissionMode: 'ask'`** — every external action confirmed
- **`trustedWorkerTools`:** read/create only — catalog reads, `create_output`. **No filing tool exists.** The absence of the capability is the guarantee, not a prompt instruction.
- **Sources:** Spotify Web API (optional), MLC Public Search API (optional). Both optional so the agent degrades rather than blocks.

### Source readiness

Reuse `resolveAgentSourceReadiness` (`packages/server-core/src/sessions/agent-source-readiness.ts`), which already distinguishes `ready` / `degraded` / `blocked` and separates `authentication-required` from `disabled` and `missing`.

Both APIs declared **optional** → absent yields `degraded`, never `blocked`. The agent must state which mode it is in and what that costs:

> "Spotify isn't connected, so I'm working from your TuneCore export alone. That covers everything you distributed through them — I may miss older or label-released work. Connecting Spotify takes about five minutes and closes that gap."

## UI

Lives in HQ, not a campaign — this is career-wide, not release-scoped.

- **Catalog view:** every released work, with a registration status column per organization (PRO / MLC / SoundExchange), and an explicit "not checked" state visually distinct from "not registered."
- **Gap list:** prioritized, with the reason and confidence for each.
- **Filing packet:** per gap, copyable, with the deep link.
- **Deadline banner:** only when gaps actually fall within an expiring window. Not a permanent alarm.

Progress is honest: *"You've provided ASCAP and MLC data. SoundExchange not yet checked."*

## Failure And Edge Cases

| Condition | Behavior |
| --- | --- |
| No distributor export, no Spotify | Manual entry only; say so plainly |
| Spotify API not connected | `degraded`; distributor export only; explain the gap |
| MLC API not available | Skip MLC checking; mark "not checked", never "not registered" |
| Artist has multiple Spotify profiles | Support additional IDs; a single ID silently under-reports |
| Title-only matching | Every result carries the approximate-match caveat |
| Splits missing or not summing to 100% | Packet blocks with explanation; never auto-normalize |
| Song registered under a different title | Fuzzy match may miss; surface as "verify" not "missing" |
| Cover songs / samples | Out of V1 scope; flag as needing human judgment |
| Work already filed but not yet in the database | Registration lag is real; recommend verifying before re-filing |

## Security And Privacy

- **No PRO credentials, ever.** Not stored, not entered, not seen.
- Catalog and registration data are artist-private; they follow existing Vault privacy rules and never route into shared agent context without explicit consent.
- Captured screen data from a human-driven session is stored only after the artist confirms it.
- ASCAP's repertory terms permit data use *"solely for evaluation purposes... for your own benefit"* — this design stays inside that: the artist evaluates their own catalog. The data is never redistributed, resold, or used to build a derivative database.

## Implementation Slices

**Slice 1 — Catalog from distributor export.** CSV import with per-distributor guidance, ISRC capture, manual entry. No external APIs. Ships value alone.

**Slice 2 — Reconciliation engine.** Artist-supplied registration lists (paste/upload), ISRC-exact and title-fuzzy matching, confidence levels, gap list, prioritization. **Still zero external dependencies.** Slices 1–2 are the whole core.

**Slice 3 — Filing packets.** Field assembly from Release Kit rights data, split validation, deep links.

**Slice 4 — MLC Public Search API.** Registration as a music technology company, sanctioned automated MLC lookup. First external dependency.

**Slice 5 — Spotify completeness check.** Client Credentials, the three-call ISRC chain, multi-profile support, transient use per the storage constraint.

**Slice 6 — Human-driven PRO capture.** `chrome-cdp` assisted reading with artist confirmation.

**Slice 7 — Deadline tracking.** MLC three-year windows, SoundExchange back-pay eligibility.

## Acceptance Tests

### Legal boundary

- No code path issues an automated request to ascap.com, bmi.com, repertoire.bmi.com, or soundexchange.com
- No credential field for any PRO exists anywhere in the codebase
- No filing/submission tool is registered for this agent
- Spotify-derived data is not persisted as a standalone catalog database

### Honesty

- "not checked" is never rendered or reported as "not registered"
- every title-only match carries the approximate caveat
- degraded mode states which source is missing and what it costs
- a gap list built from a single Spotify profile warns that other profiles may exist

### Reconciliation

- ISRC-exact matching succeeds where both sides have ISRCs
- title normalization handles "Pt. 2"/"Part 2", punctuation, case, and parenthetical suffixes
- a registered work under a slightly different title surfaces as "verify", not "missing"
- prioritization ranks recent-with-streams above dormant catalog

### Filing packet

- splits not summing to 100% block the packet with an explanation
- fields sourced from Artist OS are distinguished from fields the artist must supply
- every packet links to the correct filing destination

### Readiness

- both APIs absent yields `degraded`, never `blocked`
- `authentication-required` is distinguished from `missing`

## Deferred

- Royalty *amount* auditing (are payments correct?) — a much larger problem
- International PROs and sub-publishing
- Neighbouring rights outside the US
- Automated ISRC→ISWC resolution via Supplemental Matching Network partners
- Copyright Office registration preparation
- Sync licensing (see Track Intelligence; different feature, shared catalog)

## Verification Status

Verified directly against live sources on `last_verified`:

- ASCAP, BMI, SoundExchange, and MLC terms — automated-access prohibitions quoted above
- ASCAP Repertory Search evaluation-use permission
- MLC Data Programs page — Public Search API and Bulk Data Access exist; eligibility wording as quoted
- Spotify endpoint chain and the simplified-vs-full track object ISRC distinction

**Not independently verified — confirm before relying:**

- MLC Public Search API cost, rate limits, and query semantics (requires contacting `bulk.data@themlc.com`)
- Whether Artist OS qualifies as a "music technology company" for MLC access
- Exact MLC redistribution start date — 2027 is the reported expectation, not a published guarantee
- Current distributor export formats; these change without notice
- Spotify's position on artist-owned-app catalog lookups under "strictly necessary"

Before Slice 4 or 5 ships, the MLC and Spotify questions above need a direct answer from each organization. Both are email-a-human questions, not documentation questions.
