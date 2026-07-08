"""Capture Realism — the anti-"AI-junk" physics block.

The single highest-leverage lever for making generated frames read "photographed"
instead of "rendered". Adapted from the cinema-worldbuilder Capture Realism block
and the banana-pro Cinema Stack. Four physics mechanics, tuned per scene, folded
into BOTH the motion prompt and the keyframe image prompt:

  1. Depth via suspended atmosphere between planes (default-on; thin/light/heavy)
  2. Moisture without shine        (only if the scene is wet)
  3. Per-zone specular kill on skin (only if humans are in frame)
  4. Contrast curve stated three ways

Leans positive ("reads matte", "warmth preserved") per the negative->positive
rule; the specular-kill / anti-plastic clauses are the sanctioned exception.
"""

from __future__ import annotations

from typing import Literal

Density = Literal["thin", "light", "heavy"]
_VALID_DENSITY = ("thin", "light", "heavy")


def resolve_density(value: str | None) -> Density:
    token = str(value or "").strip().lower()
    return token if token in _VALID_DENSITY else "light"  # type: ignore[return-value]


def _depth_clause(density: Density, far_element: str) -> str:
    far = far_element.strip() or "the far background"
    return (
        f"The subject sits inside real depth — {density} atmosphere suspended in the air "
        f"between camera, subject, and {far}, so the background renders softer, desaturated, "
        f"and lower-contrast than the foreground and the figure sits within the air rather "
        f"than pasted on a flat plane."
    )


_WET_CLAUSE = (
    "Slight moisture has settled on every surface — damp and matte, no beading and no wet "
    "sheen, moisture that mutes and deepens without a single specular hotspot."
)

_SKIN_CLAUSE = (
    "Skin reads true cinematic matte — zero shine on forehead, nose bridge, cheekbones, "
    "temples, chin, and collarbones, real peach fuzz at the jaw and hairline, real soft fine "
    "even pore texture, light absorbed like true subsurface scattering, warmth preserved and "
    "natural, never plastic, never doll-skin, never AI-rendered, and never harsh — no acne, "
    "no blemishes, no enlarged or rough pores, fine flattering texture that keeps the face "
    "looking good."
)

_SURFACE_MATTE_CLAUSE = (
    "Environmental surfaces read matte not glossy — wet concrete, metal, and glass mute and "
    "deepen reflections instead of mirroring."
)

_CONTRAST_CLAUSE = (
    "Low-contrast curve — shadows lifted gently and holding texture, highlights rolled off "
    "softly never clipping to white, nothing crushed to black. All specular highlights "
    "surgically removed from skin, hair, fabric, and surrounding surfaces, every pixel reading "
    "matte and diffuse. Slightly desaturated grade with warmth preserved."
)


def build_capture_realism(
    *,
    wet: bool = False,
    humans: bool = True,
    density: str | None = "light",
    far_element: str = "the far background",
    label: bool = True,
) -> str:
    """Build a scene-tuned Capture Realism block.

    - wet:     include the moisture-without-shine clause
    - humans:  include the per-zone skin specular kill (else environmental-surface matte)
    - density: thin / light / heavy atmosphere between planes
    """
    den = resolve_density(density)
    parts: list[str] = [_depth_clause(den, far_element)]
    if wet:
        parts.append(_WET_CLAUSE)
    parts.append(_SKIN_CLAUSE if humans else _SURFACE_MATTE_CLAUSE)
    parts.append(_CONTRAST_CLAUSE)
    body = " ".join(parts)
    return f"Capture Realism: {body}" if label else body
