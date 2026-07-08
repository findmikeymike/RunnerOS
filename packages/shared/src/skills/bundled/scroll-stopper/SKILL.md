---
name: scroll-stopper
description: >-
  Invent absurd, polarizing, scroll-stopping AI-video concepts for vertical short-form
  Reels, Shorts, and TikTok. Use when a creator needs viral video ideas, absurd
  premises, stop-the-scroll concepts, cover-shot art direction, or ready-to-paste
  AI-video generation prompts.
category: content-generation
tags:
  - content
  - short-form
  - viral
  - ai-video
  - hooks
---

# Scroll Stopper

Generate absurd, polarizing, scroll-stopping AI-video concepts built around one
commanding cover frame.

Core formula:

**mundane instantly-legible setting + norm violation + instantly-readable
character + reaction that raises the stakes = one commanding freeze-frame.**

Use `references/engine.json` as the source of truth for levers, settings,
characters, triggers, cover doctrine, realism doctrine, scoring, and examples.

## Operating Rules

1. Start from a violation lever: Wrong Agent, Wrong Object, Wrong Scale, Wrong
   Context, Wrong Reaction, Casual Taboo, Over-Commitment, Forbidden Competence,
   Mundane Apocalypse, or Animal With an Agenda.
2. Cross the lever with a mundane setting, instant-read character, and emotional
   trigger.
3. Generate several rough premises, then cut hard using the scoring rubric:
   scroll-stop power, absurdity, legibility, comment-bait, describe-to-a-friend,
   originality, gen feasibility, and safety.
4. Design the cover frame as the main deliverable. If the idea cannot read in
   one glance, it is not ready.
5. Prefer found-footage realism over polish: phone/CCTV/doorbell framing,
   imperfect exposure, ambient sound, autofocus hunt, and real-world lighting.

## Output Per Concept

For each keeper, return:

1. **Logline**: one repeatable sentence, plus lever / setting / character /
   trigger tags.
2. **Cover-shot art direction**: angle, camera height, framing, wrong element,
   reaction face, double-take detail, implied motion, and why it stops the
   scroll.
3. **Ready-to-paste generation prompt**:

```text
[VIDEO - 9:16 vertical, ~6-10s]
Shot: <handheld phone / CCTV / doorbell-cam> footage, vertical, slightly shaky, a beat late to the action.
Subject: <character, specific, instantly readable>.
Action: <the violation, described as it unfolds; the beat that resolves>.
Setting: <mundane setting, specific real-world details>.
Reaction: <bystanders / crowd / stakes>.
Camera: <angle, height, movement>. Lens feel: phone-wide, autofocus hunt.
Lighting: <fluorescent / overcast / gym-bright; not cinematic golden hour>.
Audio: ambient/authentic; gasps, room noise, a distant "oh my god"; no music.
Style: photoreal, found-footage, imperfect, un-produced. Not glossy, not cinematic.

[COVER FRAME - 9:16 still]
<Peak-tension freeze, exact moment before resolution. Wrong element dead center,
a face mid-reaction, double-take detail visible, mute-legible, thumbnail-legible.>
```

## Guardrails

Keep concepts absurd-fictional and comedic. Do not create:

- real named people or deepfakes
- real dangerous stunts framed as imitable how-to
- sexualized or endangered minors
- cruelty to real identifiable victims
- fake-news realism meant to deceive

When a premise drifts unsafe, preserve the violation lever and swap the payload
to something plainly fictional, comedic, and platform-safe.
