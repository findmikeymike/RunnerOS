"""
Social-aware caption rendering for lyric clips.

Adapted from CAS4/Squad's proven caption pipeline. Captions are written as a
native ASS subtitle script (with explicit ``PlayResX``/``PlayResY``) and burned
in with FFmpeg's ``subtitles`` filter, so placement, wrapping, outline, and the
readability pill are all driven by a per-aspect-ratio :class:`CaptionStyle`.

ASS (rather than SRT + ``force_style``) is deliberate: only a hand-authored ASS
script can set PlayRes, and without it libass interprets the style's ``MarginV``
in a default 384x288 space — silently pushing large safe-zone margins (e.g.
360px on a 1920 frame) off-screen.

Why this exists: short-form platforms (TikTok / Reels / Shorts) reserve the
bottom ~15-20% of a 9:16 frame for UI (username, sound, CTA, share). The legacy
``drawtext`` path hard-coded ``y=h*0.74`` for every platform, so captions either
collided with that UI or read poorly. Here, safe zones are expressed as a
fraction of frame height and resolve to the right ``MarginV`` per aspect ratio.
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from core.media_binaries import resolve_media_binary


# Output frame height per aspect ratio (matches core/assembler.py RESOLUTIONS).
_HEIGHTS: dict[str, int] = {"9:16": 1920, "1:1": 1080, "16:9": 1080}
_WIDTHS: dict[str, int] = {"9:16": 1080, "1:1": 1080, "16:9": 1920}


@dataclass(slots=True)
class CaptionCue:
    index: int
    start_s: float
    end_s: float
    text: str
    raw_text: str = ""   # full unwrapped lyric, so build can re-wrap to fit


@dataclass(slots=True)
class CaptionStyle:
    """ASS/force_style caption styling for one aspect ratio."""
    font: str
    font_size: int
    primary_color: str
    outline_color: str
    outline_width: int
    alignment: int       # ASS alignment code; 2 = bottom-center
    margin_v: int        # pixels lifted up from the bottom edge
    max_chars_per_line: int
    max_lines: int
    shadow_offset: int = 0
    background_box: bool = False
    background_color: str = "&H66000000"
    lead_in_ms: int = 0
    hold_out_ms: int = 0
    min_duration_s: float = 0.0
    max_caption_s: float = 7.0   # hard cap so a mistimed line can't overhang


# -----------------------------------------------------------------------------
# Per-aspect safe-zone profiles
# -----------------------------------------------------------------------------
# margin_v_frac is the share of frame HEIGHT reserved below the caption, so the
# pixel margin scales with resolution. 9:16 lifts captions well clear of the
# platform UI band; 16:9 sits them near the bottom like classic subtitles.
@dataclass(slots=True)
class _AspectProfile:
    margin_v_frac: float
    margin_v_floor: int
    font_frac: float          # font size as share of height
    max_chars_per_line: int
    max_lines: int
    outline_width: int
    background_box: bool
    lead_in_ms: int
    hold_out_ms: int
    min_duration_s: float


_ASPECT_PROFILES: dict[str, _AspectProfile] = {
    # TikTok / Reels / Shorts: big, punchy captions anchored ~19% off the bottom,
    # above the UI band. font_frac ~0.052 of 1920 => ~100px.
    "9:16": _AspectProfile(
        margin_v_frac=0.1875, margin_v_floor=300, font_frac=0.052,
        max_chars_per_line=17, max_lines=3, outline_width=3,
        background_box=True, lead_in_ms=120, hold_out_ms=240, min_duration_s=1.0,
    ),
    # Instagram feed (square): bold, mobile-readable. ~0.058 of 1080 => ~63px.
    "1:1": _AspectProfile(
        margin_v_frac=0.10, margin_v_floor=80, font_frac=0.058,
        max_chars_per_line=20, max_lines=3, outline_width=3,
        background_box=True, lead_in_ms=100, hold_out_ms=200, min_duration_s=1.0,
    ),
    # YouTube (landscape): near the bottom like standard captions. ~0.040 => ~43px.
    "16:9": _AspectProfile(
        margin_v_frac=0.05, margin_v_floor=56, font_frac=0.040,
        max_chars_per_line=34, max_lines=2, outline_width=2,
        background_box=False, lead_in_ms=80, hold_out_ms=160, min_duration_s=1.0,
    ),
}

# Box padding (BorderStyle=4) as a fraction of font size, so the pill breathes
# proportionally around the text instead of hugging the glyphs.
_BOX_PADDING_FRAC = 0.2

_DEFAULT_ASPECT = "9:16"


def caption_font_name() -> str:
    """Resolve a fontconfig family name for ASS force_style.

    ``subtitles``/force_style addresses fonts by family name (not file path), so
    this returns a family rather than the TTF path used by the drawtext engine.
    """
    configured = os.getenv("GENESIS_CAPTION_FONT")
    if configured and configured.strip():
        return configured.strip()
    if platform.system() == "Darwin":
        return "Helvetica Neue"
    for path, family in (
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVu Sans"),
        ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "Liberation Sans"),
        ("/usr/share/fonts/truetype/freefont/FreeSans.ttf", "FreeSans"),
    ):
        if Path(path).exists():
            return family
    if shutil.which("fc-match"):
        try:
            result = subprocess.run(
                ["fc-match", "-f", "%{family}", "sans-serif"],
                check=True, capture_output=True, text=True,
            )
            family = (result.stdout or "").split(",", 1)[0].strip()
            if family:
                return family
        except Exception:
            pass
    return "Arial"


def normalize_aspect_ratio(aspect_ratio) -> str:
    """Accept an AspectRatio enum, its ``.value``, or a raw string."""
    value = getattr(aspect_ratio, "value", aspect_ratio)
    value = str(value or "").strip()
    return value if value in _ASPECT_PROFILES else _DEFAULT_ASPECT


def caption_style_for_aspect(aspect_ratio="9:16", *, strategy: str = "lyrics") -> CaptionStyle:
    """Build a CaptionStyle whose safe-zone margin scales with frame height."""
    key = normalize_aspect_ratio(aspect_ratio)
    profile = _ASPECT_PROFILES[key]
    height = _HEIGHTS[key]
    margin_v = max(profile.margin_v_floor, round(profile.margin_v_frac * height))
    font_size = max(18, round(profile.font_frac * height))
    return CaptionStyle(
        font=caption_font_name(),
        font_size=font_size,
        primary_color="&H00FFFFFF",
        outline_color="&H00000000",
        outline_width=profile.outline_width,
        alignment=2,
        margin_v=margin_v,
        max_chars_per_line=profile.max_chars_per_line,
        max_lines=profile.max_lines,
        shadow_offset=2,
        background_box=profile.background_box,
        background_color="&H66000000",
        lead_in_ms=profile.lead_in_ms,
        hold_out_ms=profile.hold_out_ms,
        min_duration_s=profile.min_duration_s,
    )


# -----------------------------------------------------------------------------
# Phrase-aware line wrapping (ported from Squad _fit_caption_text)
# -----------------------------------------------------------------------------
_PREFERRED_BREAK_END_CHARS = (",", ";", ":", ".", "—", "–", "!", "?")
_PREFERRED_BREAK_CONJUNCTIONS = {
    "and", "but", "or", "so", "yet", "while", "because", "when", "if", "then",
}
_DANGLING_CAPTION_WORDS = {
    "a", "an", "and", "are", "be", "because", "but", "for", "is", "or", "so",
    "that", "the", "to", "was", "were", "who", "with",
}


def _clean_caption_text(text: Optional[str]) -> str:
    return " ".join((text or "").split()).strip()


def _is_preferred_break_word(word: str) -> bool:
    stripped = word.rstrip()
    if not stripped:
        return False
    if stripped.endswith(_PREFERRED_BREAK_END_CHARS):
        return True
    return stripped.lower().rstrip(".,;:!?") in _PREFERRED_BREAK_CONJUNCTIONS


def _find_preferred_break_index(line_words: list[str], max_chars: int) -> Optional[int]:
    """Index of the last good break word sitting >= 50% of max_chars in."""
    cumulative = 0
    last_good_idx: Optional[int] = None
    for idx, word in enumerate(line_words):
        cumulative += len(word) + (1 if idx > 0 else 0)
        if cumulative >= max_chars * 0.5 and _is_preferred_break_word(word):
            last_good_idx = idx
    return last_good_idx


def _trim_caption_line_end(line: str) -> str:
    words = line.rstrip(".,;:!?").split()
    while words and words[-1].lower() in _DANGLING_CAPTION_WORDS:
        words.pop()
    return " ".join(words)


def wrap_caption_text(text: str, style: Optional[CaptionStyle]) -> str:
    """Wrap to at most ``max_lines`` lines, preferring natural phrase breaks."""
    clean = _clean_caption_text(text)
    if not clean or style is None:
        return clean
    max_lines = max(1, style.max_lines)
    max_chars = max(8, style.max_chars_per_line)
    words = clean.split()
    lines: list[str] = []
    line_words: list[str] = []
    for word in words:
        candidate = line_words + [word]
        if line_words and len(" ".join(candidate)) > max_chars:
            break_at = _find_preferred_break_index(line_words, max_chars)
            if break_at is not None and break_at < len(line_words) - 1:
                lines.append(" ".join(line_words[: break_at + 1]))
                if len(lines) >= max_lines:
                    line_words = []
                    break
                line_words = line_words[break_at + 1:] + [word]
            else:
                lines.append(" ".join(line_words))
                if len(lines) >= max_lines:
                    line_words = []
                    break
                line_words = [word]
        else:
            line_words = candidate
    if line_words and len(lines) < max_lines:
        lines.append(" ".join(line_words))
    fitted = lines[:max_lines]
    if fitted:
        fitted[-1] = _trim_caption_line_end(fitted[-1])
    return "\n".join(line for line in fitted if line)


# -----------------------------------------------------------------------------
# Timing polish (ported from Squad _apply_caption_timing_polish)
# -----------------------------------------------------------------------------
def apply_timing_polish(
    cues: list[CaptionCue],
    style: Optional[CaptionStyle],
    *,
    total_duration_s: Optional[float] = None,
) -> list[CaptionCue]:
    """Lead-in / hold-out padding, minimum on-screen duration, flicker merge."""
    if not cues or style is None:
        return list(cues)
    lead_in_s = max(0.0, float(style.lead_in_ms or 0) / 1000.0)
    hold_out_s = max(0.0, float(style.hold_out_ms or 0) / 1000.0)
    min_duration_s = max(0.0, float(style.min_duration_s or 0.0))
    if lead_in_s == 0.0 and hold_out_s == 0.0 and min_duration_s == 0.0:
        return list(cues)

    ordered = list(cues)
    timeline_end = float(total_duration_s) if total_duration_s else None

    adjusted: list[CaptionCue] = []
    for idx, cue in enumerate(ordered):
        previous_end = adjusted[-1].end_s if adjusted else 0.0
        next_start = ordered[idx + 1].start_s if idx + 1 < len(ordered) else timeline_end
        new_start = max(previous_end, round(cue.start_s - lead_in_s, 3))
        candidate_end = round(cue.end_s + hold_out_s, 3)
        if next_start is not None:
            candidate_end = min(candidate_end, round(next_start, 3))
        if timeline_end is not None:
            candidate_end = min(candidate_end, round(timeline_end, 3))
        # Anti-overhang: never let a caption linger past its sung end by more
        # than the cap (guards against sloppy artist timing when alignment is off
        # or low-confidence). Alignment normally makes ends tight already.
        max_caption_s = float(style.max_caption_s or 0.0)
        if max_caption_s > 0:
            candidate_end = min(candidate_end, round(new_start + max_caption_s, 3))
        if candidate_end <= new_start:
            candidate_end = new_start + 0.001
        adjusted.append(CaptionCue(cue.index, round(new_start, 3), round(candidate_end, 3), cue.text, cue.raw_text))

    polished: list[CaptionCue] = []
    for idx, cue in enumerate(adjusted):
        duration = cue.end_s - cue.start_s
        if duration >= min_duration_s or min_duration_s == 0.0:
            polished.append(cue)
            continue
        next_start = adjusted[idx + 1].start_s if idx + 1 < len(adjusted) else timeline_end
        if next_start is not None:
            available_end = round(min(cue.start_s + min_duration_s, next_start), 3)
        else:
            available_end = round(cue.start_s + min_duration_s, 3)
        if available_end - cue.start_s >= min_duration_s * 0.9 and polished:
            polished.append(CaptionCue(cue.index, cue.start_s, available_end, cue.text, cue.raw_text))
            continue
        if polished:
            previous = polished[-1]
            merged_text = " ".join(part for part in (previous.text, cue.text) if part)
            merged_raw = " ".join(part for part in (previous.raw_text, cue.raw_text) if part)
            polished[-1] = CaptionCue(
                previous.index, previous.start_s, max(previous.end_s, cue.end_s), merged_text, merged_raw,
            )
        else:
            polished.append(CaptionCue(cue.index, cue.start_s, available_end, cue.text, cue.raw_text))

    return [CaptionCue(pos, c.start_s, c.end_s, c.text, c.raw_text) for pos, c in enumerate(polished, start=1)]


# -----------------------------------------------------------------------------
# Cue construction + SRT serialization
# -----------------------------------------------------------------------------
def overlays_to_cues(overlays: Iterable, style: Optional[CaptionStyle]) -> list[CaptionCue]:
    """Convert manifest LyricOverlay-like items (text/start_time/end_time) into
    wrapped CaptionCues. Skips empty/zero-length items."""
    cues: list[CaptionCue] = []
    index = 1
    for item in overlays:
        text = getattr(item, "text", None)
        start = getattr(item, "start_time", None)
        end = getattr(item, "end_time", None)
        if text is None and isinstance(item, dict):
            text = item.get("text")
            start = item.get("start_time")
            end = item.get("end_time")
        cleaned = _clean_caption_text(str(text or ""))
        wrapped = wrap_caption_text(str(text or ""), style)
        if not wrapped or start is None or end is None:
            continue
        if float(end) <= float(start):
            continue
        cues.append(CaptionCue(index, round(float(start), 3), round(float(end), 3), wrapped, cleaned))
        index += 1
    return cues


def _ass_time(seconds: float) -> str:
    """ASS timestamp: H:MM:SS.cc (centiseconds)."""
    cs = int(round(max(0.0, seconds) * 100))
    hours, remainder = divmod(cs, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    secs, centis = divmod(remainder, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centis:02d}"


_ASS_STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
    "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
    "MarginR, MarginV, Encoding"
)
_ASS_EVENT_FORMAT = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"


def _sanitize_ass_text(text: str) -> str:
    """Neutralize ASS control syntax in user-supplied lyric text.

    A backslash starts an override tag and braces delimit override/comment
    blocks, so an unescaped lyric like ``{\\an8}`` or ``{\\pos(0,0)}`` could
    reposition the caption and defeat the safe-zone system. Strip backslashes and
    convert braces to parentheses so the text always renders as literal content
    in the styled, safe-zone-anchored position.
    """
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def render_ass(cues: list[CaptionCue], style: CaptionStyle, *, play_res_x: int, play_res_y: int) -> str:
    """Serialize cues to an ASS subtitle script.

    Critically, PlayResX/PlayResY are set to the real output resolution so the
    style's ``MarginV`` (e.g. 360px on a 1920 frame) lands where intended. SRT +
    force_style cannot control PlayRes, which silently pushes large margins
    off-screen — hence a hand-authored ASS script.
    """
    border_style = 4 if style.background_box else 1
    shadow = max(0, int(style.shadow_offset)) if style.shadow_offset else 1
    # With an opaque box (BorderStyle 4) the Outline field is the box padding, so
    # scale it to the font for breathing room. With an outline (BorderStyle 1)
    # it's the text stroke width, so keep it thin.
    outline_field = max(12, round(style.font_size * _BOX_PADDING_FRAC)) if style.background_box else style.outline_width
    margin_h = max(0, round(0.06 * play_res_x))  # side padding for readability
    style_line = (
        "Style: Default,{font},{size},{primary},&H000000FF,{outline},{back},"
        "-1,0,0,0,100,100,0,0,{bs},{ow},{sh},{align},{mh},{mh},{mv},1"
    ).format(
        font=style.font,
        size=style.font_size,
        primary=style.primary_color,
        outline=style.outline_color,
        back=style.background_color,
        bs=border_style,
        ow=outline_field,
        sh=shadow,
        align=style.alignment,
        mh=margin_h,
        mv=style.margin_v,
    )
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {play_res_x}",
        f"PlayResY: {play_res_y}",
        "WrapStyle: 2",            # we pre-wrap; only break on \\N
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        _ASS_STYLE_FORMAT,
        style_line,
        "",
        "[Events]",
        _ASS_EVENT_FORMAT,
    ]
    for cue in cues:
        # Sanitize first (removes backslashes), then encode hard line breaks.
        text = _sanitize_ass_text(cue.text).replace("\n", "\\N")
        if not text.strip().replace("\\N", "").strip():
            continue  # skip cues that are empty after wrapping/trimming
        lines.append(
            f"Dialogue: 0,{_ass_time(cue.start_s)},{_ass_time(cue.end_s)},Default,,0,0,0,,{text}"
        )
    return "\n".join(lines) + "\n"


# -----------------------------------------------------------------------------
# Burn-in
# -----------------------------------------------------------------------------
def ffmpeg_filter_path(path: Path) -> str:
    """Escape a path for use *inside* a libavfilter filtergraph string.

    libavfilter treats ``: ; [ ] = '`` as structural; escape them all so a
    job_id/dir containing any of these can't break or hijack the filtergraph.
    """
    escaped = str(Path(path).resolve())
    for ch in ("\\", "'", ":", ";", "[", "]", "="):
        escaped = escaped.replace(ch, "\\" + ch)
    return f"'{escaped}'"


# Candidate TTFs for *measuring* text width (PIL needs a file; ASS uses a family
# name). Kept consistent with TypographyEngine's resolution order.
_FONT_FILE_CANDIDATES = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/Library/Fonts/Lato-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
)


def _resolve_font_file() -> Optional[str]:
    override = os.getenv("GENESIS_CAPTION_FONT_FILE")
    if override and os.path.exists(override):
        return override
    for path in _FONT_FILE_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def _measure_line_width(line: str, font_file: str, size: int) -> float:
    from PIL import ImageFont
    font = ImageFont.truetype(font_file, size)
    return float(font.getlength(line))


def fit_font_size(cues: list[CaptionCue], base_font: int, usable_width: int,
                  *, floor_frac: float = 0.65) -> int:
    """Largest font size <= ``base_font`` at which every caption line fits within
    ``usable_width`` pixels, clamped to a readable floor.

    Falls back to a character-width heuristic when PIL/font is unavailable, so
    callers always get a usable size (no overflow off the frame).
    """
    floor = max(18, int(base_font * floor_frac))
    longest = ""
    for cue in cues:
        for line in cue.text.split("\n"):
            if len(line) > len(longest):
                longest = line
    if not longest or usable_width <= 0:
        return base_font
    font_file = _resolve_font_file()
    if font_file is None:
        # Heuristic: assume ~0.55em average advance.
        est = int(usable_width / (len(longest) * 0.55)) if longest else base_font
        return max(floor, min(base_font, est))
    try:
        for size in range(base_font, floor - 1, -2):
            if _measure_line_width(longest, font_file, size) <= usable_width:
                return size
        return floor
    except Exception:
        return base_font


def _wrap_to_width(text: str, font_file: str, size: int, usable_width: int) -> list[str]:
    """Greedy word-wrap by *measured* pixel width. Never drops text: an
    over-wide single word is hard-broken by characters."""
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = w if not cur else f"{cur} {w}"
        if cur and _measure_line_width(candidate, font_file, size) > usable_width:
            lines.append(cur)
            cur = w
        else:
            cur = candidate
        # Hard-break a single word that alone exceeds the width.
        while _measure_line_width(cur, font_file, size) > usable_width and len(cur) > 1:
            i = len(cur)
            while i > 1 and _measure_line_width(cur[:i], font_file, size) > usable_width:
                i -= 1
            lines.append(cur[:i])
            cur = cur[i:]
    if cur:
        lines.append(cur)
    return lines


def fit_caption_layout(
    cues: list[CaptionCue], base_font: int, usable_width: int, max_lines: int,
    *, floor_frac: float = 0.5,
) -> tuple[int, dict[int, str]]:
    """Pick the largest uniform font (<= base, >= floor) at which every cue's
    FULL lyric wraps within ``max_lines`` lines that each fit ``usable_width``.

    Returns ``(font_size, {cue_index: wrapped_text})``. Never truncates: if even
    the floor font can't fit within max_lines, the floor wrap is returned in full
    (extra line rather than a dropped word)."""
    floor = max(18, int(base_font * floor_frac))
    raw = {c.index: (c.raw_text or c.text.replace("\n", " ")) for c in cues}
    font_file = _resolve_font_file()
    if font_file is None or usable_width <= 0:
        size = fit_font_size(cues, base_font, usable_width, floor_frac=floor_frac)
        return size, {c.index: c.text for c in cues}
    try:
        chosen = floor
        for size in range(base_font, floor - 1, -2):
            wrapped = {idx: _wrap_to_width(t, font_file, size, usable_width) for idx, t in raw.items()}
            if max((len(v) for v in wrapped.values()), default=0) <= max_lines:
                return size, {idx: "\n".join(v) for idx, v in wrapped.items()}
            chosen = size
        wrapped = {idx: _wrap_to_width(t, font_file, floor, usable_width) for idx, t in raw.items()}
        return floor, {idx: "\n".join(v) for idx, v in wrapped.items()}
    except Exception:
        return base_font, {c.index: c.text for c in cues}


def build_caption_ass(
    overlays: Iterable,
    *,
    aspect_ratio="9:16",
    total_duration_s: Optional[float] = None,
    out_path: Path,
) -> tuple[Optional[Path], CaptionStyle]:
    """Wrap + timing-polish lyric overlays into an ASS script on disk.

    Auto-fits the font and re-wraps the FULL lyric by measured width so every
    word is shown and fits on-screen (no truncation). Returns ``(ass_path,
    style)`` or ``(None, style)`` when there are no usable captions.
    """
    key = normalize_aspect_ratio(aspect_ratio)
    style = caption_style_for_aspect(key)
    cues = overlays_to_cues(overlays, style)
    cues = apply_timing_polish(cues, style, total_duration_s=total_duration_s)
    if not cues:
        return None, style

    # Guarantee fit: usable width = frame minus side margins minus box padding.
    play_res_x, play_res_y = _WIDTHS[key], _HEIGHTS[key]
    margin_h = round(0.06 * play_res_x)
    box_pad = round(style.font_size * _BOX_PADDING_FRAC) if style.background_box else style.outline_width
    usable_width = play_res_x - 2 * margin_h - 2 * box_pad
    style.font_size, wrapped_map = fit_caption_layout(
        cues, style.font_size, usable_width, style.max_lines)
    for cue in cues:
        cue.text = wrapped_map.get(cue.index, cue.text)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        render_ass(cues, style, play_res_x=play_res_x, play_res_y=play_res_y),
        encoding="utf-8",
    )
    return out_path, style


def burn_captions(
    *,
    input_video: Path,
    ass_path: Path,
    output_video: Path,
    ffmpeg_path: str = "ffmpeg",
) -> Path:
    """Burn captions into a video via FFmpeg's subtitles filter.

    Styling (font, colors, safe-zone margins, pill) lives in the ASS script, so
    no ``force_style`` override is needed.
    """
    input_video = Path(input_video)
    ass_path = Path(ass_path)
    output_video = Path(output_video)
    if not input_video.exists():
        raise RuntimeError(f"input video does not exist: {input_video}")
    if not ass_path.exists():
        raise RuntimeError(f"caption file does not exist: {ass_path}")
    output_video.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = resolve_media_binary(ffmpeg_path)
    vf = f"subtitles={ffmpeg_filter_path(ass_path)}"
    cmd = [ffmpeg, "-y", "-i", str(input_video), "-vf", vf, "-c:a", "copy", str(output_video)]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    if not output_video.exists() or output_video.stat().st_size <= 0:
        raise RuntimeError(f"caption burn-in produced no output: {output_video}")
    return output_video
