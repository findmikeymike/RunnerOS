"""Micro-agent 1: Brief Analyzer.

Takes a raw creative brief (possibly vague, possibly messy) and outputs
a structured classification: product type, platform, mood, style family,
output scope, budget tier. This is the FIRST node in the chain.

Why this is a separate agent:
- Classification is a different skill than generation
- Short prompt = high compliance
- Deterministic fallbacks when LLM classification is low-confidence
- Can be tested independently with known brief→classification pairs
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from content.writing.brief_generator import (
    MOOD_TO_STYLE,
    PRODUCT_TYPE_KEYWORDS,
    CreativeBrief,
    _infer_product_type,
    _infer_style_family,
)
from content.writing.creative_modes import coerce_character_lock, coerce_world_profile, normalize_cinema_mode


VALID_PRODUCT_TYPES = {"app", "merch", "music", "general"}
VALID_STYLE_FAMILIES = {
    "BRUTALIST",
    "ART_CULTURE",
    "ART_CULTURE_KANYE",
    "ART_CULTURE_FRANK_OCEAN",
    "ART_CULTURE_FADER",
    "ART_CULTURE_WES_ANDERSON",
    "PSYCHEDELIC",
    "EDITORIAL",
    "PREMIUM",
    "UGC",
}
VALID_OUTPUT_SCOPES = {"image", "image_only", "full_production", "variants", "carousel"}
VALID_BUDGET_TIERS = {"budget", "standard", "premium"}

PRODUCT_TYPE_ALIASES = {
    "software": "app",
    "saas": "app",
    "mobile_app": "app",
    "clothing": "merch",
    "apparel": "merch",
    "social_post": "general",
}
OUTPUT_SCOPE_ALIASES = {
    "static": "image_only",
    "single_image": "image_only",
    "image": "image",
    "video": "full_production",
    "reel": "full_production",
    "reels": "full_production",
    "multiple": "variants",
    "slides": "carousel",
    "slide_deck": "carousel",
    "document_post": "carousel",
}


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------

@dataclass
class BriefAnalysis:
    """Structured output from the Brief Analyzer. Feeds into TemplateSelector."""

    product_type: str          # "app", "merch", "music", "general"
    platform: str              # "tiktok", "instagram_feed", "twitter", etc.
    style_family: str          # "BRUTALIST", "EDITORIAL", etc.
    mood_tags: list[str]       # extracted mood descriptors
    output_scope: str          # "image_only", "full_production", "variants", "carousel"
    budget_tier: str           # "budget", "standard", "premium"
    has_reference_image: bool
    audience_hint: str         # one-line audience description if detectable
    confidence: float          # 0-1, how confident the analysis is

    # Pass-through from brief
    product_description: str = ""
    campaign_goal: str = ""
    aesthetic_notes: str = ""
    copy_for_overlay: str | None = None
    voiceover_script: str | None = None
    cta_text: str | None = None
    script_bits: list[str] = field(default_factory=list)
    must_say: list[str] = field(default_factory=list)
    avoid_phrases: list[str] = field(default_factory=list)
    hook_direction: str = ""
    tone_direction: str = ""
    cinema_mode: str = ""
    character_lock: dict[str, Any] = field(default_factory=dict)
    world_profile: dict[str, Any] = field(default_factory=dict)
    key_audience_insight: str = ""
    max_cost_usd: float = 10.0

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


# ---------------------------------------------------------------------------
# System prompt (~280 tokens — fits in one focused call)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You classify creative briefs. That's your only job.

Read the brief. Output a JSON classification. No creative decisions — just categorize what you see.

Output exactly this JSON:
{
  "product_type": "app" | "merch" | "music" | "general",
  "mood_tags": ["3-5 mood words extracted from the brief"],
  "style_family": "BRUTALIST" | "ART_CULTURE" | "ART_CULTURE_KANYE" | "ART_CULTURE_FRANK_OCEAN" | "ART_CULTURE_FADER" | "ART_CULTURE_WES_ANDERSON" | "PSYCHEDELIC" | "EDITORIAL" | "PREMIUM" | "UGC",
  "output_scope": "image_only" | "full_production" | "variants" | "carousel",
  "budget_tier": "budget" | "standard" | "premium",
  "audience_hint": "one sentence describing who this is for"
}

Style family guide:
- BRUTALIST: dark, harsh, industrial, cold, minimal, angular, concrete
- ART_CULTURE: fashion-forward, editorial-meets-street, cultural moment
- ART_CULTURE_KANYE: desert, earth tones, architectural, oversized
- ART_CULTURE_FRANK_OCEAN: analog, golden hour, nostalgic, intimate, warm
- ART_CULTURE_FADER: flash photography, bold eye contact, magazine raw
- ART_CULTURE_WES_ANDERSON: symmetrical, pastel, whimsical, retro, precise
- PSYCHEDELIC: swirling colors, cosmic, retro-futurist, trippy, iridescent
- EDITORIAL: studio lighting, clean, precise, magazine quality, controlled
- PREMIUM: luxury, soft lighting, warm neutrals, floating product, refined
- UGC: iPhone quality, natural light, authentic, casual, unpolished

Budget mapping:
- "budget": testing, drafts, quick iterations, tight budget
- "standard": production content, default choice
- "premium": hero assets, flagship campaigns, unlimited budget mentioned

Output scope mapping:
- "carousel": social swipe decks, slide posts, LinkedIn document posts, Instagram carousels
- "full_production": reels, video ads, clips, commercials, trailers
- "variants": A/B tests or multiple image concepts
- "image_only": single static image or post

If the brief is vague, make your best guess and set confidence below 0.6.
Respond ONLY with the JSON. No explanation."""


# ---------------------------------------------------------------------------
# Analysis function
# ---------------------------------------------------------------------------

def analyze_brief_deterministic(brief: CreativeBrief) -> BriefAnalysis:
    """Fast, deterministic brief analysis using rules only. No LLM call.

    Use this when:
    - The brief has explicit mood_keywords and style_family_suggestion
    - Speed matters more than nuance
    - LLM is unavailable
    """
    product_type = brief.product_type if brief.product_type != "general" else _infer_product_type(brief.product_description)
    style = brief.style_family_suggestion or _infer_style_family(brief.mood_keywords)
    audience_hint = _extract_audience_hint(brief)

    # Budget tier from cost cap
    if brief.max_cost_usd <= 1.0:
        budget_tier = "budget"
    elif brief.max_cost_usd <= 5.0:
        budget_tier = "standard"
    else:
        budget_tier = "premium"

    # Confidence: high if mood keywords and style were explicit
    confidence = 0.9 if brief.mood_keywords and brief.style_family_suggestion else 0.6

    return BriefAnalysis(
        product_type=product_type,
        platform=brief.platform,
        style_family=style,
        mood_tags=brief.mood_keywords,
        output_scope=brief.output_type,
        budget_tier=budget_tier,
        has_reference_image=bool(brief.reference_image_paths),
        audience_hint=audience_hint,
        confidence=confidence,
        product_description=brief.product_description,
        campaign_goal=brief.campaign_goal,
        aesthetic_notes=brief.aesthetic_notes,
        copy_for_overlay=brief.copy_for_overlay,
        voiceover_script=brief.voiceover_script,
        cta_text=brief.cta_text,
        script_bits=list(getattr(brief, "script_bits", []) or []),
        must_say=list(getattr(brief, "must_say", []) or []),
        avoid_phrases=list(getattr(brief, "avoid_phrases", []) or []),
        hook_direction=getattr(brief, "hook_direction", "") or "",
        tone_direction=getattr(brief, "tone_direction", "") or "",
        cinema_mode=normalize_cinema_mode(getattr(brief, "cinema_mode", "") or ""),
        character_lock=coerce_character_lock(getattr(brief, "character_lock", {}) or {}),
        world_profile=coerce_world_profile(getattr(brief, "world_profile", {}) or {}),
        key_audience_insight=brief.key_audience_insight,
        max_cost_usd=brief.max_cost_usd,
    )


async def analyze_brief_llm(
    brief: CreativeBrief,
    llm_call: Any,
) -> BriefAnalysis:
    """LLM-powered brief analysis for vague or ambiguous briefs.

    Use this when:
    - Brief has no mood_keywords
    - Brief is free-form text from a human
    - Deterministic analysis returned confidence < 0.6
    """
    user_message = (
        f"Product: {brief.product_description}\n"
        f"Goal: {brief.campaign_goal}\n"
        f"Platform: {brief.platform}\n"
        f"Budget: ${brief.max_cost_usd}\n"
    )
    if brief.mood_keywords:
        user_message += f"Mood hints: {', '.join(brief.mood_keywords)}\n"
    if brief.aesthetic_notes:
        user_message += f"Aesthetic notes: {brief.aesthetic_notes}\n"

    try:
        raw = await llm_call(SYSTEM_PROMPT, user_message)
        data = _parse_json(raw)
        deterministic = analyze_brief_deterministic(brief)

        return BriefAnalysis(
            product_type=_normalize_enum(
                data.get("product_type") or data.get("content_type"),
                VALID_PRODUCT_TYPES,
                deterministic.product_type,
                aliases=PRODUCT_TYPE_ALIASES,
            ),
            platform=brief.platform,
            style_family=_normalize_enum(data.get("style_family"), VALID_STYLE_FAMILIES, deterministic.style_family),
            mood_tags=_normalize_mood_tags(data.get("mood_tags"), brief.mood_keywords),
            output_scope=_normalize_enum(
                data.get("output_scope"),
                VALID_OUTPUT_SCOPES,
                deterministic.output_scope,
                aliases=OUTPUT_SCOPE_ALIASES,
            ),
            budget_tier=_normalize_enum(data.get("budget_tier"), VALID_BUDGET_TIERS, deterministic.budget_tier),
            has_reference_image=bool(brief.reference_image_paths),
            audience_hint=_normalize_audience_hint(data.get("audience_hint")) or deterministic.audience_hint,
            confidence=0.8,  # LLM classification is generally reliable for this task
            product_description=brief.product_description,
            campaign_goal=brief.campaign_goal,
            aesthetic_notes=brief.aesthetic_notes,
            copy_for_overlay=brief.copy_for_overlay,
            voiceover_script=brief.voiceover_script,
            cta_text=brief.cta_text,
            script_bits=list(getattr(brief, "script_bits", []) or []),
            must_say=list(getattr(brief, "must_say", []) or []),
            avoid_phrases=list(getattr(brief, "avoid_phrases", []) or []),
            hook_direction=getattr(brief, "hook_direction", "") or "",
            tone_direction=getattr(brief, "tone_direction", "") or "",
            cinema_mode=normalize_cinema_mode(getattr(brief, "cinema_mode", "") or ""),
            character_lock=coerce_character_lock(getattr(brief, "character_lock", {}) or {}),
            world_profile=coerce_world_profile(getattr(brief, "world_profile", {}) or {}),
            key_audience_insight=brief.key_audience_insight,
            max_cost_usd=brief.max_cost_usd,
        )
    except Exception:
        # LLM failed — fall back to deterministic
        return analyze_brief_deterministic(brief)


def _parse_json(raw: str) -> dict:
    """Extract JSON from LLM response, handling markdown blocks."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _normalize_enum(
    value: Any,
    allowed: set[str],
    fallback: str,
    *,
    aliases: dict[str, str] | None = None,
) -> str:
    """Return a known enum value, or a deterministic fallback."""
    if not isinstance(value, str):
        return fallback

    cleaned = value.strip()
    if not cleaned:
        return fallback

    canonical = cleaned.upper() if any(item.isupper() for item in allowed) else cleaned.lower()
    if canonical in allowed:
        return canonical

    alias_key = cleaned.strip().lower().replace("-", "_").replace(" ", "_")
    alias = (aliases or {}).get(alias_key)
    if alias in allowed:
        return alias

    return fallback


def _normalize_mood_tags(value: Any, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback
    tags = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return tags or fallback


def _normalize_audience_hint(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return _clean_audience_hint(value)


def _extract_audience_hint(brief: CreativeBrief) -> str:
    if brief.key_audience_insight.strip():
        return _clean_audience_hint(brief.key_audience_insight)

    patterns = [
        r"\b(?:for|targeting|aimed at|built for|made for|designed for)\s+([^.;\n]+)",
    ]
    for text in (brief.campaign_goal, brief.aesthetic_notes, brief.product_description):
        if not text or not text.strip():
            continue
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                hint = _clean_audience_hint(match.group(1))
                if _is_high_confidence_audience(hint):
                    return hint
    return ""


def _clean_audience_hint(value: str) -> str:
    hint = re.split(r"\b(?:with|using|featuring|that|who|and drive|to drive)\b", value.strip(), maxsplit=1, flags=re.IGNORECASE)[0]
    hint = re.sub(r"\s+", " ", hint).strip(" .,:;\"'")
    return hint[:160]


def _is_high_confidence_audience(hint: str) -> bool:
    if not hint:
        return False
    words = hint.split()
    if not 2 <= len(words) <= 12:
        return False
    low_signal = {"instagram", "tiktok", "twitter", "x", "linkedin", "feed", "story", "post", "carousel"}
    return not all(word.lower().strip(".,") in low_signal for word in words)
