#!/usr/bin/env python3
"""CLI entrypoint for creative-production-v1."""

from __future__ import annotations

import argparse
from dataclasses import fields, replace
import json
import os
import re
import shutil
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from core.config import load_settings
from creative.director.graph import CreativeDirectorGraph
from creative.production.assembly import FfmpegAssemblyAdapter
from creative.production.contracts import CreativeProductionInput
from creative.production.graph import CreativeProductionGraph
from creative.production.heygen import HeyGenUgcAvatarAdapter
from creative.production.plan_review import OpenAIResponsesProductionPlanReviewer
from creative.production.recipe_registry import recommend_recipe, recipe_recommendation_to_payload
from creative.production.runtime import (
    build_audio_mix_adapter_from_env,
    build_caption_alignment_adapter_from_env,
    build_caption_burn_in_adapter_from_env,
    build_loudness_normalizer_from_env,
    build_media_probe_adapter_from_env,
    build_render_adapter_from_env,
    build_sfx_library_adapter_from_env,
    build_track_library_adapter_from_env,
    build_visual_polish_config_from_env,
)
from creative.production.sequence_treatment_director import OpenAIResponsesSequenceTreatmentDirector
from creative.production.shotlist_director import OpenAIResponsesShotlistDirector
from creative.production.story_writer import OpenAIResponsesFacelessStoryWriter
from creative.production.tools import CreativeProductionTools
from creative.production.tts import FallbackTTSAdapter, FishTTSAdapter, InworldTTSAdapter, OpenAITTSAdapter
from creative.video_factory import (
    FalKlingVideoBackend,
    HttpFalVideoTransport,
    VideoBackendRouter,
    VideoGenerationAdapter,
    WaveSpeedVideoAdapter,
    WaveSpeedVideoBackend,
)
from scripts.run_creative_director import build_runtime as build_director_runtime, summarize_error as summarize_director_error


IMAGE_ASSET_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".tif", ".tiff"}
AUDIO_ASSET_EXTENSIONS = {".mp3", ".wav", ".aiff", ".aif", ".m4a", ".aac", ".flac", ".ogg"}
REFERENCE_ROLE_KEYWORDS = {
    "logo": ("logo", "logos", "brandmark", "wordmark", "mark"),
    "face": ("face", "faces", "headshot", "headshots", "selfie", "selfies", "portrait", "portraits", "person", "people", "founder", "artist"),
    "style": ("style", "styles", "mood", "moodboard", "moodboards", "inspiration", "insp", "reference", "references", "vibe", "aesthetic", "palette"),
    "scene": ("scene", "scenes", "broll", "b-roll", "background", "backgrounds", "location", "locations", "room", "environment"),
    "product": ("product", "products", "screenshot", "screenshots", "screen", "screens", "app", "apps", "ui", "merch", "cover", "coverart", "artwork"),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run creative-production-v1 from a brief file.")
    parser.add_argument("--brief-file", required=True, help="Path to a JSON creative brief file")
    parser.add_argument(
        "--asset-root",
        action="append",
        default=[],
        help="Optional asset-pack folder. Images are mapped into reference_assets; audio files become a local music library root. Repeatable.",
    )
    parser.add_argument(
        "--music-library-root",
        action="append",
        default=[],
        help="Path to a folder of music files (mp3/wav/etc.). Use descriptive filenames "
        "(e.g. cinematic_dark_premium_120bpm.wav) — mood/genre/energy/instruments are "
        "inferred from filename and folder. Repeatable.",
    )
    parser.add_argument("--max-attempts", type=int, default=2, help="Maximum bounded attempts")
    parser.add_argument("--budget-cap-usd", type=float, default=None, help="Optional production budget override")
    parser.add_argument(
        "--video-quality",
        choices=("budget", "standard", "premium"),
        default="budget",
        help="Video generation quality tier; default is budget for cheap smoke testing",
    )
    parser.add_argument(
        "--image-eval-provider",
        choices=("auto", "openai", "off", "structural"),
        default="auto",
        help="Image scoring mode for still-generation during the run",
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Validate brief, env, provider readiness, asset roots, and output paths without provider calls.",
    )
    return parser


def load_brief(path: str | Path) -> CreativeBrief:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("brief file must contain a JSON object")
    valid_fields = {field.name for field in fields(CreativeBrief)}
    unknown = sorted(str(key) for key in payload if key not in valid_fields)
    if unknown:
        raise RuntimeError(
            "brief file contains unsupported field(s): "
            + ", ".join(unknown)
            + ". Put CLI options like video_quality on the command line, not in brief.json."
        )
    return CreativeBrief(**payload)


def apply_reference_asset_roots_to_brief(brief: CreativeBrief, asset_roots: list[str] | tuple[str, ...]) -> CreativeBrief:
    roots = tuple(_existing_asset_roots(asset_roots))
    if not roots:
        return brief
    image_assets = _scan_reference_assets(roots)
    if not image_assets:
        return brief
    return _brief_with_reference_assets(brief, image_assets)


def apply_asset_roots_to_brief(brief: CreativeBrief, asset_roots: list[str] | tuple[str, ...]) -> CreativeBrief:
    roots = tuple(_existing_asset_roots(asset_roots))
    if not roots:
        return brief
    image_assets = _scan_reference_assets(roots)
    music_roots = _scan_music_roots(roots)
    if music_roots:
        _append_env_paths("SQUAD_TRACK_LIBRARY_ROOTS", music_roots)
    return _brief_with_reference_assets(brief, image_assets)


def _brief_with_reference_assets(brief: CreativeBrief, image_assets: list[dict]) -> CreativeBrief:
    if not image_assets:
        return brief

    existing_values = {
        str(item.get("value") or item.get("path") or item.get("asset_path") or "")
        for item in (brief.reference_assets or [])
        if isinstance(item, dict)
    }
    existing_image_paths = {str(path) for path in (brief.reference_image_paths or [])}
    additions = tuple(asset for asset in image_assets if asset["value"] not in existing_values)
    image_path_additions = tuple(asset["value"] for asset in additions if asset["value"] not in existing_image_paths)
    return replace(
        brief,
        reference_assets=[*(brief.reference_assets or []), *additions],
        reference_image_paths=[*(brief.reference_image_paths or []), *image_path_additions],
    )


def _existing_asset_roots(asset_roots: list[str] | tuple[str, ...]) -> list[Path]:
    roots: list[Path] = []
    for raw in asset_roots:
        root = Path(raw).expanduser().resolve()
        if not root.exists():
            raise RuntimeError(f"asset root does not exist: {root}")
        if not root.is_dir():
            raise RuntimeError(f"asset root must be a directory: {root}")
        roots.append(root)
    return roots


def _scan_reference_assets(roots: tuple[Path, ...]) -> list[dict]:
    assets: list[dict] = []
    seen: set[Path] = set()
    for root in roots:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in IMAGE_ASSET_EXTENSIONS:
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            role = _infer_reference_role(path=resolved, root=root)
            relative = str(resolved.relative_to(root))
            assets.append(
                {
                    "source_kind": "local_path",
                    "value": str(resolved),
                    "declared_role": role,
                    "label": resolved.stem.replace("_", " ").replace("-", " "),
                    "metadata": {
                        "asset_root": str(root),
                        "relative_path": relative,
                        "asset_pack_role": role,
                    },
                }
            )
    return assets


def _scan_music_roots(roots: tuple[Path, ...]) -> list[Path]:
    music_roots: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        candidate_dirs = [path for path in root.iterdir() if path.is_dir() and path.name.lower() in {"music", "audio", "tracks", "sound", "sounds"}]
        if not candidate_dirs and any(path.is_file() and path.suffix.lower() in AUDIO_ASSET_EXTENSIONS for path in root.rglob("*")):
            candidate_dirs.append(root)
        for candidate in candidate_dirs:
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            if any(path.is_file() and path.suffix.lower() in AUDIO_ASSET_EXTENSIONS for path in resolved.rglob("*")):
                seen.add(resolved)
                music_roots.append(resolved)
    return music_roots


def _infer_reference_role(*, path: Path, root: Path) -> str:
    relative_parts = tuple(part.lower() for part in path.relative_to(root).parts)
    haystack = " ".join(relative_parts + (path.stem.lower().replace("_", " ").replace("-", " "),))
    for role, keywords in REFERENCE_ROLE_KEYWORDS.items():
        if any(_keyword_in_asset_text(keyword, haystack) for keyword in keywords):
            return role
    return "unknown"


def _keyword_in_asset_text(keyword: str, text: str) -> bool:
    normalized = text.replace("_", " ").replace("-", " ")
    keyword = keyword.replace("_", " ").replace("-", " ")
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", normalized))


def _append_env_paths(name: str, paths: list[Path]) -> None:
    existing = [part for part in os.getenv(name, "").split(os.pathsep) if part]
    merged = [*existing]
    for path in paths:
        value = str(path)
        if value not in merged:
            merged.append(value)
    os.environ[name] = os.pathsep.join(merged)


def summarize_error(exc: BaseException, *, brief_file: str | Path) -> dict:
    payload = summarize_director_error(exc, brief_file=brief_file)
    messages = _collect_error_messages(exc)
    joined = "\n".join(messages).lower()
    failed_subsystem = getattr(exc, "failed_subsystem", None) or _classify_failed_subsystem(joined)
    provider = getattr(exc, "provider", None) or payload.get("provider")
    retryable = bool(payload.get("retryable"))
    error_code = payload.get("error_code") or "runtime_failure"
    follow_up = payload.get("follow_up") or "inspect the stored manifest and upstream provider state before retrying"

    if "billing_hard_limit_reached" in joined or "billing hard limit" in joined:
        provider = "openai"
        failed_subsystem = "image_generation"
        error_code = "openai_billing_limit"
        retryable = False
        follow_up = "raise the OpenAI billing limit or route image generation to a funded provider, then rerun"

    if "wavespeed" in joined:
        provider = "wavespeed"
        failed_subsystem = "video_generation"
        error_code = "wavespeed_provider_failure"
        follow_up = "check SQUAD_WAVESPEED_API_KEY and WaveSpeed provider status, then rerun"
        if any(term in joined for term in ("401", "403", "unauthorized", "forbidden")):
            error_code = "wavespeed_auth_failure"
            follow_up = "refresh SQUAD_WAVESPEED_API_KEY or account access, then rerun"
        elif "429" in joined or "rate limit" in joined:
            error_code = "wavespeed_rate_limit"
            retryable = True
            follow_up = "wait for provider limits to clear, then rerun"
        elif "timeout" in joined or "timed out" in joined:
            error_code = "wavespeed_timeout"
            retryable = True
            follow_up = "retry after the transient upstream timeout clears"

    if "preflight" in joined or "missing required env" in joined or "not found on path" in joined:
        failed_subsystem = "preflight"
        error_code = "preflight_failed"
        provider = getattr(exc, "provider", None)
        follow_up = "fix the missing preflight requirement, then rerun"

    if "asset root" in joined:
        failed_subsystem = "asset_pack"
        error_code = "asset_pack_failed"
        provider = None
        retryable = False
        follow_up = "point --asset-root at an existing asset-pack directory, then rerun"

    if failed_subsystem == "provider_budget" or "provider budget check failed" in joined:
        failed_subsystem = "provider_budget"
        error_code = "provider_budget_failed"
        provider = getattr(exc, "provider", None) or provider
        retryable = False
        follow_up = "top up the provider balance or lower the planned run cost before retrying"

    payload.update(
        {
            "error_code": error_code,
            "failed_subsystem": failed_subsystem,
            "provider": provider,
            "retryable": retryable,
            "follow_up": follow_up,
        }
    )
    details = getattr(exc, "details", None)
    if details is not None:
        payload["details"] = details
    return payload


def summarize_system_exit(exc: SystemExit, *, brief_file: str | Path) -> dict:
    code = exc.code
    message = str(code) if code not in (None, 0) else "SystemExit"
    payload = summarize_error(RuntimeError(message), brief_file=brief_file)
    payload.update(
        {
            "error_code": "system_exit",
            "failed_subsystem": "cli",
            "provider": None,
            "retryable": False,
            "message": message,
            "exit_code": code if isinstance(code, int) else 1,
            "follow_up": "fix the CLI invocation or runtime preflight failure, then rerun",
        }
    )
    return payload


def _collect_error_messages(exc: BaseException) -> list[str]:
    messages: list[str] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message = str(current).strip()
        if message:
            messages.append(message)
        current = current.__cause__ or current.__context__
    return messages


def _classify_failed_subsystem(joined_message: str) -> str:
    if "preflight" in joined_message or "missing required env" in joined_message:
        return "preflight"
    if "asset root" in joined_message:
        return "asset_pack"
    if "billing_hard_limit_reached" in joined_message or "billing hard limit" in joined_message:
        return "image_generation"
    if "image factory run" in joined_message or "product image" in joined_message or "openai image client" in joined_message:
        return "image_generation"
    if "video generation failed" in joined_message or "image_to_video" in joined_message or "video_adapter" in joined_message:
        return "video_generation"
    if "ffmpeg" in joined_message or "assemble" in joined_message or "concatenate" in joined_message:
        return "assembly"
    if "ffprobe" in joined_message or "media probe" in joined_message or "stream" in joined_message:
        return "media_probe"
    if "voiceover" in joined_message or "tts" in joined_message:
        return "voiceover"
    return "runtime"


def build_preflight_summary(
    *,
    brief: CreativeBrief,
    brief_file: str | Path,
    asset_roots: list[str] | tuple[str, ...],
    budget_cap_usd: float | None,
    video_quality: str,
    image_eval_provider: str,
) -> dict:
    settings = load_settings()
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    effective_budget = float(budget_cap_usd if budget_cap_usd is not None else brief.max_cost_usd)
    validation_errors = brief.validate()
    for error in validation_errors:
        blockers.append({"code": "invalid_brief", "message": error})

    output_root = Path(".outputs/creative-production")
    try:
        output_root.mkdir(parents=True, exist_ok=True)
        probe = output_root / ".preflight-write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        output_writable = True
    except Exception as exc:
        output_writable = False
        blockers.append({"code": "output_not_writable", "message": f"{output_root} is not writable: {exc}"})

    if not settings.openai_api_key:
        blockers.append(
            {
                "code": "missing_openai_key",
                "message": "OPENAI_API_KEY or SQUAD_OPENAI_API_KEY is required for director decisions and image generation",
            }
        )
    if brief.output_type == "full_production" and not (settings.wavespeed_api_key or settings.fal_api_key):
        blockers.append(
            {
                "code": "missing_video_provider",
                "message": "SQUAD_WAVESPEED_API_KEY or SQUAD_FAL_API_KEY is required for full_production video generation",
            }
        )
    if image_eval_provider == "openai" and not settings.openai_api_key:
        blockers.append(
            {
                "code": "missing_image_eval_key",
                "message": "openai image eval requires OPENAI_API_KEY or SQUAD_OPENAI_API_KEY",
            }
        )
    if video_quality in {"standard", "premium"}:
        warnings.append(
            {
                "code": "non_budget_quality",
                "message": f"video_quality={video_quality}; outside agents should prove direction on budget first",
            }
        )
    if effective_budget > 1.0 and video_quality == "budget":
        warnings.append(
            {
                "code": "budget_cap_above_smoke_default",
                "message": f"budget_cap_usd={effective_budget:.2f}; confirm the operator intended this spend cap",
            }
        )

    recipe = recipe_recommendation_to_payload(recommend_recipe(brief))
    return {
        "mode": "creative_production_preflight",
        "ok": not blockers,
        "brief_file": str(brief_file),
        "brief": {
            "output_type": brief.output_type,
            "platform": brief.platform,
            "product_type": brief.product_type,
            "cinema_mode": brief.cinema_mode,
            "has_character_lock": bool(brief.character_lock),
            "has_world_profile": bool(brief.world_profile),
            "reference_asset_count": len(brief.reference_assets or []),
            "reference_image_count": len(brief.reference_image_paths or []),
        },
        "run_options": {
            "video_quality": video_quality,
            "image_eval_provider": image_eval_provider,
            "max_spend_cap_usd": round(effective_budget, 4),
            "asset_roots": [str(Path(root).expanduser()) for root in asset_roots],
        },
        "providers": {
            "openai_ready": bool(settings.openai_api_key),
            "wavespeed_video_ready": bool(settings.wavespeed_api_key),
            "fal_video_ready": bool(settings.fal_api_key),
            "tts_ready": bool(settings.fish_tts_api_key or settings.inworld_tts_api_key or settings.openai_api_key),
            "heygen_ready": bool(settings.heygen_api_key and settings.heygen_avatar_id and settings.heygen_voice_id),
        },
        "paths": {
            "creative_output_root": str(output_root),
            "creative_output_root_writable": output_writable,
            "image_factory_output_root": settings.image_factory_output_root,
        },
        "recommended_recipe": recipe,
        "blockers": blockers,
        "warnings": warnings,
    }


def build_runtime(*, image_eval_provider: str = "auto") -> CreativeProductionGraph:
    director_tools, decision_model = build_director_runtime(image_eval_provider=image_eval_provider)
    settings = load_settings()
    if not settings.fal_api_key and not settings.wavespeed_api_key:
        raise RuntimeError("preflight failed: SQUAD_WAVESPEED_API_KEY or SQUAD_FAL_API_KEY is required for creative-production video execution")

    director_graph = CreativeDirectorGraph(tools=director_tools, decision_model=decision_model)
    fal_backend = None
    if settings.fal_api_key:
        video_adapter = VideoGenerationAdapter(
            fal_api_key=settings.fal_api_key,
            transport=HttpFalVideoTransport(
                api_key=settings.fal_api_key,
                timeout_sec=settings.fal_timeout_sec,
            ),
        )
        fal_backend = FalKlingVideoBackend(video_adapter)
    wavespeed_backend = None
    if settings.wavespeed_api_key:
        wavespeed_backend = WaveSpeedVideoBackend(
            WaveSpeedVideoAdapter(
                api_key=settings.wavespeed_api_key,
                api_base_url=settings.wavespeed_api_base_url,
                timeout_sec=settings.wavespeed_timeout_sec,
                poll_interval_sec=settings.wavespeed_poll_interval_sec,
            )
        )
    video_backend_router = VideoBackendRouter(
        kling_backend=fal_backend,
        runpod_ltx_backend=None,
        wavespeed_backend=wavespeed_backend,
    )
    track_library_adapter = build_track_library_adapter_from_env()
    sfx_library_adapter = build_sfx_library_adapter_from_env()
    visual_polish_config = build_visual_polish_config_from_env()
    render_adapter = build_render_adapter_from_env()
    caption_alignment_adapter = build_caption_alignment_adapter_from_env()
    tts_adapter = _build_tts_adapter(
        fish_tts_api_key=settings.fish_tts_api_key,
        fish_tts_reference_id=settings.fish_tts_reference_id,
        fish_tts_model_id=settings.fish_tts_model_id,
        inworld_tts_api_key=settings.inworld_tts_api_key,
        inworld_tts_voice_id=settings.inworld_tts_voice_id,
        openai_api_key=settings.openai_api_key,
    )
    tools = CreativeProductionTools(
        director_graph=director_graph,
        video_adapter=video_backend_router,
        assembly_adapter=FfmpegAssemblyAdapter(
            ffmpeg_binary=os.getenv("SQUAD_FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"
        ),
        plan_reviewer=OpenAIResponsesProductionPlanReviewer(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        ),
        tts_adapter=tts_adapter,
        track_library_adapter=track_library_adapter,
        sfx_library_adapter=sfx_library_adapter,
        visual_polish_upscale_adapter=visual_polish_config["upscale_adapter"],
        visual_polish_interpolation_adapter=visual_polish_config["interpolation_adapter"],
        visual_polish_target_height=visual_polish_config["target_height"],
        visual_polish_target_fps=visual_polish_config["target_fps"],
        audio_mix_adapter=build_audio_mix_adapter_from_env(
            default_enabled=track_library_adapter is not None
        ),
        post_pass_adapter=build_caption_burn_in_adapter_from_env(),
        post_pass_normalizer=build_loudness_normalizer_from_env(),
        post_pass_probe_adapter=build_media_probe_adapter_from_env(default_enabled=True),
        caption_alignment_adapter=caption_alignment_adapter,
        narrative_script_planner=(
            OpenAIResponsesFacelessStoryWriter(
                api_key=settings.openai_api_key,
                model=settings.openai_story_writer_model,
                base_url=settings.openai_base_url,
            )
            if settings.openai_api_key
            else None
        ),
        shotlist_director=(
            OpenAIResponsesShotlistDirector(
                api_key=settings.openai_api_key,
                model=getattr(settings, "openai_shotlist_director_model", settings.openai_story_writer_model),
                base_url=settings.openai_base_url,
            )
            if settings.openai_api_key
            else None
        ),
        sequence_treatment_director=(
            OpenAIResponsesSequenceTreatmentDirector(
                api_key=settings.openai_api_key,
                model=getattr(
                    settings,
                    "openai_sequence_treatment_director_model",
                    getattr(settings, "openai_shotlist_director_model", settings.openai_story_writer_model),
                ),
                base_url=settings.openai_base_url,
            )
            if settings.openai_api_key
            else None
        ),
        ugc_presenter_adapter=(
            HeyGenUgcAvatarAdapter(
                api_key=settings.heygen_api_key,
                timeout_sec=getattr(settings, "heygen_timeout_sec", 900),
                poll_interval_sec=getattr(settings, "heygen_poll_interval_sec", 5.0),
                default_avatar_id=getattr(settings, "heygen_avatar_id", None),
                default_voice_id=getattr(settings, "heygen_voice_id", None),
                persona_map=getattr(settings, "heygen_persona_map", None),
            )
            if (
                getattr(settings, "heygen_api_key", None)
                and getattr(settings, "heygen_avatar_id", None)
                and getattr(settings, "heygen_voice_id", None)
            )
            else None
        ),
        render_adapter=render_adapter,
        preferred_renderer=os.getenv("SQUAD_RENDERER") or "auto",
        ugc_heygen_audio_source=settings.ugc_heygen_audio_source,
    )
    return CreativeProductionGraph(tools=tools)


def preflight_fal_storage(*, api_key: str, timeout_sec: int) -> None:
    """Fail fast when image-to-video cannot upload stills to Fal storage."""
    _ = timeout_sec
    try:
        import fal_client
    except ImportError as exc:  # pragma: no cover - dependency issue
        raise RuntimeError("fal-client is required for Fal video preflight") from exc

    with NamedTemporaryFile(suffix=".txt") as probe:
        probe.write(b"squad-fal-storage-preflight")
        probe.flush()
        try:
            import os

            os.environ["FAL_KEY"] = api_key
            fal_client.upload_file(probe.name)
        except Exception as exc:
            raise RuntimeError(f"Fal video storage preflight failed: {exc}") from exc


def should_preflight_fal_storage(
    brief: CreativeBrief,
    *,
    budget_cap_usd: float | None,
    wavespeed_available: bool = False,
) -> bool:
    if wavespeed_available:
        return False
    if brief.output_type != "full_production":
        return False
    effective_budget = float(budget_cap_usd if budget_cap_usd is not None else brief.max_cost_usd or 0.0)
    return effective_budget >= 0.10


def _build_tts_adapter(
    *,
    fish_tts_api_key: str | None,
    fish_tts_reference_id: str | None,
    fish_tts_model_id: str,
    inworld_tts_api_key: str | None,
    inworld_tts_voice_id: str = "Ashley",
    openai_api_key: str | None = None,
):
    fish = (
        FishTTSAdapter(
            api_key=fish_tts_api_key,
            reference_id=fish_tts_reference_id,
            default_model_id=fish_tts_model_id,
        )
        if fish_tts_api_key
        else None
    )
    inworld = (
        InworldTTSAdapter(api_key=inworld_tts_api_key, default_voice_id=inworld_tts_voice_id)
        if inworld_tts_api_key
        else None
    )
    openai = OpenAITTSAdapter(api_key=openai_api_key) if openai_api_key else None
    adapters = [adapter for adapter in (fish, inworld, openai) if adapter is not None]
    if not adapters:
        return None
    selected = adapters[-1]
    for adapter in reversed(adapters[:-1]):
        selected = FallbackTTSAdapter(primary=adapter, fallback=selected)
    return selected


def summarize_result(result) -> dict:
    return {
        "run_id": result.run_id,
        "final_status": str(result.final_status),
        "recommended_recipe": recipe_recommendation_to_payload(recommend_recipe(result.brief_input.brief)),
        "manifest_path": str(result.manifest_path) if result.manifest_path else None,
        "total_spend_usd": result.total_spend_usd,
        "selected_still_id": result.selected_still.candidate_id if result.selected_still else None,
        "selected_still_score": result.selected_still.score if result.selected_still else None,
        "video_attempt_count": len(result.video_attempt_history),
        "video_generation_error": result.video_generation_error,
        "video_clip_ids": [clip.clip_id for clip in result.video_attempt_history],
        "video_attempts": [
            {
                "clip_id": clip.clip_id,
                "asset_path": str(clip.asset_path) if clip.asset_path else None,
                "model_id": clip.model_id,
                "cost_usd": clip.cost_usd,
                "provider_request_id": clip.provider_request_id,
            }
            for clip in result.video_attempt_history
        ],
        "final_asset_path": str(result.final_assembly.asset_path) if result.final_assembly else None,
        "final_assembly_method": result.final_assembly.assembly_method if result.final_assembly else None,
        "final_audio_asset_path": (
            str(result.final_assembly.audio_asset_path)
            if result.final_assembly and result.final_assembly.audio_asset_path
            else None
        ),
        "motion_plan": (
            {
                "motion_prompt": result.motion_plan.motion_prompt,
                "action_description": result.motion_plan.action_description,
                "camera_direction": result.motion_plan.camera_direction,
                "visual_ethos": result.motion_plan.visual_ethos,
                "duration_s": result.motion_plan.duration_s,
                "cinema_controls": (
                    {
                        "camera_move": result.motion_plan.cinema_controls.camera_move,
                        "lens_feel": result.motion_plan.cinema_controls.lens_feel,
                        "depth_of_field": result.motion_plan.cinema_controls.depth_of_field,
                        "lighting_style": result.motion_plan.cinema_controls.lighting_style,
                        "motion_intensity": result.motion_plan.cinema_controls.motion_intensity,
                        "framing": result.motion_plan.cinema_controls.framing,
                    }
                    if result.motion_plan.cinema_controls
                    else None
                ),
                "shot_plan": (
                    {
                        "opening_frame": result.motion_plan.shot_plan.opening_frame,
                        "camera_move": result.motion_plan.shot_plan.camera_move,
                        "subject_action": result.motion_plan.shot_plan.subject_action,
                        "environment_motion": result.motion_plan.shot_plan.environment_motion,
                        "ending_frame": result.motion_plan.shot_plan.ending_frame,
                        "pacing": result.motion_plan.shot_plan.pacing,
                        "preservation_constraints": result.motion_plan.shot_plan.preservation_constraints,
                        "negative_constraints": result.motion_plan.shot_plan.negative_constraints,
                    }
                    if result.motion_plan.shot_plan
                    else None
                ),
            }
            if result.motion_plan
            else None
        ),
        "plan_review": (
            {
                "verdict": result.plan_review.verdict,
                "rationale": result.plan_review.rationale,
                "confidence": result.plan_review.confidence,
            }
            if result.plan_review
            else None
        ),
        "voiceover_plan": (
            {
                "enabled": result.voiceover_plan.enabled,
                "template_id": result.voiceover_plan.template_id,
                "voice_direction": result.voiceover_plan.voice_direction,
                "script": result.voiceover_plan.script,
                "rationale": result.voiceover_plan.rationale,
            }
            if result.voiceover_plan
            else None
        ),
        "voice_asset": (
            {
                "asset_path": str(result.voice_asset.asset_path),
                "provider": result.voice_asset.provider,
                "model_id": result.voice_asset.model_id,
                "voice_id": result.voice_asset.voice_id,
                "mime_type": result.voice_asset.mime_type,
                "processed_characters": result.voice_asset.processed_characters,
                "metadata": result.voice_asset.metadata,
            }
            if result.voice_asset
            else None
        ),
        "voiceover_error": result.voiceover_error,
        "audio_mix_plan": (
            {
                "audio_mode": result.audio_mix_plan.audio_mode,
                "music_role": result.audio_mix_plan.music_role,
                "selected_track_id": (
                    result.audio_mix_plan.selected_music_track.track_id
                    if result.audio_mix_plan.selected_music_track
                    else None
                ),
                "selected_track_title": (
                    result.audio_mix_plan.selected_music_track.title
                    if result.audio_mix_plan.selected_music_track
                    else None
                ),
                "voice_ducking_enabled": result.audio_mix_plan.voice_ducking_enabled,
                "music_gain_db": result.audio_mix_plan.music_gain_db,
                "loudness_target_lufs": result.audio_mix_plan.loudness_target_lufs,
            }
            if result.audio_mix_plan
            else None
        ),
        "has_review_packet": bool(result.human_review_packet),
        "review_path": str(result.human_review_packet.review_path) if result.human_review_packet and result.human_review_packet.review_path else None,
        "approval_payload": result.human_review_packet.approval_payload if result.human_review_packet else None,
    }


def main(argv: list[str] | None = None, *, graph=None) -> int:
    parser = build_parser()
    brief_file: str | Path = "unknown"
    try:
        args = parser.parse_args(argv)
        brief_file = args.brief_file
        brief = load_brief(args.brief_file)
        brief = apply_asset_roots_to_brief(brief, args.asset_root)
        if args.music_library_root:
            music_roots = _existing_asset_roots(args.music_library_root)
            _append_env_paths("SQUAD_TRACK_LIBRARY_ROOTS", music_roots)
        if args.preflight_only:
            summary = build_preflight_summary(
                brief=brief,
                brief_file=args.brief_file,
                asset_roots=args.asset_root,
                budget_cap_usd=args.budget_cap_usd,
                video_quality=args.video_quality,
                image_eval_provider=args.image_eval_provider,
            )
            print(json.dumps(summary, indent=2))
            return 0 if summary["ok"] else 1
    except SystemExit as exc:
        print(json.dumps(summarize_system_exit(exc, brief_file=brief_file), indent=2))
        return exc.code if isinstance(exc.code, int) and exc.code else 1
    except Exception as exc:
        print(json.dumps(summarize_error(exc, brief_file=brief_file), indent=2))
        return 1
    if graph is None:
        try:
            settings = load_settings()
            if should_preflight_fal_storage(
                brief,
                budget_cap_usd=args.budget_cap_usd,
                wavespeed_available=bool(settings.wavespeed_api_key),
            ):
                if not settings.fal_api_key:
                    print(
                        json.dumps(
                            summarize_error(
                                RuntimeError("SQUAD_FAL_API_KEY is required for video execution"),
                                brief_file=args.brief_file,
                            ),
                            indent=2,
                        )
                    )
                    return 1
                preflight_fal_storage(api_key=settings.fal_api_key, timeout_sec=settings.fal_timeout_sec)
            graph = build_runtime(image_eval_provider=args.image_eval_provider)
        except SystemExit as exc:
            print(json.dumps(summarize_system_exit(exc, brief_file=args.brief_file), indent=2))
            return exc.code if isinstance(exc.code, int) and exc.code else 1
        except Exception as exc:
            print(json.dumps(summarize_error(exc, brief_file=args.brief_file), indent=2))
            return 1
    try:
        result = graph.run(
            CreativeProductionInput(
                brief=brief,
                budget_cap_usd=args.budget_cap_usd,
                max_attempts=args.max_attempts,
                video_quality=args.video_quality,
            )
        )
    except SystemExit as exc:
        print(json.dumps(summarize_system_exit(exc, brief_file=args.brief_file), indent=2))
        return exc.code if isinstance(exc.code, int) and exc.code else 1
    except Exception as exc:
        print(json.dumps(summarize_error(exc, brief_file=args.brief_file), indent=2))
        return 1
    print(json.dumps(summarize_result(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
