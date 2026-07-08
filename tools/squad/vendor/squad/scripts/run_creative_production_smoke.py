#!/usr/bin/env python3
"""Cheap live smoke test for creative-production-v1."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import shlex
import struct
import subprocess
import sys
import zlib
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CreativeProductionInput, MusicTrackQuery, ProductionFinalStatus
from creative.production.output_qa import run_free_smoke_media_qa
from creative.production.runtime import build_track_library_adapter_from_env
from scripts.check_provider_budget import (
    ProviderBudgetError,
    check_wavespeed_smoke_budget,
    estimate_wavespeed_smoke_budget,
    load_env_file,
)
from scripts.run_creative_production import build_runtime, summarize_error


DEFAULT_RUN_ID = "creative-production-golden-path"
DEFAULT_BUDGET_CAP_USD = 0.9
DEFAULT_SCENARIO = "streetwear-drop"
SMOKE_SCENARIOS = (
    DEFAULT_SCENARIO,
    "ugc-founder",
    "cinematic-product",
    "faceless-youtube",
)


class SmokeRunFailure(RuntimeError):
    def __init__(
        self,
        failed_subsystem: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        provider: str | None = None,
    ) -> None:
        super().__init__(message)
        self.failed_subsystem = failed_subsystem
        self.details = details or {}
        self.provider = provider


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a cheap live creative-production smoke test.")
    parser.add_argument(
        "--reference-image",
        default=None,
        help="Optional local product reference image. Defaults to a generated black tee reference.",
    )
    parser.add_argument("--budget-cap-usd", type=float, default=DEFAULT_BUDGET_CAP_USD, help="Hard production budget cap")
    parser.add_argument("--run-id", default=DEFAULT_RUN_ID, help="Stable run id for deterministic smoke output")
    parser.add_argument(
        "--scenario",
        choices=SMOKE_SCENARIOS,
        default=DEFAULT_SCENARIO,
        help="Locked brief scenario to run without changing the production path",
    )
    parser.add_argument(
        "--music-file",
        default=None,
        help="Optional known-good music bed. If omitted, SQUAD_TRACK_LIBRARY_* must already be configured.",
    )
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg binary for final assembly")
    parser.add_argument("--ffprobe-bin", default="ffprobe", help="ffprobe binary for stream verification")
    parser.add_argument("--tesseract-bin", default="tesseract", help="Optional local OCR binary for free visual QA")
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Check local smoke readiness without calling image/video/voice providers.",
    )
    return parser


def require_smoke_env(*, scenario: str = DEFAULT_SCENARIO) -> dict[str, Any]:
    missing: list[str] = []
    if not (os.getenv("SQUAD_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")):
        missing.append("SQUAD_OPENAI_API_KEY or OPENAI_API_KEY")
    if not (os.getenv("SQUAD_WAVESPEED_API_KEY") or os.getenv("WAVESPEED_API_KEY")):
        missing.append("SQUAD_WAVESPEED_API_KEY or WAVESPEED_API_KEY")
    if missing:
        raise SmokeRunFailure(
            "preflight",
            f"preflight failed: missing required env keys: {', '.join(missing)}",
            details={"missing_env_keys": missing},
        )
    if _scenario_requires_caption_alignment(scenario):
        _require_caption_alignment_env(scenario=scenario)
    os.environ["SQUAD_IMAGE_FACTORY_MAX_REGENERATION_ATTEMPTS"] = "0"
    os.environ["SQUAD_IMAGE_BACKGROUND_REMOVAL_PROVIDER"] = "copy"
    os.environ["SQUAD_ENABLE_POST_PROBE"] = "1"
    return {
        "openai_key": "present",
        "wavespeed_key": "present",
        "image_regeneration_attempts": 0,
        "background_removal_provider": "copy",
        "post_probe": "enabled",
        "caption_alignment": "enabled" if os.getenv("SQUAD_CAPTION_ALIGN_COMMAND") else "not_configured",
    }


def build_smoke_brief(*, reference_image: Path, max_cost_usd: float, scenario: str = DEFAULT_SCENARIO) -> CreativeBrief:
    base = {
        "platform": "tiktok",
        "product_type": "merch",
        "reference_image_paths": [str(reference_image)],
        "max_cost_usd": max_cost_usd,
        "output_type": "full_production",
        "variant_count": 1,
    }
    if scenario == "ugc-founder":
        return CreativeBrief(
            **base,
            product_description="Soft black daily-wear tee for creators who film, edit, and ship late at night",
            campaign_goal=(
                "Create a cheap smoke test: a 3-clip 9:16 UGC-style TikTok ad with voiceover narration. "
                "Clip 1 feels like a founder holding the shirt on phone camera. Clip 2 shows why the fit "
                "and fabric matter. Clip 3 gives a direct shop-now CTA."
            ),
            mood_keywords=["ugc", "real", "casual", "premium"],
            style_family_suggestion="UGC",
            copy_for_overlay="MADE FOR LATE NIGHTS",
            voiceover_script="I wanted a shirt that felt easy on camera, but still looked finished when I walked out the door.",
            cta_text="Try it today",
            aesthetic_notes=(
                "UGC product ad with real phone-camera energy. Keep motion human and simple; "
                "no surreal effects."
            ),
        )
    if scenario == "cinematic-product":
        return CreativeBrief(
            **base,
            product_description="Black heavyweight graphic tee staged like a premium capsule product",
            campaign_goal=(
                "Create a cheap smoke test: a 3-clip 9:16 cinematic TikTok product ad with voiceover narration. "
                "Clip 1 opens with a moody hero reveal. Clip 2 moves across texture and print detail. "
                "Clip 3 ends with a clean limited-drop CTA."
            ),
            mood_keywords=["cinematic", "premium", "dark", "luxury"],
            style_family_suggestion="PREMIUM",
            copy_for_overlay="CAPSULE DROP",
            voiceover_script="A quiet piece with weight, shape, and a little pressure in the details.",
            cta_text="Limited drop",
            aesthetic_notes=(
                "Cinematic product ad with controlled product motion, rich shadows, and clean closeups; "
                "no surreal effects."
            ),
        )
    if scenario == "faceless-youtube":
        return CreativeBrief(
            **{
                **base,
                "platform": "youtube",
                "product_type": "general",
                "reference_image_paths": [str(reference_image)],
            },
            product_description="mini documentary about why abandoned malls feel haunted",
            campaign_goal=(
                "Create a cheap smoke test: a no-face YouTube narrative short with 5 visual scenes, "
                "16:9 widescreen framing, full voiceover narration, subtle captions, and a low eerie music bed. "
                "Scene 1 hooks with an empty mall corridor. Scene 2 gives context: these spaces were built "
                "to feel alive. Scene 3 explains how lights, symmetry, and silence create unease. "
                "Scene 4 shows proof through shuttered storefronts, dust, and abandoned signage. "
                "Scene 5 ends with the takeaway: places designed for crowds feel strange when the crowd disappears."
            ),
            mood_keywords=["educational", "cinematic", "eerie", "curious"],
            style_family_suggestion="EDITORIAL",
            copy_for_overlay="WHY EMPTY MALLS FEEL HAUNTED",
            voiceover_script=(
                "An abandoned mall feels haunted because it was never designed to be quiet. "
                "Every hallway, skylight, and storefront was built for crowds, music, and movement. "
                "When those signals remain but the people disappear, your brain reads the space as unfinished. "
                "The architecture is still waiting for a crowd that is not coming back."
            ),
            cta_text="Watch the full story",
            aesthetic_notes=(
                "No-face YouTube documentary style: empty corridors, dead escalators, dust in skylight, "
                "abandoned signage, slow investigative camera, no product, no clothing ad, no presenter, no lip sync."
            ),
        )
    return CreativeBrief(
        **base,
        product_description="Black heavyweight graphic tee with a small orange chest graphic",
        campaign_goal=(
            "Create a cheap smoke test: a 3-clip 9:16 realistic TikTok product ad with "
            "voiceover narration. Clip 1 hooks with the shirt on a real model in a city "
            "night scene. Clip 2 shows fabric weight and graphic detail. Clip 3 lands the CTA."
        ),
        mood_keywords=["premium", "realistic", "streetwear"],
        style_family_suggestion="PREMIUM",
        copy_for_overlay="NIGHT SHIFT DROP",
        voiceover_script="Built heavy. Made for late nights. The Night Shift Drop is live now.",
        cta_text="Shop now",
        aesthetic_notes=(
            "Realistic product ad with slow controlled motion and clean product detail; no surreal effects."
        ),
    )


def deterministic_output_dir(run_id: str) -> Path:
    return Path(".outputs/creative-production") / run_id


def ensure_default_reference_image(output_dir: Path, *, scenario: str = DEFAULT_SCENARIO) -> Path:
    if scenario == "faceless-youtube":
        reference_path = output_dir / "inputs" / "empty-mall-reference.png"
        if reference_path.exists():
            return reference_path
        reference_path.parent.mkdir(parents=True, exist_ok=True)
        reference_path.write_bytes(_build_empty_mall_png(width=768, height=432))
        return reference_path

    reference_path = output_dir / "inputs" / "black-tee-reference.png"
    if reference_path.exists():
        return reference_path
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference_path.write_bytes(_build_black_tee_png(width=512, height=768))
    return reference_path


def _build_black_tee_png(*, width: int, height: int) -> bytes:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            color = (232, 232, 226)
            torso = 146 <= x <= 366 and 190 <= y <= 640
            left_sleeve = 74 <= x <= 156 and 218 <= y <= 392 and (x + y) > 300
            right_sleeve = 356 <= x <= 438 and 218 <= y <= 392 and (y - x) > -210
            neck = 218 <= x <= 294 and 168 <= y <= 224
            if torso or left_sleeve or right_sleeve:
                color = (17, 18, 18)
            if neck and y < 214:
                color = (232, 232, 226)
            if 220 <= x <= 292 and 320 <= y <= 370:
                color = (232, 93, 38)
            if 232 <= x <= 280 and 338 <= y <= 350:
                color = (248, 237, 210)
            if 150 <= x <= 366 and y == 640:
                color = (8, 8, 8)
            raw.extend(color)
    return _png_bytes(width=width, height=height, raw_scanlines=bytes(raw))


def _build_empty_mall_png(*, width: int, height: int) -> bytes:
    raw = bytearray()
    center_x = width / 2
    horizon_y = height * 0.42
    for y in range(height):
        raw.append(0)
        for x in range(width):
            depth = y / max(1, height - 1)
            distance_from_center = abs(x - center_x) / center_x
            color = (
                int(32 + 28 * depth),
                int(34 + 24 * depth),
                int(36 + 20 * depth),
            )
            ceiling = y < horizon_y and distance_from_center < (1.0 - depth * 0.45)
            floor = y > horizon_y and distance_from_center < (0.35 + depth * 0.55)
            storefront = y > height * 0.28 and y < height * 0.82 and distance_from_center > 0.42
            skylight = y < height * 0.18 and abs(x - center_x) < width * 0.08
            if ceiling:
                color = (46, 47, 48)
            if floor:
                shine = 18 if (x + y) % 37 < 5 else 0
                color = (55 + shine, 54 + shine, 50 + shine)
            if storefront:
                stripe = 18 if int(x / 28) % 2 == 0 else 0
                color = (22 + stripe, 24 + stripe, 26 + stripe)
            if skylight:
                color = (92, 100, 104)
            if abs(x - center_x) < 2 and y > horizon_y:
                color = (80, 78, 70)
            raw.extend(color)
    return _png_bytes(width=width, height=height, raw_scanlines=bytes(raw))


def _png_bytes(*, width: int, height: int, raw_scanlines: bytes) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw_scanlines)) + chunk(b"IEND", b"")


def _resolve_binary(binary: str) -> str | None:
    path = Path(binary)
    if path.parent != Path("."):
        return str(path) if path.is_file() and os.access(path, os.X_OK) else None
    return shutil.which(binary)


def _env_preflight_issues() -> list[dict[str, Any]]:
    missing: list[str] = []
    if not (os.getenv("SQUAD_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")):
        missing.append("SQUAD_OPENAI_API_KEY or OPENAI_API_KEY")
    if not (os.getenv("SQUAD_WAVESPEED_API_KEY") or os.getenv("WAVESPEED_API_KEY")):
        missing.append("SQUAD_WAVESPEED_API_KEY or WAVESPEED_API_KEY")
    if not missing:
        return []
    return [{"code": "missing_env", "message": f"missing required env keys: {', '.join(missing)}", "missing": missing}]


def _reference_image_issue(reference_image: Path) -> dict[str, Any] | None:
    if not reference_image.exists():
        return {"code": "missing_reference_image", "message": f"reference image not found: {reference_image}"}
    if not reference_image.is_file():
        return {"code": "invalid_reference_image", "message": f"reference image is not a file: {reference_image}"}
    header = reference_image.read_bytes()[:16]
    is_png = header.startswith(b"\x89PNG\r\n\x1a\n")
    is_jpeg = header.startswith(b"\xff\xd8\xff")
    is_webp = len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    if not (is_png or is_jpeg or is_webp):
        return {"code": "invalid_reference_image", "message": f"reference image is not PNG/JPEG/WEBP: {reference_image}"}
    return None


def _track_library_issue() -> dict[str, Any] | None:
    has_library = any(
        os.getenv(key)
        for key in (
            "SQUAD_TRACK_LIBRARY_MANIFEST",
            "SQUAD_TRACK_LIBRARY_ROOT",
            "SQUAD_TRACK_LIBRARY_MANIFESTS",
            "SQUAD_TRACK_LIBRARY_ROOTS",
        )
    )
    if not has_library:
        return {
            "code": "missing_music_source",
            "message": "provide --music-file or configure SQUAD_TRACK_LIBRARY_* for the locked smoke",
        }
    try:
        library = build_track_library_adapter_from_env()
        query = MusicTrackQuery(
            mood=("cinematic", "premium"),
            energy="low",
            genre=("cinematic",),
            duration_min_s=5,
            duration_max_s=120,
        )
        tracks = library.search_tracks(query, limit=1) if library is not None else []
    except Exception as exc:
        return {"code": "invalid_track_library", "message": f"SQUAD_TRACK_LIBRARY_* is not loadable: {exc}"}
    if not tracks:
        return {"code": "empty_track_library", "message": "SQUAD_TRACK_LIBRARY_* did not return a usable music track"}
    os.environ["SQUAD_ENABLE_AUDIO_MIX"] = "1"
    return None


def _caption_alignment_issue(scenario: str) -> dict[str, Any] | None:
    if not _scenario_requires_caption_alignment(scenario):
        return None
    command = os.getenv("SQUAD_CAPTION_ALIGN_COMMAND")
    if not command:
        return {
            "code": "missing_caption_alignment",
            "message": "configure SQUAD_CAPTION_ALIGN_COMMAND for voiceover caption smoke QA",
        }
    try:
        parts = shlex.split(command)
    except ValueError as exc:
        return {"code": "invalid_caption_alignment_command", "message": f"SQUAD_CAPTION_ALIGN_COMMAND is invalid: {exc}"}
    if not parts:
        return {
            "code": "missing_caption_alignment",
            "message": "configure SQUAD_CAPTION_ALIGN_COMMAND for voiceover caption smoke QA",
        }
    if _resolve_binary(parts[0]) is None:
        return {
            "code": "missing_caption_alignment_binary",
            "message": f"SQUAD_CAPTION_ALIGN_COMMAND binary not found or not executable: {parts[0]}",
        }
    readiness_issue = _caption_alignment_readiness_issue(parts)
    if readiness_issue is not None:
        return readiness_issue
    return None


def _caption_alignment_readiness_issue(parts: list[str]) -> dict[str, Any] | None:
    if not any(part.endswith("caption_align_whisperx.py") for part in parts):
        return None
    try:
        completed = subprocess.run(
            [*parts, "--check"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        payload = json.loads((completed.stdout or "{}").splitlines()[-1])
    except Exception as exc:
        return {
            "code": "caption_alignment_not_ready",
            "message": f"SQUAD_CAPTION_ALIGN_COMMAND readiness check failed: {exc}",
        }
    if payload.get("ok") is not True:
        return {
            "code": "caption_alignment_not_ready",
            "message": "SQUAD_CAPTION_ALIGN_COMMAND readiness check did not return ok",
        }
    return None


def _scenario_requires_caption_alignment(scenario: str) -> bool:
    return scenario in SMOKE_SCENARIOS


def _require_caption_alignment_env(*, scenario: str) -> None:
    issue = _caption_alignment_issue(scenario)
    if issue is not None:
        raise SmokeRunFailure("preflight", f"preflight failed: {issue['message']}", details=issue)


def _raise_preflight_issues(issues: list[dict[str, Any]]) -> None:
    if not issues:
        return
    raise SmokeRunFailure(
        "preflight",
        "preflight failed: " + "; ".join(issue["message"] for issue in issues),
        details={"issues": issues},
    )


def preflight_smoke_run(
    *,
    reference_image: Path,
    music_file: Path | None,
    output_dir: Path,
    budget_cap_usd: float,
    scenario: str = DEFAULT_SCENARIO,
    ffmpeg_bin: str,
    ffprobe_bin: str,
    env: dict[str, Any] | None = None,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    if env is None:
        issues.extend(_env_preflight_issues())
    missing_bins = [
        name for name, value in (("ffmpeg", ffmpeg_bin), ("ffprobe", ffprobe_bin)) if _resolve_binary(value) is None
    ]
    if missing_bins:
        issues.append(
            {
                "code": "missing_binaries",
                "message": f"required binary not found or not executable: {', '.join(missing_bins)}",
                "missing_binaries": missing_bins,
            }
        )
    if budget_cap_usd < 0.3:
        issues.append(
            {
                "code": "budget_cap_too_low",
                "message": "budget cap is too low for the locked smoke",
                "budget_cap_usd": budget_cap_usd,
                "minimum_budget_cap_usd": 0.3,
            }
        )
    reference_issue = _reference_image_issue(reference_image)
    if reference_issue is not None:
        issues.append(reference_issue)
    caption_alignment_issue = _caption_alignment_issue(scenario)
    if caption_alignment_issue is not None:
        issues.append(caption_alignment_issue)
    music_manifest = None
    try:
        music_manifest = configure_smoke_music_library(
            music_file=music_file,
            output_dir=output_dir,
            ffprobe_bin=ffprobe_bin,
        )
    except SmokeRunFailure as exc:
        issues.append({"code": "music_preflight_failed", "message": str(exc), **exc.details})
    _raise_preflight_issues(issues)
    env = env or require_smoke_env(scenario=scenario)
    output_dir.mkdir(parents=True, exist_ok=True)
    os.environ["SQUAD_IMAGE_FACTORY_OUTPUT_ROOT"] = str(output_dir / "image-factory")
    os.environ["SQUAD_FFMPEG_BINARY"] = ffmpeg_bin
    os.environ["SQUAD_FFPROBE_BINARY"] = ffprobe_bin
    return {
        "ok": True,
        "env": env,
        "reference_image": str(reference_image),
        "output_dir": str(output_dir),
        "ffmpeg_bin": ffmpeg_bin,
        "ffprobe_bin": ffprobe_bin,
        "tesseract_bin": _resolve_binary("tesseract") or "not_available",
        "music_manifest": str(music_manifest) if music_manifest else None,
        "caption_alignment": "enabled" if os.getenv("SQUAD_CAPTION_ALIGN_COMMAND") else "not_configured",
        "expected_clip_count": expected_clip_count_for_scenario(scenario),
        "expected_aspect_ratio": expected_aspect_ratio_for_scenario(scenario),
    }


def configure_smoke_music_library(
    *,
    music_file: Path | None,
    output_dir: Path,
    ffprobe_bin: str,
) -> Path | None:
    if music_file is None:
        has_library = any(
            os.getenv(key)
            for key in (
                "SQUAD_TRACK_LIBRARY_MANIFEST",
                "SQUAD_TRACK_LIBRARY_ROOT",
                "SQUAD_TRACK_LIBRARY_MANIFESTS",
                "SQUAD_TRACK_LIBRARY_ROOTS",
            )
        )
        if not has_library:
            raise SmokeRunFailure(
                "preflight",
                "preflight failed: provide --music-file or configure SQUAD_TRACK_LIBRARY_* for the locked smoke",
                details={"required": "--music-file or SQUAD_TRACK_LIBRARY_MANIFEST/ROOT"},
            )
        issue = _track_library_issue()
        if issue is not None:
            raise SmokeRunFailure("preflight", f"preflight failed: {issue['message']}", details=issue)
        return None
    if not music_file.exists():
        raise SmokeRunFailure(
            "preflight",
            f"preflight failed: music file not found: {music_file}",
            details={"music_file": str(music_file)},
        )
    if music_file.stat().st_size <= 0:
        raise SmokeRunFailure(
            "preflight",
            f"preflight failed: music file is empty: {music_file}",
            details={"music_file": str(music_file)},
        )
    try:
        probe = probe_media_streams(music_file, ffprobe_bin=ffprobe_bin)
    except Exception as exc:
        raise SmokeRunFailure(
            "preflight",
            f"preflight failed: music file could not be probed: {music_file}: {exc}",
            details={"music_file": str(music_file)},
        ) from exc
    if not probe["has_audio"]:
        raise SmokeRunFailure(
            "preflight",
            f"preflight failed: music file has no audio stream: {music_file}",
            details={"music_file": str(music_file), "probe": probe},
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    smoke_music = output_dir / "inputs" / f"smoke-music-bed{music_file.suffix.lower() or '.wav'}"
    smoke_music.parent.mkdir(parents=True, exist_ok=True)
    if music_file.resolve() != smoke_music.resolve():
        shutil.copy2(music_file, smoke_music)
    manifest = output_dir / "smoke-music-library.json"
    manifest.write_text(
        json.dumps(
            {
                "tracks": [
                    {
                        "track_id": "golden-path-music-bed",
                        "title": "Golden Path Music Bed",
                        "artist": "Local Library",
                        "asset_uri": str(smoke_music.resolve()),
                        "mood": ["premium", "cinematic"],
                        "energy": "low",
                        "genre": ["cinematic"],
                        "instrumentation": ["soft_synth", "light_texture", "gentle_pulse"],
                        "has_vocals": False,
                        "explicit": False,
                        "loopable": True,
                        "license": "cleared_for_commercial_use",
                        "source": "local_smoke_music_file",
                    }
                ]
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    os.environ["SQUAD_TRACK_LIBRARY_MANIFEST"] = str(manifest)
    os.environ.pop("SQUAD_TRACK_LIBRARY_ROOT", None)
    os.environ.pop("SQUAD_TRACK_LIBRARY_MANIFESTS", None)
    os.environ.pop("SQUAD_TRACK_LIBRARY_ROOTS", None)
    os.environ["SQUAD_ENABLE_AUDIO_MIX"] = "1"
    return manifest


def probe_media_streams(path: Path, *, ffprobe_bin: str = "ffprobe") -> dict[str, Any]:
    completed = subprocess.run(
        [
            ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "stream=index,codec_type,codec_name",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    streams = payload.get("streams") or []
    has_video = any(stream.get("codec_type") == "video" for stream in streams)
    has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
    return {
        "streams_ok": bool(has_video and has_audio),
        "has_video": bool(has_video),
        "has_audio": bool(has_audio),
        "streams": streams,
    }


def summarize_smoke_result(
    result,
    *,
    stream_probe: dict[str, Any],
    scenario: str = DEFAULT_SCENARIO,
) -> dict[str, Any]:
    final_asset_path = result.final_assembly.asset_path if result.final_assembly else None
    format_plan = result.format_narrative_plan
    review_packet = result.human_review_packet
    return {
        "error": False,
        "run_id": result.run_id,
        "final_status": str(result.final_status),
        "spend_usd": result.total_spend_usd,
        "budget_cap_usd": result.budget_cap_usd,
        "plan_review_verdict": result.plan_review.verdict if result.plan_review else None,
        "expected_format_type": expected_format_type_for_scenario(scenario),
        "format_type": format_plan.format_type if format_plan else None,
        "audio_mode": format_plan.audio_mode if format_plan else None,
        "scene_beat_count": len(format_plan.scene_beats) if format_plan else 0,
        "video_attempt_count": len(result.video_attempt_history),
        "expected_clip_count": expected_clip_count_for_scenario(scenario),
        "final_clip_count": result.final_assembly.clip_count if result.final_assembly else None,
        "aspect_ratio": format_plan.platform_profile.aspect_ratio if format_plan else None,
        "video_model_ids": [clip.model_id for clip in result.video_attempt_history],
        "final_asset_path": str(final_asset_path) if final_asset_path else None,
        "manifest_path": str(result.manifest_path) if result.manifest_path else None,
        "review_packet_ready": bool(review_packet and review_packet.review_path and review_packet.approval_payload),
        "review_path": str(review_packet.review_path) if review_packet and review_packet.review_path else None,
        "review_summary": review_packet.summary if review_packet else None,
        "streams_ok": stream_probe["streams_ok"],
        "has_video": stream_probe["has_video"],
        "has_audio": stream_probe["has_audio"],
    }


def _persist_smoke_summary_to_manifest(*, manifest_path: Path | None, summary: dict[str, Any]) -> None:
    if manifest_path is None:
        return
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return
    manifest["smoke_summary"] = summary
    if "free_output_qa" in summary:
        manifest["free_output_qa"] = summary["free_output_qa"]
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")


def _write_locked_brief(output_dir: Path, brief: CreativeBrief) -> Path:
    brief_path = output_dir / "brief.json"
    brief_path.write_text(json.dumps(brief.__dict__, indent=2, sort_keys=True), encoding="utf-8")
    return brief_path


def expected_clip_count_for_scenario(scenario: str) -> int:
    return 5 if scenario == "faceless-youtube" else 3


def expected_aspect_ratio_for_scenario(scenario: str) -> str:
    return "16:9" if scenario == "faceless-youtube" else "9:16"


def expected_format_type_for_scenario(scenario: str) -> str:
    if scenario == "faceless-youtube":
        return "no_face_youtube"
    if scenario == "ugc-founder":
        return "ugc_scripted_ad"
    return "multi_shot_ad"


def _validate_locked_result(result, *, scenario: str) -> None:
    if result.final_status != ProductionFinalStatus.REVIEW_READY:
        raise SmokeRunFailure(
            "production_graph",
            f"smoke run finished with final_status {str(result.final_status)!r}; expected 'review_ready'",
            details={
                "final_status": str(result.final_status),
                "expected_final_status": str(ProductionFinalStatus.REVIEW_READY),
                "run_id": result.run_id,
            },
        )
    clip_count = result.final_assembly.clip_count if result.final_assembly else 0
    format_plan = result.format_narrative_plan
    format_type = format_plan.format_type if format_plan else None
    audio_mode = format_plan.audio_mode if format_plan else None
    scene_beat_count = len(format_plan.scene_beats) if format_plan else 0
    aspect_ratio = (
        format_plan.platform_profile.aspect_ratio
        if format_plan
        else None
    )
    expected_clip_count = expected_clip_count_for_scenario(scenario)
    expected_aspect_ratio = expected_aspect_ratio_for_scenario(scenario)
    expected_format_type = expected_format_type_for_scenario(scenario)
    if format_type != expected_format_type:
        raise SmokeRunFailure(
            "production_graph",
            f"locked smoke used format type {format_type!r}, expected {expected_format_type}",
            details={"format_type": format_type, "expected_format_type": expected_format_type},
        )
    if clip_count != expected_clip_count:
        raise SmokeRunFailure(
            "production_graph",
            f"locked smoke produced {clip_count} clips, expected {expected_clip_count}",
            details={"clip_count": clip_count, "expected_clip_count": expected_clip_count},
        )
    if aspect_ratio != expected_aspect_ratio:
        raise SmokeRunFailure(
            "production_graph",
            f"locked smoke used aspect ratio {aspect_ratio!r}, expected {expected_aspect_ratio}",
            details={"aspect_ratio": aspect_ratio, "expected_aspect_ratio": expected_aspect_ratio},
        )
    if scenario == "faceless-youtube" and audio_mode != "narration_led":
        raise SmokeRunFailure(
            "production_graph",
            f"faceless smoke used audio mode {audio_mode!r}, expected narration_led",
            details={"audio_mode": audio_mode, "expected_audio_mode": "narration_led"},
        )
    if scene_beat_count != expected_clip_count:
        raise SmokeRunFailure(
            "production_graph",
            f"locked smoke planned {scene_beat_count} scene beats, expected {expected_clip_count}",
            details={"scene_beat_count": scene_beat_count, "expected_scene_beat_count": expected_clip_count},
        )
    selected_music_track = (
        result.audio_mix_plan.selected_music_track
        if result.audio_mix_plan is not None
        else None
    )
    if result.voice_asset is None:
        raise SmokeRunFailure(
            "voiceover",
            "locked smoke did not produce a real voiceover asset",
            details={
                "voiceover_plan_enabled": result.voiceover_plan.enabled if result.voiceover_plan else None,
                "voiceover_error": result.voiceover_error,
            },
        )
    if scenario == "faceless-youtube" and not (
        result.human_review_packet
        and result.human_review_packet.review_path
        and result.human_review_packet.approval_payload
    ):
        raise SmokeRunFailure(
            "human_review",
            "faceless smoke did not produce review packet signals",
            details={"has_review_packet": bool(result.human_review_packet)},
        )
    if selected_music_track is None:
        raise SmokeRunFailure(
            "music",
            "locked smoke did not select a real music bed",
            details={
                "audio_mix_plan": result.audio_mix_plan.mix_notes if result.audio_mix_plan else None,
                "voiceover_error": result.voiceover_error,
            },
        )
    if result.final_assembly is None or "audio_mix" not in result.final_assembly.assembly_method:
        raise SmokeRunFailure(
            "audio_mix",
            "locked smoke did not render the final video through the audio mix stage",
            details={
                "assembly_method": result.final_assembly.assembly_method if result.final_assembly else None,
                "selected_track_id": selected_music_track.track_id,
            },
        )
    caption_alignment_warning = _caption_alignment_fallback_warning(result)
    if caption_alignment_warning:
        raise SmokeRunFailure(
            "caption_alignment",
            f"locked smoke used planned caption fallback: {caption_alignment_warning}",
            details={"caption_alignment_warning": caption_alignment_warning},
        )


def _caption_alignment_fallback_warning(result) -> str | None:
    post_pass_plan = getattr(result, "post_pass_plan", None)
    findings = getattr(post_pass_plan, "validation_findings", ()) if post_pass_plan is not None else ()
    for finding in findings or ():
        message = str(getattr(finding, "message", "") or "")
        if "caption alignment failed" in message or "caption alignment returned no cues" in message:
            return message
    return None


def run_smoke(
    *,
    reference_image: Path | None,
    music_file: Path | None = None,
    budget_cap_usd: float,
    run_id: str = DEFAULT_RUN_ID,
    scenario: str = DEFAULT_SCENARIO,
    ffmpeg_bin: str = "ffmpeg",
    ffprobe_bin: str,
) -> dict[str, Any]:
    if run_id == DEFAULT_RUN_ID and scenario != DEFAULT_SCENARIO:
        run_id = f"{DEFAULT_RUN_ID}-{scenario}"
    output_dir = deterministic_output_dir(run_id)
    reference = reference_image or ensure_default_reference_image(output_dir, scenario=scenario)
    preflight = preflight_smoke_run(
        reference_image=reference,
        music_file=music_file,
        output_dir=output_dir,
        budget_cap_usd=budget_cap_usd,
        scenario=scenario,
        ffmpeg_bin=ffmpeg_bin,
        ffprobe_bin=ffprobe_bin,
    )
    provider_budget = assert_provider_budget_for_paid_smoke(scenario=scenario)
    brief = build_smoke_brief(reference_image=reference, max_cost_usd=budget_cap_usd, scenario=scenario)
    brief_path = _write_locked_brief(output_dir, brief)
    graph = build_runtime(image_eval_provider="structural")
    result = graph.run(
        CreativeProductionInput(
            brief=brief,
            budget_cap_usd=budget_cap_usd,
            max_attempts=1,
            video_quality="budget",
            run_id=run_id,
        )
    )
    if not result.final_assembly or not result.final_assembly.asset_path:
        raise SmokeRunFailure(
            "assembly",
            "smoke run did not produce a final assembly",
            details={"run_id": result.run_id, "output_dir": str(output_dir)},
        )
    _validate_locked_result(result, scenario=scenario)
    stream_probe = probe_media_streams(result.final_assembly.asset_path, ffprobe_bin=ffprobe_bin)
    summary = summarize_smoke_result(result, stream_probe=stream_probe, scenario=scenario)
    free_output_qa = run_free_smoke_media_qa(
        final_asset_path=result.final_assembly.asset_path,
        output_dir=output_dir,
        brief=brief,
        caption_cues=tuple(result.post_pass_plan.caption_cues if result.post_pass_plan else ()),
        video_model_ids=tuple(clip.model_id for clip in result.video_attempt_history),
        ffmpeg_binary=ffmpeg_bin,
        tesseract_binary=os.getenv("SQUAD_TESSERACT_BINARY", "tesseract"),
    )
    summary["scenario"] = scenario
    summary["output_dir"] = str(output_dir)
    summary["brief_path"] = str(brief_path)
    summary["preflight"] = preflight
    summary["provider_budget"] = provider_budget
    summary["free_output_qa"] = free_output_qa
    _persist_smoke_summary_to_manifest(manifest_path=result.manifest_path, summary=summary)
    if not stream_probe["streams_ok"]:
        raise SmokeRunFailure(
            "media_probe",
            "final smoke asset is missing required audio or video stream",
            details=summary,
        )
    if not free_output_qa.get("passed", True):
        raise SmokeRunFailure(
            "free_output_qa",
            "free output QA failed",
            details=free_output_qa,
        )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        print(json.dumps(_summarize_system_exit(exc), indent=2))
        return exc.code if isinstance(exc.code, int) and exc.code else 1
    load_env_file(PROJECT_ROOT / ".env.local")
    try:
        if args.preflight_only:
            run_id = args.run_id
            if run_id == DEFAULT_RUN_ID and args.scenario != DEFAULT_SCENARIO:
                run_id = f"{DEFAULT_RUN_ID}-{args.scenario}"
            output_dir = deterministic_output_dir(run_id)
            reference = Path(args.reference_image) if args.reference_image else ensure_default_reference_image(output_dir, scenario=args.scenario)
            summary = preflight_smoke_run(
                reference_image=reference,
                music_file=Path(args.music_file) if args.music_file else None,
                output_dir=output_dir,
                budget_cap_usd=args.budget_cap_usd,
                scenario=args.scenario,
                ffmpeg_bin=args.ffmpeg_bin,
                ffprobe_bin=args.ffprobe_bin,
            )
        else:
            if args.tesseract_bin:
                os.environ["SQUAD_TESSERACT_BINARY"] = args.tesseract_bin
            summary = run_smoke(
                reference_image=Path(args.reference_image) if args.reference_image else None,
                music_file=Path(args.music_file) if args.music_file else None,
                budget_cap_usd=args.budget_cap_usd,
                run_id=args.run_id,
                scenario=args.scenario,
                ffmpeg_bin=args.ffmpeg_bin,
                ffprobe_bin=args.ffprobe_bin,
            )
    except SystemExit as exc:
        print(json.dumps(_summarize_system_exit(exc), indent=2))
        return exc.code if isinstance(exc.code, int) and exc.code else 1
    except Exception as exc:
        print(json.dumps(summarize_error(exc, brief_file="creative-production-smoke"), indent=2))
        return 1
    print(json.dumps(summary, indent=2))
    return 0 if summary.get("ok") or summary.get("streams_ok") else 1


def _summarize_system_exit(exc: SystemExit) -> dict[str, Any]:
    code = exc.code
    message = str(code) if code not in (None, 0) else "SystemExit"
    payload = summarize_error(RuntimeError(message), brief_file="creative-production-smoke")
    payload.update(
        {
            "error_code": "system_exit",
            "failed_subsystem": "cli",
            "provider": None,
            "retryable": False,
            "message": message,
            "exit_code": code if isinstance(code, int) else 1,
            "follow_up": "fix the smoke CLI invocation or runtime preflight failure, then rerun",
        }
    )
    return payload


def assert_provider_budget_for_paid_smoke(*, scenario: str) -> dict[str, Any]:
    estimate = estimate_wavespeed_smoke_budget(
        scenario=scenario,
        expected_clip_count=expected_clip_count_for_scenario(scenario),
    )
    try:
        check = check_wavespeed_smoke_budget(
            scenario=scenario,
            expected_clip_count=estimate.expected_clip_count,
            clip_cost_usd=(
                estimate.estimated_video_cost_usd / estimate.expected_clip_count
                if estimate.expected_clip_count
                else 0.0
            ),
            reserve_usd=estimate.reserve_usd,
        )
    except ProviderBudgetError:
        raise
    except Exception as exc:
        details = {
            "provider": "wavespeed",
            "scenario": scenario,
            "expected_clip_count": estimate.expected_clip_count,
            "estimated_video_cost_usd": estimate.estimated_video_cost_usd,
            "required_balance_usd": estimate.required_balance_usd,
            "message": str(exc),
        }
        raise SmokeRunFailure(
            "provider_budget",
            f"provider budget check failed: {exc}",
            details=details,
            provider="wavespeed",
        ) from exc
    return check.to_dict()


if __name__ == "__main__":
    raise SystemExit(main())
