"""Cinema mode registry — the taste engine for the Motion Director.

A finite set of cinematography registers (M1-M5), each locking lens family,
camera movement, diffusion, and grade. Adapted from the cinema-worldbuilder
director grammar. The campaign bible locks ONE dominant mode for visual DNA
across the whole campaign; a scene may pick a different mode only for
intentional contrast (and must say why).

Each mode deterministically yields the Camera Capture line — the single closing
camera/lens/grade/fps spec — so the LLM never has to invent gear.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class CinemaMode:
    id: str  # M1..M5
    name: str
    use_when: str
    lens_options_mm: tuple[int, ...]
    default_lens_mm: int
    lens_character: str  # "vintage 2x anamorphic character" / "clean spherical character"
    movement: str
    diffusion: str
    grade: str
    # framing hint for the keyframe (composition register)
    framing_bias: str = ""

    def camera_capture(self, *, duration_seconds: float, lens_mm: Optional[int] = None) -> str:
        """The single closing Camera Capture line for this mode."""
        lens = lens_mm if lens_mm in self.lens_options_mm else self.default_lens_mm
        secs = _fmt_seconds(duration_seconds)
        return (
            f"Camera Capture: wide-latitude cinema capture, {lens}mm {self.lens_character} "
            f"at a wide aperture, {self.diffusion}, {self.movement}, {self.grade}, "
            f"shallow depth of field, 24fps 180-degree shutter, {secs}."
        )


def _fmt_seconds(duration_seconds: float) -> str:
    value = max(0.0, float(duration_seconds or 0.0))
    if abs(value - round(value)) < 1e-6:
        return f"{int(round(value))} seconds"
    return f"{value:.1f} seconds"


_MODES: dict[str, CinemaMode] = {
    "M1": CinemaMode(
        id="M1",
        name="Narrative",
        use_when="lived-in real-world — streets, rooms, cars, bars, exteriors",
        lens_options_mm=(40, 55, 75, 100),
        default_lens_mm=55,
        lens_character="vintage 2x anamorphic character with oval bokeh and soft frame-edge falloff",
        movement="handheld with natural operator breath",
        diffusion="light diffusion bloom softening highlights",
        grade="color-negative daylight film rendition with fine 35mm grain, teal-amber grade",
        framing_bias="documentary, off-center, negative space",
    ),
    "M2": CinemaMode(
        id="M2",
        name="Studio/Editorial",
        use_when="white void, clean studio, fashion film, hyperpop set, editorial portrait",
        lens_options_mm=(32, 50, 75, 100),
        default_lens_mm=50,
        lens_character="clean spherical character with natural round bokeh and even sharpness",
        movement="locked tripod with an optional slow push-in",
        diffusion="mild diffusion bloom",
        grade="saturated editorial grade with warm-retained blacks, fine grain",
        framing_bias="centered, graphic, crafted",
    ),
    "M3": CinemaMode(
        id="M3",
        name="Action",
        use_when="combat, chase, stunts, debris, smoke, high physicality",
        lens_options_mm=(40, 55, 75, 100),
        default_lens_mm=40,
        lens_character="vintage 2x anamorphic character with oval bokeh and soft edge falloff",
        movement="handheld and shaky throughout with no stabilized shots",
        diffusion="light diffusion bloom softening highlights",
        grade="color-negative film rendition with heavier low-light grain and dusty atmospheric haze",
        framing_bias="kinetic, off-axis, motion-led",
    ),
    "M4": CinemaMode(
        id="M4",
        name="Performance",
        use_when="stage, arena, festival pit, crowd, jumbotron",
        lens_options_mm=(40, 55, 75, 100),
        default_lens_mm=55,
        lens_character="vintage 2x anamorphic character with horizontal streak flares on stage lights",
        movement="mixed handheld pit-photographer and orbital operator energy with hard cuts",
        diffusion="light diffusion bloom softening highlights",
        grade="color-negative film rendition, fine grain, desaturated cool with warm bloom and stage color cast",
        framing_bias="performer-forward, crowd depth, volumetric haze",
    ),
    "M5": CinemaMode(
        id="M5",
        name="Atmospheric",
        use_when="empty environments, landscapes, weather, mood / world-establishing",
        lens_options_mm=(35, 55, 85),
        default_lens_mm=55,
        lens_character="vintage 2x anamorphic character with oval bokeh and soft edge falloff",
        movement="locked-off or an extremely slow push-in only",
        diffusion="light diffusion bloom softening highlights",
        grade="color-negative film rendition with fine grain, palette-driven atmospheric haze",
        framing_bias="environment-as-subject, deep planes, slow",
    ),
}

DEFAULT_MODE_ID = "M1"
VALID_MODE_IDS = tuple(_MODES.keys())


def normalize_mode_id(value: Optional[str]) -> str:
    """Resolve a mode id from an M-id or a name (case-insensitive). Falls back to
    the default mode for anything unrecognized."""
    if not value:
        return DEFAULT_MODE_ID
    token = str(value).strip().upper()
    if token in _MODES:
        return token
    lower = str(value).strip().lower()
    # Prefer exact name match; then substring, longest name first so e.g.
    # "Studio/Editorial" wins over a shorter name that is a coincidental substring.
    for mode in sorted(_MODES.values(), key=lambda m: -len(m.name)):
        if mode.name.lower() == lower or mode.name.lower() in lower:
            return mode.id
    return DEFAULT_MODE_ID


def get_mode(value: Optional[str]) -> CinemaMode:
    return _MODES[normalize_mode_id(value)]


def all_modes() -> list[CinemaMode]:
    return list(_MODES.values())


def build_camera_capture(
    mode: Optional[str], *, duration_seconds: float = 5.0, lens_mm: Optional[int] = None
) -> str:
    """Deterministic Camera Capture line for a mode + duration (+ optional lens)."""
    return get_mode(mode).camera_capture(duration_seconds=duration_seconds, lens_mm=lens_mm)
