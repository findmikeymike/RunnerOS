---
name: ad-library-intel
description: Researches public Meta Ad Library examples for similar artists, labels, music keywords, and fan-culture phrases, then turns captured ads into hook, angle, format, and creative-pattern intel for paid campaign planning.
tags: [ads, meta, research, creative-intelligence, music-marketing]
---

# Ad Library Intel

Use this skill when the user asks what is working in music ads, wants competitor/similar-artist ad research, asks for viral music ad hooks, or needs creative/strategy inspiration before building a Meta or Google campaign.

## Core Rule

This is public research. Do not request Meta account passwords, cookies, 2FA codes, or ad-account access. The public Meta Ad Library normally does not require login. If Meta blocks automation or asks for verification, ask the user to continue manually or provide screenshots/captured examples.

## Workflow

1. Build the research plan:

```bash
node tools/ads-operator/bin/ads-operator.mjs ad-library-plan --artist "<artist>" --competitors "<similar artists or labels>" --keywords "<genre/fan phrases>" --countries "US" --json
```

2. Use browser automation against `https://www.facebook.com/ads/library`:
   - Set category to `All ads`.
   - Search similar artists, labels, genre phrases, lyric/fan phrases, and campaign-adjacent keywords.
   - Prefer active ads.
   - Capture page name, search term, visible copy, headline, CTA, media type, platform chips, start date, destination URL, screenshot path, and source URL when visible.

3. Save captured examples as JSON:

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

4. Analyze the capture:

```bash
node tools/ads-operator/bin/ads-operator.mjs ad-library-analyze captured-ads.json --artist "<artist>" --json
```

## Output

Produce an `Ad Library Intel Packet` with:

1. Search scope: artist, competitors, keywords, countries, date checked.
2. Captured examples: page, hook, angle, CTA, format, destination, source/screenshot.
3. Pattern read: repeated hooks, repeated angles, format mix, CTA mix, visual patterns.
4. Competitive gap: crowded formats, underused formats, underused angles, and whether the market looks creatively narrow or diverse.
5. Confidence: state clearly that public Meta Ad Library does not expose CTR, CPA, ROAS, or normal commercial spend.
6. Strategy implications: what Ads Strategist should consider.
7. Creative implications: what Ad Creative Agent should test.
8. Originality guardrail: do not copy another artist's ad; borrow patterns and build an artist-specific version.

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
