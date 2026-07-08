# Image Generation Prompt Templates

Every template below is a structured prompt the Creative Director agent selects from. Each has {placeholders} the agent fills from the brief + product context.

The agent reads the brief, picks a style family (from 00_STYLE_SYSTEM.md), picks a template, fills the variables, and fires it at the model.

---

## PRODUCT PLACEMENT TEMPLATES (Product in a Scene)

### IMG-PP-001: Product on Icon
**Use:** Put a product (tshirt, app, merch) on/with a famous figure archetype in a scene  
**Style families:** Any  
**Reference images:** 1 (product)  
**Model:** Flux 2 Pro (multi-reference)

```
prompt: >
  {product_description} {worn_by_or_held_by} {figure_description} 
  standing in {scene_description}. 
  {style_family_modifiers}. 
  Shot on {camera_description}. {additional_mood}.

examples:
  - "Black graphic tshirt with abstract logo worn by a tall figure in a desert landscape, 
    muted earth tones, oversized proportions, architectural minimalism, 
    editorial lighting. Shot on Hasselblad medium format. Quiet power."
  
  - "Mobile app displayed on iPhone 16 Pro held by a woman on a rooftop at golden hour, 
    analog film grain, nostalgic color palette, soft focus, intimate framing. 
    Shot on Kodak Portra 400. Contemplative mood."

negative: "blurry, low quality, distorted, watermark, extra fingers, deformed"
```

### IMG-PP-002: Product in Environment
**Use:** Product naturally existing in a designed environment  
**Style families:** EDITORIAL, PREMIUM, ART CULTURE  
**Reference images:** 1 (product)  
**Model:** Flux 2 Pro

```
prompt: >
  {product_description} placed in {environment_description}.
  {lighting_description}. {material_textures}.
  {style_family_modifiers}.
  Negative space emphasized. Product is the focal point.

examples:
  - "Minimalist black tshirt folded on raw concrete shelf, brutalist gallery space, 
    harsh directional light from left, deep shadows, monochrome palette. 
    Negative space emphasized. Product is the focal point."
  
  - "Premium mobile app on phone resting on a marble surface next to an Aesop hand cream, 
    soft studio lighting, warm neutral tones, brushed metal accents. 
    Clean reflections, shallow depth of field."

negative: "cluttered, cheap looking, plastic, stock photo, generic"
```

### IMG-PP-003: Product in Action
**Use:** Someone actively using/wearing/interacting with the product  
**Style families:** UGC, ART CULTURE, EDITORIAL  
**Reference images:** 1 (product)  
**Model:** Flux 2 Dev (more natural)

```
prompt: >
  {person_description} {action_with_product} in {setting}.
  {emotion_and_energy}. {style_family_modifiers}.
  {camera_angle_and_quality}.

examples:
  - "Young creative professional scrolling through the app on their phone while sitting in 
    a sun-drenched cafe, genuine smile, natural lighting, iPhone photography, 
    casual composition, authentic moment. Vertical framing."
  
  - "Artist wearing the graphic tshirt while painting in a warehouse studio, 
    paint-splattered jeans, flash photography, raw energy, editorial crop. 
    Fader Magazine quality."

negative: "posed, stiff, stock photo, generic background, fake smile"
```

### IMG-PP-004: Product Flat Lay / Arrangement
**Use:** Product arranged with complementary objects  
**Style families:** EDITORIAL, PREMIUM, ART CULTURE (Wes Anderson)  
**Reference images:** 1 (product)  
**Model:** Flux 2 Pro

```
prompt: >
  Overhead flat lay arrangement: {product_description} centered, 
  surrounded by {complementary_objects}.
  {surface_material}. {lighting}. {style_family_modifiers}.
  {color_coordination_notes}.

examples:
  - "Overhead flat lay: black tshirt with logo centered on aged oak surface, 
    surrounded by vintage sunglasses, film camera, brass lighter, dried flowers. 
    Warm natural light from window. Frank Ocean aesthetic, Kodak Portra warmth."
    
  - "Perfect symmetry overhead: tshirt folded precisely in center, 
    pastel objects arranged symmetrically around it, 
    mint green surface, flat lighting. Wes Anderson precision."

negative: "messy, cluttered, cheap surface, uncoordinated colors"
```

---

## HERO / BANNER TEMPLATES

### IMG-HE-001: App Store / Marketing Hero
**Use:** Hero image for app store, website, or ad  
**Style families:** EDITORIAL, PREMIUM  
**Reference images:** 1 (app screenshot or product)  
**Model:** Flux 2 Pro or GPT Image 1.5 (if text needed)

```
prompt: >
  Marketing hero image: {product_description} displayed prominently 
  against {background_style}. {device_if_app}.
  {style_family_modifiers}. Magazine advertisement quality.
  Bold, clean, immediate impact. {color_scheme}.

examples:
  - "Marketing hero: mobile app interface floating on iPhone 16 Pro, 
    subtle gradient background transitioning from deep navy to soft coral, 
    soft studio lighting, clean reflections, 3D render quality. 
    Premium product photography. Immediate impact."

negative: "busy background, cluttered, low resolution, cheap"
```

### IMG-HE-002: Cinematic Wide Hero
**Use:** Website hero, YouTube thumbnail, Twitter/X header  
**Style families:** BRUTALIST, ART CULTURE, PSYCHEDELIC  
**Reference images:** 0-1  
**Model:** Flux 2 Pro

```
prompt: >
  Cinematic wide shot (16:9): {scene_description} with {product_integration}.
  {dramatic_lighting}. {atmospheric_elements}.
  {style_family_modifiers}. Film still quality. Anamorphic lens feel.

examples:
  - "Cinematic wide: figure wearing the tshirt standing at the edge of a 
    brutalist concrete structure, city skyline behind, golden hour rim light, 
    atmospheric haze. Harsh shadows, high contrast. Film still, anamorphic bokeh."
    
  - "Cinematic wide: phone showing the app held up against a psychedelic sunset sky, 
    prismatic light, aurora colors bleeding across the frame, 
    chrome reflections, cosmic backdrop. Retro-futurist."

negative: "flat, boring, daytime, evenly lit, standard composition"
```

### IMG-HE-003: Split / Before-After
**Use:** Transformation, comparison, feature showcase  
**Style families:** EDITORIAL, PREMIUM  
**Reference images:** 0-2  
**Model:** GPT Image 1.5 (best at structured compositions)

```
prompt: >
  Split composition image: left side shows {before_state}, 
  right side shows {after_state}. 
  Clean dividing line. {style_family_modifiers}.
  Both sides same {consistent_element} for visual continuity.

negative: "uneven split, inconsistent lighting between sides, messy border"
```

---

## SOCIAL MEDIA TEMPLATES

### IMG-SO-001: Instagram Square (1:1)
**Use:** Instagram feed post  
**Style families:** Any  
**Reference images:** 0-1  
**Model:** Varies by style

```
prompt: >
  Square format (1:1): {subject_description}.
  {style_family_modifiers}. 
  Instagram-optimized: strong visual hook, 
  works at thumbnail size, {color_pop_element}.
  {mood_and_energy}.

negative: "text heavy, too much detail that gets lost at small size, dull"
```

### IMG-SO-002: Vertical Story/Reel Cover (9:16)
**Use:** Instagram Story, TikTok thumbnail, Reel cover  
**Style families:** UGC, ART CULTURE, PSYCHEDELIC  
**Reference images:** 0-1  
**Model:** Flux 2 Dev

```
prompt: >
  Vertical format (9:16): {subject_description}.
  {style_family_modifiers}.
  Full bleed, no margins. Space for text overlay in {text_zone}.
  {energy_level}: {energy_description}.

examples:
  - "Vertical 9:16: close-up of hands holding phone showing the app, 
    neon light reflecting off screen, urban night setting, 
    iPhone photography, slight motion blur. High energy.
    Space for text overlay in top third."

negative: "horizontal composition, empty corners, too much negative space for vertical"
```

### IMG-SO-003: X/Twitter Card (16:9 compact)
**Use:** Tweet image, link preview  
**Style families:** Any  
**Reference images:** 0-1  
**Model:** Varies

```
prompt: >
  Compact 16:9 image: {subject_description}.
  {style_family_modifiers}.
  Immediately readable at small size. 
  {one_clear_focal_point}. Bold contrast.
  Works against both light and dark Twitter backgrounds.

negative: "subtle, low contrast, too much detail, hard to read at thumbnail size"
```

---

## MERCH-SPECIFIC TEMPLATES

### IMG-MR-001: T-Shirt Mockup (On Person)
**Use:** E-commerce, social promotion  
**Style families:** ART CULTURE, EDITORIAL, UGC  
**Reference images:** 1 (tshirt design/product image)  
**Model:** Flux 2 Pro (reference image)

```
prompt: >
  {person_description} wearing {tshirt_description} in {setting}.
  {pose_description}. {style_family_modifiers}.
  Tshirt design clearly visible. Natural fabric draping.
  {camera_and_lighting}.

examples:
  - "Young man with curly hair wearing the black graphic tshirt, 
    standing against a weathered brick wall, confident lean, 
    one hand in pocket. Flash photography, Fader Magazine raw editorial. 
    Tshirt design clearly visible."
    
  - "Woman walking through a gallery space wearing the tshirt, 
    natural movement, candid angle from the side, 
    warm museum lighting. Frank Ocean warmth, analog film grain."

negative: "stiff pose, mannequin, flat tshirt, distorted design, floating fabric"
```

### IMG-MR-002: T-Shirt Mockup (Flat / Folded)
**Use:** Product listing, clean showcase  
**Style families:** EDITORIAL, PREMIUM, BRUTALIST  
**Reference images:** 1 (design)  
**Model:** Flux 2 Pro

```
prompt: >
  {tshirt_description} {flat_or_folded} on {surface}.
  {complementary_props}. {style_family_modifiers}.
  Design details crisp and legible. {lighting_direction}.

examples:
  - "Black tshirt laid flat on raw concrete surface, 
    brutalist gallery space, harsh overhead light casting sharp shadow. 
    Design details crisp. Monochrome except the print."

negative: "wrinkled, cheap fabric look, blurry design, generic white background"
```

### IMG-MR-003: Merch Collection Spread
**Use:** Collection launch, lookbook  
**Style families:** ART CULTURE (Wes Anderson), EDITORIAL  
**Reference images:** 1-3 (multiple products)  
**Model:** Flux 2 Pro

```
prompt: >
  Collection display: {items_description} arranged {arrangement_style} 
  in {environment}. {style_family_modifiers}.
  Every item distinct yet cohesive. {color_story}.

examples:
  - "Three tshirt variants arranged with perfect symmetry on a pastel pink backdrop, 
    complementary accessories placed equidistant, flat lighting, 
    Wes Anderson precision. Every item distinct yet cohesive."

negative: "messy, cramped, uncoordinated, random placement"
```

---

## APP-SPECIFIC TEMPLATES

### IMG-AP-001: App in Hand
**Use:** App marketing, social proof  
**Style families:** UGC, PREMIUM, EDITORIAL  
**Reference images:** 1 (app screenshot)  
**Model:** Flux 2 Pro

```
prompt: >
  {person_description} holding {phone_model} displaying {app_screen_description} 
  in {setting}. {expression_and_emotion}. 
  Screen clearly visible and readable. {style_family_modifiers}.
  {lighting_and_camera}.

examples:
  - "Woman at a coffee shop holding iPhone 16 Pro showing the app's main dashboard, 
    genuine excited expression, natural window light, 
    iPhone photography quality, casual composition. Screen clearly legible."
    
  - "Hand holding phone with the app open, floating against gradient background, 
    soft studio lighting, premium product photography, 
    clean reflections on screen. 3D render quality."

negative: "blurry screen, unreadable UI, extra fingers, distorted phone shape"
```

### IMG-AP-002: App Feature Showcase
**Use:** Feature announcement, app store screenshots  
**Style families:** EDITORIAL, PREMIUM  
**Reference images:** 1 (screenshot)  
**Model:** GPT Image 1.5 (best for text/UI precision)

```
prompt: >
  App feature showcase: {phone_model} showing {feature_screen} 
  with {visual_callout_description}. 
  {background_style}. {style_family_modifiers}.
  UI elements sharp and legible. {supporting_visual_elements}.

negative: "blurry UI, unreadable text, distorted interface, cheap mockup feel"
```

---

## MUSIC-SPECIFIC TEMPLATES

### IMG-MU-001: Album/Single Art
**Use:** Album cover, single artwork, playlist cover  
**Style families:** BRUTALIST, ART CULTURE, PSYCHEDELIC  
**Reference images:** 0-1 (artist photo)  
**Model:** Flux 2 Pro

```
prompt: >
  Album artwork (1:1 square): {visual_concept}.
  {mood_and_emotion}. {style_family_modifiers}.
  {color_palette_specific}. 
  Iconic, immediate recognition. Works at 300x300px and 3000x3000px.

examples:
  - "Album artwork: figure silhouetted against an industrial landscape, 
    monochrome with single red accent light, harsh shadows, 
    brutalist typography potential, Gesaffelstein energy. 
    Iconic at any size."
    
  - "Album artwork: portrait submerged in liquid color, 
    psychedelic swirls of magenta and teal consuming the frame, 
    prismatic light, kaleidoscopic distortion. 
    Tame Impala Currents energy."
    
  - "Album artwork: figure sitting alone on a vintage bed, 
    golden window light, analog film grain, 
    warm muted pastels, intimate and contemplative. 
    Frank Ocean Blonde quietness."

negative: "generic, stock photo, clip art, 3D render, cheesy, over-designed"
```

### IMG-MU-002: Artist Promo Shot
**Use:** Spotify profile, press kit, social promo  
**Style families:** ART CULTURE, EDITORIAL, BRUTALIST  
**Reference images:** 0-1 (artist photo for style reference)  
**Model:** Flux 2 Pro or Flux 2 Dev

```
prompt: >
  Artist promotional photo: {artist_description} in {setting}.
  {pose_and_energy}. {style_family_modifiers}.
  {camera_specs}. Press kit quality. 
  Conveys {genre_and_mood} without text.

negative: "amateur, bad lighting, generic background, yearbook photo"
```

### IMG-MU-003: Tour/Event Poster
**Use:** Show announcement, event promo  
**Style families:** PSYCHEDELIC, BRUTALIST, ART CULTURE  
**Reference images:** 0  
**Model:** Ideogram 3.0 (best text rendering) or Flux 2 Pro (if no text needed)

```
prompt: >
  Concert/event poster design: {visual_concept} for {event_description}.
  {style_family_modifiers}. 
  Space for event details in {text_zone}.
  {era_reference}: {decade_or_movement_influence}.
  Collectable design quality.

examples:
  - "Concert poster: geometric brutalist composition, 
    interlocking angular shapes in black and deep red, 
    industrial typography spaces in lower third, 
    Swiss design precision meets punk energy."
    
  - "Event poster: swirling psychedelic landscape, 
    70s silkscreen print quality, layered neon colors, 
    Art Nouveau letter spaces in top arc, 
    Fillmore poster DNA meets modern execution."

negative: "corporate event, PowerPoint, clip art, generic template"
```

---

## ABSTRACT / MOOD TEMPLATES

### IMG-AB-001: Texture/Pattern Background
**Use:** Story backgrounds, website textures, content backgrounds  
**Style families:** Any  
**Reference images:** 0  
**Model:** Flux Schnell (fast, cheap)

```
prompt: >
  Abstract {texture_type} pattern: {description}.
  {style_family_modifiers}. {color_palette}.
  Seamless, tileable. Works as background with text overlay.

examples:
  - "Abstract brutalist concrete texture with hairline cracks and 
    industrial water stains, monochrome, grainy film quality."
  - "Psychedelic liquid marble swirls in magenta, teal, and lavender, 
    iridescent surface quality, holographic sheen."
  - "Soft gradient mesh in warm neutrals, premium modern, 
    barely perceptible noise texture, luxury feel."

negative: "busy, chaotic, overwhelming, distracting from foreground content"
```

### IMG-AB-002: Mood/Concept Visual
**Use:** Campaign mood boards, visual identity exploration  
**Style families:** Any  
**Reference images:** 0  
**Model:** Flux 2 Pro

```
prompt: >
  Conceptual mood image: {emotion_or_concept} visualized as {metaphor}.
  {style_family_modifiers}. 
  No text, no product. Pure feeling. {color_story}.

examples:
  - "Conceptual mood: ambition visualized as a lone figure 
    climbing a glass staircase into clouds, 
    brutalist architecture framing, harsh upward light, 
    monochrome with warm horizon. Pure feeling."
  - "Conceptual mood: nostalgia visualized as a sunlit room 
    with dust particles floating in golden light, 
    vintage furniture, analog warmth, Portra 400 color. 
    Frank Ocean contemplation."

negative: "literal, obvious, cliché, stock photo, generic metaphor"
```
