# Prompt Template Registry

**For the Creative Director agent.** This is your lookup table. Read the brief, pick the style family, pick the template, fill the variables, fire.

---

## Files in This Directory

| File | What It Contains |
|------|-----------------|
| `00_STYLE_SYSTEM.md` | 6 style families (Brutalist → UGC), blending rules, color palettes, reference artists |
| `01_IMAGE_TEMPLATES.md` | 18 image generation templates across product placement, hero, social, merch, app, music, and abstract categories |
| `02_VIDEO_AND_AUDIO_TEMPLATES.md` | 8 video templates, 4 voiceover scripts, 3 audio mixing specs, 3 caption styles |

---

## Quick Reference: All Templates by ID

### Image Templates (20)

| ID | Name | Use Case | Best Style Families |
|----|------|----------|-------------------|
| IMG-PP-001 | Product on Icon | Product on/with a famous figure archetype | Any |
| IMG-PP-002 | Product in Environment | Product placed in a designed setting | EDITORIAL, PREMIUM, ART CULTURE |
| IMG-PP-003 | Product in Action | Someone using/wearing the product | UGC, ART CULTURE, EDITORIAL |
| IMG-PP-004 | Product Flat Lay | Product arranged with complementary objects | EDITORIAL, PREMIUM, ART CULTURE (Wes Anderson) |
| IMG-HE-001 | App/Marketing Hero | Hero image for app store, website, ad | EDITORIAL, PREMIUM |
| IMG-HE-002 | Cinematic Wide Hero | Website hero, YouTube thumb, X header | BRUTALIST, ART CULTURE, PSYCHEDELIC |
| IMG-HE-003 | Split / Before-After | Transformation, comparison | EDITORIAL, PREMIUM |
| IMG-SO-001 | Instagram Square | Instagram feed post (1:1) | Any |
| IMG-SO-002 | Vertical Story/Reel | Instagram Story, TikTok, Reel cover (9:16) | UGC, ART CULTURE, PSYCHEDELIC |
| IMG-SO-003 | X/Twitter Card | Tweet image, link preview (16:9) | Any |
| IMG-MR-001 | T-Shirt On Person | E-commerce, social merch promo | ART CULTURE, EDITORIAL, UGC |
| IMG-MR-002 | T-Shirt Flat/Folded | Product listing, clean showcase | EDITORIAL, PREMIUM, BRUTALIST |
| IMG-MR-003 | Merch Collection | Collection launch, lookbook | ART CULTURE (Wes Anderson), EDITORIAL |
| IMG-AP-001 | App in Hand | App marketing, social proof | UGC, PREMIUM, EDITORIAL |
| IMG-AP-002 | App Feature Showcase | Feature announcement, app store screenshots | EDITORIAL, PREMIUM |
| IMG-MU-001 | Album/Single Art | Album cover, single artwork (1:1) | BRUTALIST, ART CULTURE, PSYCHEDELIC |
| IMG-MU-002 | Artist Promo Shot | Spotify profile, press kit | ART CULTURE, EDITORIAL, BRUTALIST |
| IMG-MU-003 | Tour/Event Poster | Show announcement, event promo | PSYCHEDELIC, BRUTALIST, ART CULTURE |

### Video Templates (8)

| ID | Name | Use Case | Motion Level |
|----|------|----------|-------------|
| VID-I2V-001 | Slow Reveal | Hero product reveal, dramatic intro | Low |
| VID-I2V-002 | Living Moment | Lifestyle, product-in-use | Low-Medium |
| VID-I2V-003 | Energy Burst | Hype content, music promo, merch drop | High |
| VID-I2V-004 | Product Transform | Before/after, feature reveal | Medium |
| VID-T2V-001 | UGC Testimonial Scene | TikTok/Reel ad | Medium |
| VID-T2V-002 | Cinematic B-Roll | Ad filler, website background | Low |
| VID-T2V-003 | Abstract/Mood Loop | Website background, visualizer | Low |

### Voiceover Templates (4)

| ID | Name | Use Case | Energy |
|----|------|----------|--------|
| VO-001 | Product Hype | Reel/TikTok VO, 15-30s | High |
| VO-002 | Cinematic Narrator | Brand video, longer ad | Low-Medium |
| VO-003 | Streetwear/Culture Drop | Merch announcement | Low (cool) |
| VO-004 | Music Release Teaser | Single/album announcement | Varies |

### Audio Mixing Specs (3)

| ID | Name | When |
|----|------|------|
| AUD-MIX-001 | Voice Over Music | Standard narrated content |
| AUD-MIX-002 | Music-Forward | Voice as texture, music dominant |
| AUD-MIX-003 | UGC Raw | No music, authentic feel |

### Caption Styles (3)

| ID | Name | When |
|----|------|------|
| CAP-001 | Bold Impact | TikTok/Reels, attention-grabbing |
| CAP-002 | Minimal Clean | Editorial, subtle |
| CAP-003 | Brutalist Type | Dark/edgy content, design-forward |

---

## Decision Logic for the Creative Director

```python
def select_template(brief: CreativeProductionRequest) -> tuple[StyleFamily, Template]:
    """
    1. Read the brief
    2. Determine product type (app / merch / music / general)
    3. Determine platform (tiktok / instagram / twitter / website / app_store)
    4. Determine mood/energy from brief language
    5. Pick style family (or blend of two adjacent families)
    6. Pick template based on output_type + product_type
    7. Fill placeholders from brief context + brand voice pack
    8. Apply style family modifiers
    9. Return the filled prompt
    """
    
    # Product type → template category
    product_templates = {
        "app": ["IMG-AP-*", "IMG-HE-001"],
        "merch": ["IMG-MR-*", "IMG-PP-*"],
        "music": ["IMG-MU-*", "IMG-HE-002"],
        "general": ["IMG-PP-*", "IMG-HE-*", "IMG-SO-*"]
    }
    
    # Platform → aspect ratio + format constraints
    platform_formats = {
        "tiktok": {"ratio": "9:16", "prefer": ["VID-*", "IMG-SO-002"]},
        "instagram_feed": {"ratio": "1:1", "prefer": ["IMG-SO-001"]},
        "instagram_story": {"ratio": "9:16", "prefer": ["IMG-SO-002", "VID-I2V-002"]},
        "twitter": {"ratio": "16:9", "prefer": ["IMG-SO-003", "IMG-HE-002"]},
        "website": {"ratio": "16:9", "prefer": ["IMG-HE-*", "VID-T2V-002"]},
        "app_store": {"ratio": "varies", "prefer": ["IMG-AP-*"]},
        "spotify": {"ratio": "1:1", "prefer": ["IMG-MU-001"]},
    }
    
    # Energy keywords → style family leaning
    energy_to_style = {
        "dark": "BRUTALIST",
        "edgy": "BRUTALIST",
        "minimal": "BRUTALIST",
        "cool": "ART_CULTURE",
        "cultural": "ART_CULTURE",
        "dreamy": "ART_CULTURE",  # Frank Ocean sub-mood
        "vintage": "ART_CULTURE",  # Wes Anderson sub-mood
        "trippy": "PSYCHEDELIC",
        "wild": "PSYCHEDELIC",
        "colorful": "PSYCHEDELIC",
        "clean": "EDITORIAL",
        "professional": "EDITORIAL",
        "sharp": "EDITORIAL",
        "luxury": "PREMIUM",
        "premium": "PREMIUM",
        "sleek": "PREMIUM",
        "authentic": "UGC",
        "raw": "UGC",
        "real": "UGC",
        "casual": "UGC",
    }
```

---

## How Templates Grow

This library is version 1. It grows through:

1. **Performance feedback.** When the analytics agent reports that a certain visual style drove 3x engagement, we note which template + style family produced it and weight it higher.

2. **New templates from successful one-offs.** When the Creative Director freestyles a prompt that works great, extract it into a new template.

3. **Mikey's creative direction.** New reference artists, new moods, new product types = new templates.

4. **Seasonal/cultural moments.** Holiday styles, trending aesthetics, cultural events.

The Creative Director should log every prompt it uses and the resulting quality score. Over time, the best prompts become the default choices.
