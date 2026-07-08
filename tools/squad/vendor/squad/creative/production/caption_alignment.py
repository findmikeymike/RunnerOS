from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Protocol

from creative.production.contracts import CaptionCue, CaptionStyle


class CaptionAlignmentAdapter(Protocol):
    def align_caption_cues(
        self,
        *,
        run_id: str,
        audio_path: Path,
        script: str,
        style: CaptionStyle,
        duration_s: float | None,
        output_root: Path | str = ".outputs/creative-production",
    ) -> tuple[CaptionCue, ...]:
        ...


class CommandCaptionAlignmentAdapter:
    """Bridge to a WhisperX/OpenMontage-style caption alignment worker."""

    def __init__(
        self,
        *,
        command: list[str],
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 900,
    ) -> None:
        self.command = tuple(part for part in command if part)
        self.output_root = Path(output_root)
        self.timeout_sec = int(timeout_sec)
        if not self.command:
            raise ValueError("command is required")

    def align_caption_cues(
        self,
        *,
        run_id: str,
        audio_path: Path,
        script: str,
        style: CaptionStyle,
        duration_s: float | None,
        output_root: Path | str = ".outputs/creative-production",
    ) -> tuple[CaptionCue, ...]:
        if not audio_path.exists():
            raise RuntimeError(f"caption alignment audio does not exist: {audio_path}")
        run_dir = Path(output_root or self.output_root) / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        request_path = run_dir / "caption-alignment-request.json"
        output_path = run_dir / "caption-alignment.json"
        request_path.write_text(
            json.dumps(
                {
                    "schema_version": "squad.caption_alignment.v1",
                    "run_id": run_id,
                    "audio_path": str(audio_path),
                    "script": script,
                    "duration_s": duration_s,
                    "style": _style_payload(style),
                    "output_path": str(output_path),
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        env = dict(os.environ)
        env["SQUAD_CAPTION_ALIGNMENT_REQUEST_PATH"] = str(request_path)
        env["SQUAD_CAPTION_ALIGNMENT_OUTPUT_PATH"] = str(output_path)
        completed = subprocess.run(
            [*self.command, str(request_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=self.timeout_sec,
            env=env,
        )
        payload = _parse_alignment_payload(completed.stdout, output_path=output_path)
        return cues_from_alignment_payload(payload=payload, style=style, duration_s=duration_s)


def cues_from_alignment_payload(
    *,
    payload: dict[str, Any],
    style: CaptionStyle,
    duration_s: float | None = None,
) -> tuple[CaptionCue, ...]:
    cues = _coerce_payload_cues(payload)
    if cues:
        return _normalize_cues(cues, duration_s=duration_s)
    words = _coerce_payload_words(payload)
    if not words:
        return ()
    return _group_words_into_cues(words=words, style=style, duration_s=duration_s)


def _parse_alignment_payload(stdout: str, *, output_path: Path) -> dict[str, Any]:
    if output_path.exists():
        return json.loads(output_path.read_text(encoding="utf-8"))
    for line in reversed(stdout.splitlines()):
        candidate = line.strip()
        if candidate.startswith("{") and candidate.endswith("}"):
            return json.loads(candidate)
    raise RuntimeError("caption alignment command did not return JSON or create output_path")


def _coerce_payload_cues(payload: dict[str, Any]) -> list[CaptionCue]:
    raw_cues = payload.get("cues") or payload.get("caption_cues") or payload.get("segments") or []
    cues: list[CaptionCue] = []
    for index, item in enumerate(raw_cues, start=1):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start_s = _optional_float(item.get("start_s", item.get("start", item.get("start_time"))))
        end_s = _optional_float(item.get("end_s", item.get("end", item.get("end_time"))))
        if start_s is None or end_s is None or end_s <= start_s:
            continue
        cues.append(
            CaptionCue(
                index=index,
                start_s=start_s,
                end_s=end_s,
                text=text,
                beat_role=str(item.get("beat_role") or "voiceover"),
                style=str(item.get("style") or "aligned_spoken"),
            )
        )
    return cues


def _coerce_payload_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_words = payload.get("words") or payload.get("word_segments") or []
    words: list[dict[str, Any]] = []
    for item in raw_words:
        if not isinstance(item, dict):
            continue
        text = str(item.get("word") or item.get("text") or "").strip()
        if not text:
            continue
        start_s = _optional_float(item.get("start_s", item.get("start", item.get("start_time"))))
        end_s = _optional_float(item.get("end_s", item.get("end", item.get("end_time"))))
        if start_s is None or end_s is None or end_s <= start_s:
            continue
        words.append({"text": text, "start_s": start_s, "end_s": end_s})
    return sorted(words, key=lambda item: (item["start_s"], item["end_s"]))


def _group_words_into_cues(
    *,
    words: list[dict[str, Any]],
    style: CaptionStyle,
    duration_s: float | None,
) -> tuple[CaptionCue, ...]:
    max_chars = max(8, style.max_chars_per_line * max(1, style.max_lines))
    max_duration = 2.25
    max_gap = 0.55
    cues: list[CaptionCue] = []
    current: list[dict[str, Any]] = []
    for word in words:
        if current and _should_flush(current=current, word=word, max_chars=max_chars, max_duration=max_duration, max_gap=max_gap):
            cues.append(_cue_from_words(index=len(cues) + 1, words=current, style=style))
            current = []
        current.append(word)
        if _ends_sentence(word["text"]) and len(_caption_text(current).split()) >= 3:
            cues.append(_cue_from_words(index=len(cues) + 1, words=current, style=style))
            current = []
    if current:
        cues.append(_cue_from_words(index=len(cues) + 1, words=current, style=style))
    return _normalize_cues(cues, duration_s=duration_s)


def _should_flush(
    *,
    current: list[dict[str, Any]],
    word: dict[str, Any],
    max_chars: int,
    max_duration: float,
    max_gap: float,
) -> bool:
    candidate = f"{_caption_text(current)} {word['text']}".strip()
    if len(candidate) > max_chars:
        return True
    if float(word["end_s"]) - float(current[0]["start_s"]) > max_duration:
        return True
    if float(word["start_s"]) - float(current[-1]["end_s"]) > max_gap:
        return True
    return False


def _cue_from_words(*, index: int, words: list[dict[str, Any]], style: CaptionStyle) -> CaptionCue:
    return CaptionCue(
        index=index,
        start_s=float(words[0]["start_s"]),
        end_s=float(words[-1]["end_s"]),
        text=_wrap_caption_text(_caption_text(words), style),
        beat_role="voiceover",
        style="aligned_spoken",
    )


def _caption_text(words: list[dict[str, Any]]) -> str:
    return " ".join(str(word["text"]).strip() for word in words if str(word["text"]).strip()).strip()


def _wrap_caption_text(text: str, style: CaptionStyle) -> str:
    max_lines = max(1, style.max_lines)
    max_chars = max(8, style.max_chars_per_line)
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            lines.append(current)
            current = word
            if len(lines) >= max_lines:
                break
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    return "\n".join(lines) if lines else text


def _normalize_cues(cues: list[CaptionCue], *, duration_s: float | None) -> tuple[CaptionCue, ...]:
    normalized: list[CaptionCue] = []
    previous_end = 0.0
    max_end = float(duration_s) if duration_s and duration_s > 0 else None
    for cue in sorted(cues, key=lambda item: (item.start_s, item.end_s)):
        start_s = max(previous_end, float(cue.start_s))
        end_s = float(cue.end_s)
        if max_end is not None:
            end_s = min(end_s, max_end)
        if end_s <= start_s:
            continue
        normalized.append(
            CaptionCue(
                index=len(normalized) + 1,
                start_s=round(start_s, 3),
                end_s=round(end_s, 3),
                text=cue.text.strip(),
                beat_role=cue.beat_role,
                style=cue.style,
            )
        )
        previous_end = end_s
    return tuple(normalized)


def _ends_sentence(text: str) -> bool:
    return text.rstrip().endswith((".", "!", "?"))


def _style_payload(style: CaptionStyle) -> dict[str, Any]:
    return {
        "font": style.font,
        "font_size": style.font_size,
        "primary_color": style.primary_color,
        "outline_color": style.outline_color,
        "outline_width": style.outline_width,
        "alignment": style.alignment,
        "margin_v": style.margin_v,
        "max_chars_per_line": style.max_chars_per_line,
        "max_lines": style.max_lines,
    }


def _optional_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
