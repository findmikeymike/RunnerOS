"""Capture Realism — anti-AI-plastic physics clause (flag-gated, default OFF).

Squad already controls camera/lens/lighting (CinemaControlPlan) and fights slop
with negative prompts, but it carries no explicit POSITIVE anti-plastic physics
language — the single biggest lever that separates "photographed" from
"rendered" on image-to-video models. This adds a scene-tuned "Capture realism:"
clause, content-type aware via the existing ``CinemaControlPlan.framing`` so it
stays correct across Squad's many video kinds:

  * human-in-frame (UGC, presenter, narrative, performance): per-zone skin
    specular kill + subsurface + peach fuzz, atmospheric depth, contrast curve.
  * screen / faceless / environment (app demo, no-face B-roll, plates): the
    environmental-surface matte variant with NO skin language — an app-demo
    screen recording must never be told to render "peach fuzz".

Enable with ``SQUAD_CAPTURE_REALISM=1``. Off by default: zero output change.
"""

from __future__ import annotations

import os
import re
from typing import Optional

# CinemaControlPlan.framing values that are categorically NON-human (UI, product,
# environment, evidence detail) — these get the surface-matte variant, never skin
# language. Ambiguous framings (lyric_safe_negative_space, symmetry, surreal) are
# intentionally treated as human: Squad is image-to-video, so the keyframe gates
# reality — skin physics helps when the artist is present and is harmlessly
# ignored on a faceless frame the source still already locked.
_NO_HUMAN_FRAMINGS = {
    "device_ui_readable",
    "evidence_detail_frame",
    "environment_plate",
    "tight_product_detail",
}
_WET_TOKENS = (
    "rain", "wet ", "water", "ocean", "sea ", "storm", "drizzle", "mist",
    "sweat", "steam", "pool", "puddle", "downpour", "soaked",
)
_DENSITIES = ("thin", "light", "heavy")

# Intent signals for a NON-photoreal (painted / illustrated / 2D) aesthetic.
# When present, photoreal physics ("subsurface scattering", "photographed not
# generated") would fight the intended look, so the realism clause is suppressed.
_NON_PHOTOREAL_TOKENS = (
    "painted", "painterly", "illustration", "illustrated", "anime", "cartoon",
    "2d", "hand-drawn", "hand drawn", "watercolor", "gouache", "oil painting",
    "sketch", "sketched", "comic", "manga", "claymation", "stop motion",
    "pixel art", "low poly", "rotoscope", "cel shaded", "cel-shaded", "storybook",
    "woodblock", "ink wash", "collage", "papercut", "paper cut", "crayon",
    "pastel", "charcoal drawing", "line art", "vector art", "flat illustration",
    "graphic novel", "claymotion", "puppet", "felt", "needle felt",
)


def is_photoreal_intent(text: str) -> bool:
    """False when the brief signals a non-photoreal (painted/illustrated/2D)
    aesthetic. Honors simple negations so 'avoid cartoon look' / 'not anime'
    still read as photoreal intent."""
    low = " " + (text or "").lower() + " "
    for token in _NON_PHOTOREAL_TOKENS:
        if token not in low:
            continue
        negated = re.search(
            r"(?:no|not|without|avoid|avoids|avoiding|never)\s+(?:[a-z0-9-]+\s+){0,3}" + re.escape(token),
            low,
        )
        if not negated:
            return False
    return True


def capture_realism_enabled() -> bool:
    return os.getenv("SQUAD_CAPTURE_REALISM", "").strip().lower() in {"1", "true", "yes", "on"}


def _density(value: Optional[str]) -> str:
    token = (value or "").strip().lower()
    return token if token in _DENSITIES else "light"


def humans_in_frame(framing: Optional[str]) -> bool:
    """Infer whether a human subject is in frame from the cinema control framing."""
    return (framing or "").strip().lower() not in _NO_HUMAN_FRAMINGS


def build_capture_realism(
    *,
    humans: bool,
    wet: bool = False,
    density: str = "light",
    far_element: str = "the background",
) -> str:
    """Build a scene-tuned Capture Realism clause. Leans positive (matte, warmth
    preserved); the specular-kill / anti-plastic phrasing is the sanctioned
    known-failure-mode suppression."""
    den = _density(density)
    parts = [
        f"{den} atmosphere suspended between camera, subject, and {far_element} so distant "
        "planes render softer, desaturated, and lower-contrast than the foreground rather than a flat plane"
    ]
    if wet:
        parts.append(
            "any moisture reads damp and matte with no beading, no wet sheen, and no specular hotspots"
        )
    if humans:
        parts.append(
            "skin reads true cinematic matte with zero shine on forehead, nose bridge, cheekbones, temples, "
            "chin, and collarbones, real peach fuzz at the jaw and hairline, fine even pore texture, true "
            "subsurface scattering, warmth preserved, never plastic or waxy or AI-rendered and never harsh"
        )
    else:
        parts.append(
            "surfaces read matte not glossy — screen glass, metal, and plastic mute their reflections "
            "instead of mirroring, with no blown speculars"
        )
    parts.append(
        "low-contrast curve with shadows lifted gently and highlights rolled off softly, nothing clipping "
        "to white or crushed to black, every surface matte and diffuse, photographed not generated"
    )
    return "Capture realism: " + "; ".join(parts) + "."


# Explicit render-style values that decisively turn the photoreal clause on/off,
# bypassing keyword inference. Mirrors creative_modes.RENDER_STYLE_ALIASES outputs.
_EXPLICIT_PHOTOREAL_STYLES = {
    "photoreal", "photorealistic", "realistic", "real", "cinematic", "photographic",
    "live_action", "film", "footage",
}
_EXPLICIT_NON_PHOTOREAL_STYLES = {
    "painterly", "painted", "illustrated", "illustration", "animated", "anime",
    "cartoon", "stylized", "abstract", "surreal", "2d", "drawn", "comic",
    "watercolor", "oil_painting",
}


def should_apply_capture_realism(*, render_style: Optional[str] = None, text: str = "") -> bool:
    """Decide whether the photoreal Capture Realism clause applies.

    Explicit ``render_style`` from the brief is authoritative; ``auto``/``mixed``/
    unset fall back to keyword inference from the brief text. This is the clear
    style direction lever: a painterly brief never gets photoreal physics."""
    style = (render_style or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    if style in _EXPLICIT_PHOTOREAL_STYLES:
        return True
    if style in _EXPLICIT_NON_PHOTOREAL_STYLES:
        return False
    return is_photoreal_intent(text)


def scene_capture_realism(
    *, cinema_controls=None, text: str = "", density: str = "light", render_style: Optional[str] = None
) -> str:
    """Derive the right Capture Realism clause for a scene from its cinema
    controls (humans-in-frame) and prompt text (wet). Returns "" when the intent
    is non-photoreal (painted/illustrated) — photoreal physics is suppressed so
    it never fights a painterly look. Explicit ``render_style`` overrides inference."""
    if not should_apply_capture_realism(render_style=render_style, text=text):
        return ""
    humans = humans_in_frame(getattr(cinema_controls, "framing", None))
    low = (text or "").lower() + " "
    wet = any(tok in low for tok in _WET_TOKENS)
    return build_capture_realism(humans=humans, wet=wet, density=density)
