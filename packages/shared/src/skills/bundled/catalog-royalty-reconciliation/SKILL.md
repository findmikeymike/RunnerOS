---
name: catalog-royalty-reconciliation
description: Build an artist-owned released catalog, reconcile BMI/ASCAP/SESAC, MLC, SoundExchange, and copyright evidence, rank probable gaps, and prepare filing packets without filing them.
inputs: Distributor exports, manual catalog rows, artist-confirmed registration evidence, split sheets, rights-and-credits records, and optional Spotify completeness notes.
outputs: Confirmed catalog, organization-by-organization status matrix, prioritized probable-gap list, and blocked-or-ready filing packets.
tags: [rights, royalties, catalog, bmi, soundexchange, mlc]
---

# Catalog & Royalty Reconciliation

Use this skill for career-wide rights and royalty registration work in Artist HQ.
It covers four distinct lanes:

- **PRO**: ASCAP, BMI, SESAC, or GMR composition registrations.
- **MLC**: US digital mechanical composition registrations.
- **SoundExchange**: sound-recording registrations and both featured-artist and
  sound-recording-copyright-owner capacity.
- **Copyright Office**: legal registration status, clearly labeled as legal
  protection rather than a royalty source.

## Durable workspace

Keep the artist-owned package under:

```text
vault/business/rights-and-royalties/
  catalog/
  registration-evidence/
  filing-packets/
```

Prefer the artist's distributor export as the catalog authority. Spotify may
help find releases to investigate, but never persist a Spotify-derived catalog
as the system of record.

## Status language

Use only these meanings:

- `confirmed`: the artist confirmed evidence for that organization.
- `probable-gap`: supplied evidence did not show a match; verify before filing.
- `possible-match`: title/writer similarity exists, but identifiers are missing.
- `not-checked`: the artist has not supplied evidence for that organization.
- `needs-review`: evidence conflicts, is incomplete, or may still be processing.

Never turn `not-checked` into `not registered`. ISRC identifies a recording;
ISWC identifies a composition. One composition can map to several recordings.

## Browser-assisted lookup

ASCAP, BMI, SESAC, Songview, and SoundExchange do not permit bulk database
scraping. Use a visible, artist-supervised browser session instead:

1. Open the organization's normal landing page in Artist OS Canvas/browser.
2. Release control only for login, password entry, 2FA, CAPTCHA, or any other
   private identity check.
3. After the artist confirms login, resume control and navigate the normal site
   UI one page or one catalog lookup at a time. Keep the browser visible and
   stop immediately if the artist takes control or asks you to stop.
4. Read the visible result and structure a proposed capture.
5. Show the capture to the artist and save it only after they confirm it is
   accurate.

Never ask for, enter, expose, or store passwords, recovery codes, 2FA codes,
cookies, or raw session tokens. Do not use headless browsing, hidden background
queries, rapid pagination, bulk loading, or database scraping. Do not attempt to
bypass a CAPTCHA, rate limit, access restriction, or site refusal. Paste or
uploaded exports are supported and usually faster for a large catalog.

MLC programmatic lookup is allowed only through a sanctioned MLC API connection
that Artist OS has actually configured. Its absence means `not-checked`, not a
blocker and not a negative result.

## Reconciliation

1. Normalize titles for case, punctuation, `Pt.` versus `Part`, featured-artist
   suffixes, and common version labels such as Live, Remix, Acoustic, or Radio Edit.
2. Match exact identifiers first. Treat title-and-writer matching as approximate.
3. Preserve every recording/version and its ISRC while mapping related versions
   to one composition/ISWC when confirmed.
4. Rank probable gaps by likely money at stake: active recent releases first,
   then older recoverable releases, then dormant catalog.
5. State which sources were checked and which were not checked.

For SoundExchange, check both capacities separately. A self-releasing artist may
need a featured-artist claim and a sound-recording-copyright-owner claim; one
does not prove the other.

## Filing packets

Prepare one packet per organization and work with title, alternate titles,
ISRCs, known ISWC, writers and IPI/CAE values, publisher, ownership capacity,
release date, and source evidence. Mark each value as artist-confirmed,
Artist-OS-derived, or missing.

Do not file or submit. Do not invent or normalize ownership splits. If splits
are missing, conflict, or do not total 100%, mark the packet `blocked` and name
the decision the artist must resolve.

Create a concise collection Output in Canvas containing:

1. Coverage summary by organization
2. Catalog and status matrix
3. Prioritized probable gaps
4. Ready filing packets
5. Blocked packets and missing decisions
6. Evidence/source ledger with confirmation dates

Keep registration evidence private to Artist HQ. Do not broadcast the full
catalog or rights package into every agent prompt. Other workers should retrieve
it only when a song, release, licensing, sync, or rights task requires it.
