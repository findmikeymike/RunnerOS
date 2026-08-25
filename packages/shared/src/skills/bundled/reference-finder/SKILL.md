---
name: reference-finder
description: >-
  Find and present cultural allusions and references for a song — biblical, mythic, historical,
  decade-nostalgia, regional, and cosmic imagery a lyric can draw on. Use when a writer wants
  reference material to color a song: "I use a lot of biblical references, give me more,"
  "suggest 90s nostalgia images," "what allusions fit a song about betrayal," "give me Old West
  imagery," "I want this to feel Southern gothic," or when a lyric feels thin and needs texture
  and gravity. Two modes: expand within a WELL (a source the writer leans on) and match across
  wells by MEANING (the feeling/theme a song is about). Backed by the Reference Wells catalog as
  a scaffold, but generates deep and fresh on demand. Pairs with impact-phrases (which supplies
  the punch line) and hook-writer. Do NOT use for writing the punch/hook itself, full verses,
  beats, or business tasks.
---

# Reference Finder — the allusion engine

References are the **color of a song** — the loaded images pulled from a shared cultural well
that give a lyric texture, gravity, and place. "Judas kiss," "neon on wet asphalt," "the tide
going out." A reference rarely *is* the punch (that's the impact-phrase's job); it **sets the
punch up** — it paints the specific, vivid world that makes a plain, timeless payoff land.

This skill finds the right references for a song and presents them, going as deep and fresh as
the writer wants. It is **generative** — it uses the Reference Wells catalog as a scaffold and
a balancer, then draws on the full cultural memory of each well to go far past the seed list.

## The catalog (scaffold, not a cage)

`wells/wells.json` catalogs ~20 wells across categories (sacred-mythic, myth, literary,
folklore, esoteric, decade, historical-era, regional-genre, cosmic, nature). Each well has a
**tone**, what it **evokes** (the meaning axis), a set of **signature images** with meanings,
a **deploy** note, and a **cliche_watch** list. Read it to ground tone and to see what a well
already offers — then generate well beyond it. The catalog exists to keep coverage balanced and
consistent, not to limit you. If a writer names a well that isn't in the catalog (Egyptian myth,
Appalachian folk, cyberpunk, medieval, disco, the Beat generation), just build it on the fly.

## Two modes

### Mode A — Expand within a well ("I lean biblical, give me more")

The writer names a source they draw on. Surface a rich, organized family from that well:

1. Read the well's `tone`, `evokes`, and `signatures` for grounding.
2. Generate **10–20 references** from that well, going well past the seed — group them loosely
   by the feeling they serve (e.g. biblical → *betrayal:* Judas kiss, thirty pieces of silver;
   *exile:* east of Eden, forty years wandering; *sacrifice:* the lamb, Gethsemane).
3. Give each a **one-line meaning** so the writer knows what it evokes and can reach for it.
4. Flag the `cliche_watch` ones honestly and offer a twist instead of the tired version.

### Mode B — Match across wells by meaning ("a song about betrayal")

The writer gives a theme, mood, or situation. Pull the strongest images from *any* well:

1. Identify the core feeling(s) — betrayal, rebirth, distance, doom, homesickness.
2. Scan wells whose `evokes` match, and pull the sharpest images from several, so the writer
   gets range (betrayal → *biblical:* Judas kiss; *noir:* the double-cross; *myth:* the Trojan
   horse; *Shakespeare:* et tu; *folklore:* the wolf in the red hood's story).
3. Present **grouped by well** so the writer can feel each texture, or ranked by fit — whichever
   serves. Note which well each comes from.

Most real requests blend both — a writer who "leans biblical" and is "writing about betrayal"
wants biblical betrayal images first, then a few from other wells to widen the palette.

## How to present

- **Grouped, glossed, and usable.** Each reference gets the image + one line on what it evokes.
  Cluster by feeling (Mode A) or by well (Mode B). Lead with the freshest, strongest images.
- **Go deep on request.** If they want "20 more," give 20 more without repeating. The wells are
  deep; don't stop at the catalog's signatures.
- **Show how it lands, lightly.** For the top few, a quick note on how to drop it into a lyric
  ("'east of Eden' as the place you got exiled to after the fight") — but keep it light, options
  not essays.
- **Offer a twist for the worn ones.** The whole point is to avoid tired allusions. When an image
  is on `cliche_watch` or just overused (phoenix rising, star-crossed, sold my soul), say so and
  offer the fresh angle — a fresh image, or the cliché subverted.
- **Respect real people and events.** With historical/decade wells, keep real figures and
  tragedies handled with a light, respectful touch; reach for texture and imagery, not
  exploitation.

## Cliché guard (the core value)

A generic allusion is worse than none — it makes a song feel secondhand. Steer away from the
exhausted images (phoenix rising, Icarus straight, "devil at the crossroads," "star-crossed,"
tie-dye-as-60s). Prefer the deep cut and the specific detail: not "a biblical flood" but "forty
days and I stopped counting"; not "like a fairytale" but "breadcrumbs the birds already ate."
When you do reach for a famous image, twist or ground it. Say honestly when something's worn.

## Working with the other tools

This is one of a family:

- **reference-finder** (this) → the *color*: loaded images that paint the verse and set up the punch.
- **impact-phrases** → the *punch*: the plain, timeless phrase the chorus lands on.
- **hook-writer** → the *build*: shaping the whole hook, the setup, the breathe, the sonics.

A full flow: find the well and its images here → set them up as vivid, specific verse → land a
plain impact-phrase as the chorus payoff → let hook-writer tighten the whole thing. When a
request spans these, move between them naturally.

## Saving useful references

When a writer loves specific references, offer to save them into the Lab song's `remember`
area or another user-visible note surface. Save the image, well, meaning, and an optional note
on how they want to use it. Keep references generic — cultural images, idioms, and allusions,
never verbatim copyrighted lyrics.
