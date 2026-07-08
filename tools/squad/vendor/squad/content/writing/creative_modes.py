"""Compact creative-control modes shared across Squad planning prompts."""

from __future__ import annotations

from typing import Any, Mapping


CINEMA_MODE_ALIASES: dict[str, str] = {
    "narrative": "narrative",
    "cinematic": "narrative",
    "story": "narrative",
    "studio": "studio_editorial",
    "editorial": "studio_editorial",
    "studio_editorial": "studio_editorial",
    "action": "action",
    "kinetic": "action",
    "performance": "performance",
    "concert": "performance",
    "music_video": "performance",
    "atmospheric": "atmospheric",
    "world": "atmospheric",
    "ambient": "atmospheric",
}

VALID_CINEMA_MODES = tuple(dict.fromkeys(CINEMA_MODE_ALIASES.values()))


def normalize_cinema_mode(value: str | None) -> str:
    key = " ".join((value or "").strip().lower().replace("-", "_").split())
    key = key.replace(" ", "_")
    return CINEMA_MODE_ALIASES.get(key, "")


# Explicit render-style direction — the general "how should this look" lever the
# director/agent sets so the system never has to infer photoreal-vs-stylized from
# keywords alone. "auto"/"mixed" defer to per-brief inference.
RENDER_STYLE_ALIASES: dict[str, str] = {
    "": "auto", "auto": "auto", "default": "auto", "mixed": "mixed", "hybrid": "mixed",
    # photoreal family
    "photoreal": "photoreal", "photo_real": "photoreal", "photorealistic": "photoreal",
    "realistic": "photoreal", "real": "photoreal", "cinematic": "photoreal",
    "photographic": "photoreal", "live_action": "photoreal", "film": "photoreal", "footage": "photoreal",
    # painterly family
    "painterly": "painterly", "painted": "painterly", "oil_painting": "painterly",
    "watercolor": "painterly", "gouache": "painterly",
    # illustrated family
    "illustrated": "illustrated", "illustration": "illustrated", "drawn": "illustrated",
    "hand_drawn": "illustrated", "line_art": "illustrated", "comic": "illustrated",
    "graphic_novel": "illustrated", "sketch": "illustrated",
    # animated family
    "animated": "animated", "anime": "animated", "cartoon": "animated", "2d": "animated",
    "cel_shaded": "animated", "claymation": "animated", "stop_motion": "animated", "pixel_art": "animated",
    # generic stylized
    "stylized": "stylized", "abstract": "stylized", "surreal": "stylized",
}

VALID_RENDER_STYLES = tuple(dict.fromkeys(RENDER_STYLE_ALIASES.values()))


def normalize_render_style(value: str | None) -> str:
    key = " ".join((value or "").strip().lower().replace("-", "_").split())
    key = key.replace(" ", "_")
    return RENDER_STYLE_ALIASES.get(key, "")


def coerce_character_lock(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        return {"identity": value.strip()}
    return {}


def coerce_world_profile(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        return {"setting": value.strip()}
    return {}


def render_character_lock(value: Mapping[str, Any] | str | None) -> str:
    return _render_mapping(
        coerce_character_lock(value),
        allowed_keys=("identity", "face", "hair", "body", "wardrobe", "markers", "preserve"),
    )


def render_world_profile(value: Mapping[str, Any] | str | None, *, visual_only: bool = False) -> str:
    keys = ("setting", "palette", "lighting", "texture", "atmosphere", "props", "continuity", "avoid")
    if not visual_only:
        keys = (*keys[:-1], "audio", "avoid")
    return _render_mapping(
        coerce_world_profile(value),
        allowed_keys=keys,
    )


def render_creative_mode_block(brief: Any, *, visual_only: bool = False) -> str:
    parts: list[str] = []
    cinema_mode = normalize_cinema_mode(getattr(brief, "cinema_mode", "") or "")
    if cinema_mode:
        parts.append(f"- cinema_mode: {cinema_mode}")
    character_lock = render_character_lock(getattr(brief, "character_lock", None) or None)
    if character_lock:
        parts.append(f"- character_lock: {character_lock}")
    world_profile = render_world_profile(getattr(brief, "world_profile", None) or None, visual_only=visual_only)
    if world_profile:
        parts.append(f"- world_profile: {world_profile}")
    return "\n".join(parts)


def creative_mode_text(brief: Any, *, visual_only: bool = False) -> str:
    block = render_creative_mode_block(brief, visual_only=visual_only)
    return "; ".join(line.removeprefix("- ") for line in block.splitlines() if line.strip())


def _render_mapping(value: Mapping[str, Any] | None, *, allowed_keys: tuple[str, ...]) -> str:
    if not value:
        return ""
    parts: list[str] = []
    for key in allowed_keys:
        rendered = _render_value(value.get(key))
        if rendered:
            parts.append(f"{key}={rendered}")
    return "; ".join(parts)


def _render_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _compact(value)
    if isinstance(value, (list, tuple)):
        return ", ".join(_compact(str(item)) for item in value if str(item).strip())[:280].strip(" ,")
    if isinstance(value, (int, float, bool)):
        return str(value)
    return _compact(str(value))


def _compact(value: str, *, max_chars: int = 280) -> str:
    text = " ".join(value.split()).strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip(" ,;:.") + "."
