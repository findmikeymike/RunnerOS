from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class OutputQAExpectation:
    duration_min_s: float | None = None
    duration_max_s: float | None = None
    expected_clip_count: int | None = None
    require_audio: bool = False
    expected_aspect_ratio: str | None = None
    min_caption_cues: int | None = None
    max_caption_chars_per_line: int = 42
    max_caption_lines: int = 2


@dataclass(frozen=True, slots=True)
class OutputQAFinding:
    severity: str
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class OutputQAReport:
    expectations: OutputQAExpectation
    findings: tuple[OutputQAFinding, ...] = ()

    @property
    def passed(self) -> bool:
        return not any(finding.severity == "error" for finding in self.findings)


APPROVED_SMOKE_VIDEO_MODELS = ("wavespeed/bytedance/seedance-v1-lite-i2v-480p",)
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_IGNORED_OCR_TOKENS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "no",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}


def build_output_qa_expectation(
    *,
    format_plan: Any | None = None,
    expected_clip_count: int | None = None,
    require_audio: bool | None = None,
    min_caption_cues: int | None = None,
) -> OutputQAExpectation:
    platform_profile = _attr(format_plan, "platform_profile")
    scene_beats = tuple(_attr(format_plan, "scene_beats", ()) or ())
    format_type = str(_attr(format_plan, "format_type", "") or "")
    audio_mode = str(_attr(format_plan, "audio_mode", "") or "")
    inferred_clip_count = expected_clip_count if expected_clip_count is not None else (len(scene_beats) or None)
    inferred_require_audio = (
        _is_narration_led_faceless(format_type=format_type, audio_mode=audio_mode)
        if require_audio is None
        else require_audio
    )
    inferred_min_caption_cues = (
        min_caption_cues
        if min_caption_cues is not None
        else (inferred_clip_count if _is_narration_led_faceless(format_type=format_type, audio_mode=audio_mode) else None)
    )
    return OutputQAExpectation(
        duration_min_s=_optional_float(_attr(platform_profile, "duration_min_s")),
        duration_max_s=_optional_float(_attr(platform_profile, "duration_max_s")),
        expected_clip_count=inferred_clip_count,
        require_audio=inferred_require_audio,
        expected_aspect_ratio=_optional_str(_attr(platform_profile, "aspect_ratio")),
        min_caption_cues=inferred_min_caption_cues,
    )


def validate_final_output(
    *,
    final_assembly: Any | None = None,
    format_plan: Any | None = None,
    post_pass_plan: Any | None = None,
    output_probe: Any | None = None,
    expectations: OutputQAExpectation | None = None,
) -> OutputQAReport:
    expected = expectations or build_output_qa_expectation(
        format_plan=format_plan,
        expected_clip_count=_expected_clip_count_for_assembly(final_assembly=final_assembly),
    )
    probe = output_probe or _attr(post_pass_plan, "output_probe")
    caption_cues = tuple(_attr(post_pass_plan, "caption_cues", ()) or ())
    findings = (
        *validate_final_asset_exists(final_assembly=final_assembly),
        *validate_duration_range(duration_s=_duration_s(final_assembly=final_assembly, probe=probe), expectations=expected),
        *validate_clip_count(actual_clip_count=_attr(final_assembly, "clip_count"), expectations=expected),
        *validate_audio_requirement(final_assembly=final_assembly, probe=probe, expectations=expected),
        *validate_required_audio_signal(final_assembly=final_assembly, expectations=expected),
        *validate_aspect_ratio(probe=probe, expectations=expected),
        *validate_caption_readability(caption_cues=caption_cues, expectations=expected),
    )
    return OutputQAReport(expectations=expected, findings=findings)


def _expected_clip_count_for_assembly(*, final_assembly: Any | None) -> int | None:
    assembly_method = str(_attr(final_assembly, "assembly_method", "") or "")
    if assembly_method == "ffmpeg_ugc_pip_overlay":
        clip_count = _attr(final_assembly, "clip_count")
        try:
            return int(clip_count)
        except (TypeError, ValueError):
            return 2
    return None


def validate_smoke_video_models(
    *,
    model_ids: tuple[str | None, ...],
    approved_model_ids: tuple[str, ...] = APPROVED_SMOKE_VIDEO_MODELS,
) -> tuple[OutputQAFinding, ...]:
    unknown = tuple(sorted({model_id for model_id in model_ids if model_id and model_id not in approved_model_ids}))
    if not unknown:
        return ()
    return (
        OutputQAFinding(
            "error",
            "unapproved_smoke_video_model",
            f"smoke used unapproved video model(s): {', '.join(unknown)}",
        ),
    )


def run_free_smoke_media_qa(
    *,
    final_asset_path: Path,
    output_dir: Path,
    brief: Any,
    caption_cues: tuple[Any, ...] = (),
    video_model_ids: tuple[str | None, ...] = (),
    ffmpeg_binary: str = "ffmpeg",
    tesseract_binary: str = "tesseract",
    command_runner: Any | None = None,
) -> dict[str, Any]:
    runner = command_runner or subprocess.run
    output_dir.mkdir(parents=True, exist_ok=True)
    findings: list[OutputQAFinding] = []
    findings.extend(validate_smoke_video_models(model_ids=video_model_ids))
    audio_report = probe_low_frequency_audio(
        final_asset_path=final_asset_path,
        ffmpeg_binary=ffmpeg_binary,
        command_runner=runner,
    )
    visual_integrity_report = probe_visual_integrity(
        final_asset_path=final_asset_path,
        ffmpeg_binary=ffmpeg_binary,
        command_runner=runner,
    )
    visual_report = probe_unexpected_scene_text(
        final_asset_path=final_asset_path,
        output_dir=output_dir / "ocr-frames",
        brief=brief,
        caption_cues=caption_cues,
        ffmpeg_binary=ffmpeg_binary,
        tesseract_binary=tesseract_binary,
        command_runner=runner,
    )
    findings.extend(OutputQAFinding(**finding) for finding in audio_report.get("findings", ()))
    findings.extend(OutputQAFinding(**finding) for finding in visual_integrity_report.get("findings", ()))
    findings.extend(OutputQAFinding(**finding) for finding in visual_report.get("findings", ()))
    payload = {
        "passed": not any(finding.severity == "error" for finding in findings),
        "findings": [_finding_to_dict(finding) for finding in findings],
        "audio": audio_report,
        "visual_integrity": visual_integrity_report,
        "visual_text": visual_report,
        "approved_video_models": list(APPROVED_SMOKE_VIDEO_MODELS),
    }
    report_path = output_dir / "free-output-qa.json"
    report_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    payload["report_path"] = str(report_path)
    return payload


def probe_low_frequency_audio(
    *,
    final_asset_path: Path,
    ffmpeg_binary: str = "ffmpeg",
    command_runner: Any | None = None,
) -> dict[str, Any]:
    runner = command_runner or subprocess.run
    samples = _decode_audio_samples(
        final_asset_path=final_asset_path,
        ffmpeg_binary=ffmpeg_binary,
        command_runner=runner,
    )
    findings: list[OutputQAFinding] = []
    tone_report: dict[str, Any] | None = None
    signal_report: dict[str, Any] | None = None
    if samples is None:
        findings.append(OutputQAFinding("warn", "audio_noise_probe_unavailable", "could not measure audio noise profile"))
    else:
        signal_report = analyze_audio_signal(samples=samples)
        tone_report = detect_sustained_tone(samples=samples, sample_rate=16000)
    if tone_report and tone_report["detected"]:
        findings.append(
            OutputQAFinding(
                "warn",
                "sustained_tonal_hum",
                (
                    "audio contains a sustained narrow tone near "
                    f"{tone_report['frequency_hz']:.1f} Hz with median prominence {tone_report['prominence_db']:.1f} dB"
                ),
            )
        )
    return {
        "status": "checked" if tone_report is not None else "skipped",
        "signal": signal_report,
        "tone": tone_report,
        "findings": [_finding_to_dict(finding) for finding in findings],
    }


def analyze_audio_signal(*, samples: tuple[float, ...]) -> dict[str, Any]:
    if not samples:
        return {"sample_count": 0, "rms": 0.0, "peak_abs": 0.0, "silent": True, "near_silent": True}
    rms = math.sqrt(sum(float(sample) * float(sample) for sample in samples) / len(samples))
    peak_abs = max(abs(float(sample)) for sample in samples)
    return {
        "sample_count": len(samples),
        "rms": round(rms, 6),
        "peak_abs": round(peak_abs, 6),
        "silent": peak_abs <= 0.0001,
        "near_silent": rms < 0.002 and peak_abs < 0.015,
    }


def detect_sustained_tone(
    *,
    samples: tuple[float, ...],
    sample_rate: int,
    min_frequency_hz: float = 90.0,
    max_frequency_hz: float = 420.0,
    frame_duration_s: float = 1.0,
    hop_duration_s: float = 0.5,
    prominence_threshold_db: float = 18.0,
    min_coverage: float = 0.18,
) -> dict[str, Any]:
    frame_size = max(128, int(sample_rate * frame_duration_s))
    hop_size = max(1, int(sample_rate * hop_duration_s))
    if len(samples) < frame_size:
        return {"detected": False, "reason": "audio_too_short"}
    peaks: list[tuple[float, float]] = []
    for start in range(0, len(samples) - frame_size + 1, hop_size):
        frame = samples[start : start + frame_size]
        peak = _dominant_tone_peak(
            frame=frame,
            sample_rate=sample_rate,
            min_frequency_hz=min_frequency_hz,
            max_frequency_hz=max_frequency_hz,
        )
        if peak is not None:
            peaks.append(peak)
    if not peaks:
        return {"detected": False, "reason": "no_low_frequency_peaks"}
    strong = [(freq, prominence) for freq, prominence in peaks if prominence >= prominence_threshold_db]
    if not strong:
        return {
            "detected": False,
            "peak_count": len(peaks),
            "max_prominence_db": round(max(prominence for _freq, prominence in peaks), 1),
        }
    clusters: dict[int, list[float]] = {}
    for freq, prominence in strong:
        bucket = int(round(freq / 5.0) * 5)
        clusters.setdefault(bucket, []).append(prominence)
    bucket, prominences = max(clusters.items(), key=lambda item: len(item[1]))
    coverage = len(prominences) / max(1, len(peaks))
    median_prominence = sorted(prominences)[len(prominences) // 2]
    required_coverage = min_coverage if bucket >= 210 else max(min_coverage, 0.55)
    detected = coverage >= required_coverage
    return {
        "detected": detected,
        "frequency_hz": float(bucket),
        "prominence_db": round(float(median_prominence), 1),
        "coverage": round(float(coverage), 3),
        "required_coverage": round(float(required_coverage), 3),
        "peak_count": len(peaks),
        "strong_peak_count": len(strong),
    }


def probe_unexpected_scene_text(
    *,
    final_asset_path: Path,
    output_dir: Path,
    brief: Any,
    caption_cues: tuple[Any, ...] = (),
    ffmpeg_binary: str = "ffmpeg",
    tesseract_binary: str = "tesseract",
    command_runner: Any | None = None,
    sample_interval_s: float = 2.0,
    max_frames: int = 12,
) -> dict[str, Any]:
    runner = command_runner or subprocess.run
    resolved_tesseract = _resolve_binary(tesseract_binary)
    if resolved_tesseract is None:
        finding = OutputQAFinding("warn", "ocr_unavailable", "tesseract not found; skipped unexpected scene text OCR")
        return {"status": "skipped", "findings": [_finding_to_dict(finding)], "frames": [], "unexpected_tokens": []}
    frames = sample_caption_safe_frames(
        final_asset_path=final_asset_path,
        output_dir=output_dir,
        ffmpeg_binary=ffmpeg_binary,
        sample_interval_s=sample_interval_s,
        max_frames=max_frames,
        command_runner=runner,
    )
    allowed_tokens = allowed_scene_text_tokens(brief=brief, caption_cues=caption_cues)
    unexpected: dict[str, list[str]] = {}
    for frame in frames:
        ocr_tokens = ocr_frame_tokens(frame_path=frame, tesseract_binary=resolved_tesseract, command_runner=runner)
        bad_tokens = [token for token in ocr_tokens if token not in allowed_tokens and token not in _IGNORED_OCR_TOKENS]
        if bad_tokens:
            unexpected[str(frame)] = sorted(set(bad_tokens))
    findings: list[OutputQAFinding] = []
    if unexpected:
        tokens = sorted({token for frame_tokens in unexpected.values() for token in frame_tokens})
        findings.append(
            OutputQAFinding(
                "error",
                "unexpected_scene_text",
                f"OCR found unexpected baked scene text outside the caption-safe region: {', '.join(tokens)}",
            )
        )
    return {
        "status": "checked",
        "frames": [str(frame) for frame in frames],
        "allowed_token_count": len(allowed_tokens),
        "unexpected_tokens": unexpected,
        "findings": [_finding_to_dict(finding) for finding in findings],
    }


def probe_visual_integrity(
    *,
    final_asset_path: Path,
    ffmpeg_binary: str = "ffmpeg",
    command_runner: Any | None = None,
) -> dict[str, Any]:
    runner = command_runner or subprocess.run
    frames = _decode_video_frames(
        final_asset_path=final_asset_path,
        ffmpeg_binary=ffmpeg_binary,
        command_runner=runner,
    )
    findings: list[OutputQAFinding] = []
    if frames is None:
        findings.append(OutputQAFinding("warn", "visual_integrity_probe_unavailable", "could not sample video frames"))
        return {"status": "skipped", "frames": [], "findings": [_finding_to_dict(finding) for finding in findings]}
    metrics = analyze_visual_frames(frames=frames)
    findings.extend(validate_visual_frame_metrics(metrics=metrics))
    return {
        "status": "checked",
        "frame_count": metrics["frame_count"],
        "mean_luma": metrics["mean_luma"],
        "mean_contrast": metrics["mean_contrast"],
        "mean_green_pixel_ratio": metrics["mean_green_pixel_ratio"],
        "median_frame_delta": metrics["median_frame_delta"],
        "low_delta_ratio": metrics["low_delta_ratio"],
        "findings": [_finding_to_dict(finding) for finding in findings],
    }


def analyze_visual_frames(*, frames: tuple[bytes, ...]) -> dict[str, Any]:
    frame_stats = [_frame_stats(frame) for frame in frames if frame]
    deltas = [_frame_delta(left, right) for left, right in zip(frames, frames[1:]) if left and right]
    low_delta_count = sum(1 for delta in deltas if delta < 1.0)
    return {
        "frame_count": len(frame_stats),
        "mean_luma": round(_mean(stat["mean"] for stat in frame_stats), 2),
        "mean_contrast": round(_mean(stat["stddev"] for stat in frame_stats), 2),
        "dark_frame_ratio": round(_ratio((1 for stat in frame_stats if stat["mean"] < 8.0), len(frame_stats)), 3),
        "bright_frame_ratio": round(_ratio((1 for stat in frame_stats if stat["mean"] > 247.0), len(frame_stats)), 3),
        "flat_frame_ratio": round(_ratio((1 for stat in frame_stats if stat["stddev"] < 4.0), len(frame_stats)), 3),
        "mean_dark_pixel_ratio": round(_mean(stat["dark_pixel_ratio"] for stat in frame_stats), 3),
        "mean_bright_pixel_ratio": round(_mean(stat["bright_pixel_ratio"] for stat in frame_stats), 3),
        "mean_green_pixel_ratio": round(_mean(stat["green_pixel_ratio"] for stat in frame_stats), 3),
        "median_frame_delta": round(_median(deltas), 2) if deltas else None,
        "low_delta_ratio": round(low_delta_count / len(deltas), 3) if deltas else None,
    }


def validate_visual_frame_metrics(*, metrics: dict[str, Any]) -> tuple[OutputQAFinding, ...]:
    findings: list[OutputQAFinding] = []
    frame_count = int(metrics.get("frame_count") or 0)
    if frame_count < 3:
        return (
            OutputQAFinding(
                "warn",
                "visual_sample_count_low",
                f"not enough sampled frames for visual integrity QA: got {frame_count}",
            ),
        )
    if metrics.get("dark_frame_ratio", 0.0) >= 0.75 or metrics.get("mean_dark_pixel_ratio", 0.0) >= 0.9:
        findings.append(OutputQAFinding("error", "video_mostly_black", "sampled video frames are mostly black"))
    if metrics.get("bright_frame_ratio", 0.0) >= 0.75 or metrics.get("mean_bright_pixel_ratio", 0.0) >= 0.9:
        findings.append(OutputQAFinding("error", "video_mostly_white", "sampled video frames are mostly white"))
    if metrics.get("flat_frame_ratio", 0.0) >= 0.75:
        findings.append(OutputQAFinding("error", "video_mostly_flat", "sampled video frames have almost no visual contrast"))
    if metrics.get("mean_green_pixel_ratio", 0.0) >= 0.7:
        findings.append(
            OutputQAFinding(
                "error",
                "video_mostly_chromakey_green",
                "sampled video frames are dominated by chromakey green",
            )
        )
    median_delta = metrics.get("median_frame_delta")
    low_delta_ratio = metrics.get("low_delta_ratio")
    if median_delta is not None and low_delta_ratio is not None and median_delta < 1.0 and low_delta_ratio >= 0.75:
        findings.append(OutputQAFinding("warn", "video_may_be_frozen", "sampled video frames barely change over time"))
    return tuple(findings)


def sample_caption_safe_frames(
    *,
    final_asset_path: Path,
    output_dir: Path,
    ffmpeg_binary: str = "ffmpeg",
    sample_interval_s: float = 2.0,
    max_frames: int = 12,
    command_runner: Any | None = None,
) -> tuple[Path, ...]:
    runner = command_runner or subprocess.run
    output_dir.mkdir(parents=True, exist_ok=True)
    for old_frame in output_dir.glob("frame-*.png"):
        old_frame.unlink()
    pattern = output_dir / "frame-%03d.png"
    fps = 1.0 / max(sample_interval_s, 0.1)
    cmd = [
        ffmpeg_binary,
        "-y",
        "-i",
        str(final_asset_path),
        "-vf",
        f"fps={fps:.3f},crop=iw:ih*0.72:0:0",
        "-frames:v",
        str(max_frames),
        str(pattern),
    ]
    runner(cmd, check=True, capture_output=True, text=True)
    return tuple(sorted(output_dir.glob("frame-*.png")))


def ocr_frame_tokens(*, frame_path: Path, tesseract_binary: str = "tesseract", command_runner: Any | None = None) -> tuple[str, ...]:
    runner = command_runner or subprocess.run
    completed = runner(
        [tesseract_binary, str(frame_path), "stdout", "--psm", "6", "tsv"],
        check=True,
        capture_output=True,
        text=True,
    )
    return parse_tesseract_tsv_tokens(getattr(completed, "stdout", ""))


def parse_tesseract_tsv_tokens(tsv_text: str, *, min_confidence: float = 65.0) -> tuple[str, ...]:
    lines = [line for line in tsv_text.splitlines() if line.strip()]
    if not lines:
        return ()
    header = lines[0].split("\t")
    try:
        conf_index = header.index("conf")
        text_index = header.index("text")
    except ValueError:
        return ()
    tokens: list[str] = []
    for line in lines[1:]:
        columns = line.split("\t")
        if len(columns) <= max(conf_index, text_index):
            continue
        try:
            confidence = float(columns[conf_index])
        except ValueError:
            continue
        if confidence < min_confidence:
            continue
        tokens.extend(_significant_tokens(columns[text_index]))
    return tuple(tokens)


def allowed_scene_text_tokens(*, brief: Any, caption_cues: tuple[Any, ...] = ()) -> set[str]:
    parts = [
        _attr(brief, "product_description", ""),
        _attr(brief, "campaign_goal", ""),
        _attr(brief, "copy_for_overlay", ""),
        _attr(brief, "voiceover_script", ""),
        _attr(brief, "cta_text", ""),
    ]
    parts.extend(str(_attr(cue, "text", "") or "") for cue in caption_cues)
    return {token for part in parts for token in _significant_tokens(str(part))}


def validate_duration_range(
    *,
    duration_s: Any | None,
    expectations: OutputQAExpectation,
) -> tuple[OutputQAFinding, ...]:
    duration = _optional_float(duration_s)
    if duration is None:
        return ()
    findings: list[OutputQAFinding] = []
    if expectations.duration_min_s is not None and duration < expectations.duration_min_s:
        findings.append(
            OutputQAFinding(
                "error",
                "duration_too_short",
                f"final output is shorter than expected: minimum {expectations.duration_min_s}s, got {duration}s",
            )
        )
    if expectations.duration_max_s is not None and duration > expectations.duration_max_s:
        findings.append(
            OutputQAFinding(
                "error",
                "duration_too_long",
                f"final output is longer than expected: maximum {expectations.duration_max_s}s, got {duration}s",
            )
        )
    return tuple(findings)


def validate_clip_count(
    *,
    actual_clip_count: Any | None,
    expectations: OutputQAExpectation,
) -> tuple[OutputQAFinding, ...]:
    if expectations.expected_clip_count is None or actual_clip_count is None:
        return ()
    try:
        actual = int(actual_clip_count)
    except (TypeError, ValueError):
        return (
            OutputQAFinding("error", "clip_count_invalid", f"final clip count is not numeric: {actual_clip_count}"),
        )
    if actual != expectations.expected_clip_count:
        return (
            OutputQAFinding(
                "error",
                "clip_count_mismatch",
                f"final clip count does not match plan: expected {expectations.expected_clip_count}, got {actual}",
            ),
        )
    return ()


def validate_audio_requirement(
    *,
    final_assembly: Any | None,
    probe: Any | None,
    expectations: OutputQAExpectation,
) -> tuple[OutputQAFinding, ...]:
    if not expectations.require_audio:
        return ()
    audio_stream_count = _optional_int(_attr(probe, "audio_stream_count"))
    has_audio_stream = audio_stream_count is not None and audio_stream_count > 0
    has_audio_asset = bool(_attr(final_assembly, "audio_asset_path"))
    if not has_audio_stream and not has_audio_asset:
        return (
            OutputQAFinding(
                "error",
                "audio_required",
                "narration-led faceless output requires an audio track or assembled audio asset",
            ),
        )
    if audio_stream_count == 0:
        return (
            OutputQAFinding(
                "error",
                "final_audio_stream_missing",
                "final media has no audio stream despite required audio",
            ),
        )
    return ()


def validate_final_asset_exists(*, final_assembly: Any | None) -> tuple[OutputQAFinding, ...]:
    if final_assembly is None or not hasattr(final_assembly, "asset_path"):
        return ()
    asset_path = _attr(final_assembly, "asset_path")
    if not asset_path:
        return (OutputQAFinding("error", "final_asset_missing", "final assembly has no final asset path"),)
    path = Path(asset_path)
    if not path.exists():
        return (
            OutputQAFinding("error", "final_asset_missing", f"final asset does not exist: {path}"),
        )
    if path.stat().st_size <= 0:
        return (
            OutputQAFinding("error", "final_asset_empty", f"final asset is empty: {path}"),
        )
    return ()


def validate_required_audio_signal(
    *,
    final_assembly: Any | None,
    expectations: OutputQAExpectation,
    ffmpeg_binary: str = "ffmpeg",
    command_runner: Any | None = None,
) -> tuple[OutputQAFinding, ...]:
    if not expectations.require_audio or final_assembly is None or not hasattr(final_assembly, "asset_path"):
        return ()
    asset_path = _attr(final_assembly, "asset_path")
    if not asset_path:
        return ()
    path = Path(asset_path)
    if not path.exists() or path.stat().st_size <= 0:
        return ()
    samples = _decode_audio_samples(
        final_asset_path=path,
        ffmpeg_binary=ffmpeg_binary,
        command_runner=command_runner or subprocess.run,
    )
    if samples is None:
        return (
            OutputQAFinding(
                "warn",
                "audio_signal_probe_unavailable",
                "could not measure required audio signal",
            ),
        )
    signal = analyze_audio_signal(samples=samples)
    if signal["silent"]:
        return (OutputQAFinding("error", "audio_silent", "required audio track is silent"),)
    if signal["near_silent"]:
        return (
            OutputQAFinding(
                "error",
                "audio_near_silent",
                f"required audio track is near-silent: rms {signal['rms']}, peak {signal['peak_abs']}",
            ),
        )
    return ()


def validate_aspect_ratio(
    *,
    probe: Any | None,
    expectations: OutputQAExpectation,
) -> tuple[OutputQAFinding, ...]:
    if not expectations.expected_aspect_ratio or probe is None:
        return ()
    expected = _parse_aspect_ratio(expectations.expected_aspect_ratio)
    width = _optional_float(_attr(probe, "width"))
    height = _optional_float(_attr(probe, "height"))
    if expected is None or width is None or height is None or height <= 0:
        return ()
    actual = width / height
    if abs(actual - expected) <= 0.08:
        return ()
    return (
        OutputQAFinding(
            "warn",
            "aspect_ratio_mismatch",
            f"final output aspect ratio does not match expectation: expected {expectations.expected_aspect_ratio}, got {int(width)}x{int(height)}",
        ),
    )


def validate_caption_readability(
    *,
    caption_cues: tuple[Any, ...],
    expectations: OutputQAExpectation,
) -> tuple[OutputQAFinding, ...]:
    findings: list[OutputQAFinding] = []
    if expectations.min_caption_cues is not None and len(caption_cues) < expectations.min_caption_cues:
        findings.append(
            OutputQAFinding(
                "error",
                "caption_cue_count_low",
                f"not enough caption cues for narration-led output: expected at least {expectations.min_caption_cues}, got {len(caption_cues)}",
            )
        )
    for index, cue in enumerate(caption_cues, start=1):
        text = str(_attr(cue, "text", "") or "")
        lines = text.splitlines() or [text]
        if not text.strip():
            findings.append(OutputQAFinding("error", "caption_empty", f"caption cue {index} is empty"))
        if len(lines) > expectations.max_caption_lines:
            findings.append(
                OutputQAFinding("warn", "caption_too_many_lines", f"caption cue {index} has too many lines")
            )
        if any(len(line) > expectations.max_caption_chars_per_line for line in lines):
            findings.append(
                OutputQAFinding("warn", "caption_line_too_long", f"caption cue {index} may be too long to read")
            )
    return tuple(findings)


def _duration_s(*, final_assembly: Any | None, probe: Any | None) -> float | None:
    probed_duration = _optional_float(_attr(probe, "duration_s"))
    if probed_duration is not None:
        return probed_duration
    return _optional_float(_attr(final_assembly, "duration_s"))


def _is_narration_led_faceless(*, format_type: str, audio_mode: str) -> bool:
    return format_type == "no_face_youtube" and audio_mode == "narration_led"


def _parse_aspect_ratio(aspect_ratio: str) -> float | None:
    parts = aspect_ratio.strip().split(":")
    if len(parts) != 2:
        return None
    width = _optional_float(parts[0])
    height = _optional_float(parts[1])
    if width is None or height is None or width <= 0 or height <= 0:
        return None
    return width / height


def _attr(source: Any | None, name: str, default: Any = None) -> Any:
    if source is None:
        return default
    return getattr(source, name, default)


def _decode_audio_samples(
    *,
    final_asset_path: Path,
    ffmpeg_binary: str,
    command_runner: Any,
) -> tuple[float, ...] | None:
    try:
        completed = command_runner(
            [
                ffmpeg_binary,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(final_asset_path),
                "-f",
                "f32le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-",
            ],
            check=True,
            capture_output=True,
            text=False,
        )
    except Exception:
        return None
    raw = getattr(completed, "stdout", b"") or b""
    return _float32le_samples(raw)


def _decode_video_frames(
    *,
    final_asset_path: Path,
    ffmpeg_binary: str,
    command_runner: Any,
    width: int = 64,
    height: int = 64,
    sample_fps: float = 1.0,
    max_frames: int = 12,
) -> tuple[bytes, ...] | None:
    try:
        completed = command_runner(
            [
                ffmpeg_binary,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(final_asset_path),
                "-vf",
                f"fps={sample_fps:.3f},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
                "-frames:v",
                str(max_frames),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ],
            check=True,
            capture_output=True,
            text=False,
        )
    except Exception:
        return None
    raw = getattr(completed, "stdout", b"") or b""
    frame_size = width * height * 3
    if len(raw) < frame_size:
        return ()
    return tuple(raw[index : index + frame_size] for index in range(0, len(raw) - frame_size + 1, frame_size))


def _frame_stats(frame: bytes) -> dict[str, float]:
    if not frame:
        return {
            "mean": 0.0,
            "stddev": 0.0,
            "dark_pixel_ratio": 0.0,
            "bright_pixel_ratio": 0.0,
            "green_pixel_ratio": 0.0,
        }
    values = [
        0.2126 * frame[index] + 0.7152 * frame[index + 1] + 0.0722 * frame[index + 2]
        for index in range(0, len(frame) - 2, 3)
    ]
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return {
        "mean": mean,
        "stddev": math.sqrt(variance),
        "dark_pixel_ratio": sum(1 for value in values if value < 8.0) / len(values),
        "bright_pixel_ratio": sum(1 for value in values if value > 247.0) / len(values),
        "green_pixel_ratio": _green_pixel_ratio(frame),
    }


def _green_pixel_ratio(frame: bytes) -> float:
    total = 0
    green = 0
    for index in range(0, len(frame) - 2, 3):
        red = frame[index]
        green_value = frame[index + 1]
        blue = frame[index + 2]
        total += 1
        if green_value >= 90 and green_value >= red * 1.35 and green_value >= blue * 1.35:
            green += 1
    return green / total if total else 0.0


def _frame_delta(left: bytes, right: bytes) -> float:
    length = min(len(left), len(right))
    if length < 3:
        return 0.0
    deltas = [
        abs(
            (0.2126 * left[index] + 0.7152 * left[index + 1] + 0.0722 * left[index + 2])
            - (0.2126 * right[index] + 0.7152 * right[index + 1] + 0.0722 * right[index + 2])
        )
        for index in range(0, length - 2, 3)
    ]
    return sum(deltas) / len(deltas) if deltas else 0.0


def _mean(values: Any) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def _ratio(matches: Any, total: int) -> float:
    if total <= 0:
        return 0.0
    return sum(1 for _ in matches) / total


def _float32le_samples(raw: bytes) -> tuple[float, ...]:
    import struct

    if len(raw) < 4:
        return ()
    usable = len(raw) - (len(raw) % 4)
    return struct.unpack(f"<{usable // 4}f", raw[:usable])


def _dominant_tone_peak(
    *,
    frame: tuple[float, ...],
    sample_rate: int,
    min_frequency_hz: float,
    max_frequency_hz: float,
) -> tuple[float, float] | None:
    bins: list[tuple[float, float]] = []
    n = len(frame)
    for frequency in range(int(min_frequency_hz), int(max_frequency_hz) + 1, 5):
        magnitude = _goertzel_magnitude(frame=frame, sample_rate=sample_rate, frequency_hz=float(frequency))
        bins.append((float(frequency), magnitude))
    if not bins:
        return None
    frequency, magnitude = max(bins, key=lambda item: item[1])
    median = sorted(value for _freq, value in bins)[len(bins) // 2]
    if magnitude <= 1e-12 or median <= 1e-12:
        return None
    prominence_db = 20.0 * math.log10(magnitude / median)
    return frequency, prominence_db


def _goertzel_magnitude(*, frame: tuple[float, ...], sample_rate: int, frequency_hz: float) -> float:
    coeff = 2.0 * math.cos(2.0 * math.pi * frequency_hz / sample_rate)
    prev = 0.0
    prev2 = 0.0
    for sample in frame:
        value = float(sample) + coeff * prev - prev2
        prev2 = prev
        prev = value
    power = prev2 * prev2 + prev * prev - coeff * prev * prev2
    return math.sqrt(max(power, 0.0))


def _significant_tokens(text: str) -> tuple[str, ...]:
    tokens: list[str] = []
    for token in _TOKEN_RE.findall(text.lower()):
        if len(token) < 3:
            continue
        if len(set(token)) <= 1:
            continue
        tokens.append(token)
    return tuple(tokens)


def _resolve_binary(binary: str) -> str | None:
    path = Path(binary)
    if path.parent != Path("."):
        return str(path) if path.is_file() else None
    return shutil.which(binary)


def _finding_to_dict(finding: OutputQAFinding) -> dict[str, str]:
    return {"severity": finding.severity, "code": finding.code, "message": finding.message}


def _optional_float(value: Any | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_str(value: Any | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
