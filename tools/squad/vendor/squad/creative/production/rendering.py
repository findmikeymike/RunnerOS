from __future__ import annotations

from typing import Iterable

from creative.production.contracts import CreativeProductionState, RenderPlan


FFMPEG = "ffmpeg"
HYPERFRAMES = "hyperframes"
REMOTION = "remotion"
AUTO = "auto"

SUPPORTED_RENDERERS = (FFMPEG, HYPERFRAMES, REMOTION)


def build_render_plan(
    *,
    state: CreativeProductionState,
    preferred_renderer: str = AUTO,
    available_renderers: Iterable[str] = (FFMPEG,),
) -> RenderPlan:
    available = _normalize_available_renderers(available_renderers)
    requested = _normalize_renderer(preferred_renderer)
    if requested != AUTO:
        return _explicit_renderer_plan(state=state, requested=requested, available=available)
    return _auto_renderer_plan(state=state, available=available)


def _explicit_renderer_plan(
    *,
    state: CreativeProductionState,
    requested: str,
    available: set[str],
) -> RenderPlan:
    if requested not in SUPPORTED_RENDERERS:
        return RenderPlan(
            renderer=FFMPEG,
            polish_level="none",
            reason=f"unsupported renderer `{requested}` requested; using ffmpeg fallback",
            warning=f"unsupported renderer requested: {requested}",
        )
    if requested not in available:
        return RenderPlan(
            renderer=FFMPEG,
            polish_level="none",
            reason=f"requested renderer `{requested}` is unavailable; using ffmpeg fallback",
            warning=f"requested renderer unavailable: {requested}",
        )
    return RenderPlan(
        renderer=requested,
        polish_level=_polish_level_for_state(state, renderer=requested),
        reason=f"renderer explicitly requested: {requested}",
        required_capabilities=_capabilities_for_state(state, renderer=requested),
    )


def _auto_renderer_plan(*, state: CreativeProductionState, available: set[str]) -> RenderPlan:
    format_type = _format_type(state)
    caption_strategy = _caption_strategy(state)
    if HYPERFRAMES in available and format_type in {
        "product_ad",
        "ugc_scripted_ad",
        "lyric_video",
        "music_visualizer",
        "no_face_youtube",
    }:
        return RenderPlan(
            renderer=HYPERFRAMES,
            polish_level="full" if format_type in {"product_ad", "lyric_video", "music_visualizer"} else "light",
            reason=f"{format_type} benefits from styled captions, kinetic text, and social-video polish",
            required_capabilities=_capabilities_for_state(state=state, renderer=HYPERFRAMES),
        )
    if REMOTION in available and caption_strategy in {"kinetic", "lyric", "spoken_captioned"}:
        return RenderPlan(
            renderer=REMOTION,
            polish_level="full",
            reason="caption-heavy format can use reusable Remotion templates",
            required_capabilities=_capabilities_for_state(state=state, renderer=REMOTION),
        )
    return RenderPlan(
        renderer=FFMPEG,
        polish_level="none",
        reason="simple ffmpeg render is the safest available path",
        required_capabilities=("concat_or_mux",),
    )


def _capabilities_for_state(*, state: CreativeProductionState, renderer: str) -> tuple[str, ...]:
    capabilities = ["compose_assets"]
    if state.post_pass_plan and state.post_pass_plan.captions_enabled:
        capabilities.append("captions")
    elif _caption_strategy(state) != "minimal":
        capabilities.append("captions")
    if state.audio_mix_plan and (state.audio_mix_plan.selected_music_track or state.voice_asset):
        capabilities.append("audio_mix")
    if _format_type(state) in {"lyric_video", "music_visualizer"}:
        capabilities.append("lyric_or_music_visuals")
    if renderer == FFMPEG:
        return tuple(cap for cap in capabilities if cap in {"compose_assets", "audio_mix"})
    return tuple(capabilities)


def _polish_level_for_state(*, state: CreativeProductionState, renderer: str) -> str:
    if renderer == FFMPEG:
        return "none"
    if _format_type(state) in {"lyric_video", "music_visualizer", "product_ad"}:
        return "full"
    return "light"


def _normalize_available_renderers(available_renderers: Iterable[str]) -> set[str]:
    available = {_normalize_renderer(renderer) for renderer in available_renderers}
    available.discard(AUTO)
    available = {renderer for renderer in available if renderer in SUPPORTED_RENDERERS}
    available.add(FFMPEG)
    return available


def _normalize_renderer(renderer: str | None) -> str:
    return str(renderer or AUTO).strip().lower().replace("_", "-")


def _format_type(state: CreativeProductionState) -> str:
    return str(getattr(state.format_narrative_plan, "format_type", "") or "")


def _caption_strategy(state: CreativeProductionState) -> str:
    return str(getattr(state.format_narrative_plan, "caption_strategy", "") or "")
