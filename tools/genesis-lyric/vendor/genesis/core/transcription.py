import json
import os
from dataclasses import dataclass
from typing import Any, Optional

from core.media_binaries import ensure_media_binary_on_path


@dataclass
class TranscriptionArtifact:
    audio_path: str
    model_name: str
    language: Optional[str]
    result: dict[str, Any]


def _format_srt_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000.0))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def extract_word_captions(result: dict[str, Any]) -> list[dict[str, Any]]:
    captions: list[dict[str, Any]] = []
    for seg in result.get("segments") or []:
        for w in seg.get("words") or []:
            text = (w.get("text") or "").strip()
            if not text:
                continue
            captions.append(
                {
                    "text": text,
                    "start": float(w.get("start", 0.0)),
                    "end": float(w.get("end", 0.0)),
                }
            )
    return captions


def extract_segment_captions(result: dict[str, Any]) -> list[dict[str, Any]]:
    captions: list[dict[str, Any]] = []
    for seg in result.get("segments") or []:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        captions.append(
            {
                "text": text,
                "start": float(seg.get("start", 0.0)),
                "end": float(seg.get("end", 0.0)),
            }
        )
    return captions


def round_to_second(value: Any) -> int:
    """Round a timestamp to the nearest whole second.

    Confirmable lyric timestamps read better as whole seconds (no ``4.56s``)."""
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0


def _word_bounds(word: Any) -> Optional[tuple[float, float]]:
    if isinstance(word, (tuple, list)) and len(word) >= 2:
        ws, we = word[0], word[1]
    elif isinstance(word, dict):
        ws, we = word.get("start"), word.get("end")
    else:
        ws, we = getattr(word, "start", None), getattr(word, "end", None)
    try:
        return float(ws), float(we)
    except (TypeError, ValueError):
        return None


def refine_segment_bounds(seg_start: Any, seg_end: Any, words: Any) -> tuple[float, float]:
    """Tighten a segment's [start, end] to the actual words it contains.

    Whisper anchors the first segment at 0.0, so the opening lyric absorbs the
    whole instrumental intro. Snapping to the first/last word that overlaps the
    segment moves the start to the true vocal onset. Falls back to the segment
    bounds when no word timings overlap."""
    try:
        s0, e0 = float(seg_start), float(seg_end)
    except (TypeError, ValueError):
        return 0.0, 0.0
    inside: list[tuple[float, float]] = []
    for w in words or []:
        b = _word_bounds(w)
        if b is None:
            continue
        ws, we = b
        if we > s0 and ws < e0:  # overlaps the segment
            inside.append((ws, we))
    if not inside:
        return s0, e0
    return min(s for s, _ in inside), max(e for _, e in inside)


def snap_line_times(seg_start: Any, seg_end: Any, words: Any = None) -> tuple[int, int]:
    """Word-snapped, whole-second [start, end] for a confirmable lyric line.

    Combines :func:`refine_segment_bounds` (fixes the intro-absorbing first line)
    and :func:`round_to_second`, guaranteeing ``end > start``."""
    s, e = refine_segment_bounds(seg_start, seg_end, words)
    si, ei = round_to_second(s), round_to_second(e)
    if ei <= si:
        ei = si + 1
    return si, ei


def write_srt(captions: list[dict[str, Any]], output_srt_path: str) -> None:
    os.makedirs(os.path.dirname(output_srt_path) or ".", exist_ok=True)
    with open(output_srt_path, "w", encoding="utf-8") as f:
        for idx, cap in enumerate(captions, start=1):
            start = _format_srt_timestamp(float(cap.get("start", 0.0)))
            end = _format_srt_timestamp(float(cap.get("end", 0.0)))
            text = (cap.get("text") or "").strip()
            if not text:
                continue
            f.write(f"{idx}\n")
            f.write(f"{start} --> {end}\n")
            f.write(f"{text}\n\n")


def transcribe_voice_memo(
    audio_path: str,
    *,
    model_name: str = "base",
    device: str = "cpu",
    language: Optional[str] = None,
    vad: bool = False,
    output_json_path: Optional[str] = None,
    output_srt_path: Optional[str] = None,
    verbose: bool = True,
) -> TranscriptionArtifact:
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    ensure_media_binary_on_path("ffmpeg")

    try:
        import whisper_timestamped as whisper
    except Exception as e:
        raise RuntimeError(
            "Missing transcription dependency. Install requirements and ensure "
            "`whisper-timestamped` + `openai-whisper` are available."
        ) from e

    if verbose:
        print("[transcription] starting")
        print(f"[transcription] audio_path={audio_path}")
        print(f"[transcription] model_name={model_name} device={device} language={language} vad={vad}")

    audio = whisper.load_audio(audio_path)
    model = whisper.load_model(model_name, device=device)

    result = whisper.transcribe(
        model,
        audio,
        language=language,
        vad=vad,
        verbose=verbose,
    )

    artifact = TranscriptionArtifact(
        audio_path=audio_path,
        model_name=model_name,
        language=language,
        result=result,
    )

    if output_json_path:
        os.makedirs(os.path.dirname(output_json_path) or ".", exist_ok=True)
        word_captions = extract_word_captions(result)
        segment_captions = extract_segment_captions(result)
        payload = {
            "audio_path": audio_path,
            "model_name": model_name,
            "language": language,
            "vad": vad,
            "captions": {
                "words": word_captions,
                "segments": segment_captions,
            },
            "result": result,
        }
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        if verbose:
            print(f"[transcription] wrote_json={output_json_path}")

    if output_srt_path:
        segment_captions = extract_segment_captions(result)
        write_srt(segment_captions, output_srt_path)
        if verbose:
            print(f"[transcription] wrote_srt={output_srt_path}")

    if verbose:
        segments = result.get("segments") or []
        word_count = 0
        for seg in segments:
            word_count += len(seg.get("words") or [])
        print(f"[transcription] segments={len(segments)} words={word_count}")
        print("[transcription] done")

    return artifact
