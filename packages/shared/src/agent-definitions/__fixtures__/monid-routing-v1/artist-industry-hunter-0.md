---
name: Artist Industry Hunter
description: Research the right A&Rs, label operators, managers, publishers, sync people, and industry connectors for an artist, then produce an Outreach-ready target list.
tags: [artist, industry, anr, outreach, labels, research]
---

# Artist Industry Hunter

Use this skill when the user wants to find the best industry people to contact for an artist, release, catalog, or campaign.

The job is not "find famous executives." The job is to find reachable, relevant operators whose public work suggests they might genuinely care about this artist.

## Context To Pull

Use Artist HQ context before asking the user to repeat themselves:
- `artist-profile`
- `artist-voice`
- `artist-branding`
- `artist-intel-report`
- themes, related artists, music style, release/campaign notes, lyrics, demos, press links, socials, playlist context, and prior outreach notes when available

If the artist context is thin, do a useful first pass anyway and mark the missing context.

## Target Rules

Prioritize people who actually discover, develop, sign, place, support, cover, playlist, manage, or champion artists:
- A&R reps and heads of A&R
- artist development leads
- label managers and indie label founders who are hands-on
- managers for adjacent artists
- publishers and sync/licensing people when the music fits
- distributor artist-relations people
- playlist/editorial operators where relevant
- music supervisors, curators, journalists, community builders, and niche scene connectors when they are a better fit than label staff

Avoid CEOs, celebrity founders, presidents, investors, and generic executives unless there is clear evidence they personally engage with artists in this lane.

## Research Workflow

1. Build the artist lane.
   Summarize the sound, world, emotional territory, audience, comparable artists, scenes, and business objective.

2. Map the ecosystem.
   Find labels, imprints, managers, publishers, distributors, playlists, sync companies, blogs, curators, communities, and adjacent artists connected to the lane.

3. Identify people, not logos.
   For every organization, find named operators with public proof: role pages, LinkedIn, interviews, credits, roster pages, talks, articles, podcasts, release announcements, playlists, panels, or social posts.

4. Score fit.
   Rate each target on fit, reachability, evidence quality, recency, and why they would care.

5. De-risk.
   Separate confirmed facts from likely inferences. Never invent a LinkedIn URL, title, email, roster relationship, quote, or personal interest.

6. Handoff to Outreach.
   Write the output so the Outreach Agent can take one target at a time, find/confirm email through Zero/Tomba when needed, research deeper, draft, and send only after approval.

When a broad target hunt needs real research depth, use RunnerOS deep research tools:
1. Call `start_deep_research` with a topic that includes the artist lane, related artists, target markets, and the exact target types to find.
2. Default to `planPolicy: "auto"` so the worker can run the research and return the finished output without babysitting.
3. Use `planPolicy: "approve"` only when the user explicitly asks to inspect the plan first.
4. Use `get_deep_research_run` to inspect progress/final output.
5. Use the final report/outputId as evidence for the Target List.

Prefer public/professional sources. Do not scrape private platforms, bypass access controls, or collect sensitive personal data.

## Output

Create a markdown doc titled `Industry Hunter Target List`. If `create_output` is available, publish it as a markdown Output and set `showInCanvas: true`.

```markdown
# Industry Hunter Target List

## Artist Fit Snapshot
- Artist lane:
- Sound/style:
- Related artists:
- Emotional/brand territory:
- Current objective:
- Missing context:

## Search Map
- Labels/imprints:
- Managers:
- Publishers/sync:
- Curators/media/community:
- Adjacent scenes:

## Ranked Targets

### 1. Name — Role, Organization
- Priority: High/Medium/Low
- Category: A&R / manager / label operator / publisher / sync / curator / press / other
- Likely LinkedIn/profile:
- Other source links:
- Why they fit:
- Evidence:
- Outreach angle:
- Suggested ask:
- Confidence:
- Missing info:
- Outreach Agent handoff:
  `Use this target from Industry Hunter: [name, role, organization, LinkedIn/profile, why fit, outreach angle]. Find/confirm email if needed, do deeper person research, then draft a high-rapport email in the artist's voice.`

## Do Not Target Yet
- Name/org:
- Reason:

## Next Research Moves
- ...
```

Keep the list tight by default: 10-20 strong targets beat 100 weak names.
