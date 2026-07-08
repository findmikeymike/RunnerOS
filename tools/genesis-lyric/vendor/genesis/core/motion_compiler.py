"""Motion compiler — turn a structured ShotDirection into a provider-ready
motion prompt string.

The keyframe IS the reference (no @imageN tags, no identity/wardrobe re-described).
This emits only what the still can't carry: Movement (four layers + beats) ->
Last Frame -> Capture Realism -> Camera Capture. Length-tuned per provider:
Kling/Hailuo/WaveSpeed-class reward concrete, moderate prompts; fal/Seedance-class
tolerate more. Density discipline: lower-priority detail is dropped before the
load-bearing move / last-frame / camera line.
"""

from __future__ import annotations

import os
from typing import Optional

from agent.cinema_modes import build_camera_capture

# Default per-provider word budgets (override via GENESIS_MOTION_WORDBUDGET_<PROVIDER>).
_DEFAULT_BUDGETS = {
    "wavespeed": 140,
    "runware": 140,
    "lumenfall": 140,
    "kling": 140,
    "hailuo": 140,
    "fal": 240,
    "replicate": 240,
    "seedance": 280,
}
_FALLBACK_BUDGET = 160


def provider_word_budget(provider: Optional[str]) -> int:
    name = str(provider or "").strip().lower()
    env = os.environ.get(f"GENESIS_MOTION_WORDBUDGET_{name.upper()}")
    if env:
        try:
            return max(40, int(env))
        except ValueError:
            pass
    return _DEFAULT_BUDGETS.get(name, _FALLBACK_BUDGET)


def _wc(text: str) -> int:
    return len(text.split())


def _fmt_t(value: float) -> str:
    if abs(value - round(value)) < 1e-6:
        return f"{int(round(value))}s"
    return f"{value:.1f}s"


def _beats_text(beats, duration_seconds: float) -> str:
    if not beats:
        return ""
    chunks = []
    for beat in beats:
        event = str(getattr(beat, "event", "") or "").strip().rstrip(".")
        if not event:
            continue
        chunks.append(f"{_fmt_t(beat.t_start)}-{_fmt_t(beat.t_end)} {event}")
    return ("Beats: " + "; ".join(chunks) + ".") if chunks else ""


_COMPACT_CAPTURE = (
    "Capture Realism: matte and low-contrast with real atmospheric depth between planes, "
    "no plastic sheen, no specular hotspots, lifted shadows and rolled-off highlights, "
    "photographed not generated."
)


def _join_sentences(parts: list[str]) -> str:
    cleaned = [p.strip() for p in parts if p and p.strip()]
    return " ".join(cleaned)


def compile_motion_prompt(
    shot,
    *,
    provider: Optional[str] = "wavespeed",
    duration_seconds: Optional[float] = None,
) -> str:
    """Compile a ShotDirection into a provider-ready motion prompt string."""
    duration = float(duration_seconds or getattr(shot, "duration_seconds", None) or 5.0)
    budget = provider_word_budget(provider)

    camera_capture = (getattr(shot, "camera_capture", "") or "").strip() or build_camera_capture(
        getattr(shot, "cinema_mode", "M1"), duration_seconds=duration
    )
    capture_realism = (getattr(shot, "capture_realism", "") or "").strip()

    # Load-bearing movement: the camera move (+ its reason) and the subject action.
    move_bits: list[str] = []
    camera_motion = (getattr(shot, "camera_motion", "") or "").strip()
    motion_purpose = (getattr(shot, "motion_purpose", "") or "").strip()
    if camera_motion:
        move_bits.append(f"{camera_motion.rstrip('.')} — {motion_purpose.rstrip('.')}" if motion_purpose else camera_motion.rstrip("."))
    subject_action = (getattr(shot, "subject_action", "") or "").strip()
    if subject_action:
        move_bits.append(subject_action.rstrip("."))

    # Droppable detail layers.
    detail_bits: list[str] = []
    for field in ("micro_motion", "environmental_motion"):
        val = (getattr(shot, field, "") or "").strip()
        if val:
            detail_bits.append(val.rstrip("."))

    beats_txt = _beats_text(getattr(shot, "beats", []) or [], duration)
    last_frame = (getattr(shot, "last_frame", "") or "").strip()

    def assemble_body(include_detail: bool, capture: str) -> str:
        movement_clauses = move_bits + (detail_bits if include_detail else [])
        movement = ("Movement: " + ". ".join(movement_clauses) + ".") if movement_clauses else ""
        last = ("Last frame: " + last_frame.rstrip(".") + ".") if last_frame else ""
        return _join_sentences([movement, beats_txt, last, capture])

    def finalize(body: str) -> str:
        # camera_capture (the gear line) is always preserved at the end.
        return _join_sentences([body, camera_capture])

    # Full -> drop detail -> compact capture, until within budget.
    for body in (
        assemble_body(True, capture_realism),
        assemble_body(False, capture_realism),
        assemble_body(False, _COMPACT_CAPTURE if capture_realism else ""),
    ):
        out = finalize(body)
        if _wc(out) <= budget:
            return out

    # Last resort: hard-truncate the movement/last-frame body to fit, keeping the
    # camera_capture line intact where possible so the output never exceeds budget.
    available = max(0, budget - _wc(camera_capture))
    body_words = assemble_body(False, "").split()[:available]
    body_trunc = " ".join(body_words).rstrip(" ,.;:-—")
    out = finalize(body_trunc)
    # Absolute guarantee: even a camera_capture line longer than the whole budget
    # cannot push the output over (pathological / tiny-budget case).
    words = out.split()
    if len(words) > budget:
        out = " ".join(words[:budget])
    return out
