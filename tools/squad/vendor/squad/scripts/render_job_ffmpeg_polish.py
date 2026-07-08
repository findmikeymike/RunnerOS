#!/usr/bin/env python3
"""Simple command renderer for Squad render-job JSON.

This is the local, dependable renderer worker. It is intentionally not a
HyperFrames clone; it proves the external render seam with ffmpeg while keeping
the same job contract a future HyperFrames/Remotion worker will consume.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: render_job_ffmpeg_polish.py RENDER_JOB_JSON", file=sys.stderr)
        return 2

    job_path = Path(args[0])
    job = json.loads(job_path.read_text(encoding="utf-8"))
    input_video = Path(_required(job, "input_video"))
    output_video = Path(_required(job, "output_video"))
    if not input_video.exists():
        raise RuntimeError(f"input video does not exist: {input_video}")

    output_video.parent.mkdir(parents=True, exist_ok=True)
    captions = _usable_captions(job)
    if captions:
        ass_path = output_video.with_suffix(".ass")
        ass_path.write_text(_render_ass(captions, job), encoding="utf-8")
        _run_ffmpeg(
            [
                _ffmpeg_binary(),
                "-y",
                "-i",
                str(input_video),
                "-vf",
                f"subtitles={_ffmpeg_filter_path(ass_path)}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                str(output_video),
            ]
        )
    else:
        _run_ffmpeg(
            [
                _ffmpeg_binary(),
                "-y",
                "-i",
                str(input_video),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(output_video),
            ]
        )

    print(json.dumps({"asset_path": str(output_video)}))
    return 0


def _required(job: dict, key: str) -> str:
    value = str(job.get(key) or "").strip()
    if not value:
        raise RuntimeError(f"render job missing `{key}`")
    return value


def _usable_captions(job: dict) -> list[dict]:
    captions = []
    for cue in job.get("caption_intent") or []:
        text = str(cue.get("text") or "").strip()
        start_s = float(cue.get("start_s") or 0.0)
        end_s = float(cue.get("end_s") or 0.0)
        if text and end_s > start_s:
            captions.append({"text": _fit_caption(text), "start_s": start_s, "end_s": end_s})
    return captions


def _fit_caption(text: str) -> str:
    words = text.replace("\n", " ").split()
    if len(words) <= 5:
        return " ".join(words)
    return " ".join(words[:5]) + r"\N" + " ".join(words[5:10])


def _render_ass(captions: list[dict], job: dict) -> str:
    style = _style_for_job(job)
    events = [
        "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}".format(
            start=_ass_time(cue["start_s"]),
            end=_ass_time(cue["end_s"]),
            text=_escape_ass_text(cue["text"]),
        )
        for cue in captions
    ]
    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {style['play_res_x']}",
            f"PlayResY: {style['play_res_y']}",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: Default,{font},{font_size},{primary},&H00FFFFFF,{outline},&H66000000,-1,0,0,0,100,100,0,0,1,{outline_width},1,2,70,70,{margin_v},1".format(
                font=style["font"],
                font_size=style["font_size"],
                primary=style["primary_color"],
                outline=style["outline_color"],
                outline_width=style["outline_width"],
                margin_v=style["margin_v"],
            ),
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )


def _style_for_job(job: dict) -> dict:
    aspect_ratio = _aspect_ratio(job)
    caption_style = job.get("caption_style") or {}
    if aspect_ratio == "16:9":
        defaults = {"play_res_x": 1920, "play_res_y": 1080, "font_size": 48, "margin_v": 70}
    elif aspect_ratio == "1:1":
        defaults = {"play_res_x": 1080, "play_res_y": 1080, "font_size": 46, "margin_v": 60}
    else:
        defaults = {"play_res_x": 1080, "play_res_y": 1920, "font_size": 62, "margin_v": 150}
    return {
        **defaults,
        "font": str(caption_style.get("font") or "Aptos"),
        "primary_color": str(caption_style.get("primary_color") or "&H00FFFFFF"),
        "outline_color": str(caption_style.get("outline_color") or "&H00000000"),
        "outline_width": int(caption_style.get("outline_width") or 4),
        "font_size": int(caption_style.get("font_size") or defaults["font_size"]),
        "margin_v": int(caption_style.get("margin_v") or defaults["margin_v"]),
    }


def _aspect_ratio(job: dict) -> str:
    format_plan = job.get("format") or {}
    platform_profile = format_plan.get("platform_profile") or {}
    return str(platform_profile.get("aspect_ratio") or "").strip() or "9:16"


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def _escape_ass_text(text: str) -> str:
    return text.replace("{", r"\{").replace("}", r"\}")


def _ffmpeg_filter_path(path: Path) -> str:
    return shlex.quote(str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", r"\'"))


def _ffmpeg_binary() -> str:
    return os.getenv("SQUAD_FFMPEG_BINARY") or "ffmpeg"


def _run_ffmpeg(cmd: list[str]) -> None:
    completed = subprocess.run(cmd, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffmpeg render failed")


if __name__ == "__main__":
    raise SystemExit(main())
