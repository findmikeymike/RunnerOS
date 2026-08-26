---
status: backlog
owner: unassigned
last_verified: 2026-08-25
source_of_truth: true
---

# Artist OS V2 Feature Ideas

High-leverage career capabilities worth considering after the current integrated beta is smoked and stabilized. This is intentionally not a broad feature wishlist.

## Product Principle

Artist OS is already strong at songwriting, creative direction, content ideation and production, campaign planning, social publishing, paid ads, industry outreach, college radio, Spotify and YouTube intelligence, merch, Calendar, Community, and State of Play.

V2 should strengthen the thinner business layer:

- protect ownership and income
- turn fragmented metrics into career decisions
- surface real external opportunities
- convert attention into an owned fan relationship

Do not add more agents when an existing worker plus one focused skill or workflow can own the job.

## Priority 1 — Rights & Revenue Desk

### Why it matters

Release Setup currently tracks Distributor Upload, Pre-Save Link, and Credits and Metadata, but there is no true release-operations or rights specialist. Credits and Metadata currently routes to Comms Agent, which can compile facts but should not own catalog administration.

### Lean product shape

- **New persistent agent:** `rights-revenue-desk`
- **Placement:** available in Artist HQ and Campaigns
- **Canonical context:** `artist-rights-ledger`, with per-release references rather than duplicated data
- **Skills:**
  - `release-metadata-audit`
  - `rights-registration-roadmap`
  - `royalty-statement-reconciler`
- **Tools:** Vault document/CSV/PDF reading, deterministic metadata validation, and read-only browser guidance for official rights portals. Direct registration or submission can come later and must remain approval-gated.

### Core jobs

- Build a fact-checked credits, contributors, ownership, and release-metadata packet.
- Track split-sheet status, ISRC, UPC, IPI, ISWC, distributor, PRO, publisher/admin, MLC, SoundExchange, and neighboring-rights status without pretending every artist needs the same registrations.
- Flag conflicting names, percentages, identifiers, ownership claims, and missing registrations.
- Import royalty statements and detect missing periods, unexplained changes, duplicate/mismatched titles, and catalog items that may not be collecting correctly.
- Produce a red/yellow/green release-admin report and exact next actions.

### Boundaries

- Do not give legal, tax, or financial advice.
- Do not invent ownership, splits, identifiers, or registration status.
- Do not file, register, accept terms, change banking/tax data, or submit claims without explicit approval for the exact action.
- Never store bank, tax, identity-verification, or portal credentials in shared workspace context.

## Priority 2 — Career Analyst

### Why it matters

Artist OS has strong Spotify analysis and YouTube research/intelligence, but no single career-level analyst joining streaming, social, advertising, Community, merch, and live signals. Artists need decisions, not six disconnected dashboards.

### Lean product shape

- **New persistent agent:** `career-analyst`
- **Automation:** one disabled-by-default weekly Career Pulse
- **Canonical context:** `artist-career-snapshot`
- **Sources:** reuse Spotify Analyst outputs, YouTube data, social account analytics or exports, paid-ad results, Community growth, merch results, and later live/ticket data.
- **Optional premium source:** Chartmetric or a comparable provider; V2 must still work without it.

### Core jobs

- Normalize meaningful deltas across connected sources.
- Separate vanity growth from saves, follows, owned-fan capture, purchases, ticket intent, and repeat engagement.
- Identify credible correlations while clearly distinguishing them from causation.
- Explain what moved, what likely contributed, what is uncertain, and the single best next experiment.
- Feed compact evidence into State of Play instead of creating another dashboard wall.

### Cost controls

- Skip analysis when source fingerprints have not changed.
- Calculate deltas deterministically before any model call.
- Use one inexpensive synthesis call per activated weekly run.
- Keep source-specific collection jobs separate and reusable.

## Priority 3 — External Opportunity Radar

### Why it matters

State of Play ranks internal obligations and next moves. Industry Hunter finds relevant people. Neither is yet a bounded, recurring source of currently open external opportunities.

### Lean product shape

- **No new agent.** Add `artist-opportunity-scout` to Industry Hunter.
- **New workflow/automation:** `opportunity-radar`, disabled by default.
- **Handoff:** Industry Hunter verifies opportunities; Outreach Agent handles selected contact research and drafts.

### Core jobs

- Find currently open sync briefs, grants, showcases, festivals, support slots, brand collaborations, residencies, and other relevant submission calls.
- Return at most five strong opportunities per run.
- Verify source, deadline, eligibility, geography, cost, submission method, rights implications, and artist fit.
- Reject pay-to-play, stale, unverifiable, exploitative, or weak-fit listings.
- Add only user-selected deadlines to Calendar and feed verified opportunity signals into State of Play.
- Never apply, pay, submit, or contact anyone without explicit approval.

## Priority 4 — Fan Funnel Builder

### Why it matters

Artist OS already has Community contacts, VIP/local/buyer/street-team segmentation, email jobs, and Comms Agent. The missing layer is converting social and streaming attention into permissioned, owned fan relationships.

### Lean product shape

- **No new agent.** Add `fan-funnel-builder` to Comms Agent.
- **Optional tool:** a minimal static landing-page/smart-link builder or a connected link provider.
- **Data destination:** existing `artist-community`; do not create a second fan database.

### Core jobs

- Build campaign-specific pre-save, email-signup, merch, show, or fan-club funnels.
- Create one clear value exchange and CTA, not generic “join my mailing list” copy.
- Generate source-tagged links and UTM conventions.
- Import consented contacts with source, city, segment, and date.
- Propose lightweight welcome and campaign sequences through Comms Agent.
- Report visitor-to-signup and signup-to-action conversion when evidence exists.

### Boundaries

- Publishing a page, connecting a domain, or sending a sequence requires explicit approval.
- Consent, suppression, unsubscribe, and provider deliverability rules remain mandatory.
- Never scrape followers into Community or treat a platform follower as an opted-in contact.

## High-Value Follow-On Workflows

### Sync Pitch Pipeline

Build after Rights & Revenue Desk exists. This should be a workflow, not a new agent:

1. Rights & Revenue Desk verifies ownership, clearance readiness, metadata, alternate mixes, clean/instrumental/stem availability, and contact information.
2. Industry Hunter or Opportunity Radar identifies active briefs and credible supervisors/libraries.
3. Outreach Agent creates individualized, approval-ready pitches.
4. The workflow produces one canonical sync packet and submission queue.

### Live Booking Pack

Optional for artists who actively perform; do not enable by default.

- Combine Spotify city data, Community geography, Bandsintown event data, Artist Network, venue research, Calendar, and Outreach.
- Build realistic city/venue shortlists, routing options, support-slot targets, break-even assumptions, and outreach packets.
- Never book, announce, purchase travel, or accept terms without explicit approval.

## Explicitly Do Not Build Yet

- More generic content-idea agents.
- Separate Instagram, TikTok, X, and YouTube strategy agents.
- Another generic manager, chief-of-staff, or release-readiness agent. State of Play already owns readiness and priority; enrich its signals instead.
- Another brand or visual-direction agent.
- Separate sync, grants, festival, brand-deal, and booking agents before the shared Rights and Opportunity foundations prove insufficient.
- Platform integrations that add account and maintenance burden without a clear career decision or action they unlock.

## Recommended V2 Sequence

1. Rights & Revenue Desk and `artist-rights-ledger`.
2. Career Analyst and weekly Career Pulse.
3. Opportunity Radar as an Industry Hunter workflow.
4. Fan Funnel Builder through Comms Agent and Community.
5. Sync Pitch Pipeline.
6. Optional Live Booking Pack.

## Promotion Gate

Before moving any idea into active implementation, define:

- the exact user decision or career outcome it improves
- existing agents, skills, sources, and context it reuses
- one canonical data owner
- model/tool cost ceilings
- approval boundaries for public, financial, legal, or account actions
- a representative live smoke proving the feature creates a useful artifact or action

## Research Anchors

- [The MLC Songwriter Hub](https://www.themlc.com/songwriter-hub)
- [The MLC works-registration guidance](https://help.themlc.com/en/support/how-to-register-works-in-the-mlc-portal)
- [SoundExchange for artists, labels, and producers](https://www.soundexchange.com/what-we-do/for-artists-labels-and-producers/)
- [Chartmetric API](https://help.chartmetric.com/en/collections/Chartmetric%20API)
- [Bandsintown for Artists](https://www.artist.bandsintown.com/overview)
- [Bandsintown API documentation](https://help.artists.bandsintown.com/en/articles/9186477-api-documentation)
- [DISCO sync metadata guidance](https://support.disco.ac/home/pdfexport/id/67115122cc7595244308d683)
