"""Micro-agent 4: Quality Gate.

Takes a generated asset + the original brief context and decides:
ship it, regenerate with adjustments, or escalate to human review.

This is the LAST node in the creative chain. Nothing leaves without
passing through here. The gate uses a different LLM than the generator
to avoid self-congratulatory scoring.

Why this is separate:
- Scoring is adversarial to generation — different skill, different model
- Regeneration logic needs state tracking (attempt count, prior scores)
- Gate decisions are auditable — every verdict gets logged
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class AssetScore:
    """Score for a single generated asset across all applicable dimensions."""

    # Core dimensions (1-5 scale, None if N/A)
    product_fidelity: float | None = None  # N/A for abstract/mood images
    scene_believability: float = 3.0
    style_adherence: float = 3.0
    composition: float = 3.0
    platform_readiness: float = 3.0

    # Video-only dimensions
    motion_quality: float | None = None
    audio_visual_sync: float | None = None
    caption_readability: float | None = None

    # Computed
    weighted_average: float = 0.0

    # Qualitative
    top_issue: str = "none"
    regeneration_hint: str = "none"

    # Decision
    verdict: str = "regenerate"  # "ship", "regenerate", "human_review"

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


@dataclass
class GateDecision:
    """Full quality gate output — the final word on a generated asset."""

    score: AssetScore
    verdict: str  # "ship", "regenerate", "human_review"
    attempt_number: int
    max_attempts: int
    should_retry: bool  # True if verdict is regenerate AND attempts remain
    escalation_reason: str = ""

    # Regeneration guidance (only populated if should_retry)
    prompt_adjustment: str = ""
    parameter_changes: dict[str, Any] = field(default_factory=dict)

    # Audit trail
    all_attempts: list[AssetScore] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.verdict == "ship"


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

SHIP_THRESHOLD = 3.5       # weighted avg >= 3.5 → auto-approve
REGEN_THRESHOLD = 2.5      # weighted avg >= 2.5 but < 3.5 → regenerate
MAX_REGENERATIONS = 2       # after 2 failed attempts → escalate

# Any single dimension below this forces regeneration regardless of average
HARD_FLOOR = 2.0

# Dimension weights for images
IMAGE_WEIGHTS: dict[str, float] = {
    "product_fidelity": 0.25,
    "scene_believability": 0.20,
    "style_adherence": 0.20,
    "composition": 0.20,
    "platform_readiness": 0.15,
}

# Dimension weights for video (rebalanced)
VIDEO_WEIGHTS: dict[str, float] = {
    "product_fidelity": 0.15,
    "scene_believability": 0.15,
    "style_adherence": 0.15,
    "composition": 0.15,
    "platform_readiness": 0.10,
    "motion_quality": 0.15,
    "audio_visual_sync": 0.10,
    "caption_readability": 0.05,
}


# ---------------------------------------------------------------------------
# Scorer system prompt (~300 tokens — focused and calibrated)
# ---------------------------------------------------------------------------

SCORER_SYSTEM_PROMPT = """You score AI-generated marketing visuals. You are harsh, specific, and honest.

A 3 is average. A 5 is exceptional. Most AI content scores 2.5-3.5. Do not inflate.

Anti-inflation traps you MUST avoid:
1. "It looks nice" is not a 5. Nice is a 3.
2. Correct aspect ratio alone does not make platform_readiness a 5.
3. If you can tell it's AI-generated within 2 seconds, scene_believability cannot exceed 3.
4. Style adherence means it NAILS the specific style family, not just "looks stylish."
5. Extra/missing fingers, melted text, impossible shadows = scene_believability 2 or below.

Score each dimension independently. A stunning composition with a distorted product is still a 1 on product_fidelity.

Respond ONLY with JSON. No explanation."""


SCORER_USER_TEMPLATE = """## Brief
Product: {product_description}
Platform: {platform}
Style: {style_family}
Goal: {campaign_goal}

## Template: {template_id}

## Score these dimensions (1-5 each, null if N/A):

1. **product_fidelity** (0.25): Does the product look correct? Colors, proportions, details. Null only for abstract/mood images with no product.
2. **scene_believability** (0.20): Does the scene look real/intentional? Check hands, text, reflections, shadows, materials.
3. **style_adherence** (0.20): Does it match {style_family}? Compare against: {style_modifiers}
4. **composition** (0.20): Strong focal point? Good use of space? Would it stop a scroll?
5. **platform_readiness** (0.15): Correct ratio for {platform}? Right visual density? Safe zones respected?
{video_dimensions}

Output JSON:
{{
  "product_fidelity": <1-5 or null>,
  "scene_believability": <1-5>,
  "style_adherence": <1-5>,
  "composition": <1-5>,
  "platform_readiness": <1-5>,
  {video_json_fields}
  "top_issue": "<single biggest problem or 'none'>",
  "regeneration_hint": "<specific parameter to change, or 'none'>"
}}"""


_VIDEO_DIMENSIONS_BLOCK = """6. **motion_quality** (0.15): Smooth, natural motion? Or warping/flickering/frozen?
7. **audio_visual_sync** (0.10): Voice matches visuals? Music beats hit on visual changes? Null if silent.
8. **caption_readability** (0.05): Readable, well-timed, well-styled? Null if no captions."""

_VIDEO_JSON_FIELDS = """"motion_quality": <1-5>,
  "audio_visual_sync": <1-5 or null>,
  "caption_readability": <1-5 or null>,"""


# ---------------------------------------------------------------------------
# Regeneration strategy — maps top issues to prompt/param adjustments
# ---------------------------------------------------------------------------

_REGEN_STRATEGIES: dict[str, dict[str, Any]] = {
    "product_fidelity": {
        "prompt_adjustment": "Add stronger reference image guidance. Include explicit product details: exact colors, materials, proportions.",
        "parameter_changes": {"guidance_scale": "+2", "strength": "reduce_creativity"},
    },
    "scene_believability": {
        "prompt_adjustment": "Simplify the scene. Fewer elements, less complex geometry. Avoid hands, text in scene, complex reflections.",
        "parameter_changes": {"seed": "new_random", "quality_tier": "upgrade_if_budget"},
    },
    "style_adherence": {
        "prompt_adjustment": "Double down on style modifiers. Add 3-5 more specific style keywords. Remove any conflicting descriptors.",
        "parameter_changes": {"style_strength": "+0.2"},
    },
    "composition": {
        "prompt_adjustment": "Add explicit composition instruction: 'centered product, rule of thirds, clear focal point, intentional negative space.'",
        "parameter_changes": {"seed": "new_random"},
    },
    "platform_readiness": {
        "prompt_adjustment": "Verify aspect ratio parameter matches platform. Check safe zones.",
        "parameter_changes": {"aspect_ratio": "verify_correct"},
    },
    "motion_quality": {
        "prompt_adjustment": "Reduce motion intensity. Use simpler motion: slow zoom, gentle pan. Avoid complex camera movement.",
        "parameter_changes": {"motion_intensity": "-0.3"},
    },
    "audio_visual_sync": {
        "prompt_adjustment": "Adjust audio timing. Ensure voiceover pacing matches scene changes.",
        "parameter_changes": {"audio_offset_ms": "auto_align"},
    },
    "caption_readability": {
        "prompt_adjustment": "Switch to higher-contrast caption style. Increase font size. Add text shadow/background.",
        "parameter_changes": {"caption_style": "try_alternate"},
    },
}


# ---------------------------------------------------------------------------
# Core scoring logic
# ---------------------------------------------------------------------------

def _compute_weighted_average(score: AssetScore, is_video: bool) -> float:
    """Calculate weighted average, skipping N/A dimensions and rebalancing weights."""
    weights = VIDEO_WEIGHTS if is_video else IMAGE_WEIGHTS
    total_weight = 0.0
    total_score = 0.0

    for dim, weight in weights.items():
        value = getattr(score, dim, None)
        if value is not None:
            total_weight += weight
            total_score += value * weight

    if total_weight == 0:
        return 0.0

    # Normalize so weights of applicable dimensions sum to 1.0
    return round(total_score / total_weight, 2)


def _find_weakest_dimension(score: AssetScore, is_video: bool) -> str:
    """Find the lowest-scoring dimension (weighted)."""
    weights = VIDEO_WEIGHTS if is_video else IMAGE_WEIGHTS
    worst_dim = "scene_believability"
    worst_weighted = float("inf")

    for dim, weight in weights.items():
        value = getattr(score, dim, None)
        if value is not None:
            weighted = value * weight
            if weighted < worst_weighted:
                worst_weighted = weighted
                worst_dim = dim

    return worst_dim


def _has_hard_floor_violation(score: AssetScore, is_video: bool) -> str | None:
    """Check if any dimension is below the hard floor. Returns the dimension name or None."""
    weights = VIDEO_WEIGHTS if is_video else IMAGE_WEIGHTS
    for dim in weights:
        value = getattr(score, dim, None)
        if value is not None and value < HARD_FLOOR:
            return dim
    return None


def _determine_verdict(score: AssetScore, is_video: bool) -> str:
    """Assign verdict based on weighted average and hard floor checks."""
    avg = _compute_weighted_average(score, is_video)
    score.weighted_average = avg

    # Hard floor violation forces regeneration regardless of average
    floor_violation = _has_hard_floor_violation(score, is_video)
    if floor_violation:
        score.top_issue = f"{floor_violation} below minimum threshold ({getattr(score, floor_violation)}/5)"
        return "regenerate" if avg >= REGEN_THRESHOLD else "human_review"

    if avg >= SHIP_THRESHOLD:
        return "ship"
    elif avg >= REGEN_THRESHOLD:
        return "regenerate"
    else:
        return "human_review"


# ---------------------------------------------------------------------------
# Deterministic gate (no LLM — for testing and fast-path)
# ---------------------------------------------------------------------------

def gate_deterministic(
    score: AssetScore,
    *,
    is_video: bool = False,
    attempt_number: int = 1,
    prior_scores: list[AssetScore] | None = None,
) -> GateDecision:
    """Make a gate decision from a pre-computed AssetScore.

    Use this when:
    - Scores came from an external scorer (human or separate LLM call)
    - Testing the gate logic without LLM dependency
    - Fast-path for assets that already have scores
    """
    verdict = _determine_verdict(score, is_video)
    score.verdict = verdict

    # Escalate if we've exhausted regeneration attempts
    if verdict == "regenerate" and attempt_number >= MAX_REGENERATIONS:
        verdict = "human_review"
        score.verdict = verdict

    should_retry = verdict == "regenerate" and attempt_number < MAX_REGENERATIONS

    # Build regeneration guidance
    prompt_adjustment = ""
    parameter_changes: dict[str, Any] = {}
    if should_retry:
        weakest = _find_weakest_dimension(score, is_video)
        strategy = _REGEN_STRATEGIES.get(weakest, _REGEN_STRATEGIES["scene_believability"])
        prompt_adjustment = strategy["prompt_adjustment"]
        parameter_changes = dict(strategy["parameter_changes"])

    escalation_reason = ""
    if verdict == "human_review":
        if attempt_number >= MAX_REGENERATIONS:
            escalation_reason = f"Failed {attempt_number} generation attempts. Best score: {score.weighted_average}/5."
        else:
            escalation_reason = f"Score {score.weighted_average}/5 is below regeneration threshold ({REGEN_THRESHOLD})."

    all_attempts = list(prior_scores or [])
    all_attempts.append(score)

    return GateDecision(
        score=score,
        verdict=verdict,
        attempt_number=attempt_number,
        max_attempts=MAX_REGENERATIONS,
        should_retry=should_retry,
        escalation_reason=escalation_reason,
        prompt_adjustment=prompt_adjustment,
        parameter_changes=parameter_changes,
        all_attempts=all_attempts,
    )


# ---------------------------------------------------------------------------
# LLM-powered gate (production path)
# ---------------------------------------------------------------------------

async def gate_with_llm(
    *,
    product_description: str,
    platform: str,
    style_family: str,
    campaign_goal: str,
    template_id: str,
    style_modifiers: str,
    asset_url: str | None = None,
    asset_base64: str | None = None,
    is_video: bool = False,
    has_captions: bool = False,
    has_audio: bool = False,
    attempt_number: int = 1,
    prior_scores: list[AssetScore] | None = None,
    llm_call: Any,
) -> GateDecision:
    """Score a generated asset using a multimodal LLM (vision required for images).

    MULTIMODAL CONTRACT:
    The llm_call must support one of two signatures:

    Signature A (text-only fallback):
        async def llm_call(system_prompt: str, user_message: str) -> str

    Signature B (multimodal — PREFERRED for image/video scoring):
        async def llm_call(
            system_prompt: str,
            user_message: str,
            *,
            image_url: str | None = None,
            image_base64: str | None = None,
        ) -> str

    The graph layer MUST implement Signature B for production scoring.
    Without the actual image attached, the scorer can only evaluate the
    prompt text — not the generated output. This produces unreliable scores.

    Asset delivery (in order of preference):
        1. asset_url: URL to the generated image/video (fal.ai output URL)
        2. asset_base64: Base64-encoded image data

    At least one must be provided for meaningful visual scoring.
    If neither is provided, the function still works but logs a warning
    in the score's top_issue field.

    Args:
        asset_url: URL to the generated asset (preferred — avoids base64 bloat)
        asset_base64: Base64-encoded image/frame for scoring
        llm_call: Async callable — see signatures above
    """
    video_dimensions = _VIDEO_DIMENSIONS_BLOCK if is_video else ""
    video_json = _VIDEO_JSON_FIELDS if is_video else ""

    user_message = SCORER_USER_TEMPLATE.format(
        product_description=product_description,
        platform=platform,
        style_family=style_family,
        campaign_goal=campaign_goal,
        template_id=template_id,
        style_modifiers=style_modifiers,
        video_dimensions=video_dimensions,
        video_json_fields=video_json,
    )

    # Warn if no visual asset attached — scoring will be text-prompt-only
    no_visual = asset_url is None and asset_base64 is None

    try:
        # Try multimodal signature first, fall back to text-only
        try:
            raw = await llm_call(
                SCORER_SYSTEM_PROMPT,
                user_message,
                image_url=asset_url,
                image_base64=asset_base64,
            )
        except TypeError:
            # llm_call doesn't accept image kwargs — fall back to text-only
            raw = await llm_call(SCORER_SYSTEM_PROMPT, user_message)
            if not no_visual:
                # Had an asset but couldn't pass it — degrade confidence
                no_visual = True

        score = _parse_scorer_response(raw, is_video, has_captions, has_audio)

        if no_visual:
            score.top_issue = (
                f"DEGRADED: Scored without visual asset attached. "
                f"Original issue: {score.top_issue}"
            )
    except Exception:
        # LLM failed — return a conservative "regenerate" with middle scores
        score = AssetScore(
            product_fidelity=3.0,
            scene_believability=3.0,
            style_adherence=3.0,
            composition=3.0,
            platform_readiness=3.0,
            weighted_average=3.0,
            top_issue="LLM scorer unavailable — conservative regeneration",
            regeneration_hint="Retry with scorer available",
            verdict="regenerate",
        )

    return gate_deterministic(
        score,
        is_video=is_video,
        attempt_number=attempt_number,
        prior_scores=prior_scores,
    )


def _parse_scorer_response(
    raw: str,
    is_video: bool,
    has_captions: bool,
    has_audio: bool,
) -> AssetScore:
    """Parse LLM JSON response into an AssetScore."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()

    data = json.loads(text)

    def _clamp(v: Any, lo: float = 1.0, hi: float = 5.0) -> float | None:
        if v is None:
            return None
        try:
            return max(lo, min(hi, float(v)))
        except (TypeError, ValueError):
            return 3.0

    score = AssetScore(
        product_fidelity=_clamp(data.get("product_fidelity")),
        scene_believability=_clamp(data.get("scene_believability", 3.0)) or 3.0,
        style_adherence=_clamp(data.get("style_adherence", 3.0)) or 3.0,
        composition=_clamp(data.get("composition", 3.0)) or 3.0,
        platform_readiness=_clamp(data.get("platform_readiness", 3.0)) or 3.0,
        top_issue=str(data.get("top_issue", "none")),
        regeneration_hint=str(data.get("regeneration_hint", "none")),
    )

    if is_video:
        score.motion_quality = _clamp(data.get("motion_quality", 3.0)) or 3.0
        if has_audio:
            score.audio_visual_sync = _clamp(data.get("audio_visual_sync"))
        if has_captions:
            score.caption_readability = _clamp(data.get("caption_readability"))

    return score
