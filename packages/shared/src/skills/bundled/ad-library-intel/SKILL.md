---
name: ad-library-intel
description: Uses browser research across TikTok Creative Center, public music-ad examples, and Meta Ad Library to find music-ad creative vehicles, viral low-budget formats, hooks, angles, and paid validation signals for campaign planning.
tags: [ads, meta, tiktok, research, creative-intelligence, music-marketing]
---

# Ad Library Intel

Use this skill when the user asks what is working in music ads, wants competitor/similar-artist ad research, asks for viral music ad hooks, or needs creative/strategy inspiration before building a Meta or Google campaign.

## Research Priority

Default to **creative-vehicle scouting**, not strict artist similarity.

The goal is to find ad formats and hooks that can plausibly get reach or response on modest budgets. Similar artists are useful only if they are actively running relevant ads. Do not over-index on huge taste-neighbor artists just because the artist context mentions them.

Meta Ad Library is not a popularity-ranked search engine for normal music ads. Do not pretend it can sort US commercial ads by CTR, CPA, ROAS, reach, or spend. Use browser scouting to build a ranked list first, then inspect Meta ads.

Rank candidates by proxy signals:

- public viral proof: TikTok/Instagram/YouTube views, saves, comments, shares, or obvious repeat use of the same clip/hook
- active paid usage: the advertiser is currently running the format in Meta Ad Library
- longevity: the ad appears to have stayed live long enough to be more than a one-day test
- repeatability: the format can be made by a modest-budget artist with phone/performance/lyric/story assets
- pattern repetition: multiple advertisers use the same vehicle
- direct-response clarity: obvious CTA such as listen, save, watch, tickets, playlist, or follow

Browser priority order:

1. TikTok Creative Center / Top Ads / trend pages for music, entertainment, creator, app, or ecommerce examples with transferable hooks and visible engagement/performance-style signals.
2. Public music-ad example pages, agency/blog/video breakdowns, and platform case studies that show actual winning creative formats.
3. Meta Ad Library inspection for active comparable ads using the pages, artists, hooks, or vehicles found above.
4. Active indie, emerging, DIY, label, playlist, concert, and creator-style music ads with repeatable formats.
5. Repeated formats across multiple advertisers, even when the artists do not sound similar.
6. Similar artists only as a secondary input, and only when their ads are active and format-useful.

Important browser rule: do not use generic web search or DuckDuckGo as the first step for this workflow. Open the direct discovery URLs from `ad-library-plan` first. Search engines often block automated research with challenges and waste the run. Use search only after direct TikTok/Meta inspection, and only for a narrow missing item.

Avoid:

- Famous artists with no active paid ads.
- Big-brand campaigns that require celebrity scale, large production, or major-label budgets.
- Soundalike-only research that does not reveal a usable ad vehicle.
- Treating public ad presence as proof of performance. Use active status/longevity only as weak signals.

## Core Rule

This is public research. Do not request TikTok or Meta account passwords, cookies, 2FA codes, or ad-account access. TikTok Creative Center and the public Meta Ad Library normally do not require login for basic inspection. If either platform blocks automation or asks for verification, ask the user to continue manually or provide screenshots/captured examples.

## Workflow

1. Build the research plan:

```bash
node tools/ads-operator/bin/ads-operator.mjs ad-library-plan --artist "<artist>" --competitors "<similar artists or labels>" --keywords "indie artist new song, unsigned artist, viral song, listen now, music video out now, save this song, local show, playlist, for fans of" --countries "US" --json
```

2. Use browser automation for discovery:
   - Start by opening the direct `discoveryUrls` from `ad-library-plan`; do not search the web for those pages.
   - Start with TikTok Creative Center / Top Ads / trend pages in the browser.
   - Search music, entertainment, creator, concert, streaming, playlist, app, and ecommerce top ads. Borrow hook/format mechanics, not product category assumptions.
   - Capture the visible ad/hook, format, CTA, engagement/performance-style signals shown by the page, landing page, and why the vehicle could transfer to an artist campaign.
   - Use public blogs/videos/case studies only when they show actual creative examples or specific formats, not vague advice.
   - If a site blocks automation or a search engine shows a challenge, stop that branch quickly and continue from direct platform pages or user-provided screenshots. Do not loop on challenge pages.

3. Use browser automation against `https://www.facebook.com/ads/library` for validation:
   - Set category to `All ads`.
   - Search the pages, artists, hooks, vehicles, and music-ad terms found during discovery.
   - Search similar artists only after vehicle scouting, and skip them quickly if they have no active or format-useful ads.
   - Prefer ads that look repeatable by a modest-budget artist over ads that require fame, celebrity proof, or expensive production.
   - Prefer active ads.
   - Capture page name, search term, visible copy, headline, CTA, media type, platform chips, start date, destination URL, screenshot path, and source URL when visible.

4. Save captured examples as JSON:

```json
{
  "ads": [
    {
      "pageName": "Artist or label page",
      "searchTerm": "term used",
      "adText": "visible primary text",
      "headline": "visible headline",
      "description": "visible description",
      "cta": "Listen Now",
      "mediaType": "video",
      "platforms": ["facebook", "instagram"],
      "startDate": "Started running on ...",
      "destinationUrl": "https://...",
      "screenshotPath": "/absolute/path.png",
      "sourceUrl": "https://www.facebook.com/ads/library/..."
    }
  ]
}
```

5. Analyze the capture:

```bash
node tools/ads-operator/bin/ads-operator.mjs ad-library-analyze captured-ads.json --artist "<artist>" --json
```

## Output

Produce an `Ad Library Intel Packet` with:

1. Search scope: TikTok/browser discovery sources, Meta validation terms, artist, vehicle keywords, any useful competitors, countries, date checked.
2. Captured examples: source platform, page/advertiser, hook, angle, CTA, format, destination, source/screenshot.
3. Pattern read: repeated hooks, repeated angles, format mix, CTA mix, visual patterns.
4. Competitive read: proven repeated formats, optional whitespace, and whether the market looks creatively narrow or diverse. Do not reject a strong common format just because it is common; use the proven lane and differentiate the artist-specific execution.
5. Confidence: state clearly that public Meta Ad Library does not expose CTR, CPA, ROAS, or normal commercial spend.
6. Strategy implications: what Ads Strategist should consider.
7. Creative implications: what Ad Creative Agent should test.
8. Originality guardrail: do not copy another artist's ad; borrow patterns and build an artist-specific version.
9. Scale filter: flag examples that likely require major-artist fame or high production so they are not treated as low-budget playbooks.
10. Ranked winners: score each candidate as `strong`, `maybe`, or `skip` using the proxy signals above. Prefer a smaller ranked list over random search dumps.

## Music Format Labels

Use these labels when reading ads:

- `ugc`
- `performance-video`
- `music-video-clip`
- `lyric-or-song-moment`
- `playlist-or-streaming-push`
- `tour-or-event`
- `merch-or-offer`
- `static-image`
- `carousel`
- `unknown`

## Safety

- Never infer exact performance from public commercial ads.
- Use ad longevity only as a weak signal.
- Never plagiarize copy, visuals, or artist positioning.
- Do not publish, draft, spend, or change accounts from this skill.
