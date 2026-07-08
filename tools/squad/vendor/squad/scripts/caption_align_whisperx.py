#!/usr/bin/env python3
"""WhisperX caption-alignment worker for Squad.

Input is the JSON request produced by CommandCaptionAlignmentAdapter.
Output is a JSON file containing word timings that Squad groups into captions.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if args == ["--check"]:
        _check_worker_ready()
        print(json.dumps({"ok": True, "worker": "whisperx"}))
        return 0
    if len(args) != 1:
        print("usage: caption_align_whisperx.py [--check|CAPTION_ALIGNMENT_REQUEST_JSON]", file=sys.stderr)
        return 2
    request_path = Path(args[0])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    output_path = Path(request["output_path"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _align_with_whisperx(request)
    output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"output_path": str(output_path)}))
    return 0


def _align_with_whisperx(request: dict[str, Any]) -> dict[str, Any]:
    _load_whisperx()
    import whisperx

    audio_path = str(request["audio_path"])
    device = os.getenv("SQUAD_WHISPERX_DEVICE") or "cpu"
    compute_type = os.getenv("SQUAD_WHISPERX_COMPUTE_TYPE") or ("int8" if device == "cpu" else "float16")
    model_name = os.getenv("SQUAD_WHISPERX_MODEL") or "small"
    batch_size = int(os.getenv("SQUAD_WHISPERX_BATCH_SIZE") or "8")

    model = whisperx.load_model(model_name, device=device, compute_type=compute_type)
    result = model.transcribe(audio_path, batch_size=batch_size)
    language_code = result.get("language") or os.getenv("SQUAD_WHISPERX_LANGUAGE") or "en"
    aligned = result
    if not _has_word_timings(aligned):
        align_model, metadata = whisperx.load_align_model(language_code=language_code, device=device)
        aligned = whisperx.align(
            result.get("segments") or [],
            align_model,
            metadata,
            audio_path,
            device,
            return_char_alignments=False,
        )
    words = _extract_words(aligned)
    if not words:
        raise RuntimeError("WhisperX did not return word timings")
    return {
        "schema_version": "squad.caption_alignment.v1",
        "source": "whisperx",
        "language": language_code,
        "words": words,
    }


def _check_worker_ready() -> None:
    _load_whisperx()


def _load_whisperx() -> None:
    _ensure_ffmpeg_on_path()
    try:
        import whisperx
    except ImportError as exc:  # pragma: no cover - optional worker dependency
        raise RuntimeError(
            "WhisperX is required for caption alignment. Install it in the worker env "
            "or point SQUAD_CAPTION_ALIGN_COMMAND at another aligner."
        ) from exc


def _has_word_timings(payload: dict[str, Any]) -> bool:
    return any(segment.get("words") for segment in payload.get("segments") or [])


def _extract_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in payload.get("segments") or []:
        for word in segment.get("words") or []:
            text = str(word.get("word") or word.get("text") or "").strip()
            start = _optional_float(word.get("start"))
            end = _optional_float(word.get("end"))
            if text and start is not None and end is not None and end > start:
                words.append({"word": text, "start": start, "end": end})
    return words


def _ensure_ffmpeg_on_path() -> None:
    ffmpeg_binary = os.getenv("SQUAD_FFMPEG_BINARY")
    if not ffmpeg_binary:
        return
    ffmpeg_dir = str(Path(ffmpeg_binary).expanduser().parent)
    if not ffmpeg_dir or ffmpeg_dir == ".":
        return
    path = os.getenv("PATH") or ""
    if ffmpeg_dir not in path.split(os.pathsep):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + path


def _optional_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
