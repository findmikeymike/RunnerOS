"""
Video Assembler Module
Stitches video clips together with transitions using FFmpeg/MoviePy.

Supports:
- Multiple clips concatenation
- Transition effects (cuts, fades, flashes)
- Audio overlay
- Multiple aspect ratio exports
"""

import os
import subprocess
from pathlib import Path
from typing import Optional, Literal
from dataclasses import dataclass

from core.media_binaries import resolve_media_binary


@dataclass
class AssemblyResult:
    """Result from video assembly."""
    output_path: str
    duration_seconds: float
    resolution: str
    has_audio: bool
    clip_count: int


@dataclass
class TransitionSpec:
    """Specification for a transition between clips."""
    type: Literal["hard_cut", "crossfade", "fade_black", "flash_white", "dip_black"]
    duration_frames: int = 0  # 0 for hard cut


class VideoAssembler:
    """
    Assembles video clips into final output using FFmpeg.
    """

    # Resolution presets
    RESOLUTIONS = {
        "9:16": {"width": 1080, "height": 1920},
        "1:1": {"width": 1080, "height": 1080},
        "16:9": {"width": 1920, "height": 1080},
    }

    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        self.ffmpeg_path = resolve_media_binary(ffmpeg_path)
        self.ffprobe_path = resolve_media_binary("ffprobe")
        self._check_ffmpeg()

    def _check_ffmpeg(self):
        """Verify FFmpeg is available."""
        try:
            subprocess.run(
                [self.ffmpeg_path, "-version"],
                capture_output=True,
                check=True,
            )
        except FileNotFoundError:
            raise RuntimeError("FFmpeg not found. Install with: brew install ffmpeg")

    def _run_ffmpeg(self, args: list[str], description: str = ""):
        """Run FFmpeg command with error handling."""
        cmd = [self.ffmpeg_path] + args
        print(f"Running: {description or ' '.join(cmd[:5])}...")

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr}")
        return result

    def concatenate_simple(
        self,
        video_paths: list[str],
        output_path: str,
        audio_path: Optional[str] = None,
    ) -> AssemblyResult:
        """
        Simple concatenation with hard cuts (fastest method).
        """
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Create concat file
        concat_file = Path(output_path).parent / "concat_list.txt"
        with open(concat_file, "w") as f:
            for vp in video_paths:
                f.write(f"file '{os.path.abspath(vp)}'\n")

        # Build FFmpeg command
        args = [
            "-y",  # Overwrite
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
        ]

        if audio_path:
            args.extend(["-i", audio_path])
            args.extend([
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
            ])
        else:
            args.extend(["-c", "copy"])

        args.append(output_path)

        self._run_ffmpeg(args, f"Concatenating {len(video_paths)} clips")

        # Cleanup
        concat_file.unlink()

        # Get duration
        duration = self._get_duration(output_path)

        return AssemblyResult(
            output_path=output_path,
            duration_seconds=duration,
            resolution="source",
            has_audio=audio_path is not None,
            clip_count=len(video_paths),
        )


    def concatenate_with_transitions(
        self,
        video_paths: list[str],
        transitions: list[TransitionSpec],
        output_path: str,
        audio_path: Optional[str] = None,
        fps: int = 30,
    ) -> AssemblyResult:
        """
        Concatenate clips with transition effects between them.
        Uses FFmpeg xfade filter.
        """
        if len(transitions) != len(video_paths) - 1:
            raise ValueError("Need exactly len(videos) - 1 transitions")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # For complex transitions, use filter_complex
        inputs = []
        for vp in video_paths:
            inputs.extend(["-i", vp])

        if audio_path:
            inputs.extend(["-i", audio_path])

        input_durations = [self._get_duration(vp) for vp in video_paths]

        # Build filter chain. Use the primary video stream because provider MP4s
        # can include attached cover-art streams that break implicit [i:v] refs.
        filter_parts = []
        current_output = "[0:v:0]"
        current_duration = float(input_durations[0])

        for i, trans in enumerate(transitions):
            next_input = f"[{i+1}:v:0]"
            output_label = f"[v{i}]"
            next_duration = float(input_durations[i + 1])
            transition_name = self._ffmpeg_transition_name(trans.type)

            if trans.type == "hard_cut":
                # No transition, just concat
                filter_parts.append(f"{current_output}{next_input}concat=n=2:v=1:a=0{output_label}")
                current_duration = current_duration + next_duration
            elif transition_name:
                duration = trans.duration_frames / fps
                offset = max(0.0, current_duration - duration)
                filter_parts.append(
                    f"{current_output}{next_input}xfade=transition={transition_name}:duration={duration}:offset={offset}{output_label}"
                )
                current_duration = current_duration + next_duration - duration
            else:
                # Unknown transition IDs should not poison the graph. Preserve
                # continuity with a hard cut instead of producing undefined labels.
                filter_parts.append(f"{current_output}{next_input}concat=n=2:v=1:a=0{output_label}")
                current_duration = current_duration + next_duration

            current_output = output_label

        filter_complex = ";".join(filter_parts)

        args = ["-y"] + inputs + [
            "-filter_complex", filter_complex,
            "-map", current_output,
        ]

        if audio_path:
            audio_idx = len(video_paths)
            args.extend(["-map", f"{audio_idx}:a", "-c:a", "aac", "-shortest"])

        args.extend(["-c:v", "libx264", "-preset", "fast", output_path])

        self._run_ffmpeg(args, f"Assembly with {len(transitions)} transitions")

        duration = self._get_duration(output_path)

        return AssemblyResult(
            output_path=output_path,
            duration_seconds=duration,
            resolution="source",
            has_audio=audio_path is not None,
            clip_count=len(video_paths),
        )

    @staticmethod
    def _ffmpeg_transition_name(transition_type: str) -> Optional[str]:
        return {
            "crossfade": "fade",
            "fade_black": "fadeblack",
            "dip_black": "fadeblack",
            "flash_white": "fadewhite",
        }.get(str(transition_type))

    def add_audio(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
        audio_start: float = 0.0,
        audio_duration: Optional[float] = None,
    ) -> str:
        """Add or replace audio track on a video."""

        args = [
            "-y",
            "-i", video_path,
        ]

        if audio_start > 0:
            args.extend(["-ss", str(audio_start)])

        if audio_duration:
            args.extend(["-t", str(audio_duration)])

        args.extend([
            "-i", audio_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
        ])

        args.append(output_path)

        self._run_ffmpeg(args, "Adding audio")
        return output_path

    def _get_duration(self, video_path: str) -> float:
        """Get video duration in seconds."""
        result = subprocess.run(
            [
                self.ffprobe_path, "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        return float(result.stdout.strip())


    def export_aspect_ratio(
        self,
        input_path: str,
        output_path: str,
        aspect_ratio: Literal["9:16", "1:1", "16:9"],
        method: Literal["crop", "pad", "scale"] = "crop",
    ) -> str:
        """
        Export video in a different aspect ratio.

        Methods:
        - crop: Cut edges to fit (may lose content)
        - pad: Add black bars (letterbox/pillarbox)
        - scale: Stretch to fit (distorts image)
        """
        res = self.RESOLUTIONS[aspect_ratio]
        w, h = res["width"], res["height"]

        if method == "crop":
            # Center crop to target ratio
            vf = f"scale=-1:{h},crop={w}:{h}"
        elif method == "pad":
            # Scale to fit, add black bars
            vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
        elif method == "scale":
            # Stretch to exact dimensions
            vf = f"scale={w}:{h}"
        else:
            raise ValueError(f"Unknown method: {method}")

        args = [
            "-y",
            "-i", input_path,
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "copy",
            output_path,
        ]

        self._run_ffmpeg(args, f"Export {aspect_ratio}")
        return output_path

    def export_all_formats(
        self,
        input_path: str,
        output_dir: str,
        base_name: str = "video",
        formats: list[dict] = None,
    ) -> dict[str, str]:
        """
        Export video in multiple aspect ratios.

        Args:
            input_path: Source video
            output_dir: Output directory
            base_name: Base filename
            formats: List of format specs, defaults to all three ratios

        Returns:
            Dict mapping aspect ratio to output path
        """
        if formats is None:
            formats = [
                {"aspect_ratio": "9:16", "suffix": "vertical"},
                {"aspect_ratio": "1:1", "suffix": "square"},
                {"aspect_ratio": "16:9", "suffix": "horizontal"},
            ]

        Path(output_dir).mkdir(parents=True, exist_ok=True)
        outputs = {}

        for fmt in formats:
            ar = fmt["aspect_ratio"]
            suffix = fmt.get("suffix", ar.replace(":", "x"))
            output_path = f"{output_dir}/{base_name}_{suffix}.mp4"

            self.export_aspect_ratio(input_path, output_path, ar)
            outputs[ar] = output_path

        return outputs

    def create_loop(
        self,
        input_path: str,
        output_path: str,
        loop_count: int = 2,
        target_duration: Optional[float] = None,
    ) -> str:
        """
        Create a looping video (useful for Spotify Canvas).

        Args:
            input_path: Source video
            output_path: Output path
            loop_count: Number of times to loop
            target_duration: If set, loop to approximately this duration
        """
        if target_duration:
            source_duration = self._get_duration(input_path)
            loop_count = max(1, int(target_duration / source_duration))

        # Create concat file for looping
        concat_file = Path(output_path).parent / "loop_list.txt"
        with open(concat_file, "w") as f:
            for _ in range(loop_count):
                f.write(f"file '{os.path.abspath(input_path)}'\n")

        args = [
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            output_path,
        ]

        self._run_ffmpeg(args, f"Creating {loop_count}x loop")
        concat_file.unlink()

        return output_path

    def trim(
        self,
        input_path: str,
        output_path: str,
        start: float,
        duration: float,
    ) -> str:
        """Trim video to specific segment."""
        args = [
            "-y",
            "-i", input_path,
            "-ss", str(start),
            "-t", str(duration),
            "-c", "copy",
            output_path,
        ]
        self._run_ffmpeg(args, f"Trimming to {duration}s")
        return output_path
