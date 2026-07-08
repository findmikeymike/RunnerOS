#!/usr/bin/env python3
"""Create a no-provider-spend music-only remix from an existing production run."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CaptionStyle
from creative.production.output_qa import run_free_smoke_media_qa
from creative.production.post_pass import FfmpegCaptionBurnInAdapter
from scripts.show_creative_production_run import load_manifest, resolve_manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Remix an existing production run with a user-supplied music file.")
    parser.add_argument("--run-id", help="Source production run id")
    parser.add_argument("--manifest", help="Path to source manifest.json")
    parser.add_argument("--latest", action="store_true", help="Use newest creative-production manifest")
    parser.add_argument("--output-root", default=".outputs/creative-production")
    parser.add_argument("--music-file", required=True, help="Actual user-supplied music file to mix under narration")
    parser.add_argument("--new-run-id", required=True, help="Output run id for the remix artifact")
    parser.add_argument("--music-gain-db", type=float, default=-18.0, help="Gain applied to supplied music before mixing")
    parser.add_argument("--ffmpeg-bin", default="ffmpeg")
    parser.add_argument("--tesseract-bin", default="tesseract")
    return parser


def remix_music(
    *,
    source_manifest_path: Path,
    music_file: Path,
    new_run_id: str,
    music_gain_db: float,
    output_root: Path,
    ffmpeg_binary: str,
    tesseract_binary: str,
    command_runner=subprocess.run,
) -> dict:
    source_manifest = load_manifest(source_manifest_path)
    source_run_dir = source_manifest_path.parent
    output_dir = output_root / new_run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    source_video = _resolve_existing(source_run_dir, _source_video_path(source_manifest_path, source_manifest), label="source video")
    voiceover = _resolve_existing(source_run_dir, _source_voiceover_path(source_manifest), label="voiceover")
    captions_srt = _resolve_existing(source_run_dir, _source_captions_srt(source_manifest), label="captions srt")
    if not music_file.exists():
        raise SystemExit(f"music file not found: {music_file}")

    duration_s = float((source_manifest.get("final_assembly") or {}).get("duration_s") or 0.0)
    if duration_s <= 0:
        duration_s = float(((source_manifest.get("post_pass_plan") or {}).get("output_probe") or {}).get("duration_s") or 0.0)
    if duration_s <= 0:
        raise SystemExit("source manifest does not include a usable duration")

    mixed_path = output_dir / "final-audio-mix.mp4"
    final_path = output_dir / "final-captioned.mp4"
    contact_sheet_path = output_dir / "contact-sheet.jpg"
    command_runner(
        build_music_mix_command(
            ffmpeg_binary=ffmpeg_binary,
            source_video=source_video,
            voiceover=voiceover,
            music_file=music_file,
            output_path=mixed_path,
            duration_s=duration_s,
            music_gain_db=music_gain_db,
        ),
        check=True,
        capture_output=True,
        text=True,
    )
    _ensure_file(mixed_path, "mixed video")
    style = CaptionStyle(**((source_manifest.get("post_pass_plan") or {}).get("caption_style") or {}))
    FfmpegCaptionBurnInAdapter(ffmpeg_binary=ffmpeg_binary).render_captions(
        input_video=mixed_path,
        captions_srt=captions_srt,
        output_video=final_path,
        style=style,
    )
    command_runner(
        [
            ffmpeg_binary,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(final_path),
            "-vf",
            "fps=1/2,scale=216:-1,tile=4x3",
            "-frames:v",
            "1",
            str(contact_sheet_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    brief = CreativeBrief(**json.loads((source_run_dir / "brief.json").read_text(encoding="utf-8")))
    caption_cues = tuple(SimpleNamespace(text=cue.get("text", "")) for cue in (source_manifest.get("post_pass_plan") or {}).get("caption_cues") or [])
    qa = run_free_smoke_media_qa(
        final_asset_path=final_path,
        output_dir=output_dir,
        brief=brief,
        caption_cues=caption_cues,
        video_model_ids=tuple(clip.get("model_id") for clip in source_manifest.get("video_attempt_history") or []),
        ffmpeg_binary=ffmpeg_binary,
        tesseract_binary=tesseract_binary,
    )
    manifest = {
        "run_id": new_run_id,
        "source_run_id": source_manifest.get("run_id"),
        "source_manifest_path": str(source_manifest_path),
        "operation": "music_only_remix",
        "music_file": str(music_file),
        "music_gain_db": music_gain_db,
        "source_video": str(source_video),
        "source_voiceover": str(voiceover),
        "source_captions_srt": str(captions_srt),
        "audio_mix_path": str(mixed_path),
        "final_asset_path": str(final_path),
        "contact_sheet": str(contact_sheet_path),
        "free_output_qa": qa,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def build_music_mix_command(
    *,
    ffmpeg_binary: str,
    source_video: Path,
    voiceover: Path,
    music_file: Path,
    output_path: Path,
    duration_s: float,
    music_gain_db: float,
) -> list[str]:
    music_volume = 10 ** (music_gain_db / 20)
    fade_out_start = max(0.0, duration_s - 1.0)
    filter_complex = ";".join(
        (
            f"[1:a]aresample=48000,volume=1.0,apad,atrim=duration={duration_s:.3f}[voice]",
            (
                f"[2:a]aresample=48000,volume={music_volume:.8f},atrim=duration={duration_s:.3f},"
                f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_start:.3f}:d=1.0[music]"
            ),
            "[voice][music]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1:normalize=0,alimiter=limit=0.95[aout]",
        )
    )
    return [
        ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_video),
        "-i",
        str(voiceover),
        "-stream_loop",
        "-1",
        "-i",
        str(music_file),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        f"{duration_s:.3f}",
        str(output_path),
    ]


def _source_video_path(manifest_path: Path, manifest: dict) -> str | None:
    video_only = manifest_path.with_name("final-video-only.mp4")
    if video_only.exists():
        return str(video_only)
    run_dir_video = (manifest.get("final_assembly") or {}).get("asset_path")
    post_source = (manifest.get("post_pass_plan") or {}).get("source_asset_path")
    return post_source or run_dir_video


def _source_voiceover_path(manifest: dict) -> str | None:
    return (manifest.get("voice_asset") or {}).get("asset_path") or (manifest.get("final_assembly") or {}).get("audio_asset_path")


def _source_captions_srt(manifest: dict) -> str | None:
    return (manifest.get("post_pass_plan") or {}).get("srt_path")


def _resolve_existing(run_dir: Path, path_value: str | None, *, label: str) -> Path:
    if not path_value:
        raise SystemExit(f"source manifest missing {label}")
    path = Path(path_value)
    candidates = (path, run_dir / path)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(f"{label} not found: {path_value}")


def _ensure_file(path: Path, label: str) -> None:
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError(f"{label} was not created: {path}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    source_manifest_path = resolve_manifest_path(
        run_id=args.run_id,
        manifest=args.manifest,
        latest=args.latest,
        output_root=args.output_root,
    )
    result = remix_music(
        source_manifest_path=source_manifest_path,
        music_file=Path(args.music_file),
        new_run_id=args.new_run_id,
        music_gain_db=args.music_gain_db,
        output_root=Path(args.output_root),
        ffmpeg_binary=args.ffmpeg_bin,
        tesseract_binary=args.tesseract_bin,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
