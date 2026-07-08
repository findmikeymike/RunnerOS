"""
Audio Mixing Pipeline
=====================

Handles voice memo normalization and mixing with instrumental tracks.

Pipeline:
1. validate_voice_memo() - Check quality on upload, warn if issues
2. normalize_voice_memo() - Clean up phone recordings (highpass, compress, normalize)
3. mix_instrumental_under_narration() - Duck instrumental under voice with sidechain

Usage:
    # On upload
    validation = validate_voice_memo("user_recording.wav")
    if not validation["usable"]:
        warn_user(validation["issues"])

    # Pre-process for storage
    normalize_voice_memo("raw.wav", "cleaned.wav")

    # At render time
    mix_instrumental_under_narration(
        instrumental_path="beat.wav",
        narration_path="cleaned.wav",
        output_path="final_mix.wav",
    )
"""

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class MixResult:
    """Result of mixing operation."""
    output_path: str
    ffmpeg_command: list[str]
    filter_complex: str
    stdout: str
    stderr: str
    debug_json_path: Optional[str] = None


@dataclass
class NormalizeResult:
    """Result of voice memo normalization."""
    output_path: str
    ffmpeg_command: list[str]
    filter_chain: str
    input_loudness: Optional[dict] = None
    output_loudness: Optional[dict] = None
    stdout: str = ""
    stderr: str = ""


@dataclass
class ValidationResult:
    """Result of voice memo validation."""
    usable: bool
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    loudness: Optional[dict] = None
    duration_seconds: Optional[float] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    codec: Optional[str] = None


# =============================================================================
# VALIDATION (Run on upload)
# =============================================================================

def _resolve_media_binary(kind: str) -> str:
    raw = str(kind or "").strip()
    if not raw:
        raise ValueError("Unsupported media binary: ")

    explicit_path = Path(raw)
    if (explicit_path.is_absolute() or "/" in raw) and explicit_path.exists():
        return str(explicit_path)

    kind = raw.lower()
    if kind not in {"ffmpeg", "ffprobe"}:
        raise ValueError(f"Unsupported media binary: {raw}")

    env_name = "GENESIS_FFMPEG_PATH" if kind == "ffmpeg" else "GENESIS_FFPROBE_PATH"
    explicit = (os.environ.get(env_name) or "").strip()
    if explicit:
        return explicit

    discovered = shutil.which(kind)
    if discovered:
        return discovered

    candidate_names = ("/opt/homebrew/bin", "/usr/local/bin")
    for base in candidate_names:
        candidate = Path(base) / kind
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(kind)


def get_audio_info(
    audio_path: str,
    ffprobe_path: str = "ffprobe",
    timeout_seconds: float = 30.0,
) -> dict:
    """
    Get audio file metadata using ffprobe.

    Returns:
        dict with duration, sample_rate, channels, codec, bit_rate
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    ffprobe_path = _resolve_media_binary(ffprobe_path)

    cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        audio_path,
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)

    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {proc.stderr}")

    data = json.loads(proc.stdout)

    # Find audio stream
    audio_stream = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio":
            audio_stream = stream
            break

    format_info = data.get("format", {})

    return {
        "duration": float(format_info.get("duration", 0)),
        "sample_rate": int(audio_stream.get("sample_rate", 0)) if audio_stream else None,
        "channels": int(audio_stream.get("channels", 0)) if audio_stream else None,
        "codec": audio_stream.get("codec_name") if audio_stream else None,
        "bit_rate": int(format_info.get("bit_rate", 0)) if format_info.get("bit_rate") else None,
    }


def validate_voice_memo(
    audio_path: str,
    *,
    ffmpeg_path: str = "ffmpeg",
    ffprobe_path: str = "ffprobe",
    min_duration: float = 3.0,
    max_duration: float = 60.0,
    min_loudness: float = -35.0,  # Below this = probably too quiet
    quiet_is_issue: bool = False,
    max_true_peak: float = -0.3,  # Above this = likely clipped
    timeout_seconds: float = 60.0,
) -> ValidationResult:
    """
    Validate a voice memo on upload.

    Checks:
    - File exists and is readable
    - Duration within acceptable range
    - Not too quiet (would need extreme boost)
    - Not clipped (would sound distorted)
    - Has audio stream

    Args:
        audio_path: Path to voice memo file
        min_duration: Minimum acceptable duration (seconds)
        max_duration: Maximum acceptable duration (seconds)
        min_loudness: Minimum integrated loudness (LUFS) before warning
        max_true_peak: Maximum true peak (dB) before clipping warning

    Returns:
        ValidationResult with usable flag, issues, and metadata
    """
    issues = []
    warnings = []

    # Check file exists
    if not os.path.exists(audio_path):
        return ValidationResult(
            usable=False,
            issues=["File not found"],
        )

    # Get basic info
    try:
        ffmpeg_path = _resolve_media_binary(ffmpeg_path)
        ffprobe_path = _resolve_media_binary(ffprobe_path)
        info = get_audio_info(audio_path, ffprobe_path=ffprobe_path)
    except Exception as e:
        return ValidationResult(
            usable=False,
            issues=[f"Cannot read audio file: {str(e)}"],
        )

    duration = info.get("duration", 0)
    sample_rate = info.get("sample_rate")
    channels = info.get("channels")
    codec = info.get("codec")

    # Check duration
    if duration < min_duration:
        issues.append(f"Recording too short ({duration:.1f}s, minimum {min_duration}s)")
    elif duration > max_duration:
        issues.append(f"Recording too long ({duration:.1f}s, maximum {max_duration}s)")

    # Check has audio
    if not sample_rate or not channels:
        issues.append("No audio stream found in file")
        return ValidationResult(
            usable=False,
            issues=issues,
            duration_seconds=duration,
        )

    # Measure loudness
    try:
        loudness_result = measure_loudness(
            audio_path=audio_path,
            ffmpeg_path=ffmpeg_path,
            timeout_seconds=timeout_seconds,
        )
        loudness = loudness_result.get("parsed", {})
    except Exception as e:
        warnings.append(f"Could not measure loudness: {str(e)}")
        loudness = None

    if loudness:
        input_i = float(loudness.get("input_i", -100))
        input_tp = float(loudness.get("input_tp", -100))

        # Check if too quiet
        if input_i < min_loudness:
            message = (
                f"Recording is very quiet ({input_i:.1f} LUFS). "
                f"Audio will be boosted significantly which may increase noise."
            )
            if quiet_is_issue:
                issues.append(message)
            else:
                warnings.append(message)

        # Check if clipped
        if input_tp > max_true_peak:
            warnings.append(
                f"Recording appears clipped (peak at {input_tp:.1f} dB). "
                f"Audio quality may be degraded."
            )

        # Check for extreme dynamics (whisper then shout)
        input_lra = float(loudness.get("input_lra", 0))
        if input_lra > 20:
            warnings.append(
                f"Recording has very inconsistent volume (LRA: {input_lra:.1f}). "
                f"Compression will be applied to even it out."
            )

    # Low sample rate warning
    if sample_rate and sample_rate < 44100:
        warnings.append(
            f"Low sample rate ({sample_rate} Hz). "
            f"Audio quality may be limited."
        )

    # Determine if usable
    usable = len(issues) == 0

    return ValidationResult(
        usable=usable,
        issues=issues,
        warnings=warnings,
        loudness=loudness,
        duration_seconds=duration,
        sample_rate=sample_rate,
        channels=channels,
        codec=codec,
    )


# =============================================================================
# NORMALIZATION (Run before storage or mixing)
# =============================================================================

def normalize_voice_memo(
    input_path: str,
    output_path: str,
    *,
    ffmpeg_path: str = "ffmpeg",
    target_lufs: float = -17.0,
    true_peak: float = -1.5,
    lra: float = 11.0,
    high_pass_hz: float = 80.0,
    low_pass_hz: Optional[float] = 12000.0,
    apply_compression: bool = True,
    compression_threshold_db: float = -20.0,
    compression_ratio: float = 3.0,
    compression_attack_ms: float = 5.0,
    compression_release_ms: float = 100.0,
    apply_noise_gate: bool = True,
    gate_threshold_db: float = -45.0,
    gate_attack_ms: float = 10.0,
    gate_release_ms: float = 100.0,
    output_sample_rate: int = 48000,
    output_channels: int = 2,
    measure_before_after: bool = True,
    timeout_seconds: float = 180.0,
    verbose: bool = True,
) -> NormalizeResult:
    """
    Normalize and clean up a voice memo for mixing.

    Processing chain:
    1. High-pass filter (remove rumble, handling noise, HVAC)
    2. Low-pass filter (remove hiss, optional)
    3. Noise gate (reduce background noise in silent parts)
    4. Compression (even out loud/quiet parts)
    5. Loudness normalization (EBU R128 to target LUFS)
    6. True peak limiting (prevent clipping)
    7. Resample to target sample rate
    8. Convert to stereo

    Args:
        input_path: Path to raw voice memo
        output_path: Path for cleaned output
        target_lufs: Target integrated loudness (-17 is broadcast standard)
        true_peak: Maximum true peak in dB (-1.5 is safe)
        high_pass_hz: High-pass filter frequency (80 Hz removes rumble)
        low_pass_hz: Low-pass filter frequency (None to disable)
        apply_compression: Whether to apply dynamic compression
        apply_noise_gate: Whether to apply noise gate
        output_sample_rate: Target sample rate (48000 for video)
        output_channels: Target channels (2 for stereo)
        measure_before_after: Measure loudness before and after

    Returns:
        NormalizeResult with paths, commands, and measurements
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    ffmpeg_path = _resolve_media_binary(ffmpeg_path)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Build filter chain
    filters = []

    # 1. High-pass filter (remove rumble, handling noise)
    if high_pass_hz and high_pass_hz > 0:
        filters.append(f"highpass=f={high_pass_hz}:poles=2")

    # 2. Low-pass filter (remove hiss)
    if low_pass_hz and low_pass_hz > 0:
        filters.append(f"lowpass=f={low_pass_hz}:poles=2")

    # 3. Noise gate (reduce noise in silent parts)
    if apply_noise_gate:
        # agate: threshold in dB, attack/release in ms
        filters.append(
            f"agate=threshold={gate_threshold_db}dB"
            f":attack={gate_attack_ms}"
            f":release={gate_release_ms}"
            f":ratio=2"  # Gentle ratio
        )

    # 4. Compression (even out dynamics)
    if apply_compression:
        filters.append(
            f"acompressor=threshold={compression_threshold_db}dB"
            f":ratio={compression_ratio}"
            f":attack={compression_attack_ms}"
            f":release={compression_release_ms}"
            f":makeup=2dB"  # Slight makeup gain
        )

    # 5. Loudness normalization (EBU R128)
    filters.append(
        f"loudnorm=I={target_lufs}:TP={true_peak}:LRA={lra}:dual_mono=true"
    )

    # 6. Resample and format
    filters.append(
        f"aresample={output_sample_rate}"
    )

    filter_chain = ",".join(filters)

    # Build command
    cmd = [
        ffmpeg_path,
        "-y",
        "-i", input_path,
        "-af", filter_chain,
        "-ar", str(output_sample_rate),
        "-ac", str(output_channels),
        "-c:a", "pcm_s16le",  # Uncompressed for quality
        output_path,
    ]

    if verbose:
        print(f"[normalize] Processing: {input_path}")
        print(f"[normalize] Filter chain: {filter_chain}")

    # Measure input loudness
    input_loudness = None
    if measure_before_after:
        try:
            result = measure_loudness(audio_path=input_path, ffmpeg_path=ffmpeg_path)
            input_loudness = result.get("parsed")
            if verbose and input_loudness:
                print(f"[normalize] Input: {input_loudness.get('input_i', '?')} LUFS, peak {input_loudness.get('input_tp', '?')} dB")
        except Exception as e:
            if verbose:
                print(f"[normalize] Could not measure input: {e}")

    # Run normalization
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)

    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg normalization failed: {proc.stderr}")

    # Measure output loudness
    output_loudness = None
    if measure_before_after and os.path.exists(output_path):
        try:
            result = measure_loudness(audio_path=output_path, ffmpeg_path=ffmpeg_path)
            output_loudness = result.get("parsed")
            if verbose and output_loudness:
                print(f"[normalize] Output: {output_loudness.get('input_i', '?')} LUFS, peak {output_loudness.get('input_tp', '?')} dB")
        except Exception as e:
            if verbose:
                print(f"[normalize] Could not measure output: {e}")

    if verbose:
        size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        print(f"[normalize] Wrote {size:,} bytes to {output_path}")

    return NormalizeResult(
        output_path=output_path,
        ffmpeg_command=cmd,
        filter_chain=filter_chain,
        input_loudness=input_loudness,
        output_loudness=output_loudness,
        stdout=proc.stdout,
        stderr=proc.stderr,
    )


# =============================================================================
# LOUDNESS MEASUREMENT
# =============================================================================

def measure_loudness(
    *,
    audio_path: str,
    ffmpeg_path: str = "ffmpeg",
    i: float = -17.0,
    tp: float = -1.5,
    lra: float = 11.0,
    timeout_seconds: float = 180.0,
) -> dict:
    """
    Measure loudness of an audio file using EBU R128.

    Returns:
        dict with command, returncode, parsed (loudnorm JSON), raw_stderr

        parsed contains:
        - input_i: Integrated loudness (LUFS)
        - input_tp: True peak (dB)
        - input_lra: Loudness range (LU)
        - input_thresh: Loudness threshold (LUFS)
        - target_offset: Offset to reach target (LU)
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    ffmpeg_path = _resolve_media_binary(ffmpeg_path)

    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        audio_path,
        "-filter:a",
        f"loudnorm=I={i}:TP={tp}:LRA={lra}:print_format=json",
        "-f",
        "null",
        "-",
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    raw = proc.stderr or ""

    parsed = None
    try:
        matches = list(re.finditer(r"\{[\s\S]*\}", raw))
        if matches:
            parsed = json.loads(matches[-1].group(0))
    except Exception:
        parsed = None

    return {
        "command": cmd,
        "returncode": proc.returncode,
        "parsed": parsed,
        "raw_stderr": raw,
    }


# =============================================================================
# MIXING (At render time)
# =============================================================================

def mix_instrumental_under_narration(
    *,
    instrumental_path: str,
    narration_path: str,
    output_path: str,
    ffmpeg_path: str = "ffmpeg",
    sample_rate: int = 48000,
    narration_lufs: float = -17.0,
    instrumental_lufs: float = -24.0,
    true_peak: float = -1.5,
    lra: float = 11.0,
    sc_threshold: float = 0.10,
    sc_ratio: float = 8.0,
    sc_attack_ms: float = 20.0,
    sc_release_ms: float = 250.0,
    debug_json_path: Optional[str] = None,
    measure_inputs: bool = False,
    timeout_seconds: float = 300.0,
    verbose: bool = True,
    dry_run: bool = False,
) -> MixResult:
    """
    Mix instrumental under narration with sidechain ducking.

    The instrumental automatically ducks (gets quieter) when voice is present,
    then smoothly returns when voice stops.

    Processing:
    1. Normalize narration to -17 LUFS (voice prominent)
    2. Normalize instrumental to -24 LUFS (7dB quieter baseline)
    3. Apply sidechain compression (instrumental ducks under voice)
    4. Mix together

    Args:
        instrumental_path: Path to instrumental/beat audio
        narration_path: Path to voice memo (should be pre-normalized)
        output_path: Path for mixed output
        narration_lufs: Target loudness for voice (-17 LUFS standard)
        instrumental_lufs: Target loudness for instrumental (-24 LUFS, sits under)
        sc_threshold: Sidechain threshold (0.10 = duck when voice detected)
        sc_ratio: Sidechain compression ratio (8:1 = aggressive ducking)
        sc_attack_ms: How fast to duck (20ms = quick)
        sc_release_ms: How fast to return (250ms = smooth)

    Returns:
        MixResult with output path and debug info
    """
    if not os.path.exists(instrumental_path):
        raise FileNotFoundError(f"Instrumental not found: {instrumental_path}")
    if not os.path.exists(narration_path):
        raise FileNotFoundError(f"Narration not found: {narration_path}")

    ffmpeg_path = _resolve_media_binary(ffmpeg_path)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    loudnorm_narr = f"loudnorm=I={narration_lufs}:TP={true_peak}:LRA={lra}:dual_mono=true"
    loudnorm_inst = f"loudnorm=I={instrumental_lufs}:TP={true_peak}:LRA={lra}"

    sidechain = (
        "sidechaincompress="
        f"threshold={sc_threshold}:ratio={sc_ratio}:attack={sc_attack_ms}:release={sc_release_ms}:detection=rms"
    )

    filter_complex = (
        f"[1:a]{loudnorm_narr},aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo[narr];"
        f"[0:a]{loudnorm_inst},aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo[inst];"
        "[narr]asplit=2[sc][narr2];"
        f"[inst][sc]{sidechain}[ducked];"
        "[ducked][narr2]amix=inputs=2:normalize=0[mixout]"
    )

    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        instrumental_path,
        "-i",
        narration_path,
        "-filter_complex",
        filter_complex,
        "-map",
        "[mixout]",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        output_path,
    ]

    if verbose:
        print("[audio_mixing] starting")
        print(f"[audio_mixing] instrumental_path={instrumental_path}")
        print(f"[audio_mixing] narration_path={narration_path}")
        print(f"[audio_mixing] output_path={output_path}")
        print(f"[audio_mixing] filter_complex={filter_complex}")
        print(f"[audio_mixing] cmd={' '.join(cmd)}")

    if dry_run:
        return MixResult(
            output_path=output_path,
            ffmpeg_command=cmd,
            filter_complex=filter_complex,
            stdout="",
            stderr="",
            debug_json_path=debug_json_path,
        )

    measurements = None
    if measure_inputs:
        try:
            measurements = {
                "instrumental": measure_loudness(
                    audio_path=instrumental_path,
                    ffmpeg_path=ffmpeg_path,
                    i=instrumental_lufs,
                    tp=true_peak,
                    lra=lra,
                ),
                "narration": measure_loudness(
                    audio_path=narration_path,
                    ffmpeg_path=ffmpeg_path,
                    i=narration_lufs,
                    tp=true_peak,
                    lra=lra,
                ),
            }
        except Exception as e:
            measurements = {"error": str(e)}

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    if proc.returncode != 0:
        if debug_json_path:
            try:
                os.makedirs(os.path.dirname(debug_json_path) or ".", exist_ok=True)
                with open(debug_json_path, "w", encoding="utf-8") as f:
                    json.dump(
                        {
                            "ok": False,
                            "instrumental_path": instrumental_path,
                            "narration_path": narration_path,
                            "output_path": output_path,
                            "cmd": cmd,
                            "filter_complex": filter_complex,
                            "settings": {
                                "sample_rate": sample_rate,
                                "narration_lufs": narration_lufs,
                                "instrumental_lufs": instrumental_lufs,
                                "true_peak": true_peak,
                                "lra": lra,
                                "sc_threshold": sc_threshold,
                                "sc_ratio": sc_ratio,
                                "sc_attack_ms": sc_attack_ms,
                                "sc_release_ms": sc_release_ms,
                            },
                            "measurements": measurements,
                            "stdout": proc.stdout,
                            "stderr": proc.stderr,
                        },
                        f,
                        ensure_ascii=False,
                        indent=2,
                    )
            except Exception:
                pass

        raise RuntimeError(f"FFmpeg mix failed. stderr:\n{proc.stderr}\nstdout:\n{proc.stdout}")

    if verbose:
        size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        print(f"[audio_mixing] wrote_bytes={size}")
        print("[audio_mixing] done")

    if debug_json_path:
        try:
            os.makedirs(os.path.dirname(debug_json_path) or ".", exist_ok=True)
            size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            with open(debug_json_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "ok": True,
                        "instrumental_path": instrumental_path,
                        "narration_path": narration_path,
                        "output_path": output_path,
                        "output_bytes": size,
                        "cmd": cmd,
                        "filter_complex": filter_complex,
                        "settings": {
                            "sample_rate": sample_rate,
                            "narration_lufs": narration_lufs,
                            "instrumental_lufs": instrumental_lufs,
                            "true_peak": true_peak,
                            "lra": lra,
                            "sc_threshold": sc_threshold,
                            "sc_ratio": sc_ratio,
                            "sc_attack_ms": sc_attack_ms,
                            "sc_release_ms": sc_release_ms,
                        },
                        "measurements": measurements,
                        "stdout": proc.stdout,
                        "stderr": proc.stderr,
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
        except Exception:
            pass

    return MixResult(
        output_path=output_path,
        ffmpeg_command=cmd,
        filter_complex=filter_complex,
        stdout=proc.stdout,
        stderr=proc.stderr,
        debug_json_path=debug_json_path,
    )


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def process_voice_memo_upload(
    raw_path: str,
    cleaned_path: str,
    *,
    verbose: bool = True,
) -> tuple[ValidationResult, Optional[NormalizeResult]]:
    """
    Complete pipeline for processing a voice memo upload.

    1. Validate the upload
    2. If usable, normalize it

    Args:
        raw_path: Path to uploaded file
        cleaned_path: Path for cleaned output
        verbose: Print progress

    Returns:
        (validation_result, normalize_result or None)

    Example:
        validation, normalized = process_voice_memo_upload(
            "uploads/user123_memo.wav",
            "cleaned/user123_memo.wav",
        )

        if not validation.usable:
            return error_response(validation.issues)

        if validation.warnings:
            notify_user(validation.warnings)

        # Store cleaned_path for later mixing
    """
    if verbose:
        print(f"[upload] Validating: {raw_path}")

    # Validate
    validation = validate_voice_memo(raw_path)

    if verbose:
        print(f"[upload] Usable: {validation.usable}")
        if validation.issues:
            print(f"[upload] Issues: {validation.issues}")
        if validation.warnings:
            print(f"[upload] Warnings: {validation.warnings}")

    if not validation.usable:
        return validation, None

    # Normalize
    if verbose:
        print(f"[upload] Normalizing...")

    normalized = normalize_voice_memo(
        raw_path,
        cleaned_path,
        verbose=verbose,
    )

    return validation, normalized
