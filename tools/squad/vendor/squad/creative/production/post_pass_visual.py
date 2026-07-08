"""Visual polish post-pass.

Slots between assembly+audio_mix and post_pass (captions+loudnorm) in the
production graph. Two stages:

  1. Upscale (free, local ffmpeg lanczos + unsharp) — runs when source is
     shorter than `target_height`. Captions then burn in at the polished
     resolution rather than the raw provider resolution.
  2. Frame interpolation (optional, ~$0.001/sec via fal-ai/film) — runs only
     when an interpolation adapter is configured.

Default behaviour with no adapter / no target_height is a no-op, preserving
backward compatibility.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from subprocess import CalledProcessError
from typing import Protocol

from creative.production.contracts import (
    CreativeProductionState,
    VisualPolishPlan,
)


def _run_subprocess(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(
            f"visual polish command failed with exit code {exc.returncode}: {detail}"
        ) from exc


def _ensure_output_file(path: Path, *, context: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{context} did not create output file: {path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"{context} created an empty output file: {path}")


class VisualUpscaleAdapter(Protocol):
    def upscale(
        self,
        *,
        input_video: Path,
        output_video: Path,
        target_height: int,
    ) -> Path: ...


class FrameInterpolationAdapter(Protocol):
    def interpolate(
        self,
        *,
        input_video: Path,
        output_video: Path,
        target_fps: int,
    ) -> Path: ...


@dataclass(slots=True)
class FfmpegUpscaleAdapter:
    """Free local upscaler. Scales to `target_height` preserving aspect ratio
    with lanczos resampling and a light unsharp mask. Forces even dimensions
    (H264 requirement).
    """

    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    command_runner: callable | None = None
    unsharp_filter: str = "unsharp=5:5:0.8:5:5:0.0"

    def upscale(
        self,
        *,
        input_video: Path,
        output_video: Path,
        target_height: int,
    ) -> Path:
        if not input_video.exists():
            raise RuntimeError(f"upscale input does not exist: {input_video}")
        if target_height < 64 or target_height % 2:
            raise RuntimeError(f"target_height must be an even integer >= 64: {target_height}")
        output_video.parent.mkdir(parents=True, exist_ok=True)
        # -2 keeps the other axis even-divisible while preserving aspect ratio.
        vf = f"scale=-2:{target_height}:flags=lanczos,{self.unsharp_filter}"
        cmd = [
            self.ffmpeg_binary,
            "-y",
            "-i",
            str(input_video),
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            str(output_video),
        ]
        runner = self.command_runner or _run_subprocess
        runner(cmd)
        _ensure_output_file(output_video, context="visual upscale")
        return output_video


def probe_video_dimensions(
    *,
    asset_path: Path,
    ffprobe_binary: str = "ffprobe",
) -> tuple[int, int] | None:
    """Return (width, height) of first video stream or None on failure."""
    try:
        completed = subprocess.run(
            [
                ffprobe_binary,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "json",
                str(asset_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(completed.stdout or "{}")
    except Exception:
        return None
    streams = payload.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    width = stream.get("width")
    height = stream.get("height")
    try:
        return int(width), int(height)
    except (TypeError, ValueError):
        return None


def build_visual_polish_plan(
    *,
    state: CreativeProductionState,
    upscale_adapter: VisualUpscaleAdapter | None = None,
    interpolation_adapter: FrameInterpolationAdapter | None = None,
    target_height: int | None = None,
    target_fps: int | None = None,
    ffprobe_binary: str = "ffprobe",
    output_root: Path | str = ".outputs/creative-production",
) -> VisualPolishPlan:
    if state.final_assembly is None or state.final_assembly.asset_path is None:
        return VisualPolishPlan(status="disabled", notes="no final assembly to polish")
    source_path = state.final_assembly.asset_path
    if upscale_adapter is None or target_height is None:
        return VisualPolishPlan(
            status="disabled",
            source_asset_path=source_path,
            notes="visual polish not configured",
        )
    dims = probe_video_dimensions(asset_path=source_path, ffprobe_binary=ffprobe_binary)
    if dims is None:
        return VisualPolishPlan(
            status="failed",
            source_asset_path=source_path,
            error="could not probe source dimensions",
            notes="visual polish skipped; preserving source asset",
        )
    source_width, source_height = dims
    target_height_even = target_height + (target_height % 2)
    if source_height >= target_height_even:
        return VisualPolishPlan(
            status="skipped_already_target",
            source_asset_path=source_path,
            polished_asset_path=source_path,
            source_width=source_width,
            source_height=source_height,
            target_height=target_height_even,
            target_fps=target_fps,
            notes=f"source {source_width}x{source_height} already meets target height {target_height_even}",
        )
    run_dir = Path(output_root) / state.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    upscaled_path = run_dir / "final-upscaled.mp4"
    applied: list[str] = []
    try:
        upscale_adapter.upscale(
            input_video=source_path,
            output_video=upscaled_path,
            target_height=target_height_even,
        )
    except Exception as exc:
        return VisualPolishPlan(
            status="failed",
            source_asset_path=source_path,
            source_width=source_width,
            source_height=source_height,
            target_height=target_height_even,
            target_fps=target_fps,
            error=f"upscale failed: {exc}",
            notes="visual polish failed; preserving source asset",
        )
    applied.append("upscale")
    polished_path = upscaled_path
    polished_dims = probe_video_dimensions(asset_path=upscaled_path, ffprobe_binary=ffprobe_binary)
    target_width = polished_dims[0] if polished_dims else None

    if interpolation_adapter is not None and target_fps:
        interpolated_path = run_dir / "final-interpolated.mp4"
        try:
            interpolation_adapter.interpolate(
                input_video=upscaled_path,
                output_video=interpolated_path,
                target_fps=int(target_fps),
            )
            polished_path = interpolated_path
            applied.append("interpolate")
        except Exception as exc:
            return VisualPolishPlan(
                status="upscaled",
                source_asset_path=source_path,
                polished_asset_path=upscaled_path,
                source_width=source_width,
                source_height=source_height,
                target_width=target_width,
                target_height=target_height_even,
                target_fps=target_fps,
                applied_steps=tuple(applied),
                error=f"interpolation failed after upscale: {exc}",
                notes="upscale succeeded; interpolation failed; using upscaled asset",
            )

    status = "upscaled_interpolated" if "interpolate" in applied else "upscaled"
    return VisualPolishPlan(
        status=status,
        source_asset_path=source_path,
        polished_asset_path=polished_path,
        source_width=source_width,
        source_height=source_height,
        target_width=target_width,
        target_height=target_height_even,
        target_fps=target_fps,
        applied_steps=tuple(applied),
        notes=f"polished from {source_width}x{source_height} to {target_width or '?'}x{target_height_even}",
    )
