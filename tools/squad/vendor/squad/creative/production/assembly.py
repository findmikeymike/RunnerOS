from __future__ import annotations

import shlex
import subprocess
from subprocess import CalledProcessError
from dataclasses import dataclass
import json
from pathlib import Path

from creative.production.contracts import AudioAssetRecord, FinalAssemblyRecord, UgcRenderModePlan, VideoClipRecord


def _run_subprocess(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        message = f"assembly command failed with exit code {exc.returncode}"
        raise RuntimeError(f"{message}: {detail}" if detail else message) from exc


@dataclass(slots=True)
class FfmpegAssemblyAdapter:
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    command_runner: callable | None = None

    def concatenate_clips(
        self,
        *,
        run_id: str,
        clips: list[VideoClipRecord],
        voice_asset: AudioAssetRecord | None = None,
        output_root: Path | str = ".outputs/creative-production",
    ) -> FinalAssemblyRecord:
        if not clips:
            raise RuntimeError("cannot assemble video without clips")
        for clip in clips:
            if clip.asset_path is None or not clip.asset_path.exists():
                raise RuntimeError(f"clip file does not exist: {clip.asset_path}")
        if voice_asset is not None and not voice_asset.asset_path.exists():
            raise RuntimeError(f"voice asset file does not exist: {voice_asset.asset_path}")

        run_dir = Path(output_root) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        runner = self.command_runner or _run_subprocess

        normalized_clips = self._normalize_clips_if_needed(
            clips=clips,
            run_dir=run_dir,
            runner=runner,
        )
        concat_method = "ffmpeg_concat_normalized" if normalized_clips is not clips else "ffmpeg_concat"

        concat_list = run_dir / "concat-list.txt"
        output_path = run_dir / "final.mp4"
        video_only_path = run_dir / "final-video-only.mp4" if voice_asset else output_path
        concat_list.write_text(
            "\n".join(f"file {shlex.quote(str(clip.asset_path.resolve()))}" for clip in normalized_clips) + "\n",
            encoding="utf-8",
        )

        cmd = [
            self.ffmpeg_binary,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(video_only_path),
        ]
        runner(cmd)
        _ensure_output_file(video_only_path, context="video assembly")
        if voice_asset is not None:
            runner(
                [
                    self.ffmpeg_binary,
                    "-y",
                    "-i",
                    str(video_only_path),
                    "-i",
                    str(voice_asset.asset_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    str(output_path),
                ]
            )
            _ensure_output_file(output_path, context="voice assembly")

        method = f"{concat_method}_with_audio" if voice_asset else concat_method
        return FinalAssemblyRecord(
            asset_path=output_path,
            clip_count=len(clips),
            duration_s=_sum_durations(clips),
            assembly_method=method,
            source_clip_ids=tuple(clip.clip_id for clip in clips),
            audio_asset_path=voice_asset.asset_path if voice_asset else None,
        )

    def _normalize_clips_if_needed(
        self,
        *,
        clips: list[VideoClipRecord],
        run_dir: Path,
        runner: callable,
    ) -> list[VideoClipRecord]:
        if len(clips) <= 1:
            return clips
        signatures = [self._probe_clip_signature(clip.asset_path) for clip in clips]
        if any(sig is None for sig in signatures):
            # Probe failed for at least one clip — preserve historical fast path.
            return clips
        if all(sig == signatures[0] for sig in signatures):
            return clips
        # Heterogeneous signatures — normalize to a common canvas before concat.
        target_width = max(int(sig["width"]) for sig in signatures)
        target_height = max(int(sig["height"]) for sig in signatures)
        # Snap to even dims (H264 requires).
        target_width += target_width % 2
        target_height += target_height % 2
        normalized_dir = run_dir / "normalized-clips"
        normalized_dir.mkdir(parents=True, exist_ok=True)
        normalized: list[VideoClipRecord] = []
        for index, clip in enumerate(clips, start=1):
            normalized_path = normalized_dir / f"clip-{index:02d}-{clip.clip_id}.mp4"
            self._normalize_clip(
                source_path=clip.asset_path,
                output_path=normalized_path,
                target_width=target_width,
                target_height=target_height,
                runner=runner,
            )
            normalized.append(
                VideoClipRecord(
                    clip_id=clip.clip_id,
                    source_still_id=clip.source_still_id,
                    asset_path=normalized_path,
                    duration_s=clip.duration_s,
                    score=clip.score,
                    verdict=clip.verdict,
                    prompt_summary=clip.prompt_summary,
                    attempt_index=clip.attempt_index,
                    cost_usd=clip.cost_usd,
                    model_id=clip.model_id,
                    model_route_reason=clip.model_route_reason,
                    provider_request_id=clip.provider_request_id,
                )
            )
        return normalized

    def _probe_clip_signature(self, path: Path) -> dict | None:
        try:
            completed = subprocess.run(
                [
                    self.ffprobe_binary,
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height,codec_name,pix_fmt,sample_aspect_ratio,r_frame_rate",
                    "-of",
                    "json",
                    str(path),
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
        try:
            width = int(stream.get("width"))
            height = int(stream.get("height"))
        except (TypeError, ValueError):
            return None
        return {
            "width": width,
            "height": height,
            "codec_name": str(stream.get("codec_name") or ""),
            "pix_fmt": str(stream.get("pix_fmt") or ""),
            "sample_aspect_ratio": str(stream.get("sample_aspect_ratio") or ""),
            "r_frame_rate": str(stream.get("r_frame_rate") or ""),
        }

    def _normalize_clip(
        self,
        *,
        source_path: Path,
        output_path: Path,
        target_width: int,
        target_height: int,
        runner: callable,
    ) -> None:
        scale_pad = (
            f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
            f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2,"
            "setsar=1"
        )
        runner(
            [
                self.ffmpeg_binary,
                "-y",
                "-i",
                str(source_path),
                "-vf",
                scale_pad,
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-an",
                str(output_path),
            ]
        )
        _ensure_output_file(output_path, context="clip normalize")

    def compose_picture_in_picture(
        self,
        *,
        run_id: str,
        base_video_path: Path,
        presenter_video_path: Path,
        render_mode: UgcRenderModePlan | None = None,
        loop_base_to_presenter: bool = False,
        presenter_duration_s: float | None = None,
        output_root: Path | str = ".outputs/creative-production",
    ) -> FinalAssemblyRecord:
        if not base_video_path.exists():
            raise RuntimeError(f"base video file does not exist: {base_video_path}")
        if not presenter_video_path.exists():
            raise RuntimeError(f"presenter video file does not exist: {presenter_video_path}")

        plan = render_mode or UgcRenderModePlan(mode="avatar_pip_overlay")
        if plan.mode != "avatar_pip_overlay":
            raise RuntimeError(f"unsupported UGC render mode for PIP compositor: {plan.mode}")
        run_dir = Path(output_root) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        output_path = run_dir / "final-ugc-pip.mp4"
        filter_complex = _pip_filter_complex(plan)
        cmd = [
            self.ffmpeg_binary,
            "-y",
        ]
        if loop_base_to_presenter:
            cmd.extend(["-stream_loop", "-1"])
        cmd.extend(
            [
                "-i",
                str(base_video_path),
                "-i",
                str(presenter_video_path),
                "-filter_complex",
                filter_complex,
                "-map",
                "[vout]",
                "-map",
                "1:a:0" if plan.preserve_presenter_audio else "0:a:0?",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(output_path),
            ]
        )
        runner = self.command_runner or _run_subprocess
        runner(cmd)
        _ensure_output_file(output_path, context="UGC PIP assembly")
        duration_s = _first_positive_float(
            presenter_duration_s,
            _probe_duration_s(output_path, ffprobe_binary=self.ffprobe_binary),
            _probe_duration_s(presenter_video_path, ffprobe_binary=self.ffprobe_binary),
        )
        return FinalAssemblyRecord(
            asset_path=output_path,
            clip_count=2,
            duration_s=duration_s,
            assembly_method="ffmpeg_ugc_pip_overlay",
            source_clip_ids=("base_video", "presenter_video"),
            audio_asset_path=presenter_video_path if plan.preserve_presenter_audio else None,
        )


def _sum_durations(clips: list[VideoClipRecord]) -> float | None:
    durations = [clip.duration_s for clip in clips]
    if any(duration is None for duration in durations):
        return None
    return round(sum(float(duration) for duration in durations), 6)


def _ensure_output_file(path: Path, *, context: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{context} command did not create output file: {path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"{context} command created an empty output file: {path}")


def _probe_duration_s(path: Path, *, ffprobe_binary: str) -> float | None:
    try:
        completed = subprocess.run(
            [
                ffprobe_binary,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(completed.stdout or "{}")
    except Exception:
        return None
    return _positive_float((payload.get("format") or {}).get("duration"))


def _first_positive_float(*values: float | str | None) -> float | None:
    for value in values:
        parsed = _positive_float(value)
        if parsed is not None:
            return parsed
    return None


def _positive_float(value: float | str | None) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return round(parsed, 6) if parsed > 0 else None


def _pip_filter_complex(plan: UgcRenderModePlan) -> str:
    width_expr = f"iw*{_ratio(plan.presenter_width_ratio)}"
    margin_x = f"W*{_ratio(plan.margin_ratio)}"
    margin_y = f"H*{_ratio(plan.margin_ratio)}"
    if plan.presenter_position == "bottom_left":
        overlay_xy = f"{margin_x}:H-h-{margin_y}"
    elif plan.presenter_position == "top_right":
        overlay_xy = f"W-w-{margin_x}:{margin_y}"
    elif plan.presenter_position == "top_left":
        overlay_xy = f"{margin_x}:{margin_y}"
    else:
        overlay_xy = f"W-w-{margin_x}:H-h-{margin_y}"
    presenter_chain = (
        f"[1:v]chromakey={plan.chromakey_color}:"
        f"{_ratio(plan.chromakey_similarity)}:{_ratio(plan.chromakey_blend)},"
        f"scale={width_expr}:-1[presenter]"
    )
    return f"{presenter_chain};[0:v][presenter]overlay={overlay_xy}:format=auto[vout]"


def _ratio(value: float) -> str:
    bounded = max(0.0, min(float(value), 1.0))
    return f"{bounded:.4f}".rstrip("0").rstrip(".")
