#!/usr/bin/env python3
"""RunnerOS wrapper around Genesis single-video lyric clip tools."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from typing import Any


TOOL_ROOT = Path(os.environ.get("GENESIS_LYRIC_TOOL_ROOT", Path(__file__).resolve().parents[1]))
GENESIS_ROOT = Path(os.environ.get("GENESIS_LYRIC_VENDOR_ROOT", TOOL_ROOT / "vendor" / "genesis"))
if str(GENESIS_ROOT) not in sys.path:
    sys.path.insert(0, str(GENESIS_ROOT))


ASPECT_RESOLUTIONS = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

GENESIS_DIRECTOR_SOURCES = {
    "creative_director_spec": "Genesis/Docs/Creative_Director_Agent_Spec.md",
    "motion_director_spec": "Genesis/Docs/MOTION_DIRECTOR_SPEC.md",
    "cinema_modes": "Genesis/agent/cinema_modes.py",
    "capture_realism": "Genesis/core/capture_realism.py",
    "motion_compiler": "Genesis/core/motion_compiler.py",
    "motion_qa": "Genesis/services/motion_qa.py",
}

FAMILY_PROFILES = {
    "analog_photo": {
        "label": "LOFI_FLASH_FILM / ANALOG_PHOTO",
        "prompt": "1990s underground music-magazine photography, direct flash residue, expired 35mm scan texture, warm dust, imperfect framing, emotionally specific and unpolished",
        "avoid": "glossy fashion ad, sterile studio perfection, clean corporate editorial, generic HD portrait, readable text, logos",
        "wet": False,
        "humans": True,
        "density": "light",
    },
    "surreal_dream": {
        "label": "SURREAL_DREAM",
        "prompt": "lonely surreal dream logic, simple impossible event, vast negative space, tactile objects behaving emotionally, elegant strangeness",
        "avoid": "busy fantasy clutter, random horror chaos, generic neon vaporwave, screensaver psychedelia, readable text, logos",
        "wet": False,
        "humans": True,
        "density": "heavy",
    },
    "performance": {
        "label": "PERFORMANCE",
        "prompt": "music performance film language, stage haze, practical light, imperfect venue texture, crowd depth implied without extra identifiable faces",
        "avoid": "generic neon room, glossy concert commercial, lip-sync fakery, extra identifiable faces, readable text, logos",
        "wet": False,
        "humans": True,
        "density": "heavy",
    },
    "street_expressionist": {
        "label": "STREET / EXPRESSIONIST",
        "prompt": "raw hand-authored street-expressionist image world, rough paper/canvas surface, visible pressure, overpainted revisions, emotionally loaded marks",
        "avoid": "spray-paint wall clichés, subway tags, generic graffiti pastiche, photographic gear language, readable text, logos",
        "wet": False,
        "humans": False,
        "density": "thin",
    },
}

SHOT_SEQUENCE = [
    {
        "shot_type": "wide_establishing",
        "camera_movement": "slow_push",
        "role": "establish",
        "frame": "wide environmental frame with the subject small inside the world",
    },
    {
        "shot_type": "close_up",
        "camera_movement": "handheld_drift",
        "role": "explore",
        "frame": "intimate close frame built around one emotionally loaded detail",
    },
    {
        "shot_type": "overhead",
        "camera_movement": "slow_pull",
        "role": "transform",
        "frame": "overhead or off-axis frame where the room/object reveals the consequence",
    },
    {
        "shot_type": "wide_establishing",
        "camera_movement": "locked_push",
        "role": "resolve",
        "frame": "aftermath frame with more negative space than subject",
    },
]


def emit(payload: dict[str, Any], *, status: int = 0) -> None:
    print(json.dumps(payload, indent=2))
    raise SystemExit(status)


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, capture_output=True, text=True)
    except OSError as exc:
        return subprocess.CompletedProcess(cmd, 127, "", str(exc))


def command_path(name: str) -> str | None:
    return shutil.which(name)


def resolve_binary(name: str) -> str:
    try:
        from core.media_binaries import resolve_media_binary

        return resolve_media_binary(name)
    except Exception:
        return command_path(name) or name


def usable_binary(name: str) -> str | None:
    candidate = resolve_binary(name)
    result = run([candidate, "-version"])
    return candidate if result.returncode == 0 else None


def read_json(path: str | None) -> dict[str, Any]:
    if not path:
        emit({"ok": False, "error": "Missing --brief-file"}, status=1)
    p = Path(path).expanduser().resolve()
    if not p.exists():
        emit({"ok": False, "error": f"Brief file not found: {p}"}, status=1)
    try:
        parsed = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        emit({"ok": False, "error": f"Could not parse brief JSON: {exc}", "brief_file": str(p)}, status=1)
    if not isinstance(parsed, dict):
        emit({
            "ok": False,
            "code": "invalid_brief",
            "error": "Brief JSON must be an object.",
            "brief_file": str(p),
        }, status=1)
    return parsed


def path_from(value: Any) -> Path | None:
    if not value:
        return None
    return Path(str(value)).expanduser().resolve()


def probe_duration(media_path: Path) -> float:
    ffprobe = resolve_binary("ffprobe")
    result = run([
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ])
    if result.returncode != 0:
        return 0.0
    try:
        return max(0.0, float((result.stdout or "0").strip()))
    except ValueError:
        return 0.0


def brief_value(brief: dict[str, Any], args: argparse.Namespace, key: str, default: Any = None) -> Any:
    value = getattr(args, key, None)
    return value if value not in (None, "") else brief.get(key, default)


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def parse_float(value: Any) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("number must be finite")
    return parsed


def safe_float(value: Any, default: float) -> float:
    if value in (None, ""):
        return default
    try:
        return parse_float(value)
    except (TypeError, ValueError):
        return default


def requested_aspect(brief: dict[str, Any]) -> str:
    return clean_text(brief.get("aspect_ratio") or "9:16")


def numeric_blockers(brief: dict[str, Any], args: argparse.Namespace) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []

    for key in ["duration_seconds"]:
        value = brief_value(brief, args, key)
        if value in (None, ""):
            continue
        try:
            if parse_float(value) <= 0:
                blockers.append({"code": "invalid_numeric", "message": f"{key} must be greater than 0."})
        except (TypeError, ValueError):
            blockers.append({"code": "invalid_numeric", "message": f"{key} must be a number."})

    for key in ["audio_start_seconds", "video_start_seconds", "alignment_min_confidence"]:
        value = brief.get(key)
        if value in (None, ""):
            continue
        try:
            if parse_float(value) < 0:
                blockers.append({"code": "invalid_numeric", "message": f"{key} must be 0 or greater."})
        except (TypeError, ValueError):
            blockers.append({"code": "invalid_numeric", "message": f"{key} must be a number."})

    raw_lines = brief.get("lyric_lines")
    if isinstance(raw_lines, list):
        for index, item in enumerate(raw_lines):
            if not isinstance(item, dict):
                continue
            start = item.get("start_time", item.get("start"))
            end = item.get("end_time", item.get("end"))
            if start is None and end is None:
                continue
            if start is None or end is None:
                blockers.append({"code": "invalid_lyric_timing", "message": f"lyric_lines[{index}] needs both start_time and end_time, or neither."})
                continue
            try:
                start_value = parse_float(start)
                end_value = parse_float(end)
            except (TypeError, ValueError):
                blockers.append({"code": "invalid_lyric_timing", "message": f"lyric_lines[{index}] start_time/end_time must be numbers."})
                continue
            if start_value < 0 or end_value < 0:
                blockers.append({"code": "invalid_lyric_timing", "message": f"lyric_lines[{index}] timing must be 0 or greater."})
            if end_value <= start_value:
                blockers.append({"code": "invalid_lyric_timing", "message": f"lyric_lines[{index}] end_time must be after start_time."})

    return blockers


def path_blockers(brief: dict[str, Any]) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []
    raw_run_id = brief.get("run_id")
    if raw_run_id not in (None, ""):
        run_id = str(raw_run_id)
        posix_path = Path(run_id)
        windows_path = PureWindowsPath(run_id)
        if (
            posix_path.is_absolute()
            or windows_path.is_absolute()
            or ".." in posix_path.parts
            or ".." in windows_path.parts
        ):
            blockers.append({
                "code": "invalid_run_id",
                "message": "run_id must stay inside output_dir; do not use absolute paths or parent directory segments.",
            })
    return blockers


def target_duration(brief: dict[str, Any], args: argparse.Namespace) -> float:
    explicit = brief_value(brief, args, "duration_seconds")
    if explicit:
        try:
            return max(0.1, parse_float(explicit))
        except (TypeError, ValueError):
            pass

    video = path_from(brief_value(brief, args, "video_file"))
    if video and video.exists():
        duration = probe_duration(video)
        if duration > 0:
            return duration

    audio = path_from(brief_value(brief, args, "audio_file"))
    if audio and audio.exists():
        duration = probe_duration(audio)
        start = safe_float(brief.get("audio_start_seconds"), 0.0)
        if duration > start:
            return duration - start

    lines = brief.get("lyric_lines") or []
    max_end = 0.0
    for line in lines:
        try:
            max_end = max(max_end, parse_float(line.get("end_time", line.get("end", 0.0)) or 0.0))
        except (TypeError, ValueError):
            pass
    if max_end > 0:
        return max_end

    lyric_count = len([line for line in str(brief.get("lyrics") or "").splitlines() if clean_text(line)])
    return max(5.0, lyric_count * 2.5) if lyric_count else 8.0


def normalized_lyric_lines(brief: dict[str, Any], duration: float) -> list[dict[str, Any]]:
    raw_lines = brief.get("lyric_lines")
    lines: list[dict[str, Any]] = []
    if isinstance(raw_lines, list) and raw_lines:
        for item in raw_lines:
            if not isinstance(item, dict):
                continue
            text = clean_text(item.get("text", item.get("line")))
            if not text:
                continue
            start = item.get("start_time", item.get("start"))
            end = item.get("end_time", item.get("end"))
            if start is None or end is None:
                lines.append({"text": text})
            else:
                try:
                    lines.append({"text": text, "start_time": parse_float(start), "end_time": parse_float(end)})
                except (TypeError, ValueError):
                    lines.append({"text": text})
    else:
        for line in str(brief.get("lyrics") or "").splitlines():
            text = clean_text(line)
            if text:
                lines.append({"text": text})

    if not lines:
        return []

    missing_timing = any("start_time" not in line or "end_time" not in line for line in lines)
    if missing_timing:
        step = max(0.1, duration / len(lines))
        for index, line in enumerate(lines):
            line["start_time"] = round(index * step, 3)
            line["end_time"] = round(duration if index == len(lines) - 1 else (index + 1) * step, 3)
    return lines


def slug_token(value: Any) -> str:
    token = clean_text(value).lower().replace("-", "_").replace(" ", "_")
    return "".join(ch for ch in token if ch.isalnum() or ch == "_")


def storyboard_family(brief: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    raw = slug_token(
        brief.get("visual_family")
        or brief.get("aesthetic_family")
        or brief.get("style_family")
        or brief.get("visual_world")
        or "analog_photo"
    )
    if "surreal" in raw or "dream" in raw or "psychedelic" in raw:
        key = "surreal_dream"
    elif "perform" in raw or "stage" in raw or "concert" in raw:
        key = "performance"
    elif "street" in raw or "expression" in raw or "paint" in raw or "graphic" in raw:
        key = "street_expressionist"
    else:
        key = "analog_photo"
    return key, FAMILY_PROFILES[key]


def storyboard_mode(brief: dict[str, Any], family_key: str) -> str:
    explicit = clean_text(brief.get("cinema_mode") or brief.get("mode"))
    if explicit:
        return explicit
    if family_key == "performance":
        return "M4"
    if family_key == "surreal_dream":
        return "M5"
    if family_key == "street_expressionist":
        return "M2"
    return "M1"


def scene_count_for(lines: list[dict[str, Any]], duration: float) -> int:
    if duration <= 5.5 or len(lines) <= 1:
        return 1
    if duration <= 12 or len(lines) <= 3:
        return min(3, max(2, len(lines)))
    return min(4, max(3, len(lines)))


def grouped_lines(lines: list[dict[str, Any]], count: int, duration: float) -> list[dict[str, Any]]:
    if not lines:
        return []
    groups: list[list[dict[str, Any]]] = [[] for _ in range(count)]
    for index, line in enumerate(lines):
        target = min(count - 1, int(index * count / max(1, len(lines))))
        groups[target].append(line)
    out = []
    for index, group in enumerate(groups):
        if not group:
            start = round(index * duration / count, 3)
            end = round((index + 1) * duration / count, 3)
            out.append({"text": "", "start_time": start, "end_time": end})
            continue
        out.append({
            "text": " / ".join(clean_text(item.get("text")) for item in group if clean_text(item.get("text"))),
            "start_time": float(group[0].get("start_time", index * duration / count)),
            "end_time": float(group[-1].get("end_time", (index + 1) * duration / count)),
        })
    return out


def beat_namespace(t_start: float, t_end: float, event: str) -> SimpleNamespace:
    return SimpleNamespace(t_start=t_start, t_end=t_end, event=event)


def build_shot_direction(
    *,
    scene: dict[str, Any],
    index: int,
    duration: float,
    mode: str,
    family: dict[str, Any],
) -> SimpleNamespace:
    from agent.cinema_modes import build_camera_capture, normalize_mode_id
    from core.capture_realism import build_capture_realism

    role = scene["role"]
    lyric = scene["lyric"] or "the instrumental emotional turn"
    short_duration = max(0.5, float(scene["end_time"]) - float(scene["start_time"]))
    mode_id = normalize_mode_id(mode)
    if role == "establish":
        subject_action = f"the figure or central object enters the visual world through absence, reacting to the lyric '{lyric}' without acting it out literally"
        camera_motion = "slow motivated push from environment into the emotional subject"
        environmental_motion = "dust, haze, window light, and small room details move before the subject does"
        micro_motion = "breath-level movement, fabric settling, tiny light flicker"
        purpose = "to let the viewer feel the world before reading the lyric"
        last = "the frame lands with the subject held small but unmistakably emotionally trapped inside the world"
    elif role == "explore":
        subject_action = f"one concrete detail carries the feeling of '{lyric}' while the rest of the world stays withheld"
        camera_motion = "handheld drift that searches rather than announces"
        environmental_motion = "background planes breathe with film grain, soft haze, and faint practical-light pulse"
        micro_motion = "tiny facial or object-level motion, hair or fabric tremor, shallow focus breathing"
        purpose = "to make the emotion intimate without turning it into a literal illustration"
        last = "the shot lands on the detail as if it has become the whole memory"
    elif role == "transform":
        subject_action = f"the image world quietly changes under the pressure of '{lyric}', turning a normal room or object into a consequence"
        camera_motion = "slow pull or off-axis drift revealing the transformation"
        environmental_motion = "paper, shadow, light, or weather shifts in layers from foreground to background"
        micro_motion = "small edge shimmer, fabric drag, dust suspension, imperfect scan texture"
        purpose = "to show what the line does to the world instead of showing the line itself"
        last = "the frame lands after the transformation, with the old scene visibly changed"
    else:
        subject_action = f"the human presence recedes and the aftermath of '{lyric}' becomes the subject"
        camera_motion = "locked-off hold with an extremely slow final push"
        environmental_motion = "air, grain, and distant light continue moving after the action has ended"
        micro_motion = "near-stillness with only breath, fabric, and atmospheric motion"
        purpose = "to make the ending feel like a consequence, not a caption"
        last = "the final frame holds more absence than action, clean enough to loop or cut"

    capture = build_capture_realism(
        wet=bool(family.get("wet")),
        humans=bool(family.get("humans")),
        density=str(family.get("density") or "light"),
        far_element="the far background",
    )
    return SimpleNamespace(
        cinema_mode=mode_id,
        mode_contrast_reason="",
        subject_action=subject_action,
        micro_motion=micro_motion,
        environmental_motion=environmental_motion,
        camera_motion=camera_motion,
        motion_purpose=purpose,
        beats=[
            beat_namespace(0.0, round(short_duration * 0.5, 3), "world and subject relationship is established"),
            beat_namespace(round(short_duration * 0.5, 3), round(short_duration, 3), "camera lands on the emotional consequence"),
        ],
        last_frame=last,
        capture_realism=capture,
        camera_capture=build_camera_capture(mode_id, duration_seconds=short_duration),
        duration_seconds=short_duration,
    )


def shot_to_dict(shot: SimpleNamespace) -> dict[str, Any]:
    return {
        "cinema_mode": shot.cinema_mode,
        "duration_seconds": shot.duration_seconds,
        "qa_checked": True,
        "compiled": "Use image_prompt and motion_prompt for provider work.",
    }


def compact_capture_realism_for_image(family: dict[str, Any]) -> str:
    wet_clause = "damp matte surfaces without shine, " if family.get("wet") else ""
    human_clause = "skin matte with real fine texture, " if family.get("humans") else "surfaces matte not glossy, "
    return (
        "Capture realism: real atmospheric depth between foreground and background, "
        f"{wet_clause}{human_clause}lifted shadows, rolled-off highlights, no plastic sheen, photographed not generated."
    )


def storyboard_negative_prompt(family: dict[str, Any], face_refs: list[str]) -> str:
    base = [
        str(family["avoid"]),
        "photorealistic 4K, 8K, HDR, stock photo, AI plastic skin, beauty filter, generic cinematic, random symbols",
    ]
    if face_refs:
        base.append("extra identifiable faces, second face, different person, celebrity likeness drift")
    return ", ".join(base)


def face_reference_paths(brief: dict[str, Any]) -> list[str]:
    raw = brief.get("face_reference_paths") or brief.get("artist_face_reference_paths") or []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if clean_text(item)]


def command_storyboard(args: argparse.Namespace) -> None:
    brief = read_json(args.brief_file)
    duration = target_duration(brief, args)
    aspect = requested_aspect(brief)
    lines = normalized_lyric_lines(brief, duration)
    family_key, family = storyboard_family(brief)
    mode = storyboard_mode(brief, family_key)
    count = scene_count_for(lines, duration)
    groups = grouped_lines(lines, count, duration)
    face_refs = face_reference_paths(brief)
    title = clean_text(brief.get("title") or brief.get("song_title") or "Untitled lyric clip")
    mood = clean_text(brief.get("mood") or brief.get("emotional_direction") or "emotionally specific, lonely, memorable")
    concept = clean_text(brief.get("creative_thesis") or brief.get("concept") or f"{title} as a concise visual memory that changes with each lyric beat")

    from core.motion_compiler import compile_motion_prompt
    from services.motion_qa import validate_shot_direction

    scenes = []
    blockers: list[dict[str, str]] = []
    if aspect not in ASPECT_RESOLUTIONS:
        blockers.append({"code": "unsupported_aspect_ratio", "message": f"aspect_ratio must be one of: {', '.join(ASPECT_RESOLUTIONS.keys())}."})
    if not lines:
        blockers.append({"code": "missing_lyrics", "message": "Storyboard needs lyrics or lyric_lines."})

    for index, group in enumerate(groups):
        template = SHOT_SEQUENCE[min(index, len(SHOT_SEQUENCE) - 1)]
        scene = {
            "index": index + 1,
            "role": template["role"] if index < count - 1 else ("resolve" if count > 1 else "hero"),
            "shot_type": template["shot_type"],
            "camera_movement": template["camera_movement"],
            "frame": template["frame"],
            "lyric": group["text"],
            "start_time": group["start_time"],
            "end_time": group["end_time"],
        }
        shot = build_shot_direction(scene=scene, index=index, duration=duration, mode=mode, family=family)
        findings = validate_shot_direction(shot, bible_mode=mode, duration_seconds=shot.duration_seconds)
        motion_prompt = compile_motion_prompt(shot, provider=str(brief.get("video_provider") or "wavespeed"), duration_seconds=shot.duration_seconds)
        ref_clause = " Use the supplied artist face reference for the only identifiable face." if face_refs else " If a human appears, prefer silhouette, partial crop, back turned, reflection, or implied presence."
        image_prompt = (
            f"Vertical {aspect} {family['prompt']}. {scene['frame']}. "
            f"Mood: {mood}. Visual thesis: {concept}. "
            f"Lyric beat: {scene['lyric'] or 'instrumental turn'}. "
            f"No readable text, no logos.{ref_clause} "
            f"{compact_capture_realism_for_image(family)}"
        )
        scenes.append({
            **scene,
            "duration_seconds": round(float(scene["end_time"]) - float(scene["start_time"]), 3),
            "image_prompt": image_prompt,
            "motion_prompt": motion_prompt,
            "shot_direction": shot_to_dict(shot),
            "qa_findings": [vars(finding) for finding in findings],
        })

    ok = len(blockers) == 0 and all(not any(f["severity"] == "fail" for f in scene["qa_findings"]) for scene in scenes)
    emit({
        "ok": ok,
        "mode": "runneros_genesis_lyric_storyboard",
        "provider_spend_enabled": False,
        "single_video_only": True,
        "director_stack": "Genesis Creative Director + Motion Director grammar",
        "title": title,
        "core_thesis": concept,
        "visual_family": family["label"],
        "cinema_mode": mode,
        "aspect_ratio": aspect,
        "duration_seconds": duration,
        "face_reference_paths": face_refs,
        "negative_prompt": storyboard_negative_prompt(family, face_refs),
        "scene_count": len(scenes),
        "blockers": blockers,
        "scenes": scenes,
        "media_generation": {
            "image_first": True,
            "image_prompt_goes_to": "approved image generation tool",
            "motion_prompt_goes_to": "approved image-to-video tool",
            "expected_asset": "image_file or video_file for genesis-lyric render",
        },
        "next_actions": [
            "Review storyboard before provider spend.",
            "Generate/animate the chosen visual from image_prompt and motion_prompt.",
            "Pass the selected asset back as image_file or video_file, then preflight and approval-gated render.",
        ],
    }, status=0 if ok else 1)


def maybe_align_lines(lines: list[dict[str, Any]], brief: dict[str, Any], audio_path: Path | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not bool(brief.get("align_with_audio")):
        return lines, {"applied": False, "reason": "alignment not requested"}
    if not audio_path or not audio_path.exists():
        return lines, {"applied": False, "reason": "audio missing"}
    try:
        from core.lyric_alignment import align_lyrics_to_audio

        result = align_lyrics_to_audio(
            lines,
            str(audio_path),
            model_name=str(brief.get("alignment_model") or "base"),
            min_confidence=safe_float(brief.get("alignment_min_confidence"), 0.5),
        )
        aligned = [
            {
                "text": line.text,
                "start_time": line.start,
                "end_time": line.end,
                "word_timings": line.word_timings,
            }
            for line in result.lines
        ]
        return aligned, {
            "applied": result.applied,
            "confidence": result.confidence,
            "matched_tokens": result.matched_tokens,
            "total_tokens": result.total_tokens,
            "reason": result.reason,
        }
    except Exception as exc:
        return lines, {"applied": False, "reason": f"alignment failed: {exc}"}


def ffmpeg_scale_filter(aspect_ratio: str, method: str = "crop") -> str:
    width, height = ASPECT_RESOLUTIONS.get(aspect_ratio, ASPECT_RESOLUTIONS["9:16"])
    if method == "pad":
        return f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"
    if method == "scale":
        return f"scale={width}:{height},format=yuv420p"
    return f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p"


def make_base_video(brief: dict[str, Any], args: argparse.Namespace, out_dir: Path, duration: float, aspect: str) -> Path:
    ffmpeg = resolve_binary("ffmpeg")
    video = path_from(brief_value(brief, args, "video_file"))
    image = path_from(brief_value(brief, args, "image_file"))
    fit = str(brief.get("fit") or "crop")
    base = out_dir / "base_visual.mp4"

    if video and video.exists():
        video_start = safe_float(brief.get("video_start_seconds"), 0.0)
        cmd = [ffmpeg, "-y"]
        if video_start > 0:
            cmd += ["-ss", str(video_start)]
        cmd += ["-i", str(video), "-t", str(duration), "-vf", ffmpeg_scale_filter(aspect, fit), "-r", "30", "-an", "-c:v", "libx264", "-preset", "fast", str(base)]
    elif image and image.exists():
        cmd = [
            ffmpeg,
            "-y",
            "-loop",
            "1",
            "-i",
            str(image),
            "-t",
            str(duration),
            "-vf",
            ffmpeg_scale_filter(aspect, fit),
            "-r",
            "30",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            str(base),
        ]
    else:
        raise RuntimeError("render needs an existing video_file or image_file")

    result = run(cmd)
    if result.returncode != 0 or not base.exists() or base.stat().st_size <= 0:
        raise RuntimeError(f"base visual render failed: {result.stderr}")
    return base


def burn_lyrics(base_video: Path, lines: list[dict[str, Any]], out_dir: Path, aspect: str, duration: float) -> tuple[Path, dict[str, Any]]:
    if not lines:
        passthrough = out_dir / "captioned.mp4"
        shutil.copyfile(base_video, passthrough)
        return passthrough, {"enabled": False, "reason": "no lyric lines"}
    from core import captions as captions_mod

    ass_path = out_dir / "lyrics.ass"
    ass, style = captions_mod.build_caption_ass(
        lines,
        aspect_ratio=aspect,
        total_duration_s=duration,
        out_path=ass_path,
    )
    if ass is None:
        passthrough = out_dir / "captioned.mp4"
        shutil.copyfile(base_video, passthrough)
        return passthrough, {"enabled": False, "reason": "caption cues empty"}
    captioned = out_dir / "captioned.mp4"
    captions_mod.burn_captions(
        input_video=base_video,
        ass_path=ass,
        output_video=captioned,
        ffmpeg_path=resolve_binary("ffmpeg"),
    )
    return captioned, {
        "enabled": True,
        "ass_path": str(ass),
        "font_size": style.font_size,
        "margin_v": style.margin_v,
        "background_box": style.background_box,
    }


def mux_audio(video: Path, audio: Path | None, brief: dict[str, Any], out_dir: Path, duration: float) -> Path:
    final = out_dir / "final.mp4"
    if not audio or not audio.exists():
        shutil.copyfile(video, final)
        return final
    ffmpeg = resolve_binary("ffmpeg")
    audio_start = safe_float(brief.get("audio_start_seconds"), 0.0)
    cmd = [ffmpeg, "-y", "-i", str(video)]
    if audio_start > 0:
        cmd += ["-ss", str(audio_start)]
    cmd += ["-t", str(duration), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", str(final)]
    result = run(cmd)
    if result.returncode != 0 or not final.exists() or final.stat().st_size <= 0:
        raise RuntimeError(f"audio mux failed: {result.stderr}")
    return final


def output_dir_for(brief: dict[str, Any], args: argparse.Namespace) -> Path:
    root = Path(str(brief_value(brief, args, "output_dir") or (Path.cwd() / "outputs"))).expanduser().resolve()
    run_id = str(brief.get("run_id") or datetime.utcnow().strftime("genesis-lyric-%Y%m%d%H%M%S"))
    out = root / run_id
    out.mkdir(parents=True, exist_ok=True)
    return out


def command_doctor(_args: argparse.Namespace) -> None:
    checks: dict[str, Any] = {
        "vendor_root": str(GENESIS_ROOT),
        "vendor_exists": GENESIS_ROOT.exists(),
        "ffmpeg": usable_binary("ffmpeg"),
        "ffprobe": usable_binary("ffprobe"),
        "python": sys.executable,
    }
    imports: dict[str, bool] = {}
    for module in ["core.captions", "core.lyric_alignment", "core.media_binaries", "core.assembler", "core.typography"]:
        try:
            __import__(module)
            imports[module] = True
        except Exception:
            imports[module] = False
    checks["imports"] = imports
    checks["provider_spend_enabled"] = False
    checks["provider_generation_modules"] = "not bundled"
    ok = checks["vendor_exists"] and bool(checks["ffmpeg"]) and bool(checks["ffprobe"]) and imports["core.captions"]
    emit({"ok": ok, "mode": "runneros_genesis_lyric_doctor", **checks}, status=0 if ok else 1)


def command_plan(args: argparse.Namespace) -> None:
    brief = read_json(args.brief_file)
    duration = target_duration(brief, args)
    aspect = requested_aspect(brief)
    lines = normalized_lyric_lines(brief, duration)
    emit({
        "ok": aspect in ASPECT_RESOLUTIONS,
        "mode": "runneros_genesis_lyric_plan",
        "single_video_only": True,
        "duration_seconds": duration,
        "aspect_ratio": aspect,
        "supported_aspect_ratios": list(ASPECT_RESOLUTIONS.keys()),
        "lyric_line_count": len(lines),
        "lyric_lines": lines,
        "visual_source": "video_file" if brief.get("video_file") else ("image_file" if brief.get("image_file") else "needed"),
        "next_actions": [
            "Run storyboard first when the visual asset needs to be generated or creatively directed.",
            "Use or generate one visual asset as video_file or image_file.",
            "Run preflight before render.",
            "Run render only after explicit user approval.",
        ],
    })


def build_preflight(brief: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    duration = target_duration(brief, args)
    audio = path_from(brief_value(brief, args, "audio_file"))
    video = path_from(brief_value(brief, args, "video_file"))
    image = path_from(brief_value(brief, args, "image_file"))
    lines = normalized_lyric_lines(brief, duration)
    aspect = requested_aspect(brief)
    blockers: list[dict[str, str]] = numeric_blockers(brief, args) + path_blockers(brief)
    warnings: list[dict[str, str]] = []
    if aspect not in ASPECT_RESOLUTIONS:
        blockers.append({
            "code": "unsupported_aspect_ratio",
            "message": f"aspect_ratio must be one of: {', '.join(ASPECT_RESOLUTIONS.keys())}.",
        })
    if not usable_binary("ffmpeg"):
        blockers.append({"code": "missing_ffmpeg", "message": "FFmpeg is required for rendering lyric clips."})
    if not usable_binary("ffprobe"):
        blockers.append({"code": "missing_ffprobe", "message": "ffprobe is required for media inspection."})
    if audio and not audio.exists():
        blockers.append({"code": "missing_audio", "message": f"audio_file does not exist: {audio}"})
    if video and not video.exists():
        blockers.append({"code": "missing_video", "message": f"video_file does not exist: {video}"})
    if image and not image.exists():
        blockers.append({"code": "missing_image", "message": f"image_file does not exist: {image}"})
    if not video and not image:
        blockers.append({"code": "missing_visual", "message": "Render needs a video_file or image_file. Generate or attach one visual asset first."})
    if not lines:
        blockers.append({"code": "missing_lyrics", "message": "lyric clip needs lyrics or lyric_lines."})
    if not audio:
        warnings.append({"code": "no_audio", "message": "No audio_file provided; render will produce a silent captioned clip."})

    return {
        "ok": len(blockers) == 0,
        "provider_spend_enabled": False,
        "single_video_only": True,
        "duration_seconds": duration,
        "aspect_ratio": aspect,
        "supported_aspect_ratios": list(ASPECT_RESOLUTIONS.keys()),
        "render_ready": len(blockers) == 0,
        "blockers": blockers,
        "warnings": warnings,
        "inputs": {
            "audio_file": str(audio) if audio else None,
            "video_file": str(video) if video else None,
            "image_file": str(image) if image else None,
            "lyric_line_count": len(lines),
        },
        "audio": audio,
        "lines": lines,
    }


def command_preflight(args: argparse.Namespace) -> None:
    brief = read_json(args.brief_file)
    report = build_preflight(brief, args)
    emit({
        "mode": "runneros_genesis_lyric_preflight",
        **{key: value for key, value in report.items() if key not in {"audio", "lines"}},
    }, status=0 if report["ok"] else 1)


def command_render(args: argparse.Namespace) -> None:
    if not args.approved:
        emit({"ok": False, "code": "approval_required", "error": "Render requires --approved after preflight."}, status=1)
    brief = read_json(args.brief_file)
    preflight = build_preflight(brief, args)
    if not preflight["ok"]:
        emit({
            "ok": False,
            "mode": "runneros_genesis_lyric_render",
            "code": "preflight_blocked",
            "error": "Render blocked by preflight. Fix blockers before running with --approved.",
            **{key: value for key, value in preflight.items() if key not in {"audio", "lines"}},
        }, status=1)
    duration = float(preflight["duration_seconds"])
    aspect = str(preflight["aspect_ratio"])
    if aspect not in ASPECT_RESOLUTIONS:
        aspect = "9:16"
    audio = preflight["audio"]
    out_dir = output_dir_for(brief, args)
    lines = preflight["lines"]
    lines, alignment = maybe_align_lines(lines, brief, audio)
    try:
        base = make_base_video(brief, args, out_dir, duration, aspect)
        captioned, caption_report = burn_lyrics(base, lines, out_dir, aspect, duration)
        final = mux_audio(captioned, audio, brief, out_dir, duration)
    except Exception as exc:
        emit({"ok": False, "mode": "runneros_genesis_lyric_render", "error": str(exc), "output_dir": str(out_dir)}, status=1)

    report = {
        "ok": True,
        "mode": "runneros_genesis_lyric_render",
        "provider_spend_enabled": False,
        "single_video_only": True,
        "output_path": str(final),
        "output_dir": str(out_dir),
        "duration_seconds": probe_duration(final) or duration,
        "aspect_ratio": aspect,
        "caption_report": caption_report,
        "alignment": alignment,
        "lyric_lines": lines,
    }
    (out_dir / "render-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    emit(report)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RunnerOS Genesis lyric-video helper")
    sub = parser.add_subparsers(dest="command", required=True)
    doctor = sub.add_parser("doctor")
    doctor.add_argument("--json", action="store_true")
    for name in ["storyboard", "plan", "preflight", "render"]:
        p = sub.add_parser(name)
        p.add_argument("--brief-file")
        p.add_argument("--audio-file")
        p.add_argument("--video-file")
        p.add_argument("--image-file")
        p.add_argument("--output-dir")
        p.add_argument("--duration-seconds", type=float)
        p.add_argument("--json", action="store_true")
        if name == "render":
            p.add_argument("--approved", action="store_true")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "doctor":
        command_doctor(args)
    if args.command == "storyboard":
        command_storyboard(args)
    if args.command == "plan":
        command_plan(args)
    if args.command == "preflight":
        command_preflight(args)
    if args.command == "render":
        command_render(args)
    emit({"ok": False, "error": f"Unknown command: {args.command}"}, status=1)


if __name__ == "__main__":
    main()
