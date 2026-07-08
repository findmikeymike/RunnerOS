from __future__ import annotations

import json
import os
import re
import platform
import shlex
import shutil
import subprocess
from subprocess import CalledProcessError
from dataclasses import asdict
from dataclasses import dataclass
from pathlib import Path

from content.writing.brief_generator import CreativeBrief
from creative.production.caption_alignment import CaptionAlignmentAdapter
from creative.production.contracts import (
    CaptionCue,
    CaptionStyle,
    CaptionValidationFinding,
    CreativeProductionState,
    FormatNarrativePlan,
    OutputValidationFinding,
    PostPassOutputProbe,
    PostPassPlan,
    SceneBeat,
    VoiceoverPlan,
)


def build_post_pass_plan(
    *,
    state: CreativeProductionState,
    output_root: Path | str = ".outputs/creative-production",
    renderer: "FfmpegCaptionBurnInAdapter | None" = None,
    normalizer: "FfmpegLoudnessNormalizeAdapter | None" = None,
    probe_adapter: "FfmpegMediaProbeAdapter | None" = None,
    caption_aligner: CaptionAlignmentAdapter | None = None,
) -> PostPassPlan:
    plan = state.format_narrative_plan
    caption_strategy = plan.caption_strategy if plan else "minimal"
    captions_enabled = caption_strategy != "minimal"
    loudness_target_lufs = _loudness_target_for_platform(state.brief_input.brief.platform)
    caption_style = _caption_style_for_platform(state.brief_input.brief, caption_strategy) if captions_enabled else None
    cues, alignment_warning = _build_caption_cues_for_state(
        state=state,
        captions_enabled=captions_enabled,
        caption_style=caption_style,
        caption_aligner=caption_aligner,
        output_root=output_root,
    )
    run_dir = Path(output_root) / state.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    srt_path = run_dir / "captions.srt" if captions_enabled else None
    json_path = run_dir / "captions.json"
    if srt_path:
        srt_path.write_text(_render_srt(cues), encoding="utf-8")
    findings = list(validate_caption_cues(cues=cues, style=caption_style))
    if alignment_warning:
        findings.append(CaptionValidationFinding("warn", None, alignment_warning))
    source_asset_path = state.final_assembly.asset_path if state.final_assembly else None
    rendered_asset_path: Path | None = None
    render_status = "not_requested"
    normalized_asset_path: Path | None = None
    normalize_status = "not_requested"
    normalize_error: str | None = None
    if captions_enabled and renderer is not None and srt_path is not None and source_asset_path is not None:
        rendered_asset_path = run_dir / "final-captioned.mp4"
        renderer.render_captions(
            input_video=source_asset_path,
            captions_srt=srt_path,
            output_video=rendered_asset_path,
            style=caption_style or _default_caption_style(),
        )
        render_status = "rendered"
    final_asset_path = rendered_asset_path or source_asset_path
    if normalizer is not None and final_asset_path is not None and loudness_target_lufs is not None:
        candidate_normalized_asset_path = run_dir / "final-normalized.mp4"
        try:
            normalizer.normalize(
                input_video=final_asset_path,
                output_video=candidate_normalized_asset_path,
                target_lufs=loudness_target_lufs,
            )
            normalized_asset_path = candidate_normalized_asset_path
            normalize_status = "normalized"
            final_asset_path = normalized_asset_path
        except Exception as exc:
            normalize_status = "failed"
            normalize_error = str(exc)
    output_probe = probe_adapter.probe(final_asset_path) if probe_adapter is not None and final_asset_path is not None else None
    output_findings = validate_output_media(
        probe=output_probe,
        expected_duration_s=state.final_assembly.duration_s if state.final_assembly else None,
        expected_aspect_ratio=plan.platform_profile.aspect_ratio if plan else None,
        require_audio=_requires_audio_track(state=state, plan=plan),
    )
    if normalize_error:
        output_findings = (
            *output_findings,
            OutputValidationFinding("warn", f"loudness normalization failed: {normalize_error}"),
        )
    json_path.write_text(
        json.dumps(
            {
                "caption_strategy": caption_strategy,
                "captions_enabled": captions_enabled,
                "caption_style": asdict(caption_style) if caption_style else None,
                "validation_findings": [asdict(finding) for finding in findings],
                "source_asset_path": str(source_asset_path) if source_asset_path else None,
                "rendered_asset_path": str(rendered_asset_path) if rendered_asset_path else None,
                "render_status": render_status,
                "normalized_asset_path": str(normalized_asset_path) if normalized_asset_path else None,
                "normalize_status": normalize_status,
                "normalize_error": normalize_error,
                "final_asset_path": str(final_asset_path) if final_asset_path else None,
                "output_probe": _output_probe_to_dict(output_probe) if output_probe else None,
                "output_validation_findings": [asdict(finding) for finding in output_findings],
                "cues": [_caption_cue_to_dict(cue) for cue in cues],
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return PostPassPlan(
        caption_strategy=caption_strategy,
        captions_enabled=captions_enabled,
        caption_cues=cues,
        caption_style=caption_style,
        validation_findings=tuple(findings),
        srt_path=srt_path,
        json_path=json_path,
        source_asset_path=source_asset_path,
        rendered_asset_path=rendered_asset_path,
        render_status=render_status,
        normalized_asset_path=normalized_asset_path,
        normalize_status=normalize_status,
        final_asset_path=final_asset_path,
        output_probe=output_probe,
        output_validation_findings=output_findings,
        burn_in_recommended=captions_enabled and _is_short_form(state.brief_input.brief),
        loudness_target_lufs=loudness_target_lufs,
        platform_notes=_platform_notes(state.brief_input.brief, plan),
    )


def _requires_audio_track(*, state: CreativeProductionState, plan: FormatNarrativePlan | None) -> bool:
    if bool(state.audio_mix_plan and (state.audio_mix_plan.selected_music_track or state.voice_asset)):
        return True
    return bool(plan and plan.audio_mode == "music_led")


@dataclass(slots=True)
class FfmpegCaptionBurnInAdapter:
    ffmpeg_binary: str = "ffmpeg"
    command_runner: callable | None = None

    def render_captions(
        self,
        *,
        input_video: Path,
        captions_srt: Path,
        output_video: Path,
        style: CaptionStyle,
    ) -> Path:
        if not input_video.exists():
            raise RuntimeError(f"input video file does not exist: {input_video}")
        if not captions_srt.exists():
            raise RuntimeError(f"caption file does not exist: {captions_srt}")
        output_video.parent.mkdir(parents=True, exist_ok=True)
        vf = f"subtitles={_ffmpeg_filter_path(captions_srt)}:force_style={_ffmpeg_force_style(style)}"
        cmd = [
            self.ffmpeg_binary,
            "-y",
            "-i",
            str(input_video),
            "-vf",
            vf,
            "-c:a",
            "copy",
            str(output_video),
        ]
        runner = self.command_runner or _run_subprocess
        runner(cmd)
        _ensure_output_file(output_video, context="caption burn-in")
        return output_video


@dataclass(slots=True)
class FfmpegLoudnessNormalizeAdapter:
    ffmpeg_binary: str = "ffmpeg"
    command_runner: callable | None = None

    def normalize(
        self,
        *,
        input_video: Path,
        output_video: Path,
        target_lufs: float,
    ) -> Path:
        if not input_video.exists():
            raise RuntimeError(f"input video file does not exist: {input_video}")
        output_video.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            self.ffmpeg_binary,
            "-y",
            "-i",
            str(input_video),
            "-c:v",
            "copy",
            "-af",
            f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(output_video),
        ]
        runner = self.command_runner or _run_subprocess
        runner(cmd)
        _ensure_output_file(output_video, context="loudness normalize")
        return output_video


@dataclass(slots=True)
class FfmpegMediaProbeAdapter:
    ffprobe_binary: str = "ffprobe"
    command_runner: callable | None = None

    def probe(self, asset_path: Path) -> PostPassOutputProbe:
        if not asset_path.exists():
            return PostPassOutputProbe(asset_path=asset_path, exists=False)
        cmd = [
            self.ffprobe_binary,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(asset_path),
        ]
        runner = self.command_runner or _run_subprocess_with_output
        try:
            result = runner(cmd)
            stdout = getattr(result, "stdout", result)
            payload = json.loads(stdout or "{}")
            return _probe_from_payload(asset_path=asset_path, payload=payload)
        except Exception as exc:
            return PostPassOutputProbe(asset_path=asset_path, exists=True, probe_error=str(exc))


def validate_caption_cues(
    *,
    cues: tuple[CaptionCue, ...],
    style: CaptionStyle | None,
) -> tuple[CaptionValidationFinding, ...]:
    findings: list[CaptionValidationFinding] = []
    if not cues:
        return ()
    max_chars = style.max_chars_per_line * style.max_lines if style else 64
    previous_end = 0.0
    seen_text: set[str] = set()
    for cue in cues:
        if cue.end_s <= cue.start_s:
            findings.append(CaptionValidationFinding("error", cue.index, "caption cue end must be after start"))
        if cue.start_s < previous_end:
            findings.append(CaptionValidationFinding("error", cue.index, "caption cue overlaps previous cue"))
        if not cue.text.strip():
            findings.append(CaptionValidationFinding("error", cue.index, "caption text is empty"))
        cue_lines = cue.text.splitlines() or [cue.text]
        if len(cue_lines) > (style.max_lines if style else 2) or any(
            len(line) > (style.max_chars_per_line if style else 32) for line in cue_lines
        ) or len(cue.text.replace("\n", "")) > max_chars:
            findings.append(CaptionValidationFinding("warn", cue.index, "caption text may be too long for safe reading"))
        normalized = cue.text.strip().lower()
        if normalized and normalized in seen_text:
            findings.append(CaptionValidationFinding("warn", cue.index, "caption text repeats an earlier cue"))
        seen_text.add(normalized)
        previous_end = cue.end_s
    return tuple(findings)


def validate_output_media(
    *,
    probe: PostPassOutputProbe | None,
    expected_duration_s: float | None,
    expected_aspect_ratio: str | None = None,
    require_audio: bool = False,
) -> tuple[OutputValidationFinding, ...]:
    if probe is None:
        return ()
    findings: list[OutputValidationFinding] = []
    if not probe.exists:
        findings.append(OutputValidationFinding("error", "final media file does not exist"))
        return tuple(findings)
    if probe.probe_error:
        findings.append(OutputValidationFinding("warn", f"media probe failed: {probe.probe_error}"))
        return tuple(findings)
    if probe.size_bytes is not None and probe.size_bytes <= 0:
        findings.append(OutputValidationFinding("error", "final media file is empty"))
    if probe.video_stream_count < 1:
        findings.append(OutputValidationFinding("error", "final media has no video stream"))
    if require_audio and probe.audio_stream_count < 1:
        findings.append(OutputValidationFinding("error", "final media has no audio stream despite an audio plan"))
    if probe.duration_s is not None and probe.duration_s <= 0:
        findings.append(OutputValidationFinding("error", "final media duration is zero"))
    if expected_duration_s and probe.duration_s is not None and abs(probe.duration_s - expected_duration_s) > 1.0:
        findings.append(
            OutputValidationFinding(
                "warn",
                f"final media duration differs from assembly plan by more than 1s: expected {expected_duration_s}, got {probe.duration_s}",
            )
        )
    if probe.width is not None and probe.height is not None and (probe.width < 64 or probe.height < 64):
        findings.append(OutputValidationFinding("warn", "final media dimensions are suspiciously small"))
    if probe.width is not None and probe.height is not None and expected_aspect_ratio:
        expected_ratio = _parse_aspect_ratio(expected_aspect_ratio)
        if expected_ratio is not None:
            actual_ratio = float(probe.width) / float(probe.height)
            if abs(actual_ratio - expected_ratio) > 0.08:
                findings.append(
                    OutputValidationFinding(
                        "warn",
                        f"final media aspect ratio does not match platform plan: expected {expected_aspect_ratio}, got {probe.width}x{probe.height}",
                    )
                )
    return tuple(findings)


def _parse_aspect_ratio(aspect_ratio: str) -> float | None:
    parts = aspect_ratio.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        width = float(parts[0])
        height = float(parts[1])
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return width / height


def _build_caption_cues(
    *,
    brief: CreativeBrief,
    format_plan: FormatNarrativePlan | None,
    voiceover_plan: VoiceoverPlan | None,
    captions_enabled: bool,
    caption_style: CaptionStyle | None = None,
    actual_duration_s: float | None = None,
) -> tuple[CaptionCue, ...]:
    if not captions_enabled:
        return ()
    beats = tuple(format_plan.scene_beats if format_plan else ())
    if not beats:
        text = _clean_caption_text(brief.copy_for_overlay or brief.cta_text or brief.campaign_goal)
        return (CaptionCue(index=1, start_s=0.0, end_s=5.0, text=text, beat_role="single", style="minimal"),)

    script_chunks = _script_chunks(
        voiceover_plan.script if voiceover_plan and voiceover_plan.enabled else "",
        target_count=len(beats),
    )
    authored_captions = _script_plan_caption_map(format_plan)
    caption_strategy = format_plan.caption_strategy if format_plan else "minimal"
    beat_texts = [
        _caption_text_for_beat(
            brief=brief,
            beat_role=beat.beat_role,
            caption_strategy=caption_strategy,
            authored_caption=authored_captions.get(beat.beat_index, ""),
            script_chunk=script_chunks[idx] if idx < len(script_chunks) else "",
        )
        for idx, beat in enumerate(beats)
    ]
    timing_windows = _caption_timing_windows(
        beats=beats,
        texts=beat_texts,
        actual_duration_s=actual_duration_s,
        caption_strategy=caption_strategy,
    )
    cues: list[CaptionCue] = []
    for idx, beat in enumerate(beats):
        start, end = timing_windows[idx]
        caption_strategy = format_plan.caption_strategy if format_plan else "minimal"
        text = beat_texts[idx]
        chunks = (
            _fit_spoken_caption_chunks(text, caption_style)
            if caption_strategy == "spoken_caption_highlights"
            else [_fit_caption_text(text, caption_style)]
        )
        chunk_count = max(1, len(chunks))
        beat_duration = max(0.001, end - start)
        for chunk_idx, chunk in enumerate(chunks):
            chunk_start = start + (beat_duration * chunk_idx / chunk_count)
            chunk_end = (
                end
                if chunk_idx == chunk_count - 1
                else start + (beat_duration * (chunk_idx + 1) / chunk_count)
            )
            cues.append(
                CaptionCue(
                    index=len(cues) + 1,
                    start_s=round(chunk_start, 3),
                    end_s=round(chunk_end, 3),
                    text=chunk,
                    beat_role=beat.beat_role,
                    style=_caption_style(caption_strategy),
                )
            )
    return tuple(cues)


def _caption_timing_windows(
    *,
    beats: tuple[SceneBeat, ...],
    texts: list[str],
    actual_duration_s: float | None,
    caption_strategy: str,
) -> list[tuple[float, float]]:
    actual_duration = float(actual_duration_s or 0.0)
    if actual_duration <= 0:
        windows: list[tuple[float, float]] = []
        cursor = 0.0
        for beat in beats:
            end = round(cursor + max(1.0, float(beat.duration_s)), 3)
            windows.append((round(cursor, 3), end))
            cursor = end
        return windows

    if caption_strategy != "spoken_caption_highlights":
        duration_each = actual_duration / len(beats)
        return [
            (
                round(idx * duration_each, 3),
                round(actual_duration if idx == len(beats) - 1 else (idx + 1) * duration_each, 3),
            )
            for idx in range(len(beats))
        ]

    weights = []
    for beat, text in zip(beats, texts):
        word_weight = max(1.0, float(len(text.split())))
        planned_weight = max(1.0, float(beat.duration_s)) * 0.35
        weights.append(word_weight + planned_weight)
    total_weight = sum(weights) or float(len(beats))
    min_duration = min(1.4, actual_duration / max(1, len(beats)))
    durations = [max(min_duration, actual_duration * weight / total_weight) for weight in weights]
    scale = actual_duration / sum(durations)
    durations = [duration * scale for duration in durations]

    windows = []
    cursor = 0.0
    for idx, duration in enumerate(durations):
        start = round(cursor, 3)
        end = actual_duration if idx == len(durations) - 1 else round(cursor + duration, 3)
        windows.append((start, round(end, 3)))
        cursor = end
    return windows


def _build_caption_cues_for_state(
    *,
    state: CreativeProductionState,
    captions_enabled: bool,
    caption_style: CaptionStyle | None,
    caption_aligner: CaptionAlignmentAdapter | None,
    output_root: Path | str,
) -> tuple[tuple[CaptionCue, ...], str | None]:
    actual_duration_s = state.final_assembly.duration_s if state.final_assembly else None
    warning: str | None = None
    cues: tuple[CaptionCue, ...] = ()
    if (
        captions_enabled
        and caption_aligner is not None
        and caption_style is not None
        and state.voice_asset is not None
        and state.voiceover_plan is not None
        and state.voiceover_plan.enabled
        and state.voiceover_plan.script.strip()
    ):
        try:
            aligned = caption_aligner.align_caption_cues(
                run_id=state.run_id,
                audio_path=state.voice_asset.asset_path,
                script=state.voiceover_plan.script,
                style=caption_style,
                duration_s=actual_duration_s,
                output_root=output_root,
            )
        except Exception as exc:
            warning = f"caption alignment failed; using planned caption fallback: {exc}"
        else:
            if aligned:
                cues = aligned
            else:
                warning = "caption alignment returned no cues; using planned caption fallback"
    if not cues:
        cues = _build_caption_cues(
            brief=state.brief_input.brief,
            format_plan=state.format_narrative_plan,
            voiceover_plan=state.voiceover_plan,
            captions_enabled=captions_enabled,
            caption_style=caption_style,
            actual_duration_s=actual_duration_s,
        )
    polished = _apply_caption_timing_polish(
        cues=cues,
        style=caption_style,
        assembly_duration_s=actual_duration_s,
    )
    return polished, warning


def _apply_caption_timing_polish(
    *,
    cues: tuple[CaptionCue, ...],
    style: CaptionStyle | None,
    assembly_duration_s: float | None,
) -> tuple[CaptionCue, ...]:
    """Apply lead-in / hold-out padding, enforce minimum on-screen duration,
    and merge sub-threshold flickers into neighbours.

    No-op when style is None or all timing fields are zero (preserves legacy
    behaviour for tests that pin pre-polish timing assertions).
    """
    if not cues or style is None:
        return cues
    lead_in_s = max(0.0, float(style.lead_in_ms or 0) / 1000.0)
    hold_out_s = max(0.0, float(style.hold_out_ms or 0) / 1000.0)
    min_duration_s = max(0.0, float(style.min_duration_s or 0.0))
    if lead_in_s == 0.0 and hold_out_s == 0.0 and min_duration_s == 0.0:
        return cues

    ordered = list(cues)
    timeline_end = float(assembly_duration_s) if assembly_duration_s else None

    # First pass: apply lead-in / hold-out without breaking ordering.
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
        if candidate_end <= new_start:
            candidate_end = new_start + 0.001
        adjusted.append(
            CaptionCue(
                index=cue.index,
                start_s=round(new_start, 3),
                end_s=round(candidate_end, 3),
                text=cue.text,
                beat_role=cue.beat_role,
                style=cue.style,
            )
        )

    # Second pass: enforce minimum duration by extending into next-cue head room,
    # or merging into the previous cue when no room exists.
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
            polished.append(
                CaptionCue(
                    index=cue.index,
                    start_s=cue.start_s,
                    end_s=available_end,
                    text=cue.text,
                    beat_role=cue.beat_role,
                    style=cue.style,
                )
            )
            continue
        if polished:
            previous = polished[-1]
            merged_text = " ".join(part for part in (previous.text, cue.text) if part)
            polished[-1] = CaptionCue(
                index=previous.index,
                start_s=previous.start_s,
                end_s=max(previous.end_s, cue.end_s),
                text=merged_text,
                beat_role=previous.beat_role,
                style=previous.style,
            )
        else:
            polished.append(
                CaptionCue(
                    index=cue.index,
                    start_s=cue.start_s,
                    end_s=available_end,
                    text=cue.text,
                    beat_role=cue.beat_role,
                    style=cue.style,
                )
            )

    # Renumber after possible merges so cue indices remain contiguous.
    return tuple(
        CaptionCue(
            index=position,
            start_s=cue.start_s,
            end_s=cue.end_s,
            text=cue.text,
            beat_role=cue.beat_role,
            style=cue.style,
        )
        for position, cue in enumerate(polished, start=1)
    )


def _script_plan_caption_map(format_plan: FormatNarrativePlan | None) -> dict[int, str]:
    script_plan = format_plan.script_plan if format_plan else None
    if script_plan is None:
        return {}
    return {
        scene.beat_index: scene.caption_text
        for scene in script_plan.scenes
        if scene.caption_text.strip()
    }


def _caption_text_for_beat(
    *,
    brief: CreativeBrief,
    beat_role: str,
    caption_strategy: str,
    authored_caption: str = "",
    script_chunk: str,
) -> str:
    if caption_strategy == "kinetic_lyrics":
        return _clean_caption_text(authored_caption or script_chunk or brief.copy_for_overlay or beat_role)
    if caption_strategy == "spoken_caption_highlights":
        return _clean_caption_text(script_chunk or authored_caption or _fallback_caption_for_role(brief, beat_role))
    if caption_strategy == "hook_caption_cta":
        if beat_role == "hook":
            return _clean_caption_text(brief.copy_for_overlay or brief.campaign_goal)
        if beat_role == "cta":
            return _clean_caption_text(brief.cta_text or "Learn more")
        return _clean_caption_text(_fallback_caption_for_role(brief, beat_role))
    return _clean_caption_text(script_chunk or brief.copy_for_overlay or brief.cta_text or "")


def _script_chunks(script: str, *, target_count: int | None = None) -> list[str]:
    clean = " ".join(script.split())
    if not clean:
        return []
    desired_count = max(1, int(target_count or 0)) if target_count else None
    sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+", clean) if item.strip()]
    if desired_count and len(sentences) == desired_count:
        return sentences
    if desired_count and len(sentences) > desired_count:
        return _merge_chunks_to_count(sentences, desired_count)
    if len(sentences) > 1 and not desired_count:
        return sentences
    words = clean.split()
    if not desired_count and len(words) <= 10:
        return [clean]
    chunk_count = desired_count or 2
    return _split_words_to_count(words, chunk_count)


def _split_words_to_count(words: list[str], chunk_count: int) -> list[str]:
    if not words:
        return []
    chunk_count = max(1, min(chunk_count, len(words)))
    base, remainder = divmod(len(words), chunk_count)
    chunks: list[str] = []
    cursor = 0
    for index in range(chunk_count):
        size = base + (1 if index < remainder else 0)
        chunk_words = words[cursor: cursor + size]
        if chunk_words:
            chunks.append(" ".join(chunk_words))
        cursor += size
    return _move_dangling_chunk_endings(chunks)


def _move_dangling_chunk_endings(chunks: list[str]) -> list[str]:
    adjusted = [chunk.split() for chunk in chunks]
    for index in range(len(adjusted) - 1):
        while adjusted[index] and adjusted[index][-1].lower().rstrip(".,;:!?") in _DANGLING_CAPTION_WORDS:
            adjusted[index + 1].insert(0, adjusted[index].pop())
    return [" ".join(chunk) for chunk in adjusted if chunk]


def _merge_chunks_to_count(chunks: list[str], target_count: int) -> list[str]:
    if len(chunks) <= target_count:
        return chunks
    merged = list(chunks[:target_count])
    for extra in chunks[target_count:]:
        merged[-1] = f"{merged[-1]} {extra}".strip()
    return merged


def _fallback_caption_for_role(brief: CreativeBrief, beat_role: str) -> str:
    if beat_role in {"hook", "intro"}:
        return brief.copy_for_overlay or brief.campaign_goal
    if beat_role in {"cta", "tag", "takeaway"}:
        return brief.cta_text or "See it now"
    if beat_role in {"problem", "context"}:
        return "Here is the problem"
    if beat_role in {"solution", "value"}:
        return "Made to move"
    if beat_role == "proof":
        return "Built to feel different"
    return beat_role.replace("_", " ").title()


def _clean_caption_text(text: str | None) -> str:
    clean = " ".join((text or "").split()).strip()
    return clean


_PREFERRED_BREAK_END_CHARS = (",", ";", ":", ".", "—", "–", "!", "?")
_PREFERRED_BREAK_CONJUNCTIONS = {
    "and",
    "but",
    "or",
    "so",
    "yet",
    "while",
    "because",
    "when",
    "if",
    "then",
}


def _is_preferred_break_word(word: str) -> bool:
    stripped = word.rstrip()
    if not stripped:
        return False
    if stripped.endswith(_PREFERRED_BREAK_END_CHARS):
        return True
    return stripped.lower().rstrip(".,;:!?") in _PREFERRED_BREAK_CONJUNCTIONS


def _find_preferred_break_index(line_words: list[str], max_chars: int) -> int | None:
    """Return index of the last word that's a good break point sitting at
    >= 50% of max_chars from the line start. None if no such break exists."""
    cumulative = 0
    last_good_idx: int | None = None
    for idx, word in enumerate(line_words):
        cumulative += len(word) + (1 if idx > 0 else 0)
        if cumulative >= max_chars * 0.5 and _is_preferred_break_word(word):
            last_good_idx = idx
    return last_good_idx


def _fit_caption_text(text: str, style: CaptionStyle | None) -> str:
    """Wrap caption text across at most `style.max_lines` lines preferring
    natural phrase boundaries (punctuation, coordinating conjunctions) over
    greedy character-count breaks. Falls back to greedy when no natural break
    exists in the candidate line."""
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
        candidate_str = " ".join(candidate)
        if line_words and len(candidate_str) > max_chars:
            break_at = _find_preferred_break_index(line_words, max_chars)
            if break_at is not None and break_at < len(line_words) - 1:
                head = " ".join(line_words[: break_at + 1])
                tail = line_words[break_at + 1 :]
                lines.append(head)
                if len(lines) >= max_lines:
                    line_words = []
                    break
                line_words = tail + [word]
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
    return "\n".join(fitted)


def _fit_spoken_caption_chunks(text: str, style: CaptionStyle | None) -> list[str]:
    clean = _clean_caption_text(text)
    if not clean:
        return [""]
    if style is None:
        return [clean]
    max_lines = max(1, style.max_lines)
    max_chars = max(8, style.max_chars_per_line)
    chunks: list[str] = []
    lines: list[str] = []
    current = ""
    for word in clean.split():
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            lines.append(current)
            if len(lines) >= max_lines:
                chunk, carry = _spoken_chunk_with_carry(lines)
                if chunk:
                    chunks.append(chunk)
                lines = []
                current = f"{carry} {word}".strip()
            else:
                current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if lines:
        chunks.append("\n".join(lines))
    return chunks or [clean]


def _spoken_chunk_with_carry(lines: list[str]) -> tuple[str, str]:
    fitted = list(lines)
    carry_words: list[str] = []
    while fitted:
        words = fitted[-1].split()
        while words and words[-1].lower().rstrip(".,;:!?") in _DANGLING_CAPTION_WORDS:
            carry_words.insert(0, words.pop())
        fitted[-1] = " ".join(words)
        if fitted[-1]:
            break
        fitted.pop()
    return "\n".join(line for line in fitted if line), " ".join(carry_words)


def _trim_caption_line_end(line: str) -> str:
    words = line.rstrip(".,;:!?").split()
    while words and words[-1].lower() in _DANGLING_CAPTION_WORDS:
        words.pop()
    return " ".join(words)


_DANGLING_CAPTION_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "be",
    "because",
    "but",
    "for",
    "is",
    "or",
    "so",
    "that",
    "the",
    "to",
    "was",
    "were",
    "who",
    "with",
}


def _caption_style(caption_strategy: str) -> str:
    return {
        "kinetic_lyrics": "kinetic",
        "spoken_caption_highlights": "spoken_highlight",
        "hook_caption_cta": "bold_hook_cta",
    }.get(caption_strategy, "minimal")


def _caption_style_for_platform(brief: CreativeBrief, caption_strategy: str) -> CaptionStyle:
    normalized_platform = brief.platform.strip().lower()
    font = _caption_font_name()
    if caption_strategy == "kinetic_lyrics":
        return CaptionStyle(
            font=font,
            font_size=44,
            primary_color="&H00FFFFFF",
            outline_color="&H00000000",
            outline_width=2,
            alignment=2,
            margin_v=300,
            max_chars_per_line=22,
            max_lines=2,
            shadow_offset=2,
            background_box=False,
            lead_in_ms=80,
            hold_out_ms=160,
            min_duration_s=0.9,
        )
    if normalized_platform == "youtube":
        return CaptionStyle(
            font=font,
            font_size=34,
            primary_color="&H00FFFFFF",
            outline_color="&H00000000",
            outline_width=2,
            alignment=2,
            margin_v=56,
            max_chars_per_line=42,
            max_lines=2,
            shadow_offset=2,
            background_box=False,
            lead_in_ms=80,
            hold_out_ms=160,
            min_duration_s=1.0,
        )
    if _is_short_form(brief):
        # Short-form social (TikTok/Reels/Shorts): bottom 250-300px is reserved
        # for platform UI (username, sound, CTA, share). Anchor at ~37% from bottom
        # of a 1920px-tall frame so captions sit in the readable middle band.
        return CaptionStyle(
            font=font,
            font_size=52,
            primary_color="&H00FFFFFF",
            outline_color="&H00000000",
            outline_width=3,
            alignment=2,
            margin_v=360,
            max_chars_per_line=22,
            max_lines=2,
            shadow_offset=2,
            background_box=True,
            background_color="&H66000000",
            lead_in_ms=120,
            hold_out_ms=240,
            min_duration_s=1.0,
        )
    return _default_caption_style()


def _default_caption_style() -> CaptionStyle:
    return CaptionStyle(
        font=_caption_font_name(),
        font_size=36,
        primary_color="&H00FFFFFF",
        outline_color="&H00000000",
        outline_width=3,
        alignment=2,
        margin_v=54,
        max_chars_per_line=32,
        max_lines=2,
        shadow_offset=2,
        background_box=False,
        lead_in_ms=80,
        hold_out_ms=160,
        min_duration_s=0.9,
    )


def _caption_font_name() -> str:
    configured = os.getenv("SQUAD_CAPTION_FONT")
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
            result = subprocess.run(["fc-match", "-f", "%{family}", "sans-serif"], check=True, capture_output=True, text=True)
            family = (result.stdout or "").split(",", 1)[0].strip()
            if family:
                return family
        except Exception:
            pass
    return "Arial"


def _render_srt(cues: tuple[CaptionCue, ...]) -> str:
    chunks: list[str] = []
    for cue in cues:
        chunks.extend(
            [
                str(cue.index),
                f"{_srt_time(cue.start_s)} --> {_srt_time(cue.end_s)}",
                cue.text,
                "",
            ]
        )
    return "\n".join(chunks)


def _srt_time(seconds: float) -> str:
    total_ms = int(round(max(0.0, seconds) * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _run_subprocess(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        message = f"post-pass command failed with exit code {exc.returncode}"
        raise RuntimeError(f"{message}: {detail}" if detail else message) from exc


def _run_subprocess_with_output(cmd: list[str]):
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True)
    except CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        message = f"media probe command failed with exit code {exc.returncode}"
        raise RuntimeError(f"{message}: {detail}" if detail else message) from exc


def _ensure_output_file(path: Path, *, context: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{context} command did not create output file: {path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"{context} command created an empty output file: {path}")


def _probe_from_payload(*, asset_path: Path, payload: dict) -> PostPassOutputProbe:
    streams = payload.get("streams") or []
    video_streams = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    first_video = video_streams[0] if video_streams else {}
    format_payload = payload.get("format") or {}
    return PostPassOutputProbe(
        asset_path=asset_path,
        exists=True,
        size_bytes=_safe_int(format_payload.get("size")),
        duration_s=_safe_float(format_payload.get("duration")),
        video_stream_count=len(video_streams),
        audio_stream_count=len(audio_streams),
        width=_safe_int(first_video.get("width")),
        height=_safe_int(first_video.get("height")),
        video_codecs=tuple(str(stream.get("codec_name") or "") for stream in video_streams if stream.get("codec_name")),
        audio_codecs=tuple(str(stream.get("codec_name") or "") for stream in audio_streams if stream.get("codec_name")),
    )


def _safe_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _ffmpeg_filter_path(path: Path) -> str:
    # libavfilter expects escaping inside the filter string, not shell quoting.
    escaped = str(path.resolve()).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return f"'{escaped}'"


def _ffmpeg_force_style(style: CaptionStyle) -> str:
    # BorderStyle 4 = opaque box behind text; BorderStyle 1 = outline + drop shadow.
    border_style = "4" if style.background_box else "1"
    shadow = str(max(0, int(style.shadow_offset))) if style.shadow_offset else "1"
    parts = {
        "FontName": style.font,
        "FontSize": str(style.font_size),
        "PrimaryColour": style.primary_color,
        "OutlineColour": style.outline_color,
        "BackColour": style.background_color,
        "BorderStyle": border_style,
        "Outline": str(style.outline_width),
        "Shadow": shadow,
        "Bold": "-1",
        "Alignment": str(style.alignment),
        "MarginV": str(style.margin_v),
    }
    return shlex.quote(",".join(f"{key}={value}" for key, value in parts.items()))


def _caption_cue_to_dict(cue: CaptionCue) -> dict:
    return asdict(cue)


def _output_probe_to_dict(probe: PostPassOutputProbe) -> dict:
    payload = asdict(probe)
    payload["asset_path"] = str(probe.asset_path)
    return payload


def _is_short_form(brief: CreativeBrief) -> bool:
    return brief.platform.strip().lower() in {"tiktok", "reels", "instagram_reel", "instagram_story", "youtube_shorts", "shorts"}


def _loudness_target_for_platform(platform: str) -> float | None:
    normalized = platform.strip().lower()
    if normalized == "youtube":
        return -14.0
    if normalized in {"tiktok", "reels", "instagram_reel", "instagram_story", "youtube_shorts", "shorts"}:
        return -14.0
    return None


def _platform_notes(brief: CreativeBrief, plan: FormatNarrativePlan | None) -> str:
    safe_area = plan.platform_profile.safe_area if plan else "center-safe composition"
    if _is_short_form(brief):
        return f"burn captions into the video and keep text within safe area: {safe_area}"
    return f"provide captions as sidecar metadata; safe area: {safe_area}"
