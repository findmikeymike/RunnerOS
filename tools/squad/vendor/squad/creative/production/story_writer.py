from __future__ import annotations

import json
from dataclasses import dataclass
from textwrap import dedent
from typing import Any

from content.writing.brief_generator import CreativeBrief
from content.writing.creative_modes import render_creative_mode_block
from content.writing.script_guidance import render_guidance_block, script_guidance_from_brief
from creative.production.contracts import FormatNarrativePlan, NarrativeSceneScript, NarrativeScriptPlan


@dataclass(frozen=True, slots=True)
class OpenAIResponsesFacelessStoryWriter:
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
            raise RuntimeError("openai package is required for faceless story writing") from exc
        kwargs = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def __call__(self, *, brief: CreativeBrief, fallback_plan: FormatNarrativePlan) -> NarrativeScriptPlan:
        system_prompt, user_prompt = build_faceless_story_prompt(brief=brief, fallback_plan=fallback_plan)
        response = self._client().responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "faceless_story_plan",
                    "strict": True,
                    "schema": faceless_story_schema(),
                }
            },
            store=False,
        )
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
            raise ValueError("faceless story writer returned no output")
        return validate_faceless_story_payload(
            json.loads(raw_text),
            fallback_plan=fallback_plan,
        )


def build_faceless_story_prompt(*, brief: CreativeBrief, fallback_plan: FormatNarrativePlan) -> tuple[str, str]:
    beat_lines = "\n".join(
        f"- Beat {beat.beat_index} `{beat.beat_role}` ({beat.duration_s}s): "
        f"{beat.visual_premise} Motion: {beat.motion_intent}"
        for beat in fallback_plan.scene_beats
    )
    system_prompt = dedent(
        """
        You are a faceless YouTube creative director and documentary scriptwriter.

        Write the narrative, A/B visual direction, narration, and motion direction for a faceless video.
        This is creative work: make the hook sharper, the story more watchable, and each scene more specific.

        Hard constraints:
        - No presenter, no talking head, no product ad language unless the brief explicitly asks for an ad.
        - Use the provided beat count and beat roles exactly.
        - Each scene needs two distinct visual options: A establishes the idea, B adds a cutaway/detail/reveal.
        - Include stock search terms for optional archive/B-roll sourcing.
        - Scene duration must be realistic for a short faceless sequence.
        - Audio emphasis should say what the narration/music/SFX should make the viewer feel in that beat.
        - Narration should be plainspoken, intriguing, and timed for a short video.
        - Use supplied script bits as optional raw material, not as a rigid transcript.
        - Honor must-say phrases in narration/caption when they fit naturally.
        - Avoid banned phrases exactly.
        - Start with a curiosity gap in the first scene.
        - Keep direction concise; do not overload a clip with five actions.
        - Return only the strict JSON payload.
        """
    ).strip()
    user_prompt = dedent(
        f"""
        Brief:
        - Topic/product field: {brief.product_description}
        - Goal: {brief.campaign_goal}
        - Platform: {brief.platform}
        - Mood: {brief.mood_keywords}
        - Existing voiceover/script if any: {brief.voiceover_script}
        - Script guidance:
        {render_guidance_block(script_guidance_from_brief(brief))}
        - Compact cinema/world controls:
        {render_creative_mode_block(brief) or "- none"}
        - Aesthetic notes: {brief.aesthetic_notes}
        - Audience insight: {brief.key_audience_insight}
        - Competitor notes: {brief.competitor_visual_notes}

        Deterministic fallback plan:
        - Format: {fallback_plan.format_type}
        - Intent: {fallback_plan.primary_intent}
        - Target duration: {fallback_plan.duration_target_s}s
        - Audio mode: {fallback_plan.audio_mode}
        - Caption strategy: {fallback_plan.caption_strategy}
        - Emotional arc: {fallback_plan.emotional_arc}

        Required beats:
        {beat_lines}

        Write a stronger faceless documentary/story plan for exactly these beats.
        """
    ).strip()
    return system_prompt, user_prompt


def faceless_story_schema() -> dict:
    scene_schema = {
        "type": "object",
        "properties": {
            "beat_index": {"type": "integer", "minimum": 1},
            "beat_role": {"type": "string"},
            "hook_question": {"type": "string", "minLength": 1},
            "narration": {"type": "string", "minLength": 1},
            "visual_prompt": {"type": "string", "minLength": 1},
            "visual_a_prompt": {"type": "string", "minLength": 1},
            "visual_b_prompt": {"type": "string", "minLength": 1},
            "stock_search_terms": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "minItems": 2,
                "maxItems": 6,
            },
            "motion_direction": {"type": "string", "minLength": 1},
            "caption_text": {"type": "string", "minLength": 1},
            "retention_note": {"type": "string", "minLength": 1},
            "retention_reason": {"type": "string", "minLength": 1},
            "scene_duration_s": {"type": "integer", "minimum": 2, "maximum": 20},
            "audio_emphasis": {"type": "string", "minLength": 1},
        },
        "required": [
            "beat_index",
            "beat_role",
            "hook_question",
            "narration",
            "visual_prompt",
            "visual_a_prompt",
            "visual_b_prompt",
            "stock_search_terms",
            "motion_direction",
            "caption_text",
            "retention_note",
            "retention_reason",
            "scene_duration_s",
            "audio_emphasis",
        ],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "topic": {"type": "string", "minLength": 1},
            "title": {"type": "string", "minLength": 1},
            "thesis": {"type": "string", "minLength": 1},
            "curiosity_gap": {"type": "string", "minLength": 1},
            "narration_script": {"type": "string", "minLength": 1},
            "music_mood": {"type": "string", "minLength": 1},
            "pacing_notes": {"type": "string", "minLength": 1},
            "scenes": {"type": "array", "items": scene_schema},
        },
        "required": [
            "topic",
            "title",
            "thesis",
            "curiosity_gap",
            "narration_script",
            "music_mood",
            "pacing_notes",
            "scenes",
        ],
        "additionalProperties": False,
    }


def validate_faceless_story_payload(
    payload: dict[str, Any],
    *,
    fallback_plan: FormatNarrativePlan,
) -> NarrativeScriptPlan:
    expected_roles = {beat.beat_index: beat.beat_role for beat in fallback_plan.scene_beats}
    scenes_payload = payload.get("scenes")
    if not isinstance(scenes_payload, list):
        raise ValueError("scenes must be a list")
    if len(scenes_payload) != len(expected_roles):
        raise ValueError(f"expected {len(expected_roles)} scenes, got {len(scenes_payload)}")

    scenes: list[NarrativeSceneScript] = []
    seen_indexes: set[int] = set()
    for item in scenes_payload:
        if not isinstance(item, dict):
            raise ValueError("each scene must be an object")
        beat_index = int(item.get("beat_index", 0))
        if beat_index not in expected_roles:
            raise ValueError(f"unexpected beat_index: {beat_index}")
        if beat_index in seen_indexes:
            raise ValueError(f"duplicate beat_index: {beat_index}")
        seen_indexes.add(beat_index)
        beat_role = _required_text(item, "beat_role")
        if beat_role != expected_roles[beat_index]:
            raise ValueError(f"beat_role mismatch for beat {beat_index}: {beat_role}")
        visual_a_prompt = _validate_visual_prompt(_required_text(item, "visual_a_prompt"), beat_index=beat_index)
        visual_b_prompt = _validate_visual_prompt(_required_text(item, "visual_b_prompt"), beat_index=beat_index)
        _validate_ab_visual_direction(visual_a_prompt, visual_b_prompt, beat_index=beat_index)
        scenes.append(
            NarrativeSceneScript(
                beat_index=beat_index,
                beat_role=beat_role,
                hook_question=_required_text(item, "hook_question"),
                narration=_validate_narration(_required_text(item, "narration"), beat_index=beat_index),
                visual_prompt=_validate_visual_prompt(_required_text(item, "visual_prompt"), beat_index=beat_index),
                motion_direction=_validate_motion_direction(
                    _required_text(item, "motion_direction"),
                    beat_index=beat_index,
                ),
                caption_text=_validate_caption_text(_required_text(item, "caption_text"), beat_index=beat_index),
                retention_note=_required_text(item, "retention_note"),
                visual_a_prompt=visual_a_prompt,
                visual_b_prompt=visual_b_prompt,
                stock_search_terms=_validate_stock_search_terms(item.get("stock_search_terms"), beat_index=beat_index),
                retention_reason=_validate_retention_reason(
                    _required_text(item, "retention_reason"),
                    beat_index=beat_index,
                ),
                scene_duration_s=_validate_scene_duration(item.get("scene_duration_s"), beat_index=beat_index),
                audio_emphasis=_validate_audio_emphasis(
                    _required_text(item, "audio_emphasis"),
                    beat_index=beat_index,
                ),
            )
        )

    scenes.sort(key=lambda scene: scene.beat_index)
    narration_script = _validate_full_narration_script(_required_text(payload, "narration_script"))
    if len(narration_script.split()) < max(12, len(scenes) * 5):
        narration_script = " ".join(scene.narration for scene in scenes)
    return NarrativeScriptPlan(
        topic=_required_text(payload, "topic"),
        title=_required_text(payload, "title"),
        thesis=_required_text(payload, "thesis"),
        curiosity_gap=_required_text(payload, "curiosity_gap"),
        narration_script=narration_script,
        music_mood=_required_text(payload, "music_mood"),
        pacing_notes=_required_text(payload, "pacing_notes"),
        scenes=tuple(scenes),
        source="openai_responses_faceless_story_writer",
    )


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key, "")).strip()
    if not value:
        raise ValueError(f"{key} must not be empty")
    return value


def _validate_caption_text(text: str, *, beat_index: int) -> str:
    word_count = len(text.split())
    if word_count > 9 or len(text) > 64:
        raise ValueError(f"caption_text for beat {beat_index} is too long")
    _reject_presenter_or_ad_language(text, field="caption_text", beat_index=beat_index)
    return text


def _validate_narration(text: str, *, beat_index: int) -> str:
    word_count = len(text.split())
    if word_count < 5:
        raise ValueError(f"narration for beat {beat_index} is too short")
    if word_count > 45:
        raise ValueError(f"narration for beat {beat_index} is too long for a short scene")
    _reject_presenter_or_ad_language(text, field="narration", beat_index=beat_index)
    return text


def _validate_full_narration_script(text: str) -> str:
    words = text.split()
    if len(words) > 260:
        raise ValueError("narration_script is too long for a short faceless video")
    _reject_presenter_or_ad_language(text, field="narration_script", beat_index=0)
    return text


def _validate_visual_prompt(text: str, *, beat_index: int) -> str:
    _reject_presenter_or_ad_language(text, field="visual_prompt", beat_index=beat_index)
    if len(text.split()) > 45:
        raise ValueError(f"visual_prompt for beat {beat_index} is too verbose")
    return text


def _validate_ab_visual_direction(visual_a_prompt: str, visual_b_prompt: str, *, beat_index: int) -> None:
    if visual_a_prompt.strip().lower() == visual_b_prompt.strip().lower():
        raise ValueError(f"visual_a_prompt and visual_b_prompt for beat {beat_index} must be distinct")


def _validate_stock_search_terms(value: Any, *, beat_index: int) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError(f"stock_search_terms for beat {beat_index} must be a list")
    terms = tuple(str(term).strip() for term in value if str(term).strip())
    if len(terms) < 2:
        raise ValueError(f"stock_search_terms for beat {beat_index} must include at least two terms")
    if len(terms) > 6:
        raise ValueError(f"stock_search_terms for beat {beat_index} must include six or fewer terms")
    for term in terms:
        _reject_presenter_or_ad_language(term, field="stock_search_terms", beat_index=beat_index)
    return terms


def _validate_retention_reason(text: str, *, beat_index: int) -> str:
    _reject_presenter_or_ad_language(text, field="retention_reason", beat_index=beat_index)
    if len(text.split()) > 24:
        raise ValueError(f"retention_reason for beat {beat_index} is too verbose")
    return text


def _validate_scene_duration(value: Any, *, beat_index: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"scene_duration_s for beat {beat_index} must be an integer")
    duration = value
    if duration < 2 or duration > 20:
        raise ValueError(f"scene_duration_s for beat {beat_index} must be between 2 and 20 seconds")
    return duration


def _validate_audio_emphasis(text: str, *, beat_index: int) -> str:
    _reject_presenter_or_ad_language(text, field="audio_emphasis", beat_index=beat_index)
    if len(text.split()) > 18:
        raise ValueError(f"audio_emphasis for beat {beat_index} is too verbose")
    return text


def _validate_motion_direction(text: str, *, beat_index: int) -> str:
    _reject_presenter_or_ad_language(text, field="motion_direction", beat_index=beat_index)
    if len(text.split()) > 28:
        raise ValueError(f"motion_direction for beat {beat_index} is too verbose")
    return text


def _reject_presenter_or_ad_language(text: str, *, field: str, beat_index: int) -> None:
    lower = text.lower()
    blocked_terms = (
        "talking head",
        "presenter",
        "host on camera",
        "creator selfie",
        "buy now",
        "shop now",
        "limited drop",
        "product hero",
        "commercial product",
    )
    for term in blocked_terms:
        if term in lower:
            raise ValueError(f"{field} for beat {beat_index} contains blocked faceless-story term: {term}")
