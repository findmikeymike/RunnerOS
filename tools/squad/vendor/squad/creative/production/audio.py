from __future__ import annotations

import subprocess
from subprocess import CalledProcessError
from dataclasses import replace
from pathlib import Path
from typing import Protocol

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import (
    AudioMixPlan,
    CreativeProductionState,
    FinalAssemblyRecord,
    FormatNarrativePlan,
    MusicTrackQuery,
    MusicTrackRecord,
    SfxCuePlan,
)


MUSIC_BED_PRE_NORM_LUFS = -18.0
MUSIC_BED_HIGHPASS_HZ = 100


class SfxLibraryAdapter(Protocol):
    def resolve(self, *, search_tags: tuple[str, ...], intensity: str) -> Path | None:
        ...


class LocalSfxLibraryAdapter:
    """File-based SFX resolver.

    Layout: each SFX file lives at <root>/<tag>/<anything>.{wav,mp3,m4a,ogg}.
    The first matching tag in `search_tags` wins. Intensity is a tiebreaker:
    files containing the intensity in their name are preferred.
    """

    _SUFFIXES = (".wav", ".mp3", ".m4a", ".ogg", ".aac", ".flac")

    def __init__(self, *, root: Path | str) -> None:
        self.root = Path(root)

    def resolve(self, *, search_tags: tuple[str, ...], intensity: str) -> Path | None:
        if not self.root.exists():
            return None
        intensity_token = (intensity or "").strip().lower()
        for tag in search_tags:
            tag_dir = self.root / tag
            if not tag_dir.is_dir():
                continue
            candidates = [path for path in tag_dir.iterdir() if path.suffix.lower() in self._SUFFIXES]
            if not candidates:
                continue
            if intensity_token:
                ranked = sorted(
                    candidates,
                    key=lambda path: (0 if intensity_token in path.stem.lower() else 1, path.name),
                )
            else:
                ranked = sorted(candidates, key=lambda path: path.name)
            return ranked[0]
        return None


def _run_subprocess(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        message = f"audio mix command failed with exit code {exc.returncode}"
        raise RuntimeError(f"{message}: {detail}" if detail else message) from exc


class TrackLibraryAdapter(Protocol):
    def search_tracks(self, query: MusicTrackQuery, *, limit: int = 8) -> list[MusicTrackRecord]:
        ...


class FfmpegAudioMixAdapter:
    def __init__(self, *, ffmpeg_binary: str = "ffmpeg", command_runner=None) -> None:
        self.ffmpeg_binary = ffmpeg_binary
        self.command_runner = command_runner

    def render_audio_mix(
        self,
        *,
        state: CreativeProductionState,
        output_root: Path | str = ".outputs/creative-production",
    ) -> FinalAssemblyRecord | None:
        if state.final_assembly is None:
            raise RuntimeError("cannot mix audio before final assembly exists")
        if state.audio_mix_plan is None:
            return None

        voice_path = state.voice_asset.asset_path if state.voice_asset else None
        music = state.audio_mix_plan.selected_music_track
        music_path = music.asset_path if music and music.asset_path else None
        if voice_path is None and music_path is None:
            return None
        if voice_path is not None and not voice_path.exists():
            raise RuntimeError(f"voice asset file does not exist: {voice_path}")
        if music_path is not None and not music_path.exists():
            raise RuntimeError(f"music asset file does not exist: {music_path}")
        if not state.final_assembly.asset_path.exists():
            raise RuntimeError(f"source video file does not exist: {state.final_assembly.asset_path}")

        run_dir = Path(output_root) / state.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        output_path = run_dir / "final-audio-mix.mp4"
        cmd = self._build_command(
            source_video=state.final_assembly.asset_path,
            output_path=output_path,
            voice_path=voice_path,
            music_path=music_path,
            plan=state.audio_mix_plan,
            duration_s=state.final_assembly.duration_s,
        )
        runner = self.command_runner or _run_subprocess
        runner(cmd)
        _ensure_output_file(output_path, context="audio mix")
        return replace(
            state.final_assembly,
            asset_path=output_path,
            assembly_method=f"{state.final_assembly.assembly_method}_audio_mix",
            audio_asset_path=voice_path or music_path,
        )

    def _build_command(
        self,
        *,
        source_video: Path,
        output_path: Path,
        voice_path: Path | None,
        music_path: Path | None,
        plan: AudioMixPlan,
        duration_s: float | None,
    ) -> list[str]:
        cmd = [self.ffmpeg_binary, "-y", "-i", str(source_video)]
        input_index = 1
        voice_index: int | None = None
        music_index: int | None = None
        if voice_path is not None:
            cmd.extend(["-i", str(voice_path)])
            voice_index = input_index
            input_index += 1
        if music_path is not None:
            if duration_s:
                cmd.extend(["-stream_loop", "-1"])
            cmd.extend(["-i", str(music_path)])
            music_index = input_index
            input_index += 1

        sfx_inputs: list[tuple[SfxCuePlan, int]] = []
        for cue in plan.sfx_cues:
            if cue.asset_path is not None and cue.asset_path.exists():
                cmd.extend(["-i", str(cue.asset_path)])
                sfx_inputs.append((cue, input_index))
                input_index += 1

        cmd.extend(
            [
                "-filter_complex",
                self._filter_complex(
                    voice_index=voice_index,
                    music_index=music_index,
                    plan=plan,
                    duration_s=duration_s,
                    sfx_inputs=tuple(sfx_inputs),
                ),
                "-map",
                "0:v:0",
                "-map",
                "[aout]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
            ]
        )
        if duration_s:
            cmd.extend(["-t", _fmt_seconds(duration_s)])
        cmd.append(str(output_path))
        return cmd

    @staticmethod
    def _filter_complex(
        *,
        voice_index: int | None,
        music_index: int | None,
        plan: AudioMixPlan,
        duration_s: float | None,
        sfx_inputs: tuple[tuple[SfxCuePlan, int], ...] = (),
    ) -> str:
        loudnorm = _loudnorm_filter(plan.loudness_target_lufs)
        # When SFX are present, the base chain emits to [premix] without loudnorm
        # (loudnorm is applied once after SFX are mixed in). When no SFX, behaviour
        # is identical to the pre-SFX implementation: chain ends in `{loudnorm}[aout]`.
        base_sink = "[premix]" if sfx_inputs else "[aout]"
        base_terminator = f"anull{base_sink}" if sfx_inputs else f"{loudnorm}{base_sink}"

        base_chain: str
        if voice_index is not None and music_index is not None:
            music_filters = [
                f"[{music_index}:a]aresample=48000",
                _loudnorm_filter(MUSIC_BED_PRE_NORM_LUFS),
                f"highpass=f={MUSIC_BED_HIGHPASS_HZ}",
                f"volume={_db_to_volume(plan.music_gain_db)}",
            ]
            if duration_s:
                music_filters.extend(
                    [
                        f"atrim=duration={_fmt_seconds(duration_s)}",
                        "asetpts=PTS-STARTPTS",
                        "afade=t=in:st=0:d=0.25",
                        f"afade=t=out:st={_fmt_seconds(max(0.0, duration_s - 0.75))}:d=0.75",
                    ]
                )
            voice_filters = f"[{voice_index}:a]aresample=48000,volume=1.0"
            if duration_s:
                voice_filters += f",apad,atrim=duration={_fmt_seconds(duration_s)}"
            voice_filters += "[voice]"
            mix = "[music][voice]amix=inputs=2:duration=first:dropout_transition=0:weights=1 1:normalize=0"
            base_chain = ";".join(
                part
                for part in (
                    ",".join(music_filters) + "[music]",
                    voice_filters,
                    f"{mix},{base_terminator}",
                )
                if part
            )
        elif music_index is not None:
            filters = [
                f"[{music_index}:a]aresample=48000",
                f"volume={_db_to_volume(plan.music_gain_db)}",
            ]
            if duration_s:
                filters.extend(
                    [
                        f"atrim=duration={_fmt_seconds(duration_s)}",
                        "asetpts=PTS-STARTPTS",
                        "afade=t=in:st=0:d=0.25",
                        f"afade=t=out:st={_fmt_seconds(max(0.0, duration_s - 0.75))}:d=0.75",
                    ]
                )
            filters.append(base_terminator)
            base_chain = ",".join(filters)
        elif voice_index is not None:
            filters = [f"[{voice_index}:a]aresample=48000", "volume=1.0"]
            if duration_s:
                filters.extend(["apad", f"atrim=duration={_fmt_seconds(duration_s)}"])
            filters.append(base_terminator)
            base_chain = ",".join(filters)
        else:
            raise RuntimeError("cannot build audio mix without voice or music")

        if not sfx_inputs:
            return base_chain

        sfx_gain_volume = _db_to_volume(plan.sfx_gain_db)
        sfx_chain_parts: list[str] = []
        sfx_sinks: list[str] = []
        for idx, (cue, input_index) in enumerate(sfx_inputs):
            sink = f"[sfx{idx}]"
            sfx_sinks.append(sink)
            delay_ms = max(0, int(round(float(cue.start_s) * 1000.0)))
            chain_steps = [
                f"[{input_index}:a]aresample=48000",
                f"volume={sfx_gain_volume}",
            ]
            if delay_ms > 0:
                chain_steps.append(f"adelay={delay_ms}|{delay_ms}")
            chain_steps.append("apad")
            if duration_s:
                chain_steps.append(f"atrim=duration={_fmt_seconds(duration_s)}")
            sfx_chain_parts.append(",".join(chain_steps) + sink)

        amix_inputs = ["[premix]", *sfx_sinks]
        amix_step = (
            f"{''.join(amix_inputs)}amix=inputs={len(amix_inputs)}:"
            "duration=first:dropout_transition=0:normalize=0"
        )
        final_step = f"{amix_step},{loudnorm}[aout]"
        return ";".join((base_chain, *sfx_chain_parts, final_step))


def build_audio_mix_plan(
    *,
    state: CreativeProductionState,
    track_library: TrackLibraryAdapter | None = None,
    sfx_library: SfxLibraryAdapter | None = None,
) -> AudioMixPlan:
    plan = state.format_narrative_plan
    brief = state.brief_input.brief
    audio_mode = plan.audio_mode if plan else _infer_audio_mode(brief, voice_enabled=bool(state.voiceover_plan and state.voiceover_plan.enabled))
    music_role = _music_role(audio_mode)
    track_query = _build_track_query(brief=brief, plan=plan, music_role=music_role)
    candidates = track_library.search_tracks(track_query, limit=8) if track_library else []
    ranked = sorted(
        ((track, _score_track(track, track_query)) for track in candidates),
        key=lambda item: item[1],
        reverse=True,
    )
    selected = ranked[0][0] if ranked and ranked[0][1] > 0 else None
    rejected = tuple(track.track_id for track, _score in ranked[1:4])
    voice_enabled = bool(state.voice_asset is not None)
    sfx_cues = _build_sfx_cues(plan=plan, voice_enabled=voice_enabled)
    if sfx_library is not None and sfx_cues:
        sfx_cues = tuple(
            _resolve_sfx_cue_asset(cue=cue, sfx_library=sfx_library) for cue in sfx_cues
        )
    return AudioMixPlan(
        audio_mode=audio_mode,
        music_role=music_role,
        track_query=track_query,
        selected_music_track=selected,
        rejected_track_ids=rejected,
        sfx_cues=sfx_cues,
        voice_ducking_enabled=False,
        music_gain_db=_music_gain(audio_mode, voice_enabled),
        sfx_gain_db=-18.0 if voice_enabled else -12.0,
        loudness_target_lufs=_loudness_target_for_platform(brief.platform),
        mix_notes=_mix_notes(audio_mode=audio_mode, voice_enabled=voice_enabled, selected=selected),
        selection_rationale=_selection_rationale(
            audio_mode=audio_mode,
            music_role=music_role,
            selected=selected,
            candidate_count=len(candidates),
        ),
    )


def _infer_audio_mode(brief: CreativeBrief, *, voice_enabled: bool = False) -> str:
    text = _brief_text(brief)
    if any(term in text for term in ("lyric", "lyrics", "music", "song", "track", "beat")):
        return "music_led"
    if voice_enabled:
        return "narration_led"
    if brief.voiceover_script or any(term in text for term in ("voiceover", "narration", "explainer", "ugc")):
        return "narration_led"
    return "none"


def _music_role(audio_mode: str) -> str:
    if audio_mode == "music_led":
        return "hero_track"
    if audio_mode == "narration_led":
        return "background_bed"
    return "optional_texture"


def _build_track_query(
    *,
    brief: CreativeBrief,
    plan: FormatNarrativePlan | None,
    music_role: str,
) -> MusicTrackQuery:
    mood = _mood_terms(brief, plan)
    energy = _energy_for_intent(plan.primary_intent if plan else "", mood)
    tempo_min, tempo_max = _tempo_range(energy=energy, music_role=music_role)
    return MusicTrackQuery(
        mood=mood,
        energy=energy,
        tempo_bpm_min=tempo_min,
        tempo_bpm_max=tempo_max,
        genre=_genre_terms(brief, mood),
        instrumentation=_instrumentation_for_role(music_role, mood),
        vocal_policy="allow_vocals" if music_role == "hero_track" else "instrumental_required",
        duration_min_s=max(5, int((plan.duration_target_s if plan else 10) * 0.8)),
        duration_max_s=max(15, int((plan.duration_target_s if plan else 10) * 1.5)),
        loopable_preferred=music_role != "hero_track",
        explicit_allowed=False,
    )


def _mood_terms(brief: CreativeBrief, plan: FormatNarrativePlan | None) -> tuple[str, ...]:
    terms = [item.strip().lower() for item in brief.mood_keywords if item.strip()]
    text = _brief_text(brief)
    for term in (
        "premium",
        "cinematic",
        "dark",
        "dreamy",
        "nostalgic",
        "luxury",
        "energetic",
        "funny",
        "calm",
        "weird",
        "gritty",
        "romantic",
        "futuristic",
    ):
        if term in text:
            terms.append(term)
    if plan:
        terms.extend(
            item
            for item in (
                plan.viewer_emotion_start,
                plan.viewer_emotion_peak,
                plan.viewer_emotion_end,
            )
            if item
        )
    return tuple(dict.fromkeys(item.strip().lower() for item in terms if item.strip())) or ("cinematic",)


def _genre_terms(brief: CreativeBrief, mood: tuple[str, ...]) -> tuple[str, ...]:
    text = _brief_text(brief)
    genres: list[str] = []
    for term in ("hip hop", "ambient", "electronic", "cinematic", "indie", "pop", "jazz", "rock"):
        if term in text:
            genres.append(term)
    if not genres:
        if any(term in mood for term in ("premium", "luxury", "cinematic")):
            genres.append("cinematic")
        elif any(term in mood for term in ("dreamy", "nostalgic", "calm")):
            genres.append("ambient")
        else:
            genres.append("electronic")
    return tuple(dict.fromkeys(genres))


def _instrumentation_for_role(music_role: str, mood: tuple[str, ...]) -> tuple[str, ...]:
    if music_role == "hero_track":
        return ("full_mix",)
    if music_role == "background_bed":
        if any(term in mood for term in ("premium", "luxury", "cinematic")):
            return ("soft_synth", "light_texture", "gentle_pulse")
        if any(term in mood for term in ("dreamy", "nostalgic", "calm")):
            return ("pads", "soft_keys", "texture")
        return ("light_drums", "soft_keys", "texture")
    if any(term in mood for term in ("premium", "luxury", "cinematic")):
        return ("sub_bass", "soft_synth", "cinematic_pulse")
    if any(term in mood for term in ("dreamy", "nostalgic", "calm")):
        return ("pads", "soft_keys", "texture")
    return ("drums", "bass", "synth")


def _energy_for_intent(primary_intent: str, mood: tuple[str, ...]) -> str:
    if primary_intent in {"sell", "entertain"} or any(term in mood for term in ("energetic", "funny")):
        return "high"
    if any(term in mood for term in ("calm", "dreamy", "nostalgic", "premium", "luxury")):
        return "low"
    return "medium"


def _tempo_range(*, energy: str, music_role: str) -> tuple[int, int]:
    if music_role == "hero_track":
        return (70, 150)
    if energy == "high":
        return (95, 140)
    if energy == "low":
        return (60, 100)
    return (80, 120)


def _resolve_sfx_cue_asset(*, cue: SfxCuePlan, sfx_library: SfxLibraryAdapter) -> SfxCuePlan:
    if cue.asset_path is not None:
        return cue
    try:
        resolved = sfx_library.resolve(search_tags=cue.search_tags, intensity=cue.intensity)
    except Exception:
        resolved = None
    if resolved is None:
        return replace(cue, resolution_source="library_miss")
    return replace(cue, asset_path=resolved, resolution_source="library_hit")


def _build_sfx_cues(*, plan: FormatNarrativePlan | None, voice_enabled: bool) -> tuple[SfxCuePlan, ...]:
    if not plan or not plan.scene_beats:
        return ()
    cues: list[SfxCuePlan] = []
    cursor = 0.0
    for beat in plan.scene_beats:
        start = cursor
        end = cursor + max(1, beat.duration_s)
        tags = _sfx_tags(beat.music_sfx_goal, beat.motion_intent, beat.beat_role)
        if tags:
            cues.append(
                SfxCuePlan(
                    cue_id=f"sfx-beat-{beat.beat_index}",
                    beat_index=beat.beat_index,
                    start_s=round(start, 3),
                    end_s=round(min(end, start + 1.5), 3),
                    purpose=beat.music_sfx_goal or beat.motion_intent or beat.beat_role,
                    search_tags=tags,
                    intensity="low" if voice_enabled else _sfx_intensity(beat.beat_role),
                    keep_under_voice=voice_enabled,
                )
            )
        cursor = end
    return tuple(cues)


def _sfx_tags(goal: str, motion: str, beat_role: str) -> tuple[str, ...]:
    text = f"{goal} {motion} {beat_role}".lower()
    tags: list[str] = []
    if any(term in text for term in ("impact", "drop", "cta", "tag")):
        tags.append("impact")
    if any(term in text for term in ("reveal", "transition", "cut")):
        tags.append("transition")
    if any(term in text for term in ("texture", "room", "atmosphere", "ambient")):
        tags.append("room_tone")
    if any(term in text for term in ("flame", "explosion", "fire")):
        tags.append("fire")
    if any(term in text for term in ("clap", "hands")):
        tags.append("hand_clap")
    return tuple(dict.fromkeys(tags))


def _sfx_intensity(beat_role: str) -> str:
    return "medium" if beat_role in {"hook", "cta", "reveal"} else "low"


def _score_track(track: MusicTrackRecord, query: MusicTrackQuery) -> float:
    score = 0.0
    score += 3.0 * len(set(track.mood) & set(query.mood))
    score += 2.0 if track.energy == query.energy else 0.0
    score += 1.5 * len(set(track.genre) & set(query.genre))
    score += 1.0 * len(set(track.instrumentation) & set(query.instrumentation))
    if track.tempo_bpm is not None and query.tempo_bpm_min is not None and query.tempo_bpm_max is not None:
        score += 2.0 if query.tempo_bpm_min <= track.tempo_bpm <= query.tempo_bpm_max else -1.0
    if query.vocal_policy == "instrumental_required" and track.has_vocals:
        score -= 4.0
    if not query.explicit_allowed and track.explicit:
        score -= 6.0
    if query.loopable_preferred and track.loopable:
        score += 1.0
    if query.license_required and query.license_required in track.license:
        score += 2.0
    if track.duration_s is not None and query.duration_min_s is not None and query.duration_max_s is not None:
        score += 1.0 if query.duration_min_s <= track.duration_s <= query.duration_max_s else -0.5
    return score


def _loudness_target_for_platform(platform: str) -> float | None:
    normalized = platform.strip().lower()
    if normalized == "youtube":
        return -14.0
    if normalized in {"tiktok", "reels", "instagram_reel", "instagram_story", "youtube_shorts", "shorts"}:
        return -14.0
    return None


def _db_to_volume(db_value: float | None) -> str:
    if db_value is None:
        return "1.0"
    return f"{float(db_value):.2f}dB"


def _loudnorm_filter(target_lufs: float | None) -> str:
    if target_lufs is None:
        return "loudnorm=I=-16:TP=-1.5:LRA=11"
    return f"loudnorm=I={float(target_lufs):.1f}:TP=-1.5:LRA=11"


def _fmt_seconds(seconds: float) -> str:
    return f"{float(seconds):.3f}".rstrip("0").rstrip(".")


def _ensure_output_file(path: Path, *, context: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{context} command did not create output file: {path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"{context} command created an empty output file: {path}")


def _music_gain(audio_mode: str, voice_enabled: bool) -> float | None:
    if audio_mode == "none":
        return None
    if voice_enabled:
        return -28.0
    if audio_mode == "music_led":
        return -8.0
    return -14.0


def _mix_notes(*, audio_mode: str, voice_enabled: bool, selected: MusicTrackRecord | None) -> str:
    if audio_mode == "none":
        return "No required soundtrack; keep silence unless the user explicitly asks for room tone."
    if selected is None:
        return "Audio track not selected yet; pass the query to the configured track library before final mix."
    if voice_enabled:
        return "Keep music bed at a fixed low level under voiceover; no sidechain ducking."
    if audio_mode == "music_led":
        return "Let the selected track drive pacing; cuts and captions should follow music phrases."
    return "Use the selected track as a restrained bed under the visual sequence."


def _selection_rationale(
    *,
    audio_mode: str,
    music_role: str,
    selected: MusicTrackRecord | None,
    candidate_count: int,
) -> str:
    if audio_mode == "none":
        return "Brief does not require music-led or narration-led audio."
    if selected is None:
        return f"Built a `{music_role}` query, but no matching track was available from {candidate_count} candidates."
    return f"Selected `{selected.title}` as `{music_role}` because its metadata best matched the brief mood, energy, tempo, and license constraints."


def _brief_text(brief: CreativeBrief) -> str:
    return " ".join(
        item
        for item in (
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.key_audience_insight,
            brief.competitor_visual_notes,
            brief.copy_for_overlay or "",
            brief.cta_text or "",
        )
        if item
    ).lower()
