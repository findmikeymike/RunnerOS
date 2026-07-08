"""Anti-slop QA gate for Motion Director shot direction.

Replaces the `"subtle natural movement"` fallback with regenerate-or-fail.
Hard-fails a shot that isn't actually directed; soft-warns on coherence nits.
The director should regenerate on hard-fail (capped retries) rather than ship
generic motion.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class MotionFinding:
    severity: str  # "fail" | "warn"
    code: str
    message: str


# Pure-slop phrases that must never reach a provider.
_BANNED_PHRASES = (
    "subtle natural movement",
    "subtle movement",
    "natural movement",
    "smooth motion",
    "gentle movement",
    "4k",
    "8k",
    "hdr",
    "hyperrealistic",
)

# Generic camera moves that are slop ONLY when they carry the shot alone (no
# stated subject action and no motivation).
_GENERIC_CAMERA = ("slow zoom", "zoom in", "zoom out", "pan left", "pan right", "ken burns")

_REQUIRED_LAYERS = ("subject_action", "micro_motion", "environmental_motion", "camera_motion")


def _norm(text: str) -> str:
    # Lowercase and collapse all punctuation/hyphens to spaces so banned phrases
    # are matched on word boundaries regardless of separators (smooth-motion, 4k-res).
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _scan_banned(text: str) -> list[str]:
    low = _norm(text)
    hits = []
    for phrase in _BANNED_PHRASES:
        # Word-boundary match: avoids false positives like "supernatural movement"
        # matching "natural movement", and "look" matching "8k".
        if re.search(rf"\b{re.escape(phrase)}\b", low):
            hits.append(phrase)
    return hits


def validate_shot_direction(
    shot,
    *,
    bible_mode: Optional[str] = None,
    duration_seconds: Optional[float] = None,
) -> list[MotionFinding]:
    findings: list[MotionFinding] = []
    duration = float(duration_seconds or getattr(shot, "duration_seconds", None) or 5.0)

    # 1) Required movement layers + last frame + motivation (each must be SPECIFIED,
    #    even if the content is "camera locked off" — absence is not a directive).
    for layer in _REQUIRED_LAYERS:
        if not _norm(getattr(shot, layer, "")):
            findings.append(MotionFinding("fail", "missing_layer", f"{layer} is empty — every movement layer must be specified"))
    if not _norm(getattr(shot, "last_frame", "")):
        findings.append(MotionFinding("fail", "missing_last_frame", "last_frame target is empty"))
    if not _norm(getattr(shot, "motion_purpose", "")):
        findings.append(MotionFinding("fail", "missing_purpose", "motion_purpose is empty — every move needs an emotional reason"))

    # 2) Banned slop phrases anywhere in the movement text.
    motion_text = " ".join(
        _norm(getattr(shot, f, "")) for f in (_REQUIRED_LAYERS + ("motion_purpose", "last_frame"))
    )
    for phrase in sorted(set(_scan_banned(motion_text))):
        findings.append(MotionFinding("fail", "banned_phrase", f"banned generic phrase: {phrase!r}"))

    # 3) A bare generic camera move carrying the shot with no subject action.
    cam = _norm(getattr(shot, "camera_motion", ""))
    subject = _norm(getattr(shot, "subject_action", ""))
    if cam and not subject:
        if any(cam == g or cam.startswith(g) for g in _GENERIC_CAMERA):
            findings.append(MotionFinding("fail", "generic_camera_only", f"generic camera move {cam!r} carries the shot with no subject action"))

    # 4) Beats: required for clips longer than a single beat; must cover [0, duration].
    beats = list(getattr(shot, "beats", []) or [])
    if duration > 5.0 and not beats:
        findings.append(MotionFinding("fail", "missing_beats", f"clip is {duration:.0f}s but has no per-beat timing"))
    if beats:
        starts = [b.t_start for b in beats]
        ends = [b.t_end for b in beats]
        if min(starts) > 0.6:
            findings.append(MotionFinding("fail", "beats_late_start", f"first beat starts at {min(starts):.1f}s (should cover the open)"))
        if abs(max(ends) - duration) > 0.6:
            findings.append(MotionFinding("fail", "beats_dont_cover", f"beats end at {max(ends):.1f}s but clip is {duration:.1f}s"))

    # 5) Mode contrast without a stated reason (soft).
    if bible_mode:
        from agent.cinema_modes import normalize_mode_id
        if normalize_mode_id(getattr(shot, "cinema_mode", "")) != normalize_mode_id(bible_mode):
            if not _norm(getattr(shot, "mode_contrast_reason", "")):
                findings.append(MotionFinding("warn", "mode_contrast", "scene mode differs from the campaign's locked mode without a stated reason"))

    return findings


def has_blocking_failures(findings: list[MotionFinding]) -> bool:
    return any(f.severity == "fail" for f in findings)


def assert_shot_direction_ok(shot, **kwargs) -> None:
    findings = validate_shot_direction(shot, **kwargs)
    fails = [f for f in findings if f.severity == "fail"]
    if fails:
        raise ValueError("Shot direction failed QA: " + "; ".join(f"{f.code}: {f.message}" for f in fails))
