---
name: music-ad-conversion-protocol
description: Plan and audit Meta music conversion campaigns for streaming growth, including smart-link flow, pixel events, manual Instagram placements, tiered geos, creative testing, benchmarks, and Spotify quality checks.
tags: [ads, meta, spotify-growth, campaign-strategy, paid-media, music-marketing]
---

# Music Ad Conversion Protocol

Use this when planning, auditing, or handing off a Meta music campaign whose goal is real streaming growth, saves, and active Spotify listener quality.

This skill plans and audits. It does not publish, pause, spend, or change ad accounts.

## Conversion Ecosystem

In music marketing, "conversion ads" usually mean:

1. Instagram/Facebook ad.
2. Smart landing page such as SubmitHub Links, Hypeddit, Feature.fm, Smart Noise, or similar.
3. Listener chooses Spotify, Apple Music, YouTube, etc.
4. Pixel event fires when the user clicks the streaming-service button.
5. Listener ideally streams, saves, follows, or enters the artist's catalog.

Do not optimize for accidental landing-page visits. Optimize for the service-button click event:

- SubmitHub Links: usually `View Content`.
- Hypeddit: usually Smart Link Click / Click.
- Feature.fm: usually FeatureFM Click.
- Other smart links: use the deepest available DSP button-click event.

## Pixel Validation

Before launch, require proof that the bridge works:

1. Use Chrome.
2. Disable ad blockers and third-party cookie blockers.
3. Open Meta Events Manager Test Events.
4. Load landing page and confirm Page View fires.
5. Click Spotify/Apple/YouTube button and confirm `View Content` or equivalent fires.
6. Confirm Pixel/Data Set ID exactly matches the landing page settings.

Page View is a weak signal. The streaming-service click event is the campaign's real optimization event.

## Manual Meta Setup

Default music protocol:

- Objective: Engagement.
- Conversion location: Website.
- Optimization event: `View Content` or equivalent smart-link click.
- Start budget: about $10/day for a cautious test.
- Testing phase: ABO / ad set budget so each audience or creative lane gets spend.
- Scaling phase: CBO only after winners are proven.
- Safety: campaign spending limit around the planned test window, commonly at least $100 for a 10-day test.

Reject or question default ecommerce-style automation:

- Do not rely on Sales/Leads defaults for a streaming campaign.
- Use Manual Setup when Meta suggests Advantage+ paths.
- Disable Advantage+ Audience during controlled tests.
- Disable Advantage+ Placements for music testing.
- Disable Creative Enhancements / AI Edits so Meta does not crop, brighten, rewrite, or damage the visual language.

## Placement Protocol

For early high-quality music conversion tests, prefer Instagram-only:

1. Instagram Feed.
2. Instagram Stories.
3. Instagram Reels.
4. Instagram Explore.

Turn off Facebook, Audience Network, and Messenger unless there is account-specific evidence that they produce quality streaming outcomes.

Audience Network can make costs look cheap while sending low-intent or bot-like traffic.

## Geo Protocol

Do not use worldwide targeting for early quality tests.

Use tiering:

- Tier 1: USA, UK, Canada, Australia, New Zealand, Germany.
- Tier 2: Brazil, Mexico, Italy.

Tier 1 costs more but tends to produce higher-value Spotify behavior and royalty value. Tier 2 can add efficient volume.

Be cautious with regions that can produce cheap conversions but weak Spotify outcomes, especially when Spotify Free usage or bot density makes actual stream/save quality poor.

## Audience Structure

Use layered targeting when manual control is needed:

- Layer 1: streaming behavior or app affinity such as Spotify OR Apple Music.
- Layer 2: relevant genre, artist, band, scene, subculture, or lifestyle signal.

The logic: find people who both fit the sound and plausibly use streaming services.

Do not over-trust a single broad interest. Do not use irrelevant lifestyle targeting just because CPM is cheap.

## Creative Testing Requirement

Do not risk the whole test on one clip.

Require a minimum viable creative set:

- 4 video assets minimum.
- 4-8 preferred.
- At least two distinct visual formats.
- At least two song sections if the song has multiple plausible hooks.

Approved creative lanes:

- lip-sync/performance
- lyric hook
- mood/cinematic b-roll
- AMV/cartoon/fandom edit
- stock/Kashi-style fallback
- direct "for fans of" bridge
- meme/UGC native format

If every ad is expensive, pivot creative format before blaming the audience.

## Learning Phase

Do not overreact during the first 3-4 days. A 3-7 day marination window is normal.

Avoid touching budget, targeting, placements, or creative during the first 96 hours unless there is a clear technical failure, policy issue, or spend safety problem.

## Benchmarks

Use these as directional benchmarks, not promises.

For mixed Tier 1/Tier 2 campaigns:

- Great: $0.20-$0.30 per conversion.
- Good: $0.30-$0.40.
- Mediocre: $0.40-$0.50.
- Poor: over $0.50.

For Tier 1-only campaigns, $0.35-$0.45 can still be strong because CPMs are higher.

Some highly relatable meme/UGC ads can get below $0.10, but this should be treated as an upside case, not a forecast.

## Spotify Reality Check

Meta conversions are not enough. Cross-check quality in Spotify for Artists when available:

- saves
- playlist adds
- followers
- source of streams
- "Your Profile and Catalog" share
- listener retention
- top cities
- algorithmic lift from Radio or Discover Weekly 2-3 weeks later

Strong campaign quality means active intent, not just cheap clicks.

## Kill, Hold, Scale, Pivot

Default rules:

- Great conversion cost plus Spotify quality signals: hold until stable, then scale 10-20%.
- Good cost but weak Spotify saves/catalog behavior: inspect landing page and targeting quality before scaling.
- Mediocre: test new visuals or song sections.
- Poor: kill the ad/ad set or restart with new creative.
- High watch time but no conversions: destination/CTA is unclear.
- Cheap conversions but no streams/saves: geo, placement, or traffic quality problem.

Never recommend scale from Meta dashboard alone.

## Runner Handoff Fields

When handing to Ad Runner, include:

- platform: Meta
- campaign objective and conversion event
- smart-link URL and landing-page tool
- Pixel/Data Set ID validation status
- account/business if known
- budget and test window
- geos
- placements
- audience layers
- creative asset list
- CTA and destination cue
- spending limit
- kill/hold/scale rules
- approval-needed actions

## Safety

- Never claim a campaign was launched unless Ad Runner verified it.
- Never recommend any live account mutation without explicit current-conversation approval.
- Never ask for passwords, cookies, 2FA codes, access tokens, or recovery codes.
- State uncertainty when Pixel, Spotify for Artists, or export data is missing.
