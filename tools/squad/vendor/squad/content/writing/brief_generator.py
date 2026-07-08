"""Creative brief generator — translates campaign strategy into visual direction.

The Content Agent writes copy AND generates creative briefs for the Creative Director.
This module structures that brief so the Creative Director gets consistent, complete input.

Usage:
    from content.writing.brief_generator import CreativeBrief, build_brief

    brief = build_brief(
        product_description="Mobile productivity app with dark UI and teal accents",
        campaign_goal="Drive app store downloads from Instagram",
        platform="instagram_feed",
        mood_keywords=["clean", "professional", "sharp"],
        copy_for_overlay="Less noise. More signal.",
    )
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from content.writing.creative_modes import (
    VALID_CINEMA_MODES,
    VALID_RENDER_STYLES,
    coerce_character_lock,
    coerce_world_profile,
    normalize_cinema_mode,
    normalize_render_style,
)


# ---------------------------------------------------------------------------
# Mood → style family mapping (mirrors TEMPLATES_STRUCTURED.py ENERGY_TO_STYLE)
# ---------------------------------------------------------------------------

MOOD_TO_STYLE: dict[str, str] = {
    # BRUTALIST
    "dark": "BRUTALIST", "edgy": "BRUTALIST", "minimal": "BRUTALIST",
    "industrial": "BRUTALIST", "cold": "BRUTALIST", "harsh": "BRUTALIST",
    "menacing": "BRUTALIST", "angular": "BRUTALIST",
    # ART_CULTURE
    "cool": "ART_CULTURE", "cultural": "ART_CULTURE", "artistic": "ART_CULTURE",
    "fashion": "ART_CULTURE", "editorial-street": "ART_CULTURE",
    # ART_CULTURE sub-moods
    "dreamy": "ART_CULTURE_FRANK_OCEAN", "nostalgic": "ART_CULTURE_FRANK_OCEAN",
    "warm": "ART_CULTURE_FRANK_OCEAN", "intimate": "ART_CULTURE_FRANK_OCEAN",
    "analog": "ART_CULTURE_FRANK_OCEAN",
    "quirky": "ART_CULTURE_WES_ANDERSON", "symmetrical": "ART_CULTURE_WES_ANDERSON",
    "retro": "ART_CULTURE_WES_ANDERSON", "whimsical": "ART_CULTURE_WES_ANDERSON",
    "pastel": "ART_CULTURE_WES_ANDERSON",
    "bold": "ART_CULTURE_FADER", "raw": "ART_CULTURE_FADER",
    "street": "ART_CULTURE_FADER", "magazine": "ART_CULTURE_FADER",
    "earthy": "ART_CULTURE_KANYE", "desert": "ART_CULTURE_KANYE",
    "architectural": "ART_CULTURE_KANYE", "oversized": "ART_CULTURE_KANYE",
    # PSYCHEDELIC
    "trippy": "PSYCHEDELIC", "colorful": "PSYCHEDELIC", "cosmic": "PSYCHEDELIC",
    "vibrant": "PSYCHEDELIC", "psychedelic": "PSYCHEDELIC", "wild": "PSYCHEDELIC",
    # EDITORIAL
    "clean": "EDITORIAL", "professional": "EDITORIAL", "sharp": "EDITORIAL",
    "polished": "EDITORIAL", "precise": "EDITORIAL",
    # PREMIUM
    "luxury": "PREMIUM", "premium": "PREMIUM", "sleek": "PREMIUM",
    "high-end": "PREMIUM", "refined": "PREMIUM", "sophisticated": "PREMIUM",
    # UGC
    "authentic": "UGC", "real": "UGC", "casual": "UGC",
    "iphone": "UGC", "ugc": "UGC", "unfiltered": "UGC",
}

PRODUCT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "app": ["app", "software", "digital", "platform", "saas", "tool", "dashboard", "mobile app"],
    "merch": ["tshirt", "t-shirt", "hoodie", "merch", "clothing", "apparel", "hat", "cap", "sweatshirt"],
    "music": ["song", "album", "single", "track", "ep", "mixtape", "music", "beat", "record"],
}


# ---------------------------------------------------------------------------
# Creative brief dataclass
# ---------------------------------------------------------------------------

@dataclass
class CreativeBrief:
    """Structured creative brief for the Creative Director agent.

    This is the handoff document from Content Agent → Creative Director.
    Every field maps to something the Creative Director's decision tree uses.
    """

    # Required
    product_description: str
    campaign_goal: str
    platform: str

    # Style direction
    mood_keywords: list[str] = field(default_factory=list)
    style_family_suggestion: str = ""  # Creative Director may override
    product_type: str = "general"
    render_style: str = "auto"  # explicit look: auto/photoreal/painterly/illustrated/animated/stylized/mixed

    # Content for the visual
    copy_for_overlay: str | None = None  # text to burn into image/video
    voiceover_script: str | None = None  # narration script for video
    cta_text: str | None = None  # call to action text
    script_bits: list[str] = field(default_factory=list)  # loose lines/fragments Squad may weave into script
    must_say: list[str] = field(default_factory=list)  # required phrases for generated scripts
    avoid_phrases: list[str] = field(default_factory=list)  # phrases/tone to avoid in generated scripts
    hook_direction: str = ""  # loose hook direction when script is not final
    tone_direction: str = ""  # loose spoken-performance direction

    # References
    reference_image_paths: list[str] = field(default_factory=list)
    reference_assets: list[dict[str, Any]] = field(default_factory=list)
    reference_urls: list[str] = field(default_factory=list)  # competitor/inspiration visuals
    aesthetic_notes: str = ""  # free-form visual direction
    cinema_mode: str = ""  # narrative/studio_editorial/action/performance/atmospheric
    character_lock: dict[str, Any] = field(default_factory=dict)  # compact identity continuity constraints
    world_profile: dict[str, Any] = field(default_factory=dict)  # compact setting/palette/lighting/audio continuity

    # Budget
    max_cost_usd: float = 10.0
    output_type: str = "image"  # "image", "full_production", "variants", "carousel"
    variant_count: int = 1

    # Research context (from Research Agent)
    key_audience_insight: str = ""
    competitor_visual_notes: str = ""

    def __post_init__(self) -> None:
        if self.cinema_mode:
            self.cinema_mode = normalize_cinema_mode(self.cinema_mode) or self.cinema_mode
        if self.render_style:
            self.render_style = normalize_render_style(self.render_style) or self.render_style
        self.character_lock = coerce_character_lock(self.character_lock)
        self.world_profile = coerce_world_profile(self.world_profile)

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v}

    def validate(self) -> list[str]:
        """Return list of validation errors. Empty = valid."""
        errors: list[str] = []
        if not self.product_description.strip():
            errors.append("product_description is required")
        if not self.campaign_goal.strip():
            errors.append("campaign_goal is required")
        if not self.platform.strip():
            errors.append("platform is required")
        if self.max_cost_usd <= 0:
            errors.append("max_cost_usd must be positive")
        if self.variant_count < 1:
            errors.append("variant_count must be >= 1")
        if self.output_type not in ("image", "full_production", "variants", "carousel"):
            errors.append(f"output_type must be image/full_production/variants/carousel, got {self.output_type}")
        if self.cinema_mode and not normalize_cinema_mode(self.cinema_mode):
            errors.append(f"cinema_mode must be one of {', '.join(VALID_CINEMA_MODES)}, got {self.cinema_mode}")
        if self.render_style and not normalize_render_style(self.render_style):
            errors.append(f"render_style must be one of {', '.join(VALID_RENDER_STYLES)}, got {self.render_style}")
        return errors


# ---------------------------------------------------------------------------
# Builder function
# ---------------------------------------------------------------------------

def _infer_product_type(product_description: str) -> str:
    """Infer product type from description text."""
    desc_lower = product_description.lower()
    for ptype, keywords in PRODUCT_TYPE_KEYWORDS.items():
        if any(kw in desc_lower for kw in keywords):
            return ptype
    return "general"


def _infer_style_family(mood_keywords: list[str]) -> str:
    """Map mood keywords to a style family. Uses majority vote."""
    if not mood_keywords:
        return "EDITORIAL"  # safe default

    votes: dict[str, int] = {}
    for mood in mood_keywords:
        style = MOOD_TO_STYLE.get(mood.lower().strip())
        if style:
            votes[style] = votes.get(style, 0) + 1

    if not votes:
        return "EDITORIAL"

    return max(votes, key=votes.get)  # type: ignore[arg-type]


def _infer_output_type(campaign_goal: str, platform: str) -> str:
    """Infer whether we need image only, full production, or variants."""
    goal_lower = campaign_goal.lower()
    platform_lower = platform.lower()

    carousel_keywords = [
        r"\bcarousel\b",
        r"\bslides?\b",
        r"\bslideshows?\b",
        r"\bswipe\b",
        r"\bswipeable\b",
        r"\bdeck\b",
        r"\bdocument post\b",
        r"\blinkedin document\b",
    ]
    if any(re.search(kw, goal_lower) for kw in carousel_keywords):
        return "carousel"

    # Video platforms default to full production
    video_platforms = {"tiktok", "instagram_story", "youtube"}
    if platform_lower in video_platforms:
        return "full_production"

    # Video keywords in goal (word-boundary matching to avoid false positives like "downloads")
    video_keywords = [r"\bvideo\b", r"\breel\b", r"\bclip\b", r"\bad\b", r"\bads\b", r"\bcommercial\b", r"\bteaser\b", r"\btrailer\b"]
    if any(re.search(kw, goal_lower) for kw in video_keywords):
        return "full_production"

    # A/B test / variant keywords — use phrase matching to avoid
    # false positives like "quick test post" or "testing the waters"
    variant_phrases = [
        "a/b",
        "a/b test",
        "split test",
        "variant",
        "variants",
        "multiple options",
        "multiple versions",
        "compare versions",
        "test different",
        "test multiple",
    ]
    if any(phrase in goal_lower for phrase in variant_phrases):
        return "variants"

    return "image"


def build_brief(
    *,
    product_description: str,
    campaign_goal: str,
    platform: str,
    mood_keywords: list[str] | None = None,
    style_family: str | None = None,
    product_type: str | None = None,
    copy_for_overlay: str | None = None,
    voiceover_script: str | None = None,
    cta_text: str | None = None,
    script_bits: list[str] | None = None,
    must_say: list[str] | None = None,
    avoid_phrases: list[str] | None = None,
    hook_direction: str = "",
    tone_direction: str = "",
    reference_image_paths: list[str] | None = None,
    reference_assets: list[dict[str, Any]] | None = None,
    reference_urls: list[str] | None = None,
    aesthetic_notes: str = "",
    cinema_mode: str = "",
    character_lock: dict[str, Any] | None = None,
    world_profile: dict[str, Any] | None = None,
    max_cost_usd: float = 10.0,
    output_type: str | None = None,
    variant_count: int | None = None,
    key_audience_insight: str = "",
    competitor_visual_notes: str = "",
) -> CreativeBrief:
    """Build a complete creative brief with intelligent defaults.

    Infers product_type, style_family, and output_type from the inputs
    when not explicitly provided. The Creative Director can override
    any suggestion.
    """
    moods = mood_keywords or []
    inferred_product_type = product_type or _infer_product_type(product_description)
    inferred_style = style_family or _infer_style_family(moods)
    inferred_output = output_type or _infer_output_type(campaign_goal, platform)

    # Default variant count
    if variant_count is None:
        variant_count = 3 if inferred_output == "variants" else 1

    brief = CreativeBrief(
        product_description=product_description,
        campaign_goal=campaign_goal,
        platform=platform,
        mood_keywords=moods,
        style_family_suggestion=inferred_style,
        product_type=inferred_product_type,
        copy_for_overlay=copy_for_overlay,
        voiceover_script=voiceover_script,
        cta_text=cta_text,
        script_bits=script_bits or [],
        must_say=must_say or [],
        avoid_phrases=avoid_phrases or [],
        hook_direction=hook_direction,
        tone_direction=tone_direction,
        reference_image_paths=reference_image_paths or [],
        reference_assets=reference_assets or [],
        reference_urls=reference_urls or [],
        aesthetic_notes=aesthetic_notes,
        cinema_mode=cinema_mode,
        character_lock=coerce_character_lock(character_lock),
        world_profile=coerce_world_profile(world_profile),
        max_cost_usd=max_cost_usd,
        output_type=inferred_output,
        variant_count=variant_count,
        key_audience_insight=key_audience_insight,
        competitor_visual_notes=competitor_visual_notes,
    )

    errors = brief.validate()
    if errors:
        raise ValueError(f"Invalid creative brief: {'; '.join(errors)}")

    return brief
