#!/usr/bin/env python3
"""Create a no-provider-spend clip replacement remix from an existing production run."""

from __future__ import annotations

import argparse
import json
import shlex
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
from scripts.remix_creative_production_music import (
    _ensure_file,
    _resolve_existing,
    _source_captions_srt,
    _source_voiceover_path,
    build_music_mix_command,
)
from scripts.show_creative_production_run import load_manifest, resolve_manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Replace selected clip indexes and rebuild a production run.")
    parser.add_argument("--run-id", help="Source production run id")
    parser.add_argument("--manifest", help="Path to source manifest.json")
    parser.add_argument("--latest", action="store_true", help="Use newest creative-production manifest")
    parser.add_argument("--output-root", default=".outputs/creative-production")
    parser.add_argument("--new-run-id", required=True)
    parser.add_argument(
        "--replace",
        action="append",
        default=[],
        metavar="INDEX=PATH",
        help="1-based clip replacement. Repeatable, e.g. --replace 3=/tmp/new-scene.mp4",
    )
    parser.add_argument("--music-file", help="Optional user-supplied music file to mix under narration")
    parser.add_argument("--music-gain-db", type=float, default=-18.0)
    parser.add_argument("--ffmpeg-bin", default="ffmpeg")
    parser.add_argument("--tesseract-bin", default="tesseract")
    return parser


def replace_clips(
    *,
    source_manifest_path: Path,
    replacements: dict[int, Path],
    new_run_id: str,
    output_root: Path,
    ffmpeg_binary: str,
    tesseract_binary: str,
    music_file: Path | None = None,
    music_gain_db: float = -18.0,
    command_runner=subprocess.run,
) -> dict:
    source_manifest = load_manifest(source_manifest_path)
    source_run_dir = source_manifest_path.parent
    output_dir = output_root / new_run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    source_clips = _source_clip_paths(source_manifest)
    clip_paths = apply_replacements(source_clips=source_clips, replacements=replacements, run_dir=source_run_dir)
    concat_path = output_dir / "concat-list.txt"
    video_only_path = output_dir / "final-video-only.mp4"
    write_concat_list(concat_path=concat_path, clip_paths=clip_paths)
    command_runner(
        [
            ffmpeg_binary,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-c",
            "copy",
            str(video_only_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    _ensure_file(video_only_path, "video-only replacement assembly")
    voiceover = _resolve_existing(source_run_dir, _source_voiceover_path(source_manifest), label="voiceover")
    captions_srt = _resolve_existing(source_run_dir, _source_captions_srt(source_manifest), label="captions srt")
    duration_s = float((source_manifest.get("final_assembly") or {}).get("duration_s") or 0.0)
    if duration_s <= 0:
        raise SystemExit("source manifest does not include a usable duration")
    audio_mix_path = output_dir / "final-audio-mix.mp4"
    if music_file is not None:
        if not music_file.exists():
            raise SystemExit(f"music file not found: {music_file}")
        mix_cmd = build_music_mix_command(
            ffmpeg_binary=ffmpeg_binary,
            source_video=video_only_path,
            voiceover=voiceover,
            music_file=music_file,
            output_path=audio_mix_path,
            duration_s=duration_s,
            music_gain_db=music_gain_db,
        )
    else:
        mix_cmd = build_voice_mix_command(
            ffmpeg_binary=ffmpeg_binary,
            source_video=video_only_path,
            voiceover=voiceover,
            output_path=audio_mix_path,
            duration_s=duration_s,
        )
    command_runner(mix_cmd, check=True, capture_output=True, text=True)
    _ensure_file(audio_mix_path, "replacement audio mix")
    final_path = output_dir / "final-captioned.mp4"
    style = CaptionStyle(**((source_manifest.get("post_pass_plan") or {}).get("caption_style") or {}))
    FfmpegCaptionBurnInAdapter(ffmpeg_binary=ffmpeg_binary).render_captions(
        input_video=audio_mix_path,
        captions_srt=captions_srt,
        output_video=final_path,
        style=style,
    )
    contact_sheet_path = output_dir / "contact-sheet.jpg"
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
        "operation": "clip_replacement_remix",
        "replacements": {str(index): str(path) for index, path in sorted(replacements.items())},
        "source_clip_paths": [str(path) for path in source_clips],
        "final_clip_paths": [str(path) for path in clip_paths],
        "music_file": str(music_file) if music_file else None,
        "music_gain_db": music_gain_db if music_file else None,
        "source_voiceover": str(voiceover),
        "source_captions_srt": str(captions_srt),
        "video_only_path": str(video_only_path),
        "audio_mix_path": str(audio_mix_path),
        "final_asset_path": str(final_path),
        "contact_sheet": str(contact_sheet_path),
        "free_output_qa": qa,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def parse_replacements(values: list[str]) -> dict[int, Path]:
    replacements: dict[int, Path] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"replacement must be INDEX=PATH: {value}")
        raw_index, raw_path = value.split("=", 1)
        try:
            index = int(raw_index)
        except ValueError as exc:
            raise SystemExit(f"replacement index must be an integer: {raw_index}") from exc
        if index <= 0:
            raise SystemExit(f"replacement index must be 1 or greater: {index}")
        path = Path(raw_path)
        if not path.exists():
            raise SystemExit(f"replacement clip not found: {path}")
        replacements[index] = path
    if not replacements:
        raise SystemExit("pass at least one --replace INDEX=PATH")
    return replacements


def apply_replacements(*, source_clips: list[Path], replacements: dict[int, Path], run_dir: Path) -> list[Path]:
    clips = [_resolve_existing(run_dir, str(path), label=f"source clip {index}") for index, path in enumerate(source_clips, start=1)]
    for index, path in replacements.items():
        if index > len(clips):
            raise SystemExit(f"replacement index {index} exceeds clip count {len(clips)}")
        clips[index - 1] = path
    return clips


def write_concat_list(*, concat_path: Path, clip_paths: list[Path]) -> None:
    concat_path.write_text(
        "\n".join(f"file {shlex.quote(str(path.resolve()))}" for path in clip_paths) + "\n",
        encoding="utf-8",
    )


def build_voice_mix_command(*, ffmpeg_binary: str, source_video: Path, voiceover: Path, output_path: Path, duration_s: float) -> list[str]:
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
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-t",
        f"{duration_s:.3f}",
        str(output_path),
    ]


def _source_clip_paths(manifest: dict) -> list[Path]:
    clips = [Path(str(clip.get("asset_path"))) for clip in manifest.get("video_attempt_history") or [] if clip.get("asset_path")]
    if not clips:
        raise SystemExit("source manifest does not include video clip paths")
    return clips


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    source_manifest_path = resolve_manifest_path(
        run_id=args.run_id,
        manifest=args.manifest,
        latest=args.latest,
        output_root=args.output_root,
    )
    result = replace_clips(
        source_manifest_path=source_manifest_path,
        replacements=parse_replacements(args.replace),
        new_run_id=args.new_run_id,
        output_root=Path(args.output_root),
        ffmpeg_binary=args.ffmpeg_bin,
        tesseract_binary=args.tesseract_bin,
        music_file=Path(args.music_file) if args.music_file else None,
        music_gain_db=args.music_gain_db,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
