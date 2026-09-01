---
name: artist-x-editorial
description: Build an artist-specific X editorial slate from Artist HQ worldview, voice, beliefs, lyrics, active campaign context, and current cited research. Use for X strategy, daily posts, threads, cultural commentary, campaign-adjacent posts, release posts, and a structured approval-gated Daily X Slate. This skill drafts and plans; it never publishes or self-approves.
---

# Artist X Editorial

Use this skill to turn an artist's real worldview into an X presence people can follow for more than release announcements.

The job is not "write viral tweets." The job is to notice what this artist genuinely has standing to say, research what is happening now, find the strongest intersection, and write posts that sound like a person with a point of view.

## Non-Negotiable Boundary

This skill drafts and proposes. It never publishes, schedules a public action, or treats model confidence as user approval.

Create a Daily X Slate for review. Artist OS and Social Publisher own exact approval, scheduling, execution, and receipts.

## Context To Pull First

Use available Artist OS context before asking the user to repeat it:

- `artist-profile`
- `artist-voice`
- `artist-branding`
- `artist-intel-report`
- active or pinned Campaign context
- lyrics, song themes, Spark Bank ideas, prior posts, and relevant Vault/Release Kit references when supplied
- recent X slates, scheduled X work, and receipts when supplied

Treat HQ as the artist-wide source of truth. A Campaign adds current release context; it does not replace the artist's wider identity.

When the launch context pins a Campaign, use its exact `campaignWorkspaceId` with `list_release_kit`, `get_release_kit_item`, `list_campaign_outputs`, and `get_campaign_output`. These are read-only context calls. Use `list_artist_vault` for reusable artist-approved references. Never guess an asset, path, digest, or Campaign.

Call `list_x_editorial_history` before drafting. It is the shared HQ fatigue ledger across both launch doors: compare exact copy, repeated hooks, lane balance, timing, Campaign linkage, and posted/scheduled state.

If Profile, Voice, and Branding are too thin to write credibly, say what is missing and produce a smaller provisional slate rather than inventing a persona.

## Edge And Conviction

Mine HQ for the artist's real fault lines: convictions, standards, enemies, contradictions, unpopular tastes, humor, attitude, taboos, and places they already push against the expected answer.

Do not sand those edges down merely because some people may disagree. When the artist has genuine standing, draft the sharpest honest version of the thought. A strong candidate may be polarizing, confrontational, sensual, strange, darkly funny, or uncomfortable if it is authentically theirs.

The approval surface is the creative risk control: draft boldly, then let the artist edit, skip, reject, or approve the exact post. Touchy is allowed. Invented beliefs, unsupported factual allegations, harassment, exploitation, and controversy manufactured only for attention are not.

If HQ contains no meaningful edge, name that context gap and return fewer candidates rather than generic safe copy.

## Operating Sequence

1. **Build the editorial spine.**
   Identify the artist's strongest beliefs, tensions, recurring questions, emotional territories, taste markers, humor, boundaries, and lived authority.

2. **Read the release pressure.**
   Identify the active or pinned Campaign, release window, song themes, approved assets, and direct promotional needs. Keep campaign influence light unless the date or user request makes it central.

3. **Research the present.**
   Use Deep Research for current topics, evidence, language, and conversations that intersect the editorial spine. Research is raw material, not the voice.

4. **Select, do not spray.**
   Score candidate angles for artist fit, truth, timeliness, distinctiveness, and risk. Reject weak or opportunistic intersections.

5. **Draft in the artist's voice.**
   Use `artist-comms-strategist` for fact discipline, audience clarity, speakability, and approval framing.

6. **Build one slate.**
   Propose the strongest small set, assign honest timing, identify sources, and label each lane.

7. **Publish the slate as an Output.**
   Use the exact contract in `references/daily-slate-contract.md`.

## Default Editorial Mix

Aim for:

- three Worldview posts;
- one Campaign-adjacent post when the connection is natural;
- one Direct release post during an active release window.

Do not fill a quota. Return fewer posts when fewer deserve to exist.

## Campaign Relevance Gate

A Campaign-adjacent post must satisfy all three:

1. It intersects an established artist belief, tension, or recurring theme.
2. The current song genuinely occupies the same emotional territory.
3. The post still has value with the release title and link removed.

If the third test fails, it is an ad. Label it Direct release or discard it.

Never use a news event, social cause, tragedy, identity, or relationship discourse as a costume for a release.

## Research Rules

- Prefer current primary or reputable sources.
- Record the exact claim used, not just a homepage URL.
- Separate fact, inference, and editorial interpretation.
- Never fabricate a trend, quote, statistic, consensus, or post performance claim.
- Reject topics outside the artist's credible standing unless the post is clearly personal curiosity rather than authority.
- Keep private notes and unpublished lyrics private unless the artist explicitly made them available for public copy.

For broad research, use `start_deep_research` with `planPolicy: "auto"` unless the user explicitly asks to approve the research plan. Inspect the completed result with `get_deep_research_run` before drafting factual posts.

Read `references/editorial-lanes.md` for angle selection and anti-generic tests.

## Voice And Quality Rules

Every candidate must pass:

- **Identity:** it could plausibly come from this artist, not a creator-growth account.
- **Truth:** it contains a real observation, belief, tension, story, or useful point.
- **Speakability:** the artist could actually say it aloud without cringing.
- **Need:** it earns a place in the slate rather than feeding cadence.
- **Integrity:** facts are supportable and the post is not exploitative, deceptive, harassing, or built on invented controversy. Dividing opinion is not itself a failure.

Use hooks, compression, pacing, and thread structure only after the thought is worth expressing.

Avoid:

- generic inspiration;
- fake-deep declarations;
- manufactured controversy;
- engagement bait and empty questions;
- hashtag piles;
- growth-guru language;
- false intimacy or trauma bait;
- forced lyric quotations;
- repetitive direct promotion;
- claiming an "optimal" posting time without real analytics.

## Timing

Use this order:

1. current connected-account analytics;
2. known audience behavior in Artist HQ;
3. explicit Campaign timing constraints;
4. a clearly labeled `editorial-default`.

Without analytics, use reasonable local waking hours, space posts by at least two hours, and do not call the result optimized.

## Standard Post Length

Keep every schedulable `post` at 280 Unicode characters or fewer. Artist OS V1 does not assume a connected account can publish Premium long posts. If an idea needs more room, tighten it or return a `thread` marked `draft-only`; do not silently emit an over-limit schedulable post.

## Dedupe

When recent slate, schedule, or receipt context is available, reject or rewrite:

- exact or near-duplicate copy;
- the same opinion without a new observation;
- repeated hooks or structures that make the artist sound automated;
- excessive release links;
- overlapping time slots;
- a campaign post already covered by an artist-wide post.

## Threads

You may draft a thread concept when the idea needs progression, but label it `draft-only` until Artist OS exposes native thread authorization and ordered reply execution. Never disguise a thread as multiple unrelated scheduled posts.

## Output

Create one `collection` Output:

- title: `Daily X Slate — <local date>`
- summary: one sentence naming the editorial focus and campaign influence
- content MIME type: `application/json`
- tag: `artist-x-slate`
- approval state: `pending`
- context: HQ, with optional Campaign linkage inside the JSON
- `showInCanvas: true`

The JSON must follow `references/daily-slate-contract.md`. Do not wrap it in Markdown or add prose outside the JSON content.

End the chat response with a short human summary: strongest angle, campaign influence, number of candidates, and that nothing will post until the artist approves it.
