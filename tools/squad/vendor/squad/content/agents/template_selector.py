"""Micro-agent 2: Template Selector.

Takes a BriefAnalysis and returns the best template ID + model ID.
This is MOSTLY deterministic — no LLM needed for 90% of cases.
LLM only used for ambiguous edge cases.

Why this is separate:
- Template selection is a lookup, not a generation task
- Deterministic = testable, fast, zero cost
- Easy to add new templates without touching other agents
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from content.agents.brief_analyzer import BriefAnalysis


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

@dataclass
class TemplateSelection:
    """Output from template selection. Feeds into PromptComposer."""

    image_template_id: str
    video_template_id: str | None  # None if image_only
    voiceover_template_id: str | None  # None if no voice needed
    audio_mix_id: str | None  # None if no audio
    caption_style_id: str | None  # None if no captions
    model_id: str  # fal model endpoint
    quality_tier: str  # maps to adapter QualityTier
    variant_count: int
    reasoning: str  # one sentence explaining the choice

    # Pass-through
    style_family: str = ""
    platform: str = ""


# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

# Product type + platform → best image template
# Format: (product_type, platform) → template_id
_TEMPLATE_MAP: dict[tuple[str, str], str] = {
    # App
    ("app", "instagram_feed"): "IMG-SO-001",
    ("app", "instagram_story"): "IMG-SO-002",
    ("app", "tiktok"): "IMG-SO-002",
    ("app", "twitter"): "IMG-SO-003",
    ("app", "x"): "IMG-SO-003",
    ("app", "website"): "IMG-HE-001",
    ("app", "app_store"): "IMG-AP-002",
    ("app", "linkedin"): "IMG-HE-001",
    # Merch
    ("merch", "instagram_feed"): "IMG-MR-001",
    ("merch", "instagram_story"): "IMG-SO-002",
    ("merch", "tiktok"): "IMG-MR-002",
    ("merch", "twitter"): "IMG-SO-003",
    ("merch", "x"): "IMG-SO-003",
    ("merch", "website"): "IMG-HE-002",
    ("merch", "linkedin"): "IMG-PP-002",
    # Music
    ("music", "spotify"): "IMG-MU-001",
    ("music", "instagram_feed"): "IMG-MU-001",
    ("music", "instagram_story"): "IMG-SO-002",
    ("music", "tiktok"): "IMG-SO-002",
    ("music", "twitter"): "IMG-SO-003",
    ("music", "x"): "IMG-SO-003",
    ("music", "website"): "IMG-HE-002",
    ("music", "youtube"): "IMG-HE-002",
}

# Fallbacks by platform when product type has no specific mapping
_PLATFORM_FALLBACK: dict[str, str] = {
    "instagram_feed": "IMG-SO-001",
    "instagram_story": "IMG-SO-002",
    "tiktok": "IMG-SO-002",
    "twitter": "IMG-SO-003",
    "x": "IMG-SO-003",
    "website": "IMG-HE-001",
    "linkedin": "IMG-HE-001",
    "youtube": "IMG-HE-002",
    "spotify": "IMG-MU-001",
    "app_store": "IMG-AP-001",
    "email": "IMG-HE-001",
}

# Style-aware overrides for the most important image-first paths.
# These should beat generic product/platform routing when the creative
# direction clearly implies a different composition strategy.
_STYLE_TEMPLATE_OVERRIDES: dict[tuple[str, str, str], str] = {
    ("merch", "instagram_feed", "BRUTALIST"): "IMG-HE-002",
    ("merch", "instagram_feed", "PREMIUM"): "IMG-HE-002",
    ("merch", "instagram_feed", "EDITORIAL"): "IMG-MR-001",
    ("merch", "instagram_feed", "UGC"): "IMG-SO-001",
    ("merch", "tiktok", "BRUTALIST"): "IMG-MR-002",
    ("merch", "website", "PREMIUM"): "IMG-HE-002",
}

# Style family → video template (for full_production)
_VIDEO_BY_STYLE: dict[str, str] = {
    "BRUTALIST": "VID-I2V-001",     # Slow Reveal — matches BRUTALIST's controlled menace
    "ART_CULTURE": "VID-I2V-002",   # Living Moment
    "ART_CULTURE_KANYE": "VID-I2V-001",
    "ART_CULTURE_FRANK_OCEAN": "VID-I2V-002",
    "ART_CULTURE_FADER": "VID-I2V-003",  # Energy Burst
    "ART_CULTURE_WES_ANDERSON": "VID-I2V-001",
    "PSYCHEDELIC": "VID-I2V-003",   # Energy Burst
    "EDITORIAL": "VID-I2V-001",     # Slow Reveal
    "PREMIUM": "VID-I2V-001",       # Slow Reveal
    "UGC": "VID-T2V-001",           # UGC Testimonial (text-to-video, no source image needed)
}

# Style family → voiceover template
_VO_BY_STYLE: dict[str, str | None] = {
    "BRUTALIST": "VO-003",          # Streetwear Drop — minimal words, max cool
    "ART_CULTURE": "VO-002",        # Cinematic Narrator
    "ART_CULTURE_KANYE": "VO-003",
    "ART_CULTURE_FRANK_OCEAN": "VO-002",
    "ART_CULTURE_FADER": "VO-001",  # Product Hype
    "ART_CULTURE_WES_ANDERSON": "VO-002",
    "PSYCHEDELIC": None,             # Psychedelic usually better without voice
    "EDITORIAL": "VO-002",          # Cinematic Narrator
    "PREMIUM": "VO-002",            # Cinematic Narrator
    "UGC": "VO-001",                # Product Hype
}

# Style family → audio mix
_MIX_BY_STYLE: dict[str, str] = {
    "BRUTALIST": "AUD-MIX-002",     # Music-Forward — voice is texture
    "PSYCHEDELIC": "AUD-MIX-002",
    "UGC": "AUD-MIX-003",           # UGC Raw — no music
}
_MIX_DEFAULT = "AUD-MIX-001"        # Voice Over Music

# Style family → caption style
_CAPTION_BY_STYLE: dict[str, str] = {
    "BRUTALIST": "CAP-003",          # Brutalist Type — ALL CAPS, hard cut
    "EDITORIAL": "CAP-002",          # Minimal Clean
    "PREMIUM": "CAP-002",
}
_CAPTION_DEFAULT = "CAP-001"         # Bold Impact

# Budget tier → model + quality
_MODEL_BY_TIER: dict[str, tuple[str, str]] = {
    "budget": ("fal-ai/flux/dev", "budget"),
    "standard": ("fal-ai/flux-pro/kontext", "standard"),
    "premium": ("fal-ai/flux-pro/kontext/max", "premium"),
}

# Music product always gets album art model for spotify
_MUSIC_MODEL_OVERRIDE = "fal-ai/flux-pro/v1.1-ultra"


# ---------------------------------------------------------------------------
# Selection function
# ---------------------------------------------------------------------------

def select_template(analysis: BriefAnalysis) -> TemplateSelection:
    """Deterministic template selection from a structured BriefAnalysis.

    This covers ~90% of cases. For the remaining 10% (ambiguous briefs,
    unusual product/platform combos), the coding agent can add an LLM
    fallback node after this one.
    """
    # Image template: exact match → platform fallback → universal fallback
    image_template = (
        _STYLE_TEMPLATE_OVERRIDES.get((analysis.product_type, analysis.platform, analysis.style_family))
        or _TEMPLATE_MAP.get((analysis.product_type, analysis.platform))
        or _PLATFORM_FALLBACK.get(analysis.platform)
        or "IMG-PP-001"  # Product on Icon — most versatile
    )

    # Video template (only for full_production). Carousel rendering is owned by content.carousel.
    video_template = None
    if analysis.output_scope == "full_production":
        video_template = _VIDEO_BY_STYLE.get(analysis.style_family, "VID-I2V-001")

    # Voiceover (only for full_production, and some styles skip it)
    vo_template = None
    if analysis.output_scope == "full_production":
        vo_template = _VO_BY_STYLE.get(analysis.style_family, "VO-002")

    # Audio mix (only if voice exists)
    audio_mix = None
    if vo_template:
        audio_mix = _MIX_BY_STYLE.get(analysis.style_family, _MIX_DEFAULT)

    # Captions (only for full_production)
    caption_style = None
    if analysis.output_scope == "full_production":
        caption_style = _CAPTION_BY_STYLE.get(analysis.style_family, _CAPTION_DEFAULT)

    # Model selection
    if analysis.product_type == "music" and analysis.platform == "spotify":
        model_id = _MUSIC_MODEL_OVERRIDE
        quality_tier = "premium"
    else:
        model_id, quality_tier = _MODEL_BY_TIER.get(analysis.budget_tier, _MODEL_BY_TIER["standard"])

    # Variant count
    if analysis.output_scope == "variants":
        variant_count = 3
    elif analysis.output_scope == "carousel":
        variant_count = 1
    elif analysis.budget_tier == "premium":
        variant_count = 2  # premium gets a spare
    else:
        variant_count = 1

    # Build reasoning
    reasoning = (
        f"{analysis.product_type}/{analysis.platform} → {image_template}, "
        f"style {analysis.style_family}, {analysis.budget_tier} tier"
    )

    return TemplateSelection(
        image_template_id=image_template,
        video_template_id=video_template,
        voiceover_template_id=vo_template,
        audio_mix_id=audio_mix,
        caption_style_id=caption_style,
        model_id=model_id,
        quality_tier=quality_tier,
        variant_count=variant_count,
        reasoning=reasoning,
        style_family=analysis.style_family,
        platform=analysis.platform,
    )
