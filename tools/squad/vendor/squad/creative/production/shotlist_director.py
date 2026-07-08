from __future__ import annotations

import json
from dataclasses import dataclass, replace
from textwrap import dedent
from typing import Any

from content.writing.brief_generator import CreativeBrief
from content.writing.creative_modes import render_creative_mode_block
from content.writing.script_guidance import render_guidance_block, script_guidance_from_brief
from creative.production.contracts import (
    CreativeTreatmentPlan,
    FormatNarrativePlan,
    SceneBeat,
    ShotDirective,
    ShotGrammar,
    UgcStrategyPlan,
)


SHOT_SIZE_OPTIONS = (
    "extreme_close",
    "close_up",
    "medium",
    "wide",
    "extreme_wide",
    "insert",
    "over_shoulder",
    "pov",
    "none",
)
LENS_OPTIONS = (
    "wide_24mm",
    "doc_35mm",
    "natural_50mm",
    "portrait_85mm",
    "macro_100mm",
    "none",
)
LIGHTING_MOTIVATION_OPTIONS = (
    "window_natural",
    "practical_source",
    "motivated_key_soft",
    "hard_directional",
    "silhouette",
    "available_room",
    "atmospheric_color",
    "none",
)
CUT_FROM_PREVIOUS_OPTIONS = (
    "match_action",
    "match_eyeline",
    "hard_cut",
    "j_cut",
    "smash_cut",
    "continuous",
    "none",
)


_SHOT_SIZE_PROSE: dict[str, str] = {
    "extreme_close": "extreme close-up frame",
    "close_up": "tight close-up framing",
    "medium": "medium framing",
    "wide": "wide framing",
    "extreme_wide": "extreme wide establishing frame",
    "insert": "tight insert detail shot",
    "over_shoulder": "over-the-shoulder framing",
    "pov": "subjective POV framing",
}

_LENS_PROSE: dict[str, str] = {
    "wide_24mm": "24mm wide-angle perspective with immersive geometry",
    "doc_35mm": "35mm documentary-feel perspective",
    "natural_50mm": "natural 50mm eye-level perspective",
    "portrait_85mm": "compressed 85mm portrait perspective",
    "macro_100mm": "100mm macro perspective with intimate detail",
}

_LIGHTING_PROSE: dict[str, str] = {
    "window_natural": "natural window light",
    "practical_source": "single motivated practical source in frame",
    "motivated_key_soft": "motivated soft key light",
    "hard_directional": "hard directional source",
    "silhouette": "backlit silhouette against the lit background",
    "available_room": "available room light",
    "atmospheric_color": "atmospheric color wash",
}

_CUT_PROSE: dict[str, str] = {
    "match_action": "match-action transition from the previous beat",
    "match_eyeline": "eyeline match into this beat",
    "hard_cut": "hard cut into this beat",
    "j_cut": "j-cut audio bridge into this beat",
    "smash_cut": "smash cut into this beat",
    "continuous": "continuous unbroken move from the previous beat",
}


def render_shot_grammar_image_prose(grammar: Any) -> str:
    """Translate still-safe ShotGrammar fields into one filmmaker-prose sentence.

    Edit/cut terms are intentionally excluded; this text feeds still-image prompts.
    """
    if grammar is None:
        return ""
    parts: list[str] = []
    size = _SHOT_SIZE_PROSE.get(getattr(grammar, "shot_size", "none"))
    lens = _LENS_PROSE.get(getattr(grammar, "lens", "none"))
    light = _LIGHTING_PROSE.get(getattr(grammar, "lighting_motivation", "none"))
    if size:
        parts.append(size)
    if lens:
        parts.append(lens)
    if light:
        parts.append(light)
    if not parts:
        return ""
    return f"Composition: {'; '.join(parts)}."


def render_shot_grammar_motion_prose(grammar: Any) -> str:
    """Translate edit/cut grammar for motion prompts only."""
    if grammar is None:
        return ""
    cut = _CUT_PROSE.get(getattr(grammar, "cut_from_previous", "none"))
    if not cut:
        return ""
    return f"Edit relation: {cut}."


def render_shot_grammar_prose(grammar: Any) -> str:
    """Backward-compatible full grammar prose for tests and review surfaces."""
    return " ".join(
        part for part in (render_shot_grammar_image_prose(grammar), render_shot_grammar_motion_prose(grammar)) if part
    )


@dataclass(frozen=True, slots=True)
class OpenAIResponsesShotlistDirector:
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
            raise RuntimeError("openai package is required for shotlist directing") from exc
        kwargs = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def __call__(self, *, brief: CreativeBrief, fallback_plan: FormatNarrativePlan) -> FormatNarrativePlan:
        system_prompt, user_prompt = build_shotlist_director_prompt(brief=brief, fallback_plan=fallback_plan)
        response = self._client().responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "shotlist_director_plan",
                    "strict": True,
                    "schema": shotlist_director_schema(),
                }
            },
            store=False,
        )
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
            raise ValueError("shotlist director returned no output")
        return apply_shotlist_director_payload(
            json.loads(raw_text),
            fallback_plan=fallback_plan,
        )


def build_shotlist_director_prompt(*, brief: CreativeBrief, fallback_plan: FormatNarrativePlan) -> tuple[str, str]:
    seed_beats = fallback_plan.base_scene_beats or fallback_plan.scene_beats
    beat_lines = "\n".join(_beat_line(beat) for beat in seed_beats)
    treatment_block = _treatment_block(fallback_plan.creative_treatment)
    sequence_block = _sequence_treatment_block(fallback_plan.sequence_treatment)
    ugc_block = _ugc_block(fallback_plan.ugc_strategy)
    per_beat_cues = _per_beat_cues(
        beats=seed_beats,
        treatment=fallback_plan.creative_treatment,
        ugc_strategy=fallback_plan.ugc_strategy,
    )
    negatives = _negative_block(fallback_plan.creative_treatment)
    creative_mode_block = render_creative_mode_block(brief) or "- none"
    system_prompt = dedent(
        """
        You are Squad's senior video creative director.

        Improve the draft shotlist before any paid image or video generation.
        Your job is taste, specificity, pacing, and visual proof. Make each beat feel like it was directed by a real
        filmmaker, not filled from a template.

        Hard constraints:
        - Keep the exact beat count, beat indexes, and beat roles.
        - Return only the strict JSON payload.
        - Keep every field compact and production-useful.
        - No vague taste words unless paired with a concrete visual action.
        - No provider names, model names, budgets, file paths, or implementation notes.
        - Do not add extra stages, new characters, impossible VFX, or expensive requirements.
        - Do not bake captions, typography, random letters, or CTA text into generated visuals.
        - Preserve reference/product/character continuity when the brief implies it.

        Authoring rules:
        - The Draft beats section is your seed material — one premise and one motion intent per beat. Do not echo it.
        - Sequence treatment is the through-line. Every beat must honor its palette/texture, rhythm rule,
          emotional tension, and repeatable composition rule, but do not force the same exact move everywhere.
        - Treatment direction and UGC direction are global tone constraints. Apply them everywhere they fit.
        - Per-beat cues attach extra direction to specific beats. Honor them where they are listed.
        - Negative constraints are forbidden. Do not produce them.

        Shot grammar vocabulary (pick from these enums; use "none" only when the beat genuinely has no opinion):
        - shot_size: extreme_close, close_up, medium, wide, extreme_wide, insert, over_shoulder, pov, none
        - lens: wide_24mm (24mm wide, immersive), doc_35mm (35mm documentary), natural_50mm (50mm natural eye), portrait_85mm (compressed portrait), macro_100mm (macro detail), none
        - lighting_motivation: window_natural, practical_source, motivated_key_soft, hard_directional, silhouette, available_room, atmospheric_color, none
        - cut_from_previous: match_action, match_eyeline, hard_cut, j_cut, smash_cut, continuous, none. For beat 1 use "none".
        Choose grammar that earns the beat. Vary across beats when it serves the story.
        """
    ).strip()
    user_prompt = dedent(
        f"""
        Brief:
        - Product/topic: {brief.product_description}
        - Goal: {brief.campaign_goal}
        - Platform: {brief.platform}
        - Product type: {brief.product_type}
        - Mood: {brief.mood_keywords}
        - Overlay/caption copy: {brief.copy_for_overlay}
        - CTA: {brief.cta_text}
        - Voiceover/script: {brief.voiceover_script}
        - Loose script/creative guidance:
        {render_guidance_block(script_guidance_from_brief(brief))}
        - Compact cinema/world controls:
        {creative_mode_block}
        - Aesthetic notes: {brief.aesthetic_notes}
        - Audience insight: {brief.key_audience_insight}
        - Competitor notes: {brief.competitor_visual_notes}

        Plan context:
        - Format: {fallback_plan.format_type}
        - Intent: {fallback_plan.primary_intent}
        - Duration target: {fallback_plan.duration_target_s}s
        - Platform aspect ratio: {fallback_plan.platform_profile.aspect_ratio}
        - Safe area: {fallback_plan.platform_profile.safe_area}
        - Caption strategy: {fallback_plan.caption_strategy}
        - Emotional arc: {fallback_plan.emotional_arc}

        Sequence treatment (through-line — honor on every beat):
        {sequence_block}

        Treatment direction:
        {treatment_block}

        UGC direction:
        {ugc_block}

        Per-beat cues:
        {per_beat_cues}

        Negative constraints:
        {negatives}

        Draft beats:
        {beat_lines}

        Return a stronger directed shotlist for exactly these beats.
        """
    ).strip()
    return system_prompt, user_prompt


def shotlist_director_schema() -> dict[str, Any]:
    grammar_schema = {
        "type": "object",
        "properties": {
            "shot_size": {"type": "string", "enum": list(SHOT_SIZE_OPTIONS)},
            "lens": {"type": "string", "enum": list(LENS_OPTIONS)},
            "lighting_motivation": {"type": "string", "enum": list(LIGHTING_MOTIVATION_OPTIONS)},
            "cut_from_previous": {"type": "string", "enum": list(CUT_FROM_PREVIOUS_OPTIONS)},
        },
        "required": ["shot_size", "lens", "lighting_motivation", "cut_from_previous"],
        "additionalProperties": False,
    }
    beat_schema = {
        "type": "object",
        "properties": {
            "beat_index": {"type": "integer", "minimum": 1},
            "beat_role": {"type": "string", "minLength": 1},
            "visual_premise": {"type": "string", "minLength": 1, "maxLength": 260},
            "image_prompt_focus": {"type": "string", "minLength": 1, "maxLength": 240},
            "purpose": {"type": "string", "minLength": 1, "maxLength": 140},
            "visual_action": {"type": "string", "minLength": 1, "maxLength": 240},
            "framing": {"type": "string", "minLength": 1, "maxLength": 160},
            "continuity_anchor": {"type": "string", "minLength": 1, "maxLength": 180},
            "caption_role": {"type": "string", "minLength": 1, "maxLength": 160},
            "shot_grammar": grammar_schema,
        },
        "required": [
            "beat_index",
            "beat_role",
            "visual_premise",
            "image_prompt_focus",
            "purpose",
            "visual_action",
            "framing",
            "continuity_anchor",
            "caption_role",
            "shot_grammar",
        ],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "beats": {
                "type": "array",
                "items": beat_schema,
                "minItems": 1,
                "maxItems": 8,
            }
        },
        "required": ["beats"],
        "additionalProperties": False,
    }


def apply_shotlist_director_payload(
    payload: dict[str, Any],
    *,
    fallback_plan: FormatNarrativePlan,
) -> FormatNarrativePlan:
    items = payload.get("beats")
    if not isinstance(items, list):
        raise ValueError("beats must be a list")
    if len(items) != len(fallback_plan.scene_beats):
        raise ValueError(f"expected {len(fallback_plan.scene_beats)} beats, got {len(items)}")

    by_index = {beat.beat_index: beat for beat in fallback_plan.scene_beats}
    directed: list[SceneBeat] = []
    seen: set[int] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("each directed beat must be an object")
        beat_index = int(item.get("beat_index", 0))
        if beat_index not in by_index:
            raise ValueError(f"unexpected beat_index: {beat_index}")
        if beat_index in seen:
            raise ValueError(f"duplicate beat_index: {beat_index}")
        seen.add(beat_index)
        original = by_index[beat_index]
        beat_role = _required_text(item, "beat_role")
        if beat_role != original.beat_role:
            raise ValueError(f"beat_role mismatch for beat {beat_index}: {beat_role}")
        visual_premise = _validate_director_text(item, "visual_premise", beat_index=beat_index, max_words=36)
        image_prompt_focus = _validate_director_text(item, "image_prompt_focus", beat_index=beat_index, max_words=34)
        purpose = _validate_director_text(item, "purpose", beat_index=beat_index, max_words=18)
        visual_action = _validate_director_text(item, "visual_action", beat_index=beat_index, max_words=30)
        framing = _validate_director_text(item, "framing", beat_index=beat_index, max_words=22)
        continuity_anchor = _validate_director_text(item, "continuity_anchor", beat_index=beat_index, max_words=24)
        caption_role = _validate_director_text(item, "caption_role", beat_index=beat_index, max_words=22)
        shot_grammar = _validate_shot_grammar(item.get("shot_grammar"), beat_index=beat_index)
        directed.append(
            replace(
                original,
                visual_premise=visual_premise,
                image_prompt_focus=image_prompt_focus,
                motion_intent=visual_action,
                shot_directive=ShotDirective(
                    purpose=purpose,
                    visual_action=visual_action,
                    framing=framing,
                    continuity_anchor=continuity_anchor,
                    caption_role=caption_role,
                    shot_grammar=shot_grammar,
                ),
            )
        )

    directed.sort(key=lambda beat: beat.beat_index)
    rationale = fallback_plan.rationale
    if "shotlist_director" not in rationale:
        rationale = f"{rationale}; shotlist_director=openai_responses_v1"
    return replace(fallback_plan, scene_beats=tuple(directed), rationale=rationale)


def _beat_line(beat: SceneBeat) -> str:
    return (
        f"- Beat {beat.beat_index} `{beat.beat_role}` ({beat.duration_s}s, intent={beat.intent}, "
        f"emotion={beat.viewer_emotion}): "
        f"visual_goal={beat.visual_goal}; premise_seed={beat.visual_premise}; "
        f"motion_seed={beat.motion_intent}; image_focus_seed={beat.image_prompt_focus}."
    )


def _sequence_treatment_block(treatment: Any) -> str:
    from creative.production.sequence_treatment_director import render_sequence_treatment_block

    return render_sequence_treatment_block(treatment)


def _treatment_block(treatment: CreativeTreatmentPlan | None) -> str:
    if treatment is None:
        return "- none"
    parts = [
        f"- concept: {treatment.concept}" if treatment.concept else "",
        f"- aesthetic_lane: {treatment.aesthetic_lane}" if treatment.aesthetic_lane else "",
        f"- visual_language: {treatment.visual_language}" if treatment.visual_language else "",
        f"- pacing: {treatment.pacing}" if treatment.pacing else "",
    ]
    prompt_directives = "; ".join(treatment.prompt_directives or ())
    if prompt_directives:
        parts.append(f"- prompt_directives: {prompt_directives}")
    return "\n".join(part for part in parts if part) or "- none"


def _ugc_block(strategy: UgcStrategyPlan | None) -> str:
    if strategy is None:
        return "- none"
    parts = [
        f"- creator_persona: {strategy.creator_persona}" if strategy.creator_persona else "",
        f"- authenticity_angle: {strategy.authenticity_angle}" if strategy.authenticity_angle else "",
        f"- hook_pattern: {strategy.hook_pattern}" if strategy.hook_pattern else "",
        f"- proof_mechanism: {strategy.proof_mechanism}" if strategy.proof_mechanism else "",
        f"- objection_to_answer: {strategy.objection_to_answer}" if strategy.objection_to_answer else "",
        f"- setting: {strategy.setting}" if strategy.setting else "",
    ]
    return "\n".join(part for part in parts if part) or "- none"


def _per_beat_cues(
    *,
    beats: tuple[SceneBeat, ...],
    treatment: CreativeTreatmentPlan | None,
    ugc_strategy: UgcStrategyPlan | None,
) -> str:
    scene_directives = tuple((treatment.scene_directives or ()) if treatment else ())
    edit_rules = tuple((treatment.edit_rules or ()) if treatment else ())
    archetypes = tuple((ugc_strategy.shot_archetypes or ()) if ugc_strategy else ())
    lines: list[str] = []
    for beat in beats:
        cue_parts = []
        if scene_directives:
            cue_parts.append(f"scene_directive={scene_directives[(beat.beat_index - 1) % len(scene_directives)]}")
        if edit_rules:
            cue_parts.append(f"edit_rule={edit_rules[(beat.beat_index - 1) % len(edit_rules)]}")
        if archetypes:
            cue_parts.append(f"ugc_archetype={archetypes[(beat.beat_index - 1) % len(archetypes)]}")
        if cue_parts:
            lines.append(f"- Beat {beat.beat_index}: {'; '.join(cue_parts)}")
    return "\n".join(lines) or "- none"


def _negative_block(treatment: CreativeTreatmentPlan | None) -> str:
    items = tuple((treatment.negative_constraints or ()) if treatment else ())
    if not items:
        return "- none"
    return "\n".join(f"- {item}" for item in items)


def _validate_shot_grammar(payload: Any, *, beat_index: int) -> ShotGrammar:
    if payload is None:
        return ShotGrammar()
    if not isinstance(payload, dict):
        raise ValueError(f"shot_grammar for beat {beat_index} must be an object")
    field_options = (
        ("shot_size", SHOT_SIZE_OPTIONS),
        ("lens", LENS_OPTIONS),
        ("lighting_motivation", LIGHTING_MOTIVATION_OPTIONS),
        ("cut_from_previous", CUT_FROM_PREVIOUS_OPTIONS),
    )
    values: dict[str, str] = {}
    for key, options in field_options:
        raw = str(payload.get(key, "")).strip().lower()
        if not raw:
            raw = "none"
        if raw not in options:
            raise ValueError(
                f"shot_grammar.{key} for beat {beat_index} is not in the allowed enum: {raw}"
            )
        values[key] = raw
    if beat_index == 1 and values["cut_from_previous"] != "none":
        values["cut_from_previous"] = "none"
    return ShotGrammar(**values)


def _validate_director_text(item: dict[str, Any], key: str, *, beat_index: int, max_words: int) -> str:
    text = _required_text(item, key)
    if _is_vague_director_text(text):
        raise ValueError(f"{key} for beat {beat_index} is too vague: {text}")
    words = text.split()
    if len(words) > max_words:
        text = " ".join(words[:max_words]).rstrip(" ,;:.") + "."
    return text


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = " ".join(str(payload.get(key, "")).replace("\n", " ").split()).strip()
    if not value:
        raise ValueError(f"{key} must not be empty")
    return value


def _is_vague_director_text(text: str) -> bool:
    lowered = text.lower().strip(" .")
    vague_exact = {
        "make it cinematic",
        "make it premium",
        "make it engaging",
        "show the product",
        "show the app",
        "show the scene",
        "nice shot",
        "beautiful shot",
        "cool visual",
    }
    if lowered in vague_exact:
        return True
    vague_terms = ("cinematic", "premium", "engaging", "beautiful", "cool")
    concrete_terms = (
        "opens",
        "holds",
        "shows",
        "turns",
        "points",
        "reveals",
        "scrolls",
        "taps",
        "walks",
        "camera",
        "screen",
        "desk",
        "room",
        "street",
        "object",
        "close",
        "wide",
        "frame",
    )
    return any(term in lowered for term in vague_terms) and not any(term in lowered for term in concrete_terms)
