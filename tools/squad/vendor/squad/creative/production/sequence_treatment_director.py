"""LLM sequence-treatment director.

One bounded LLM call per video run. Picks four through-line craft decisions that tint every
shot of the piece: a palette/texture anchor, a rhythm rule, an emotional tension, and a
repeatable composition move. The output is intentionally compact so it sharpens downstream
prompts without becoming another loose creative layer.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from textwrap import dedent
from typing import Any

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import (
    CreativeTreatmentPlan,
    FormatNarrativePlan,
    SequenceTreatment,
)


@dataclass(frozen=True, slots=True)
class OpenAIResponsesSequenceTreatmentDirector:
    api_key: str
    model: str = "gpt-4.1-mini"
    base_url: str | None = None
    timeout_sec: int = 90
    client: object | None = None

    def _client(self):
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("openai package is required for sequence treatment directing") from exc
        kwargs = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def __call__(self, *, brief: CreativeBrief, fallback_plan: FormatNarrativePlan) -> SequenceTreatment:
        system_prompt, user_prompt = build_sequence_treatment_prompt(brief=brief, fallback_plan=fallback_plan)
        response = self._client().responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "sequence_treatment_plan",
                    "strict": True,
                    "schema": sequence_treatment_schema(),
                }
            },
            store=False,
        )
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
            raise ValueError("sequence treatment director returned no output")
        return apply_sequence_treatment_payload(json.loads(raw_text))


def build_sequence_treatment_prompt(
    *,
    brief: CreativeBrief,
    fallback_plan: FormatNarrativePlan,
) -> tuple[str, str]:
    treatment_block = _treatment_context_block(fallback_plan.creative_treatment)
    system_prompt = dedent(
        """
        You are Squad's senior sequence director. You decide the four through-line commitments that make
        a short video feel intentionally directed before any shotlist or provider prompt is written.

        Your output is four prose commitments. Each is one specific concrete decision a department head would
        protect downstream. No vibes, no taste adjectives stacked together, no invented mythology.

        Hard constraints:
        - All four fields are required prose, 10-25 words each.
        - Each commitment must contain at least one concrete craft anchor — a camera move, lighting source,
          texture, color, rhythm, cut, hold, frame, or other word a real crew could enforce.
        - No vague taste words alone. "premium", "cinematic", "engaging", "emotional", "elevated", "tasteful"
          on their own are forbidden.
        - No format-specific gimmicks ("recurring red ball", "always end on the logo", "same hands every shot").
          Pick decisions that scale across product, entertainment, education, and art.
        - No provider names, model names, budgets, file paths, or implementation notes.
        - Anchor every decision to the brief's emotional core and format, not its surface description.

        The four fields:

        palette_or_texture_anchor: one disciplined visual constant — color, lighting quality, grain, surface
        texture, or contrast pattern — that every shot must respect.

        rhythmic_intent: one edit or timing rule. For UGC this can be performance pacing; for app demos it
        can be proof rhythm; for faceless/lyric pieces it can be story or music rhythm.

        tonal_contradiction: the visible tension that gives the piece character. Tie it to behavior, setting,
        image contrast, or delivery so it can affect actual shots.

        signature_camera_or_framing_move: one repeatable composition or camera rule, used with variation.
        Avoid forcing the exact same move on every beat.

        Commit to useful craft. If a field would add noise, choose the smallest concrete rule that helps.
        """
    ).strip()
    user_prompt = dedent(
        f"""
        Brief:
        - Subject: {brief.product_description}
        - Goal: {brief.campaign_goal}
        - Platform: {brief.platform}
        - Mood: {brief.mood_keywords}
        - Aesthetic notes: {brief.aesthetic_notes}
        - Audience insight: {brief.key_audience_insight}
        - Competitor notes: {brief.competitor_visual_notes}

        Plan context:
        - Format: {fallback_plan.format_type}
        - Primary intent: {fallback_plan.primary_intent}
        - Emotional arc: {fallback_plan.emotional_arc}
        - Duration target: {fallback_plan.duration_target_s}s
        - Caption strategy: {fallback_plan.caption_strategy}

        Existing treatment context:
        {treatment_block}

        Return four committed through-line decisions for this piece.
        """
    ).strip()
    return system_prompt, user_prompt


def sequence_treatment_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "palette_or_texture_anchor": {"type": "string", "minLength": 12, "maxLength": 220},
            "rhythmic_intent": {"type": "string", "minLength": 12, "maxLength": 220},
            "tonal_contradiction": {"type": "string", "minLength": 12, "maxLength": 220},
            "signature_camera_or_framing_move": {"type": "string", "minLength": 12, "maxLength": 220},
        },
        "required": [
            "palette_or_texture_anchor",
            "rhythmic_intent",
            "tonal_contradiction",
            "signature_camera_or_framing_move",
        ],
        "additionalProperties": False,
    }


def apply_sequence_treatment_payload(payload: dict[str, Any]) -> SequenceTreatment:
    if not isinstance(payload, dict):
        raise ValueError("sequence treatment payload must be an object")
    palette = _validate_sequence_text(payload, "palette_or_texture_anchor")
    rhythm = _validate_sequence_text(payload, "rhythmic_intent")
    contradiction = _validate_sequence_text(payload, "tonal_contradiction")
    signature = _validate_sequence_text(payload, "signature_camera_or_framing_move")
    return SequenceTreatment(
        palette_or_texture_anchor=palette,
        rhythmic_intent=rhythm,
        tonal_contradiction=contradiction,
        signature_camera_or_framing_move=signature,
    )


def render_sequence_treatment_block(treatment: SequenceTreatment | None) -> str:
    if treatment is None:
        return "- none"
    parts = (
        f"- palette_or_texture_anchor: {treatment.palette_or_texture_anchor}",
        f"- rhythmic_intent: {treatment.rhythmic_intent}",
        f"- tonal_contradiction: {treatment.tonal_contradiction}",
        f"- signature_camera_or_framing_move: {treatment.signature_camera_or_framing_move}",
    )
    return "\n".join(parts)


def render_sequence_treatment_prose(treatment: SequenceTreatment | None) -> str:
    """Compact prose of the through-line. Used by the per-beat brief so each generation
    inherits the same tonal discipline without a label that would need filtering."""
    if treatment is None:
        return ""
    return (
        f"Through-line: {treatment.palette_or_texture_anchor}; "
        f"{treatment.rhythmic_intent}; "
        f"{treatment.tonal_contradiction}; "
        f"{treatment.signature_camera_or_framing_move}."
    )


_VAGUE_SEQUENCE_EXACT: frozenset[str] = frozenset(
    {
        "make it cinematic",
        "make it premium",
        "make it engaging",
        "make it emotional",
        "give it taste",
        "feels emotional",
        "high production value",
        "elevated production",
        "next level",
        "tasteful direction",
        "good direction",
        "great directing",
    }
)


_VAGUE_SEQUENCE_TERMS: tuple[str, ...] = (
    "cinematic",
    "premium",
    "engaging",
    "beautiful",
    "cool",
    "elevated",
    "tasteful",
    "high-end",
    "high end",
    "luxe",
    "luxurious",
)


_CONCRETE_CRAFT_ANCHORS: tuple[str, ...] = (
    "push",
    "pull",
    "dolly",
    "tilt",
    "pan",
    "track",
    "tracks",
    "tracking",
    "hold",
    "holds",
    "still",
    "stillness",
    "frame",
    "framing",
    "wide",
    "close",
    "medium",
    "locked",
    "handheld",
    "lens",
    "shot",
    "shots",
    "take",
    "takes",
    "key",
    "fill",
    "lit",
    "light",
    "lighting",
    "source",
    "practical",
    "soft",
    "hard",
    "silhouette",
    "motivated",
    "exposure",
    "contrast",
    "shadow",
    "highlight",
    "color",
    "palette",
    "grain",
    "hue",
    "tone",
    "tones",
    "monochrome",
    "warm",
    "cold",
    "cool",
    "desaturated",
    "saturated",
    "texture",
    "surface",
    "sharp",
    "cut",
    "cuts",
    "pause",
    "silence",
    "beat",
    "rhythm",
    "tempo",
    "pulse",
    "breath",
    "momentum",
    "motion",
    "edit",
    "phrase",
    "movement",
    "movements",
)


def _validate_sequence_text(payload: dict[str, Any], key: str) -> str:
    value = " ".join(str(payload.get(key, "")).replace("\n", " ").split()).strip()
    if not value:
        raise ValueError(f"{key} must not be empty")
    words = value.split()
    if len(words) < 8:
        raise ValueError(f"{key} is too short to be a directing commitment: {value}")
    if len(words) > 28:
        value = " ".join(words[:28]).rstrip(" ,;:.") + "."
        words = value.split()
    lowered = value.lower().strip(" .")
    if lowered in _VAGUE_SEQUENCE_EXACT:
        raise ValueError(f"{key} is too vague: {value}")
    has_vague = any(term in lowered for term in _VAGUE_SEQUENCE_TERMS)
    has_anchor = any(_word_token(word) in _CONCRETE_CRAFT_ANCHORS for word in words)
    if has_vague and not has_anchor:
        raise ValueError(f"{key} is vague taste language without a craft anchor: {value}")
    if not has_anchor:
        raise ValueError(f"{key} has no concrete craft anchor a department head could enforce: {value}")
    return value


def _word_token(word: str) -> str:
    return "".join(char for char in word.lower() if char.isalpha() or char == "-")


def _treatment_context_block(treatment: CreativeTreatmentPlan | None) -> str:
    if treatment is None:
        return "- none"
    lines = [
        f"- concept: {treatment.concept}" if treatment.concept else "",
        f"- aesthetic_lane: {treatment.aesthetic_lane}" if treatment.aesthetic_lane else "",
        f"- visual_language: {treatment.visual_language}" if treatment.visual_language else "",
        f"- pacing: {treatment.pacing}" if treatment.pacing else "",
    ]
    return "\n".join(line for line in lines if line) or "- none"


def merge_sequence_treatment(
    plan: FormatNarrativePlan,
    treatment: SequenceTreatment,
) -> FormatNarrativePlan:
    return replace(plan, sequence_treatment=treatment)
