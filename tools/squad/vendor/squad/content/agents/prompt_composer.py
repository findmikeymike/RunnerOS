"""Micro-agent 3: Prompt Composer.

Takes a TemplateSelection + BriefAnalysis and fills the prompt template
with concrete values. This is where the LLM adds creative value — turning
"black tshirt, BRUTALIST style" into a vivid, specific generation prompt.

Why this is separate:
- Prompt writing is a creative task — benefits from LLM
- Template filling is mechanical — can be tested deterministically
- Separating them means we can A/B test prompt styles
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from content.agents.brief_analyzer import BriefAnalysis
from content.writing.creative_modes import creative_mode_text
from content.agents.template_selector import TemplateSelection


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

@dataclass
class ComposedPrompt:
    """Ready-to-send generation payload. Feeds into the image/video adapters."""

    # Image generation
    image_prompt: str
    image_negative_prompt: str
    image_model: str
    image_aspect_ratio: str
    reference_image_paths: list[str] = field(default_factory=list)

    # Video generation (if applicable)
    video_prompt: str | None = None
    video_duration_s: int = 5

    # Voiceover (if applicable)
    voiceover_script: str | None = None

    # Metadata
    template_id: str = ""
    style_family: str = ""
    variant_seed: int | None = None
    estimated_cost_usd: float = 0.0


# ---------------------------------------------------------------------------
# System prompt for creative prompt writing (~250 tokens)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You write image generation prompts. You are specific, visual, and vivid.

You receive:
- A product description
- A style direction with modifiers
- A template structure with placeholders

Your job: Fill the placeholders with concrete, specific visual details. Not vague adjectives — actual scene descriptions a photographer could execute.

BAD: "a cool scene with nice lighting"
GOOD: "standing on a rain-slicked rooftop at blue hour, sodium vapor streetlights casting amber pools, breath visible in cold air"

BAD: "modern and sleek"
GOOD: "brushed aluminum surface, single overhead softbox, 45-degree key light, dark gradient background fading from charcoal to black"

Rules:
1. Product description must appear verbatim — don't rephrase what the product looks like
2. Style modifiers from the template must be included
3. Be specific about lighting, camera, materials, textures
4. Keep total prompt under 200 words — models perform worse with longer prompts
5. Never include text/words you want rendered in the image (text rendering is unreliable)

Respond with ONLY the filled prompt text. No JSON, no explanation."""


# ---------------------------------------------------------------------------
# Aspect ratio lookup
# ---------------------------------------------------------------------------

_ASPECT_BY_PLATFORM: dict[str, str] = {
    "instagram_feed": "1:1",
    "instagram_story": "9:16",
    "tiktok": "9:16",
    "twitter": "16:9",
    "x": "16:9",
    "linkedin": "16:9",
    "website": "16:9",
    "youtube": "16:9",
    "spotify": "1:1",
    "app_store": "9:16",
    "email": "16:9",
}

# Template ID prefixes that force specific ratios
_TEMPLATE_RATIO_OVERRIDES: dict[str, str] = {
    "IMG-MU-001": "1:1",    # Album art is always square
    "IMG-SO-001": "1:1",    # Instagram square
    "IMG-SO-002": "9:16",   # Vertical story/reel
    "IMG-HE-": "16:9",      # Hero banners are landscape
}


# ---------------------------------------------------------------------------
# Style modifier injection
# ---------------------------------------------------------------------------

# Condensed style modifiers (~30 words each, not the full verbose set)
_STYLE_CORE: dict[str, str] = {
    "BRUTALIST": "harsh directional light, deep shadows, monochrome, high contrast, concrete and steel, matte black, grainy film, cold, clinical",
    "ART_CULTURE": "editorial flash, bold framing, cultural moment, raw-yet-composed, mixed textures, candid energy",
    "ART_CULTURE_KANYE": "muted earth tones, desert light, oversized proportions, architectural minimalism, Hasselblad medium format",
    "ART_CULTURE_FRANK_OCEAN": "Kodak Portra 400, golden hour, analog grain, soft focus, intimate, nostalgic warmth, shallow depth of field",
    "ART_CULTURE_FADER": "flash photography, bold eye contact, urban, print magazine quality, raw energy, cultural",
    "ART_CULTURE_WES_ANDERSON": "perfect symmetry, pastel palette, centered composition, retro, whimsical precision, flat lighting",
    "PSYCHEDELIC": "iridescent gradients, kaleidoscopic, chrome reflections, retro-futurist, neon accents, liquid color, cosmic",
    "EDITORIAL": "studio lighting, clean background, sharp focus, controlled palette, magazine quality, dramatic shadows",
    "PREMIUM": (
        "soft studio lighting, warm neutrals, brushed metal, frosted glass, isolated product hero, "
        "crisp garment graphic visibility, sculptural pedestal, luxury, restrained depth of field"
    ),
    "UGC": "iPhone photo, natural light, casual composition, slight motion blur, real skin, imperfect, vertical framing",
}

_STYLE_NEGATIVES: dict[str, str] = {
    "BRUTALIST": "colorful, warm, soft, cute, playful, saturated, organic, nature",
    "ART_CULTURE": "stock photo, corporate, sterile, clipart, over-processed, HDR",
    "PSYCHEDELIC": "boring, flat, corporate, minimal, monochrome, mundane",
    "EDITORIAL": "cluttered, amateur, noisy, over-saturated, chaotic",
    "PREMIUM": "cheap, plastic, flat lighting, cluttered, stock photo, discount, human model, busy room, candid lifestyle",
    "UGC": "studio lighting, perfect composition, airbrushed, stock photo, staged",
}

_NON_VISUAL_DIRECTION_LABELS: tuple[str, ...] = (
    "audio goal",
    "caption goal",
    "voiceover goal",
    "music/sfx goal",
    "music goal",
    "sfx goal",
    "reference strategy",
    "caption role",
    "provider",
    "cost goal",
)

_VISUAL_DIRECTION_LABELS: tuple[str, ...] = (
    "visual premise",
    "image focus",
    "story scene direction",
    "scene direction",
    "motion intent",
    "shot purpose",
    "shot action",
    "framing",
    "continuity anchor",
    "visual goal",
)


# ---------------------------------------------------------------------------
# Cost estimation
# ---------------------------------------------------------------------------

_IMAGE_COST: dict[str, float] = {
    "fal-ai/flux/dev": 0.03,
    "fal-ai/flux-pro/kontext": 0.04,
    "fal-ai/flux-pro/kontext/max": 0.08,
    "fal-ai/flux-pro/v1.1-ultra": 0.03,
    "fal-ai/flux/schnell": 0.01,
}

_VIDEO_COST_PER_SEC: dict[str, float] = {
    "budget": 0.07,
    "standard": 0.14,
    "premium": 0.28,
}


# ---------------------------------------------------------------------------
# Compose function
# ---------------------------------------------------------------------------

def compose_deterministic(
    analysis: BriefAnalysis,
    selection: TemplateSelection,
) -> ComposedPrompt:
    """Build a generation prompt without an LLM call.

    Uses the product description + style modifiers directly.
    Good enough for testing and for briefs with very clear descriptions.
    """
    style_mods = _STYLE_CORE.get(selection.style_family, _STYLE_CORE["EDITORIAL"])
    negative = _STYLE_NEGATIVES.get(selection.style_family, "blurry, low quality, watermark")

    # Build image prompt
    parts = [analysis.product_description]
    parts.append(f"for {analysis.platform}")
    visual_direction = _visual_direction_for_prompt(analysis)
    if visual_direction:
        parts.append(visual_direction)
    parts.append(style_mods)

    image_prompt = ", ".join(parts)

    # Aspect ratio
    aspect = "1:1"  # safe default
    for prefix, ratio in _TEMPLATE_RATIO_OVERRIDES.items():
        if selection.image_template_id.startswith(prefix):
            aspect = ratio
            break
    else:
        aspect = _ASPECT_BY_PLATFORM.get(analysis.platform, "1:1")

    # Video prompt
    video_prompt = None
    if selection.video_template_id:
        video_prompt = f"Slow, cinematic motion of {analysis.product_description}. Subtle atmospheric movement. {style_mods}."

    # Cost estimate
    img_cost = _IMAGE_COST.get(selection.model_id, 0.04) * selection.variant_count
    vid_cost = 0.0
    if selection.video_template_id:
        vid_cost = _VIDEO_COST_PER_SEC.get(selection.quality_tier, 0.07) * 5  # default 5s
    vo_cost = 0.03 if selection.voiceover_template_id else 0.0

    return ComposedPrompt(
        image_prompt=image_prompt,
        image_negative_prompt=f"{negative}, blurry, low quality, distorted, watermark, extra fingers, deformed",
        image_model=selection.model_id,
        image_aspect_ratio=aspect,
        reference_image_paths=[],  # filled by the graph from brief.reference_image_paths
        video_prompt=video_prompt,
        video_duration_s=5,
        voiceover_script=analysis.voiceover_script,
        template_id=selection.image_template_id,
        style_family=selection.style_family,
        estimated_cost_usd=round(img_cost + vid_cost + vo_cost, 3),
    )


async def compose_with_llm(
    analysis: BriefAnalysis,
    selection: TemplateSelection,
    llm_call: Any,
) -> ComposedPrompt:
    """Use an LLM to write a vivid, specific generation prompt.

    This produces significantly better images than compose_deterministic
    because the LLM fills in creative details (lighting, scene, mood)
    that the brief didn't specify.
    """
    style_mods = _STYLE_CORE.get(selection.style_family, _STYLE_CORE["EDITORIAL"])
    negative = _STYLE_NEGATIVES.get(selection.style_family, "blurry, low quality, watermark")

    user_message = (
        f"Product: {analysis.product_description}\n"
        f"Platform: {analysis.platform}\n"
        f"Style: {selection.style_family}\n"
        f"Style modifiers to include: {style_mods}\n"
        f"Template: {selection.image_template_id}\n"
        f"Goal: {analysis.campaign_goal}\n"
        f"Visual direction: {_visual_direction_for_prompt(analysis) or 'use the product and goal as the visual source'}\n"
        f"Mood: {', '.join(analysis.mood_tags)}\n"
    )
    if analysis.audience_hint:
        user_message += f"Audience: {analysis.audience_hint}\n"

    try:
        image_prompt = await llm_call(SYSTEM_PROMPT, user_message)
        image_prompt = image_prompt.strip().strip('"')
    except Exception:
        # Fallback to deterministic
        return compose_deterministic(analysis, selection)

    # Video prompt (LLM-written if video needed)
    video_prompt = None
    if selection.video_template_id:
        try:
            vid_msg = (
                f"Now write a short motion prompt for video generation from this image.\n"
                f"Style: {selection.style_family}\n"
                f"Keep it under 50 words. Describe camera movement and subtle motion only."
            )
            video_prompt = await llm_call(SYSTEM_PROMPT, vid_msg)
            video_prompt = video_prompt.strip().strip('"')
        except Exception:
            video_prompt = f"Slow cinematic motion. {style_mods}."

    # Aspect ratio (same logic as deterministic)
    aspect = "1:1"
    for prefix, ratio in _TEMPLATE_RATIO_OVERRIDES.items():
        if selection.image_template_id.startswith(prefix):
            aspect = ratio
            break
    else:
        aspect = _ASPECT_BY_PLATFORM.get(analysis.platform, "1:1")

    # Cost
    img_cost = _IMAGE_COST.get(selection.model_id, 0.04) * selection.variant_count
    vid_cost = _VIDEO_COST_PER_SEC.get(selection.quality_tier, 0.07) * 5 if selection.video_template_id else 0.0
    vo_cost = 0.03 if selection.voiceover_template_id else 0.0

    return ComposedPrompt(
        image_prompt=image_prompt,
        image_negative_prompt=f"{negative}, blurry, low quality, distorted, watermark, extra fingers, deformed",
        image_model=selection.model_id,
        image_aspect_ratio=aspect,
        reference_image_paths=[],
        video_prompt=video_prompt,
        video_duration_s=5,
        voiceover_script=analysis.voiceover_script,
        template_id=selection.image_template_id,
        style_family=selection.style_family,
        estimated_cost_usd=round(img_cost + vid_cost + vo_cost, 3),
    )


def _visual_direction_for_prompt(analysis: BriefAnalysis) -> str:
    """Keep scene intent without leaking audio/caption/provider planning notes."""
    raw = " ".join(
        value.strip()
        for value in (
            analysis.campaign_goal,
            analysis.aesthetic_notes,
            creative_mode_text(analysis, visual_only=True),
            analysis.key_audience_insight,
        )
        if value and value.strip()
    )
    if not raw:
        return ""
    cleaned = _strip_non_visual_direction(raw)
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return ""
    words = cleaned.split()
    if len(words) > 80:
        cleaned = " ".join(words[:80]).rstrip(" ,;:.") + "."
    return f"visual brief: {cleaned}"


def _strip_non_visual_direction(text: str) -> str:
    cleaned = text
    label_pattern = r"\b[A-Z][A-Za-z /-]{1,32}:\s"
    for label in _NON_VISUAL_DIRECTION_LABELS:
        cleaned = re.sub(
            rf"\b{re.escape(label)}:\s*.*?(?={label_pattern}|$)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
    for label in _VISUAL_DIRECTION_LABELS:
        cleaned = re.sub(rf"\b{re.escape(label)}:\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip(" ,;.")
