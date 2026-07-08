"""Provider-specific prompt shaping for paid video calls."""

from __future__ import annotations

from dataclasses import dataclass

from creative.production.contracts import MotionPromptPlan, ShotPlan


@dataclass(frozen=True, slots=True)
class ProviderMotionPrompt:
    prompt: str
    negative_prompt: str
    profile: str
    notes: tuple[str, ...] = ()


def compile_video_provider_prompt(
    *,
    motion_plan: MotionPromptPlan,
    model_id: str | None,
    aspect_ratio: str = "16:9",
) -> ProviderMotionPrompt:
    normalized_model = (model_id or "").lower()
    if "seedance" in normalized_model:
        return _compile_seedance_prompt(motion_plan=motion_plan, aspect_ratio=aspect_ratio)
    return ProviderMotionPrompt(
        prompt=motion_plan.motion_prompt,
        negative_prompt=motion_plan.negative_prompt,
        profile="generic_i2v",
    )


def compile_heygen_avatar_motion_prompt(
    *,
    motion_prompt: str,
    persona: str = "",
    render_mode: str = "",
) -> str:
    parts = [
        "Natural creator delivery.",
        _clean_clause(motion_prompt, 220),
    ]
    if persona:
        parts.append(f"Persona: {_clean_clause(persona, 120)}.")
    if render_mode:
        parts.append(f"Frame behavior: {_clean_clause(render_mode, 80)}.")
    parts.append("Use believable eye contact, small head turns, and casual hand gestures.")
    return " ".join(part for part in parts if part).strip()


def _compile_seedance_prompt(*, motion_plan: MotionPromptPlan, aspect_ratio: str) -> ProviderMotionPrompt:
    shot = motion_plan.shot_plan
    if shot is None:
        return ProviderMotionPrompt(
            prompt=_clean_clause(motion_plan.motion_prompt, 1200),
            negative_prompt="",
            profile="wavespeed_seedance",
            notes=("seedance ignores separate negative_prompt in current WaveSpeed adapter",),
        )

    prompt = (
        f"Animate the provided starting image as the first frame. "
        f"Format: {aspect_ratio}. "
        f"Subject action: {_clean_clause(shot.subject_action, 360)}. "
        f"Camera: {_clean_clause(shot.camera_move, 180)}. "
        f"Scene motion: {_clean_clause(shot.environment_motion, 220)}. "
        f"Opening frame: {_clean_clause(shot.opening_frame, 180)}. "
        f"Ending frame: {_clean_clause(shot.ending_frame, 180)}. "
        f"Pacing: {_clean_clause(shot.pacing, 120)}. "
        f"Preserve: {_clean_preservation(shot)}."
    )
    return ProviderMotionPrompt(
        prompt=prompt,
        negative_prompt="",
        profile="wavespeed_seedance",
        notes=("positive motion/action prompt compiled for Seedance-style I2V",),
    )


def _clean_preservation(shot: ShotPlan) -> str:
    text = _clean_clause(shot.preservation_constraints, 420)
    if "Add motion only through camera movement" in text:
        return text
    return f"{text}. Add motion only through camera movement, atmosphere, and the requested action"


def _clean_clause(value: str, max_chars: int) -> str:
    cleaned = " ".join(str(value or "").replace("\n", " ").split()).strip(" ;,")
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max(0, max_chars - 1)].rstrip(" ,.;") + "."
