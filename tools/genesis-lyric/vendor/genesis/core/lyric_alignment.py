"""
Forced alignment of known lyrics to the master audio.

Artist-submitted lyric timestamps are often approximate, which produces captions
that drift off the vocal or linger past the sung word ("overhang"). We don't have
an isolated vocal stem, but we *do* have the exact lyric text, so we:

  1. Run whisper-timestamped over the master mix to get word-level timings (ASR).
  2. Sequence-align the recognised words to the known lyric words.
  3. Transfer the ASR timings onto the known lyrics (tight start/end per line,
     plus per-word timings for future karaoke rendering).

The known lyric text is never replaced — only its timing is refined. If the
audio or dependency is unavailable, or alignment confidence is low, we keep the
artist-provided timing unchanged (graceful, flag-gated).

The alignment math (`align_known_lines_to_words`) is pure and unit-tested without
whisper; only `align_lyrics_to_audio` touches the model.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional


def alignment_enabled() -> bool:
    """Forced alignment is on by default; set GENESIS_LYRIC_ALIGNMENT=0 to skip."""
    return os.getenv("GENESIS_LYRIC_ALIGNMENT", "1").strip().lower() not in {
        "0", "false", "no", "off",
    }


_TOKEN_RE = re.compile(r"[^\w']+")

# Per-line trust gates: a line must have at least this fraction of its words
# directly heard by whisper, and span at least this long, or we keep the
# artist's original timing instead of an interpolated guess.
_MIN_LINE_ANCHOR_FRAC = 0.34
_MIN_LINE_SPAN_S = 0.4


def _tokenize(text: str) -> list[str]:
    """Lowercased word tokens with surrounding punctuation stripped."""
    return [t for t in _TOKEN_RE.sub(" ", (text or "").lower()).split() if t]


@dataclass
class AlignedLine:
    index: int
    text: str
    start: float
    end: float
    word_timings: list[dict] = field(default_factory=list)  # [{text,start,end}]


@dataclass
class AlignmentResult:
    applied: bool
    confidence: float            # fraction of known lyric tokens anchored to audio
    lines: list[AlignedLine]
    matched_tokens: int = 0
    total_tokens: int = 0
    reason: str = ""


def align_known_lines_to_words(
    lines: list[dict],
    asr_words: list[dict],
    *,
    min_confidence: float = 0.5,
) -> AlignmentResult:
    """Pure alignment: map known lyric lines onto ASR word timings.

    ``lines``: [{"text", "start", "end"}] in order (known lyrics).
    ``asr_words``: [{"text", "start", "end"}] from whisper, in time order.

    Returns refined per-line/per-word timing. If too few known tokens anchor to
    the audio (< ``min_confidence``), ``applied`` is False and the original line
    timings are returned untouched.
    """
    original = [
        AlignedLine(
            index=i,
            text=str(ln.get("text", "")),
            start=float(ln.get("start", ln.get("start_time", 0.0)) or 0.0),
            end=float(ln.get("end", ln.get("end_time", 0.0)) or 0.0),
        )
        for i, ln in enumerate(lines)
    ]
    if not lines or not asr_words:
        return AlignmentResult(False, 0.0, original, 0, 0, "no lyrics or no ASR words")

    # Flatten known lyrics into a token stream tagged with their line index.
    known_tokens: list[str] = []
    token_line: list[int] = []
    for i, ln in enumerate(original):
        for tok in _tokenize(ln.text):
            known_tokens.append(tok)
            token_line.append(i)
    total = len(known_tokens)
    if total == 0:
        return AlignmentResult(False, 0.0, original, 0, 0, "no usable known tokens")

    # Flatten ASR words into a parallel token stream carrying timings.
    asr_tokens: list[str] = []
    asr_times: list[tuple[float, float]] = []
    for w in asr_words:
        toks = _tokenize(str(w.get("text", "")))
        if not toks:
            continue
        try:
            ws, we = float(w.get("start", 0.0)), float(w.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        # A whisper "word" can contain >1 token; spread its span evenly.
        span = max(0.0, we - ws)
        step = span / len(toks) if toks else 0.0
        for k, t in enumerate(toks):
            asr_tokens.append(t)
            asr_times.append((ws + k * step, ws + (k + 1) * step if step else we))

    if not asr_tokens:
        return AlignmentResult(False, 0.0, original, 0, total, "no usable ASR tokens")

    # Anchor known tokens to ASR timings via the longest-matching-block diff.
    anchored: dict[int, tuple[float, float]] = {}
    matcher = SequenceMatcher(None, known_tokens, asr_tokens, autojunk=False)
    for a, b, size in matcher.get_matching_blocks():
        for off in range(size):
            anchored[a + off] = asr_times[b + off]
    matched = len(anchored)
    confidence = matched / total if total else 0.0
    if confidence < min_confidence:
        return AlignmentResult(False, confidence, original, matched, total,
                               f"confidence {confidence:.2f} < {min_confidence}")

    # Interpolate timings for unanchored tokens between known anchors so every
    # token has a monotonic time, then collapse to per-line and per-word spans.
    times: list[Optional[tuple[float, float]]] = [anchored.get(i) for i in range(total)]
    _fill_gaps(times)

    aligned: list[AlignedLine] = []
    cursor = 0
    for i, ln in enumerate(original):
        toks = _tokenize(ln.text)
        n = len(toks)
        line_idx = range(cursor, cursor + n)
        # Tokens DIRECTLY anchored to audio (not interpolated) gate trust in the
        # line. Lines whose words whisper didn't actually hear get interpolated
        # into a degenerate window at the wrong time, which is worse than the
        # artist's original timing -- so fall back per line.
        anchored_here = sum(1 for j in line_idx if j in anchored)
        spans = [t for t in times[cursor:cursor + n] if t is not None]
        cursor += n
        if not spans or anchored_here == 0:
            aligned.append(AlignedLine(i, ln.text, ln.start, ln.end))  # keep original
            continue
        start = min(s for s, _ in spans)
        end = max(e for _, e in spans)
        anchor_frac = anchored_here / max(1, n)
        # Too weakly anchored or a collapsed span -> trust the artist's timing.
        if anchor_frac < _MIN_LINE_ANCHOR_FRAC or (end - start) < _MIN_LINE_SPAN_S:
            aligned.append(AlignedLine(i, ln.text, ln.start, ln.end))
            continue
        if end <= start:
            end = start + 0.2
        word_timings = [
            {"text": tok, "start": round(sp[0], 3), "end": round(sp[1], 3)}
            for tok, sp in zip(toks, times[cursor - n:cursor]) if sp is not None
        ]
        aligned.append(AlignedLine(i, ln.text, round(start, 3), round(end, 3), word_timings))

    return AlignmentResult(True, confidence, aligned, matched, total, "ok")


_EPS = 0.05  # minimum span width for interpolated/extrapolated tokens


def _fill_gaps(times: list[Optional[tuple[float, float]]]) -> None:
    """Interpolate None spans between known anchors and extrapolate edges.

    Every produced span is non-zero width and non-decreasing, so per-word
    karaoke timings never come out degenerate (start == end) or backwards even
    when whisper emits overlapping/out-of-order word times.
    """
    n = len(times)
    known_idx = [i for i, t in enumerate(times) if t is not None]
    if not known_idx:
        return
    # Leading gap -> small window just before the first anchor's start.
    first = known_idx[0]
    s = max(0.0, times[first][0] - _EPS)
    for i in range(first):
        times[i] = (s, s + _EPS)
    # Trailing gap -> small window just after the last anchor's end.
    last = known_idx[-1]
    e = times[last][1]
    for i in range(last + 1, n):
        times[i] = (e, e + _EPS)
    # Interior gaps -> spread evenly between bracketing anchors (clamped sane).
    for a, b in zip(known_idx, known_idx[1:]):
        if b - a <= 1:
            continue
        t0, t1 = times[a][1], times[b][0]
        if t1 < t0:  # anchors out of order (overlapping ASR words)
            t0, t1 = t1, t0
        step = (t1 - t0) / (b - a)
        for k in range(1, b - a):
            start = t0 + step * (k - 1)
            end = t0 + step * k
            if end <= start:
                end = start + 0.001
            times[a + k] = (start, end)


def align_lyrics_to_audio(
    lines: list[dict],
    audio_path: str,
    *,
    model_name: str = "base",
    min_confidence: float = 0.5,
) -> AlignmentResult:
    """Transcribe ``audio_path`` and align known ``lines`` to it.

    Never raises: on any failure returns ``applied=False`` with original timings,
    so callers can use the result unconditionally.
    """
    original = [
        AlignedLine(
            index=i,
            text=str(ln.get("text", "")),
            start=float(ln.get("start", ln.get("start_time", 0.0)) or 0.0),
            end=float(ln.get("end", ln.get("end_time", 0.0)) or 0.0),
        )
        for i, ln in enumerate(lines)
    ]
    if not audio_path or not os.path.exists(audio_path):
        return AlignmentResult(False, 0.0, original, reason="audio file not found")
    try:
        from core.transcription import transcribe_voice_memo, extract_word_captions

        artifact = transcribe_voice_memo(audio_path, model_name=model_name, verbose=False)
        asr_words = extract_word_captions(artifact.result)
        return align_known_lines_to_words(lines, asr_words, min_confidence=min_confidence)
    except Exception as exc:  # pragma: no cover - defensive
        return AlignmentResult(False, 0.0, original, reason=f"alignment failed: {exc}")
