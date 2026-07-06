---
name: Artist Typography Taste
description: Choose culturally literate type direction for artist cover art, merch, posters, and campaign visuals, then translate it into SVG/PNG composition specs.
tags: [artist, typography, album-art, merch, design, fonts, layout]
category: media-design
---

# Artist Typography Taste

Use this skill when an artist visual needs font direction, title treatment, album-cover type, merch lettering, poster hierarchy, editorial masthead logic, or SVG/PNG layout execution.

## Core Rule

Typography is not a caption. It is part of the artwork's identity system.

Default to a deterministic type layer using `artwork_compose` after the base image exists. Do not ask an image model to render final artist/title type unless the user explicitly wants messy baked-in poster text and you have a cleanup fallback.

## How To Choose Type

Choose from the visual world, not from generic genre labels:

- If the music feels warm, analog, soulful, songwriter, folk, psych-rock, or timeless: use 70s vinyl logic.
- If the artist is the signal and image matters: use editorial/FADER logic.
- If the work is surreal, spiritual, strange, druggy, cosmic, existential, or guitar-psych: use psychedelic poster logic.
- If the artist is premium, icy, minimal, fashion, nightlife, or high-status: use luxury/minimal logic.
- If the artist is raw, local, angry, anti-polish, DIY, or underground: use zine/punk logic.
- If the work is street, mixtape, club, trap, rap, or pop chaos: use street-poster/mixtape logic with restraint.

## Style Lanes

### 70s Vinyl

Feel: record-store classic, warm, composed, adult, analog.

Use:
- soft serif, Cooper/Windsor/Bookman energy without parody
- rounded grotesk or humanist sans for supporting type
- generous tracking, centered lockups, label-strip details
- cream, black, deep red, muted green, brown, gold, washed primary accents

Avoid:
- fake distressed fonts
- fake ring wear
- Halloween-retro costume typography
- too many period signifiers at once

### Editorial / FADER

Feel: artist-forward, press-ready, confident, direct.

Use:
- Helvetica/Franklin/Trade Gothic-style bold sans hierarchy
- masthead logic, strong crop, left rail or bottom-third type
- tight but readable spacing
- one bold display move and otherwise restraint

Avoid:
- fake magazine parody unless requested
- too many text boxes
- ironic "cover story" clutter
- generic fashion-mag elegance with no attitude

### Psychedelic / Far Out

Feel: trippy, strange, spiritual, optic, mythic, but composed.

Use:
- organic serif, hand-lettered curves, poster lettering, warping only when readable
- radial or wave placement if the image supports it
- high color intelligence: acid accent against disciplined base palette
- title as symbol, not label

Avoid:
- illegible lava-lamp text
- cheap fractal/groovy fonts
- random rainbow gradients
- over-busy type fighting the image

### Luxury / Minimal

Feel: expensive, icy, clean, controlled.

Use:
- high-contrast serif, Didot/Bodoni energy, or exacting Swiss sans
- small type with large negative space
- black/white/metallic/off-white, one accent max
- precise alignment, restrained case, calm hierarchy

Avoid:
- generic luxury perfume ad
- thin type over low-contrast images
- fake premium spacing that becomes unreadable
- decorative flourishes without concept

### Zine / Punk / Grunge

Feel: photocopied, blunt, local, agitated, imperfect.

Use:
- condensed sans, ransom-note fragments, stamped type, xerox blocks
- roughness from layout logic, not fake distress filters
- high contrast black/white/red or dirty paper tones
- asymmetry that still has hierarchy

Avoid:
- random distressed font packs
- illegibility as an excuse
- fake rebellion on a polished image
- too many competing type voices

### Street Poster / Mixtape

Feel: loud, immediate, nightlife, flyer wall, block-party, bootleg energy.

Use:
- condensed bold sans, chrome/sticker/badge/price-tag logic when earned
- warning-label hierarchy, show-poster placement, big title/readable artist
- strong outline or shadow only for readability
- one loud trick, not five

Avoid:
- fake cash/chains/fire clutter
- unreadable chrome
- default mixtape template nostalgia
- type effects that look like preset thumbnails

## Pairing Rules

- Pair one display voice with one quiet support voice.
- If image is busy, type gets simpler.
- If image is minimal, type can carry more personality.
- If artist name is already visually known, title can lead.
- If the song title is the hook, title leads.
- If merch, the mark must read from six feet away.
- If cover art, it must read as a thumbnail.

## User Requested Styles

When the user requests a style, translate it into constraints:

- "vintage" means period spacing, color, and type proportion; not fake damage.
- "grungy" means xerox logic, imperfect alignment, and contrast; not random distressed font.
- "psychedelic" means organic rhythm and controlled weirdness; not illegibility.
- "luxury" means restraint, negative space, and exact alignment; not generic perfume type.
- "bold" means hierarchy and scale; not simply bigger text.
- "minimal" means fewer decisions, not absence of design.
- "merch" means print survival, distance readability, and shape-first composition.

## SVG / PNG Composition Spec

When calling `artwork_compose`, provide:

- canvas size
- base image path if available
- text layers with `text`, `x`, `y`, `fontSize`, `fontFamily`, `fontWeight`, `fill`, `anchor`, `letterSpacing`, `maxWidth`
- shape layers for labels, strips, frames, badges, stickers, or editorial rules
- do **not** add a rectangle/box behind type by default; only add a backing shape when the user explicitly asks for a label/sticker/strip or when readability absolutely requires it
- if a backing shape is needed, make it an intentional designed element (label, sticker, caption strip) with clear style rationale; avoid low-opacity rectangles that create accidental halos, outlines, or "not transparent" bugs around text
- for simple cover typography, prefer direct text over the image using placement, scale, contrast, shadow-free color choice, or a subtle text opacity change before using any background shape
- after composing, visually inspect for visible bounding boxes, halos, export artifacts, or accidental shape edges around type; if present, remove the shape and re-compose
- `exportPng: true`
- `publishOutput: true`
- `showInCanvas: true`

Use font families as practical system stacks, not impossible assumptions:

- serif: `"Georgia, Times New Roman, serif"`
- high contrast: `"Didot, Bodoni 72, Georgia, serif"`
- grotesk: `"Helvetica Neue, Arial, sans-serif"`
- condensed: `"Arial Narrow, Helvetica Neue Condensed, Impact, sans-serif"`
- mono/industrial: `"Courier New, ui-monospace, monospace"`

If an exact font is not installed, name the aesthetic target and use a fallback stack. Do not claim an exact font rendered unless a font file is available or the runtime confirms the font exists.

## Open-Source Font Kit

Prefer open-source font families when the user wants assets that may later be packaged, sold, embedded, or handed off. Google Fonts families are generally open-source and commercially usable, but always keep license files/notices with any bundled font assets.

Use these as taste targets and fallback directions:

### Warm / 70s / Vinyl

- Fraunces: expressive soft-serif energy, useful for warm classic covers.
- Libre Baskerville: literary, adult, timeless; good for songwriter and soul-adjacent covers.
- Cormorant Garamond: elegant, fragile, romantic, slightly old-world.
- DM Serif Display: bold vintage editorial title energy.
- Josefin Sans: geometric 30s/70s-adjacent support sans.

### Editorial / FADER / Press

- Archivo / Archivo Black: strong grotesk headline weight, works for bold artist-forward covers.
- Work Sans: clean contemporary support face with good spacing.
- Inter: neutral UI/editorial utility when the image carries personality.
- Space Grotesk: modern, slightly strange, good for alt-pop/electronic identity.
- Oswald: condensed poster/editorial hierarchy when used with restraint.

### Psychedelic / Far Out

- Fraunces: use heavier/wonky optical styles as an organic display direction.
- Cormorant Garamond: spiritual, literary, ornate without cheap trippy cliche.
- Grenze Gotisch: gothic/ritual edge; use sparingly.
- Syne: art-school oddness for modern psych and experimental pop.
- Unbounded: futuristic/psychedelic tension when paired with simple layout.

### Luxury / Minimal

- Playfair Display: high-contrast fashion/editorial energy.
- Cormorant Garamond: delicate luxury with more restraint than fake Didot clones.
- Libre Bodoni: sharper premium title direction.
- Instrument Serif: modern boutique serif, useful for tasteful minimal covers.
- Inter or Work Sans: exacting support sans.

### Zine / Punk / Grunge

- Archivo Narrow / Oswald: condensed blunt poster type.
- Special Elite: typewriter/zine texture; use only when concept earns it.
- Rubik Mono One: loud block letter direction; use sparingly.
- Barlow Condensed: utilitarian flyer hierarchy.
- Space Mono: mechanical DIY captions, labels, catalog marks.

### Street Poster / Mixtape / Merch

- Bebas Neue: tall bold merch/poster display; watch overuse.
- Anton: heavy direct headline, useful for short titles.
- Archivo Black: muscular but cleaner than default impact-style type.
- Barlow Condensed: flexible street-poster hierarchy.
- Black Ops One: stencil/military energy; only for concepts that justify it.

Pairing examples:

- Fraunces display + Work Sans support.
- Libre Baskerville title + Archivo caption.
- Archivo Black title + Space Mono catalog marks.
- Playfair Display title + Inter support.
- Bebas Neue merch mark + Space Grotesk support.

When exact font assets are not available, say: "Target font direction: [family/style]. Render fallback: [stack]." When exact assets are available, pass the real family name and keep the font license with the project/export.

## Output Shape

```markdown
Typography read:
Recommended lane:
Artist/title hierarchy:
Font direction:
Exact font asset available:
Fallback stack:
Layout:
Color/contrast:
SVG/PNG composition notes:
What to avoid:
Ready for artwork_compose:
```
