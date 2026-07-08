"""
Typography Module
Adds text overlays to videos (lyrics, captions, titles).

Uses FFmpeg drawtext filter for efficiency.
Future: Could use Motion Canvas for advanced animations.
"""

import os
import math
import re
from pathlib import Path
from typing import Optional, Literal
from dataclasses import dataclass
import textwrap

from core.media_binaries import resolve_media_binary


@dataclass
class TextOverlay:
    """Specification for a single text overlay."""
    text: str
    start_time: float
    end_time: float
    position: Literal["top", "center", "bottom"] = "bottom"
    font_size: int = 42
    font_color: str = "white"
    font_file: Optional[str] = None
    shadow: bool = True
    animation: Literal["none", "fade", "slide_up"] = "fade"


class TypographyEngine:
    """
    Adds text overlays to videos using FFmpeg.
    """

    # Position mappings for FFmpeg
    POSITIONS = {
        "top": "x=(w-text_w)/2:y=h*0.06",
        "center": "x=(w-text_w)/2:y=(h-text_h)/2",
        "bottom": "x=(w-text_w)/2:y=h*0.74",
    }

    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        self.ffmpeg_path = resolve_media_binary(ffmpeg_path)
        self.ffprobe_path = resolve_media_binary("ffprobe")
        self.default_font = None
        for candidate in [
            "/Library/Fonts/Lato-Bold.ttf",
            "/System/Library/Fonts/HelveticaNeue.ttc",
            "/System/Library/Fonts/Supplemental/HelveticaNeue.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        ]:
            if os.path.exists(candidate):
                self.default_font = candidate
                break

    def add_single_text(
        self,
        video_path: str,
        output_path: str,
        text: str,
        start_time: float = 0,
        end_time: Optional[float] = None,
        position: Literal["top", "center", "bottom"] = "bottom",
        font_size: int = 40,
        font_color: str = "white",
        shadow: bool = True,
    ) -> str:
        """Add a single text overlay to video."""

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        pos = self.POSITIONS[position]
        w, _h = self._probe_resolution(video_path)
        wrapped = self._wrap_text(text, video_width=w, font_size=font_size)

        textfile_path = self._write_textfile(output_path, wrapped, stem="overlay")
        escaped_path = self._escape_path(textfile_path)
        font_opt = ""
        if self.default_font:
            font_opt = f":fontfile='{self._escape_path(self.default_font)}'"
        base = (
            f"drawtext=textfile='{escaped_path}':reload=0:fix_bounds=1:"
            f"{pos}:fontsize={font_size}:fontcolor={font_color}:line_spacing=10:borderw=1:bordercolor=black@0.75"
            f"{font_opt}"
        )
        filter_str = base

        if shadow:
            filter_str += f":shadowcolor=black@0.5:shadowx=2:shadowy=2"

        if end_time:
            enable_expr = f"between(t,{start_time},{end_time})"
            filter_str += f":enable='{self._escape_expr(enable_expr)}'"
        elif start_time > 0:
            enable_expr = f"gte(t,{start_time})"
            filter_str += f":enable='{self._escape_expr(enable_expr)}'"

        args = [
            "-y",
            "-i", video_path,
            "-vf", filter_str,
            "-c:a", "copy",
            output_path,
        ]

        self._run_ffmpeg(args)
        return output_path

    def add_multiple_texts(
        self,
        video_path: str,
        output_path: str,
        overlays: list[TextOverlay],
    ) -> str:
        """Add multiple text overlays with timing."""

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        w, _h = self._probe_resolution(video_path)

        # Build filter chain
        filters = []
        for idx, overlay in enumerate(overlays):
            pos = self.POSITIONS[overlay.position]
            wrapped = self._wrap_text(overlay.text, video_width=w, font_size=overlay.font_size)

            textfile_path = self._write_textfile(output_path, wrapped, stem=f"overlay_{idx:03d}")
            escaped_path = self._escape_path(textfile_path)
            font_file = overlay.font_file or self.default_font
            font_opt = f":fontfile='{self._escape_path(font_file)}'" if font_file else ""

            f = (
                f"drawtext=textfile='{escaped_path}':reload=0:fix_bounds=1:{pos}:fontsize={overlay.font_size}:"
                f"fontcolor={overlay.font_color}:line_spacing=10:borderw=1:bordercolor=black@0.75"
                f"{font_opt}"
            )

            if overlay.shadow:
                f += ":shadowcolor=black@0.5:shadowx=2:shadowy=2"

            enable_expr = f"between(t,{overlay.start_time},{overlay.end_time})"
            f += f":enable='{self._escape_expr(enable_expr)}'"

            # Add fade animation if requested
            if overlay.animation == "fade":
                fade_duration = 0.3
                alpha_expr = (
                    f"if(lt(t,{overlay.start_time + fade_duration}),(t-{overlay.start_time})/{fade_duration},"
                    f"if(gt(t,{overlay.end_time - fade_duration}),({overlay.end_time}-t)/{fade_duration},1))"
                )
                f += f":alpha='{self._escape_expr(alpha_expr)}'"

            filters.append(f)

        filter_complex = ",".join(filters)

        args = [
            "-y",
            "-i", video_path,
            "-vf", filter_complex,
            "-c:a", "copy",
            output_path,
        ]

        self._run_ffmpeg(args)
        return output_path

    def _run_ffmpeg(self, args: list[str]):
        """Run FFmpeg command."""
        import subprocess
        cmd = [self.ffmpeg_path] + args
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr}\nCMD: {' '.join(cmd)}")

    def _escape_expr(self, expr: str) -> str:
        return expr.replace(",", "\\,")

    def _escape_path(self, path: str) -> str:
        return (
            path.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace(":", "\\:")
        )

    def _write_textfile(self, output_path: str, text: str, *, stem: str) -> str:
        parent = Path(output_path).parent
        tmp_dir = parent / "_typography_text"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        p = tmp_dir / f"{stem}.txt"
        p.write_text(text, encoding="utf-8")
        return str(p)

    def _probe_resolution(self, video_path: str) -> tuple[int, int]:
        import subprocess

        result = subprocess.run(
            [
                self.ffprobe_path,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffprobe error: {result.stderr}")

        payload = __import__("json").loads(result.stdout)
        streams = payload.get("streams") or []
        if not streams:
            raise RuntimeError("ffprobe did not return stream info")
        width = int(streams[0].get("width") or 0)
        height = int(streams[0].get("height") or 0)
        if width <= 0 or height <= 0:
            raise RuntimeError("Invalid resolution from ffprobe")
        return width, height

    def _probe_duration(self, video_path: str) -> Optional[float]:
        import subprocess

        result = subprocess.run(
            [
                self.ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return None
        try:
            return float(result.stdout.strip())
        except (TypeError, ValueError):
            return None


    def add_lyrics_from_manifest(
        self,
        video_path: str,
        output_path: str,
        lyrics_config: dict,
    ) -> str:
        """
        Add lyrics from a JobManifest typography config.

        Args:
            video_path: Source video
            output_path: Output path
            lyrics_config: Typography section from JobManifest
        """
        if not lyrics_config.get("enabled", True):
            # Just copy if typography disabled
            import shutil
            shutil.copy(video_path, output_path)
            return output_path

        font_size = self._size_to_pixels(lyrics_config.get("font_size", "medium"))
        overlays = self._normalize_overlays(
            lyrics_config.get("lyrics", []),
            rendered_duration=self._probe_duration(video_path),
            font_size=font_size,
            font_color=lyrics_config.get("color", "white"),
            shadow=lyrics_config.get("shadow", True),
        )

        if not overlays:
            import shutil
            shutil.copy(video_path, output_path)
            return output_path

        return self.add_multiple_texts(video_path, output_path, overlays)

    def _normalize_overlays(
        self,
        lyrics: list[dict],
        *,
        rendered_duration: Optional[float],
        font_size: int,
        font_color: str,
        shadow: bool,
    ) -> list[TextOverlay]:
        """Clip and split lyric lines to the actual rendered video timeline."""
        duration = float(rendered_duration or 0.0)
        if duration <= 0:
            duration = max([float(item.get("end_time") or 0.0) for item in lyrics] or [0.0])

        overlays: list[TextOverlay] = []
        for lyric in lyrics:
            text = " ".join(str(lyric.get("text") or "").split())
            if not text or not re.search(r"[A-Za-z0-9]", text):
                continue

            start = max(0.0, float(lyric.get("start_time") or 0.0))
            end = min(duration, float(lyric.get("end_time") or 0.0))
            if end <= start:
                continue

            for chunk_text, chunk_start, chunk_end in self._split_timed_text(text, start, end):
                if chunk_end <= chunk_start:
                    continue
                overlays.append(TextOverlay(
                    text=chunk_text,
                    start_time=round(chunk_start, 3),
                    end_time=round(chunk_end, 3),
                    position=lyric.get("position", "bottom"),
                    font_size=font_size,
                    font_color=font_color,
                    shadow=shadow,
                    animation=lyric.get("animation", "fade"),
                ))

        return overlays

    def _split_timed_text(
        self,
        text: str,
        start_time: float,
        end_time: float,
        *,
        max_chunk_duration: float = 4.0,
        max_chars: int = 42,
    ) -> list[tuple[str, float, float]]:
        duration = end_time - start_time
        if duration <= max_chunk_duration and len(text) <= max_chars:
            return [(text, start_time, end_time)]

        words = text.split()
        if not words:
            return []

        chunks_needed = max(
            1,
            math.ceil(duration / max_chunk_duration),
            math.ceil(len(text) / max_chars),
        )
        chunks_needed = min(chunks_needed, len(words))
        target_words = max(1, math.ceil(len(words) / chunks_needed))
        text_chunks = [
            " ".join(words[idx:idx + target_words])
            for idx in range(0, len(words), target_words)
        ]
        chunk_duration = duration / len(text_chunks)
        chunks: list[tuple[str, float, float]] = []
        for idx, chunk in enumerate(text_chunks):
            chunk_start = start_time + (idx * chunk_duration)
            chunk_end = end_time if idx == len(text_chunks) - 1 else chunk_start + chunk_duration
            chunks.append((chunk, chunk_start, chunk_end))
        return chunks

    def _escape_text(self, text: str) -> str:
        """Escape characters for FFmpeg drawtext."""
        return (
            text.replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace(":", "\\:")
            .replace("%", "\\%")
            .replace("\n", "\\n")
        )

    def _wrap_text(self, text: str, *, video_width: int, font_size: int) -> str:
        if not text:
            return text

        safe_width_px = int(video_width * 0.86)
        approx_char_px = max(9, int(font_size * 0.56))
        max_chars = max(18, int(safe_width_px / approx_char_px))

        cleaned = " ".join(text.split())
        return textwrap.fill(cleaned, width=max_chars)

    def _size_to_pixels(self, size: str) -> int:
        """Convert size name to pixel value."""
        sizes = {
            "small": 30,
            "medium": 38,
            "large": 48,
        }
        return sizes.get(size, 38)

    def create_title_card(
        self,
        output_path: str,
        text: str,
        duration: float = 3.0,
        width: int = 1080,
        height: int = 1920,
        bg_color: str = "black",
        text_color: str = "white",
        font_size: int = 72,
    ) -> str:
        """
        Create a simple title card video.
        Useful for intros, outros, or section dividers.
        """
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        escaped_text = text.replace("'", "'\\''").replace(":", "\\:")

        # Generate solid color video with text
        args = [
            "-y",
            "-f", "lavfi",
            "-i", f"color=c={bg_color}:s={width}x{height}:d={duration}",
            "-vf", f"drawtext=text='{escaped_text}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize={font_size}:fontcolor={text_color}",
            "-c:v", "libx264",
            "-t", str(duration),
            output_path,
        ]

        self._run_ffmpeg(args)
        return output_path
