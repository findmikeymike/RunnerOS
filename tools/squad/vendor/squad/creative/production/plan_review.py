from __future__ import annotations

import json
from dataclasses import dataclass, replace
from textwrap import dedent
from typing import Any

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CinemaControlPlan, MotionPromptPlan, PlanReviewRecord, ShotPlan


PLAN_REVIEW_VERDICTS = ("approve", "revise", "escalate")
MOTION_STRATEGIES = (
    "character_action",
    "product_orbit",
    "camera_push",
    "environment_event",
    "graphic_reveal",
    "still_life_atmosphere",
)
SUBJECT_MOTION_PRIORITIES = ("subject_first", "camera_first", "environment_first")


@dataclass(frozen=True, slots=True)
class OpenAIResponsesProductionPlanReviewer:
    api_key: str
    model: str = "gpt-4.1-mini"
    base_url: str | None = None
    timeout_sec: int = 60
    client: object | None = None

    def _client(self):
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("openai package is required for production plan review") from exc
        kwargs = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def __call__(self, *, brief: CreativeBrief, motion_plan: MotionPromptPlan) -> PlanReviewRecord:
        try:
            system_prompt, user_prompt = build_plan_review_prompt(brief=brief, motion_plan=motion_plan)
            response = self._client().responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                    {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "production_plan_review",
                        "strict": True,
                        "schema": plan_review_schema(),
                    }
                },
                store=False,
            )
            raw_text = getattr(response, "output_text", None)
            if not raw_text:
                return _fail_closed("plan reviewer returned no output")
            return validate_plan_review_payload(json.loads(raw_text))
        except Exception as exc:
            return _fail_closed(f"plan reviewer failure: {exc}")


def build_plan_review_prompt(*, brief: CreativeBrief, motion_plan: MotionPromptPlan) -> tuple[str, str]:
    shot = motion_plan.shot_plan
    system_prompt = dedent(
        """
        You are a bounded motion director critic for short image-to-video clips.

        Review the text-only shot plan before any provider spend.
        Your job is not to invent a new campaign. Your job is to catch weak, generic, overloaded,
        or misaligned motion plans and propose small concrete revisions.

        Allowed verdicts:
        - approve: plan is specific enough and aligned with brief.
        - revise: plan is usable but should sharpen one or more bounded shot fields.
        - escalate: plan is too confused, unsafe, impossible, or contradicts the source brief.

        Motion strategy choices:
        - character_action: human/face/person should visibly do one action.
        - product_orbit: object/product is static; camera orbits/reveals it.
        - camera_push: still-like premium motion where camera move is the point.
        - environment_event: environment action is the main event.
        - graphic_reveal: typography/logo/graphic reveal is the main event.
        - still_life_atmosphere: subtle non-character atmosphere only.

        Rules:
        - Pick exactly one dominant motion strategy and one dominant motion beat.
        - If the source has a person/face and the brief asks for a reel/social clip, avoid passive Ken Burns unless the brief explicitly asks for stillness.
        - Keep one dominant camera intention for a short image-to-video clip.
        - Preserve source image/product/character identity.
        - Do not ask the video model to render overlay, CTA, caption, subtitle, or lyric text into the scene.
        - For CTA/overlay endpoints, only reserve blank caption-safe space and explicitly say no rendered text.
        - Do not add voiceover; voice decisions happen elsewhere.
        - Do not rewrite the whole prompt. Only provide revised bounded fields when needed.
        - If the requested action is concrete, preserve it.
        - If the prompt is generic or camera-only, add a clearer subject action, environment motion, or endpoint.
        - Prefer subject motion over camera motion for character_action.
        """
    ).strip()
    user_prompt = dedent(
        f"""
        Brief product: {brief.product_description}
        Brief goal: {brief.campaign_goal}
        Platform: {brief.platform}
        Mood keywords: {brief.mood_keywords}
        Aesthetic notes: {brief.aesthetic_notes}
        Overlay: {brief.copy_for_overlay}
        CTA: {brief.cta_text}

        Motion prompt: {motion_plan.motion_prompt}
        Camera direction: {motion_plan.camera_direction}
        Visual ethos: {motion_plan.visual_ethos}
        Negative prompt: {motion_plan.negative_prompt}

        Shot plan:
        - Opening frame: {shot.opening_frame if shot else None}
        - Subject action: {shot.subject_action if shot else None}
        - Camera move: {shot.camera_move if shot else None}
        - Environment motion: {shot.environment_motion if shot else None}
        - Ending frame: {shot.ending_frame if shot else None}
        - Pacing: {shot.pacing if shot else None}
        - Preserve: {shot.preservation_constraints if shot else None}
        - Avoid: {shot.negative_constraints if shot else None}

        Return a bounded plan review.
        """
    ).strip()
    return system_prompt, user_prompt


def plan_review_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": list(PLAN_REVIEW_VERDICTS)},
            "rationale": {"type": "string", "minLength": 1},
            "confidence": {"anyOf": [{"type": "number", "minimum": 0.0, "maximum": 1.0}, {"type": "null"}]},
            "motion_strategy": {"anyOf": [{"type": "string", "enum": list(MOTION_STRATEGIES)}, {"type": "null"}]},
            "dominant_motion_beat": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "subject_motion_priority": {"anyOf": [{"type": "string", "enum": list(SUBJECT_MOTION_PRIORITIES)}, {"type": "null"}]},
            "revised_subject_action": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "revised_camera_move": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "revised_environment_motion": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "revised_ending_frame": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        },
        "required": [
            "verdict",
            "rationale",
            "confidence",
            "motion_strategy",
            "dominant_motion_beat",
            "subject_motion_priority",
            "revised_subject_action",
            "revised_camera_move",
            "revised_environment_motion",
            "revised_ending_frame",
        ],
        "additionalProperties": False,
    }


def validate_plan_review_payload(payload: dict[str, Any]) -> PlanReviewRecord:
    verdict = str(payload.get("verdict", "")).strip()
    if verdict not in PLAN_REVIEW_VERDICTS:
        raise ValueError(f"unsupported plan review verdict: {verdict}")
    rationale = str(payload.get("rationale", "")).strip()
    if not rationale:
        raise ValueError("rationale must not be empty")
    confidence = payload.get("confidence")
    if confidence is not None:
        confidence = float(confidence)
        if confidence < 0.0 or confidence > 1.0:
            raise ValueError("confidence must be between 0.0 and 1.0")
    return PlanReviewRecord(
        verdict=verdict,
        rationale=rationale,
        confidence=confidence,
        motion_strategy=_optional_enum(payload.get("motion_strategy"), MOTION_STRATEGIES, "motion_strategy"),
        dominant_motion_beat=_optional_text(payload.get("dominant_motion_beat")),
        subject_motion_priority=_optional_enum(
            payload.get("subject_motion_priority"),
            SUBJECT_MOTION_PRIORITIES,
            "subject_motion_priority",
        ),
        revised_subject_action=_optional_text(payload.get("revised_subject_action")),
        revised_camera_move=_optional_text(payload.get("revised_camera_move")),
        revised_environment_motion=_optional_text(payload.get("revised_environment_motion")),
        revised_ending_frame=_optional_text(payload.get("revised_ending_frame")),
    )


def apply_plan_review(
    *,
    motion_plan: MotionPromptPlan,
    review: PlanReviewRecord | None,
) -> MotionPromptPlan:
    if review is None or review.verdict != "revise" or motion_plan.shot_plan is None:
        return motion_plan
    shot = motion_plan.shot_plan
    revised_shot = replace(
        shot,
        subject_action=_dominant_subject_action(review) or shot.subject_action,
        camera_move=_sanitize_camera_move(review.revised_camera_move or shot.camera_move),
        environment_motion=review.revised_environment_motion or shot.environment_motion,
        ending_frame=_sanitize_ending_frame(review.revised_ending_frame or shot.ending_frame),
    )
    return replace(
        motion_plan,
        action_description=revised_shot.subject_action,
        motion_prompt=_compile_motion_prompt(
            shot_plan=revised_shot,
            visual_ethos=motion_plan.visual_ethos,
            cinema_controls=motion_plan.cinema_controls,
        ),
        shot_plan=revised_shot,
    )


def _compile_motion_prompt(
    *,
    shot_plan: ShotPlan,
    visual_ethos: str,
    cinema_controls: CinemaControlPlan | None = None,
) -> str:
    return (
        f"Opening frame: {_clean_prompt_clause(shot_plan.opening_frame)}. "
        f"Camera movement: {_clean_prompt_clause(shot_plan.camera_move)}. "
        f"Subject action: {_clean_prompt_clause(shot_plan.subject_action)}. "
        f"Environment motion: {_clean_prompt_clause(shot_plan.environment_motion)}. "
        f"Ending frame: {_clean_prompt_clause(shot_plan.ending_frame)}. "
        f"Pacing: {_clean_prompt_clause(shot_plan.pacing)}. "
        f"Cinema controls: {_cinema_controls_clause(cinema_controls)}. "
        f"Visual ethos: {_clean_prompt_clause(visual_ethos)}. "
        f"Preserve: {_clean_prompt_clause(shot_plan.preservation_constraints)}. "
        f"Negative constraints: {_clean_prompt_clause(shot_plan.negative_constraints)}."
    )


def _cinema_controls_clause(cinema_controls: CinemaControlPlan | None) -> str:
    if cinema_controls is None:
        return "use the shot plan camera and lighting consistently"
    return (
        f"camera_move={cinema_controls.camera_move}; "
        f"lens_feel={cinema_controls.lens_feel}; "
        f"depth_of_field={cinema_controls.depth_of_field}; "
        f"lighting_style={cinema_controls.lighting_style}; "
        f"motion_intensity={cinema_controls.motion_intensity}; "
        f"framing={cinema_controls.framing}"
    )


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_enum(value: Any, allowed: tuple[str, ...], field_name: str) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    if text not in allowed:
        raise ValueError(f"unsupported {field_name}: {text}")
    return text


def _sanitize_ending_frame(value: str) -> str:
    lower = value.lower()
    if "space for '" in lower or 'space for "' in lower or "cta space" in lower or "overlay space" in lower:
        return "camera settles into a clean hero frame with blank caption-safe space; no rendered text or letters"
    return value


def _dominant_subject_action(review: PlanReviewRecord) -> str | None:
    if review.revised_subject_action:
        return review.revised_subject_action
    if review.motion_strategy == "character_action" and review.dominant_motion_beat:
        return review.dominant_motion_beat
    return None


def _sanitize_camera_move(value: str) -> str:
    text = value.strip().rstrip(".")
    lowered = text.lower()
    # Keep image-to-video prompts to one dominant camera intention.
    split_markers = (
        " combined with ",
        " and ",
        " around ",
        " to gently ",
        ";",
        ",",
    )
    for marker in split_markers:
        index = lowered.find(marker)
        if index > 0:
            text = text[:index].strip()
            lowered = text.lower()
    return text or value.strip()


def _clean_prompt_clause(value: str) -> str:
    return " ".join(value.strip().rstrip(" .").split())


def _fail_closed(reason: str) -> PlanReviewRecord:
    return PlanReviewRecord(
        verdict="escalate",
        rationale=reason,
        confidence=0.0,
        motion_strategy=None,
        dominant_motion_beat=None,
        subject_motion_priority=None,
    )
