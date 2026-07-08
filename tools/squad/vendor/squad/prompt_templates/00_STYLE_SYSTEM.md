# Style System — The Aesthetic Spectrum

This file defines the style families the Creative Director agent selects from. Each family has a core DNA, signature modifiers, and rules about when to use it.

The Creative Director's job: read the brief, pick the right style family (or blend), then select specific templates within that family.

---

## The Spectrum (6 Families)

```
BRUTALIST ←——→ ART CULTURE ←——→ PSYCHEDELIC ←——→ EDITORIAL ←——→ PREMIUM ←——→ UGC
dark/harsh      curated/cool     trippy/wild     polished/sharp   luxe/clean    raw/real
```

Each family is a world. The Creative Director picks one (or blends two adjacent families) based on: product type, platform, audience, and campaign mood.

---

## Family 1: BRUTALIST
**DNA:** Gesaffelstein. Industrial. Dark minimalism. Monochrome. Harsh light. Concrete and steel. Typography as weapon.

**When to use:** Merch drops with edge. App launches that want to feel dangerous. Music releases that are dark/electronic/heavy. Anything that should feel like it doesn't care if you like it.

**Signature modifiers:**
```
brutalist architecture, harsh directional lighting, deep shadows, 
monochrome palette, high contrast, industrial textures, concrete, 
steel, matte black, sans-serif typography, negative space, 
grainy film texture, desaturated, cold tones, clinical precision
```

**Negative prompt defaults:**
```
colorful, warm, friendly, soft, rounded, cute, playful, 
saturated, organic shapes, nature, flowers, smiling
```

**Color palette:** Black, white, gunmetal grey, concrete grey, blood red (accent only)  
**Typography feel:** Helvetica Neue Bold, Monument Extended, brutalist sans-serifs  
**Reference artists:** Gesaffelstein album art, Rick Owens campaigns, Balenciaga under Demna, Comme des Garçons  
**Recommended model:** Flux 2 Pro (best at harsh lighting and architectural precision)

---

## Family 2: ART CULTURE
**DNA:** Kanye (Yeezus-era through Donda). Frank Ocean (Blonde, Channel Orange). Fader Magazine covers. Tyler the Creator. A$AP Rocky. The cool kid's mood board.

**When to use:** Music promotion. Streetwear/merch with cultural currency. Anything targeting 18-35 taste-makers. Content for X, Instagram, or editorial placement.

**Sub-moods:**

**2A — Kanye/Yeezy minimal:**
```
muted earth tones, oversized proportions, desert landscape,
architectural minimalism, neutral palette, raw materials,
fashion photography, editorial lighting, stark composition,
deliberate imperfection, museum-quality framing
```

**2B — Frank Ocean dreamy:**
```
analog film grain, golden hour warmth, nostalgic color palette,
soft focus, intimate framing, quiet luxury, muted pastels,
vintage texture, contemplative mood, natural light,
Kodak Portra 400 look, shallow depth of field
```

**2C — Fader/editorial raw:**
```
high-fashion meets street, flash photography, raw energy,
editorial crop, bold eye contact, urban environment,
mixed media texture, print magazine quality, 
candid yet composed, cultural moment captured
```

**2D — Wes Anderson symmetrical:**
```
perfect symmetry, pastel color palette, centered composition,
retro typography, whimsical precision, vintage set design,
flat lighting, deadpan framing, miniature quality,
meticulous production design, complementary color pairs
```

**Negative prompt defaults:**
```
generic stock photo, corporate, sterile, clipart quality,
over-processed, HDR look, lens flare, generic background
```

**Recommended model:** Flux 2 Pro (2A, 2C), Flux 2 Dev with style reference image (2B, 2D)

---

## Family 3: PSYCHEDELIC
**DNA:** Tame Impala (Currents, The Slow Rush). 60s/70s revival. Retro-futurism. Acid visuals. Swirling color.

**When to use:** Music releases with psych/indie/alternative vibes. Festival merch. App experiences that want to feel mind-expanding. Any product that benefits from visual "wow."

**Signature modifiers:**
```
psychedelic color swirls, iridescent gradients, kaleidoscopic patterns,
retro-futurist aesthetic, chrome reflections, liquid color,
70s color palette, analog synthesizer visuals, 
warped perspective, double exposure, prismatic light,
neon accents, holographic sheen, melting forms,
cosmic backdrop, sunset gradients, aurora colors
```

**Negative prompt defaults:**
```
boring, static, flat, corporate, minimal, monochrome,
standard photography, realistic lighting, mundane
```

**Color palette:** Magenta/coral/teal/lavender/electric orange — saturated and shifting  
**Reference artists:** Tame Impala album art (Leif Podhajsky), Peter Max, Alex Grey, Bridget Riley  
**Recommended model:** Flux 2 Pro (handles complex color and abstract forms well)

---

## Family 4: EDITORIAL
**DNA:** Vogue. GQ. Highsnobiety. Apple product launches. Clean, sharp, considered. Every pixel intentional.

**When to use:** App Store screenshots. Product hero shots. LinkedIn content. Investor-facing materials. Any context where "professional but not boring" is the brief.

**Signature modifiers:**
```
studio lighting, clean background, editorial photography,
sharp focus, precise composition, modern minimalism,
controlled color palette, professional grade, magazine quality,
dramatic lighting, soft shadows, product hero shot,
negative space, grid-aligned, thoughtful typography placement
```

**Negative prompt defaults:**
```
cluttered, busy, amateur, low resolution, noisy,
over-saturated, chaotic, unintentional blur, messy composition
```

**Color palette:** Controlled — usually 2-3 colors max. White/grey/black base with one accent.  
**Reference:** Apple marketing, Highsnobiety editorials, Monocle magazine  
**Recommended model:** Flux 2 Pro (precision) or GPT Image 1.5 (if text/UI elements needed)

---

## Family 5: PREMIUM MODERN
**DNA:** Luxury tech. Tesla. Aesop. Dieter Rams. High-end but not pretentious. Sleek surfaces, warm materials, precision.

**When to use:** SaaS/app marketing that wants to feel premium. Product packaging. Landing page hero images. Email headers. Anything that should say "this costs more and it's worth it."

**Signature modifiers:**
```
premium product photography, soft studio lighting, 
warm neutral tones, brushed metal, frosted glass,
minimal composition, luxury materials, 
subtle gradient backgrounds, ambient occlusion,
3D render quality, floating product, 
clean reflections, depth of field, 
warm highlights, cool shadows
```

**Negative prompt defaults:**
```
cheap, plastic, flat lighting, cluttered, busy background,
stock photo, generic, low-end, discount feel
```

**Color palette:** Warm neutrals (cream, sand, soft grey) + one material accent (copper, rose gold, dark wood)  
**Reference:** Aesop packaging, Apple product shots, Bang & Olufsen, Rapha  
**Recommended model:** Flux 2 Pro (product shots), Ideogram (if text/branding needed)

---

## Family 6: UGC / AUTHENTIC
**DNA:** iPhone 15 Pro shot. Real person, real moment. TikTok native. Instagram Stories native. The opposite of produced — and that's the point.

**When to use:** TikTok/Reels content. Testimonial-style ads. "User showing the product" content. Reddit-appropriate visuals. Anything where polish = distrust.

**Signature modifiers:**
```
iPhone photography, natural lighting, casual composition,
authentic moment, real person, unposed, 
slight motion blur, selfie angle, front-facing camera,
ring light reflection in eyes, bedroom/kitchen/car setting,
handheld camera feel, vertical framing (9:16),
real skin texture, imperfect lighting, genuine expression
```

**Negative prompt defaults:**
```
studio lighting, perfect composition, professional model,
airbrushed skin, stock photo, corporate, staged,
symmetrical, over-produced, magazine quality
```

**Color palette:** Whatever the room gives you — warm indoor light, cool daylight, ring light white  
**Reference:** Top TikTok creators, unboxing videos, "get ready with me," casual product reviews  
**Recommended model:** Flux 2 Dev (more natural/imperfect than Pro) or Kling for video (best human realism)

---

## Style Blending Rules

The Creative Director can blend TWO adjacent families. Examples:

- **BRUTALIST + ART CULTURE** → Dark editorial. Rick Owens meets Fader. Merch that feels like a gallery opening.
- **ART CULTURE + PSYCHEDELIC** → Tyler the Creator territory. Colorful but curated. Festival meets fashion.
- **PSYCHEDELIC + EDITORIAL** → Apple's "Shot on iPhone" dreamier moments. Precision with wonder.
- **EDITORIAL + PREMIUM** → Standard luxury brand campaign. Clean, controlled, expensive.
- **PREMIUM + UGC** → The "casual luxury" aesthetic. Aesop products in a real kitchen. Airpods in a real ear.

**Never blend opposites** (BRUTALIST + UGC, PSYCHEDELIC + PREMIUM). The Creative Director should refuse these combos — they produce visual incoherence.
