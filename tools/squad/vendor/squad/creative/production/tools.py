from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from creative.director.contracts import CreativeDirectorInput, CreativeDirectorState
from creative.production.contracts import (
    AudioAssetRecord,
    CandidateStillRecord,
    CreativeProductionInput,
    MotionPromptPlan,
    UgcPresenterRecord,
    UgcStrategyPlan,
    UgcRenderModePlan,
    VideoClipRecord,
    VoiceoverPlan,
)
from creative.production.heygen import HeyGenUgcRequest
from creative.production.provider_prompt_compiler import compile_heygen_avatar_motion_prompt
from creative.production.handoff import build_image_to_video_handoff


@dataclass(slots=True)
class CreativeProductionTools:
    director_graph: Any | None
    video_adapter: Any | None
    assembly_adapter: Any | None = None
    tts_adapter: Any | None = None
    plan_reviewer: Any | None = None
    post_pass_adapter: Any | None = None
    post_pass_normalizer: Any | None = None
    post_pass_probe_adapter: Any | None = None
    caption_alignment_adapter: Any | None = None
    track_library_adapter: Any | None = None
    sfx_library_adapter: Any | None = None
    audio_mix_adapter: Any | None = None
    visual_polish_upscale_adapter: Any | None = None
    visual_polish_interpolation_adapter: Any | None = None
    visual_polish_target_height: int | None = None
    visual_polish_target_fps: int | None = None
    narrative_script_planner: Any | None = None
    shotlist_director: Any | None = None
    sequence_treatment_director: Any | None = None
    render_adapter: Any | None = None
    ugc_presenter_adapter: Any | None = None
    preferred_renderer: str = "auto"
    ugc_heygen_audio_source: str = "heygen_script"

    def run_creative_director(self, production_input: CreativeProductionInput) -> CreativeDirectorState:
        if self.director_graph is None:
            raise RuntimeError("director_graph is required")
        return self.director_graph.run(
            CreativeDirectorInput(
                brief=production_input.brief,
                budget_cap_usd=production_input.budget_cap_usd,
                max_attempts=production_input.max_attempts,
            )
        )

    def select_still_for_animation(self, director_state: CreativeDirectorState) -> CandidateStillRecord:
        candidate = director_state.best_candidate
        if candidate is None:
            raise RuntimeError("creative director did not return a best candidate")
        return CandidateStillRecord(
            candidate_id=candidate.candidate_id,
            source_run_id=candidate.run_id,
            asset_path=candidate.asset_path,
            score=candidate.score,
            verdict=candidate.verdict,
            style_family=candidate.style_family,
            template_id=candidate.template_id,
            prompt_summary=candidate.prompt_summary,
            attempt_index=candidate.attempt_index,
            reference_asset_roles=self._reference_asset_roles_from_director_state(director_state, candidate.run_id),
        )

    def plan_narrative_script(self, *, brief, fallback_plan):
        if self.narrative_script_planner is None:
            return None
        return self.narrative_script_planner(brief=brief, fallback_plan=fallback_plan)

    def direct_shotlist(self, *, brief, fallback_plan):
        if self.shotlist_director is None:
            return None
        return self.shotlist_director(brief=brief, fallback_plan=fallback_plan)

    def direct_sequence_treatment(self, *, brief, fallback_plan):
        if self.sequence_treatment_director is None:
            return None
        return self.sequence_treatment_director(brief=brief, fallback_plan=fallback_plan)

    @staticmethod
    def build_image_to_video_handoff(selected_still: CandidateStillRecord):
        return build_image_to_video_handoff(selected_still)

    @staticmethod
    def _reference_asset_roles_from_director_state(director_state: CreativeDirectorState, run_id: str) -> dict:
        generation = director_state.generation_history.get(run_id) or director_state.latest_generation
        request = generation.get("request") if isinstance(generation, dict) else getattr(generation, "request", None)
        if request is not None:
            metadata = request.get("metadata", {}) if isinstance(request, dict) else getattr(request, "metadata", {})
            return dict(metadata.get("reference_asset_roles") or {})
        manifest_path = generation.get("manifest_path") if isinstance(generation, dict) else getattr(generation, "manifest_path", None)
        if not manifest_path:
            return {}
        try:
            import json

            manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
            return dict(
                manifest.get("state", {})
                .get("request", {})
                .get("metadata", {})
                .get("reference_asset_roles", {})
                or {}
            )
        except Exception:
            return {}

    def run_video_generation(
        self,
        *,
        still_path: Path,
        motion_prompt: str,
        negative_prompt: str = "",
        provider_prompt_profile: str = "generic_i2v",
        attempt_index: int,
        source_still_id: str,
        quality: str,
        aspect_ratio: str = "16:9",
        budget_cap_usd: float | None = None,
        model_id_override: str | None = None,
        model_route_reason: str | None = None,
    ) -> VideoClipRecord:
        if self.video_adapter is None:
            raise RuntimeError("video_adapter is required")
        asset = asyncio.run(
            self.video_adapter.image_to_video(
                input_image=still_path,
                prompt=motion_prompt,
                negative_prompt=negative_prompt,
                quality=quality,
                aspect_ratio=aspect_ratio,
                budget_cap_usd=budget_cap_usd,
                model_id_override=model_id_override,
            )
        )
        return VideoClipRecord(
            clip_id=asset.file_path.stem,
            source_still_id=source_still_id,
            asset_path=asset.file_path,
            duration_s=asset.duration_s,
            score=None,
            verdict="generated",
            prompt_summary=motion_prompt,
            attempt_index=attempt_index,
            cost_usd=float(getattr(getattr(asset, "cost", None), "cost_usd", 0.0) or 0.0),
            model_id=str(getattr(getattr(asset, "cost", None), "model", "") or model_id_override or ""),
            model_route_reason=_append_route_reason(model_route_reason, f"provider prompt profile: {provider_prompt_profile}"),
            provider_request_id=getattr(getattr(asset, "cost", None), "provider_request_id", None),
        )

    def generate_voiceover(self, *, run_id: str, voiceover_plan: VoiceoverPlan):
        if self.tts_adapter is None or not voiceover_plan.enabled:
            return None
        return self.tts_adapter.synthesize(run_id=run_id, voiceover_plan=voiceover_plan)

    def review_motion_plan(self, *, production_input: CreativeProductionInput, motion_plan: MotionPromptPlan):
        if self.plan_reviewer is None:
            return None
        return self.plan_reviewer(brief=production_input.brief, motion_plan=motion_plan)

    def assemble_final_video(
        self,
        *,
        run_id: str,
        clips: list[VideoClipRecord],
        voice_asset: AudioAssetRecord | None = None,
    ):
        if self.assembly_adapter is None:
            if not clips:
                raise RuntimeError("cannot assemble without clips")
            first = clips[0]
            from creative.production.contracts import FinalAssemblyRecord

            return FinalAssemblyRecord(
                asset_path=first.asset_path,
                clip_count=len(clips),
                duration_s=first.duration_s,
                assembly_method="single_clip_passthrough_with_audio_sidecar" if voice_asset else "single_clip_passthrough",
                source_clip_ids=tuple(clip.clip_id for clip in clips),
                audio_asset_path=voice_asset.asset_path if voice_asset else None,
            )
        return self.assembly_adapter.concatenate_clips(run_id=run_id, clips=clips, voice_asset=voice_asset)

    def generate_ugc_presenter(
        self,
        *,
        run_id: str,
        script: str,
        render_mode: UgcRenderModePlan,
        aspect_ratio: str,
        budget_cap_usd: float,
        ugc_strategy: UgcStrategyPlan | None = None,
    ) -> UgcPresenterRecord:
        if self.ugc_presenter_adapter is None:
            raise RuntimeError("ugc_presenter_adapter is required for UGC presenter rendering")
        presenter = _select_ugc_presenter(self.ugc_presenter_adapter, ugc_strategy=ugc_strategy)
        if not presenter.avatar_id or not presenter.voice_id:
            raise RuntimeError("UGC presenter adapter requires default_avatar_id and default_voice_id")
        output_root = Path(".outputs/creative-production") / run_id
        output_path = output_root / "ugc-presenter.mp4"
        audio_asset = None
        audio_asset_id = None
        duration_estimate_s = _estimate_script_duration_s(script)
        if self.ugc_heygen_audio_source in {"inworld", "tts", "squad_tts"}:
            audio_asset = self._synthesize_ugc_presenter_audio(run_id=run_id, script=script)
            upload_asset = getattr(self.ugc_presenter_adapter, "upload_asset", None)
            if upload_asset is None:
                raise RuntimeError("UGC presenter adapter must support upload_asset for external TTS audio")
            audio_asset_id = upload_asset(audio_asset.asset_path, content_type=audio_asset.mime_type)
            duration_estimate_s = int(round(audio_asset.duration_s or duration_estimate_s))
        request = HeyGenUgcRequest(
            avatar_id=presenter.avatar_id,
            voice_id=presenter.voice_id,
            script="" if audio_asset_id else script,
            title=f"{run_id} UGC presenter",
            aspect_ratio=aspect_ratio,
            duration_estimate_s=duration_estimate_s,
            avatar_kind=presenter.avatar_kind,
            motion_prompt=compile_heygen_avatar_motion_prompt(
                motion_prompt=presenter.motion_hint,
                persona=ugc_strategy.creator_persona if ugc_strategy else "",
                render_mode=render_mode.mode,
            ),
            background=_heygen_background_for_render_mode(render_mode),
            audio_asset_id=audio_asset_id,
        )
        result = self.ugc_presenter_adapter.generate(
            request=request,
            output_path=output_path,
            max_cost_usd=budget_cap_usd,
            wait=True,
        )
        if result.asset_path is None:
            raise RuntimeError("UGC presenter adapter completed without a local asset path")
        audio_cost_usd = float(getattr(audio_asset, "cost_usd", 0.0) or 0.0) if audio_asset is not None else 0.0
        total_cost_usd = float(result.estimated_cost_usd or 0.0) + audio_cost_usd
        return UgcPresenterRecord(
            clip_id=Path(result.asset_path).stem,
            asset_path=result.asset_path,
            provider="heygen",
            provider_request_id=result.video_id,
            script=script,
            render_mode=render_mode.mode,
            duration_s=float(duration_estimate_s),
            cost_usd=total_cost_usd,
            model_id=request.avatar_kind,
            metadata={
                "status": result.status,
                "thumbnail_url": result.thumbnail_url,
                "presenter_selection": presenter.metadata,
                "audio_source": (
                    {
                        "mode": self.ugc_heygen_audio_source,
                        "provider": audio_asset.provider,
                        "model_id": audio_asset.model_id,
                        "voice_id": audio_asset.voice_id,
                        "mime_type": audio_asset.mime_type,
                        "asset_path": str(audio_asset.asset_path),
                        "heygen_audio_asset_id": audio_asset_id,
                        "cost_usd": audio_cost_usd,
                    }
                    if audio_asset is not None
                    else {"mode": "heygen_script"}
                ),
            },
        )

    def _synthesize_ugc_presenter_audio(self, *, run_id: str, script: str) -> AudioAssetRecord:
        if self.tts_adapter is None:
            raise RuntimeError("tts_adapter is required when SQUAD_UGC_HEYGEN_AUDIO_SOURCE uses external TTS")
        plan = VoiceoverPlan(
            enabled=True,
            script=script,
            voice_direction="Natural UGC creator delivery. Conversational, clear, believable, not announcer-like.",
            template_id="VO-UGC-EXTERNAL",
            rationale="UGC presenter audio is generated by Squad TTS and uploaded to HeyGen for lip-sync",
        )
        asset = self.tts_adapter.synthesize(run_id=run_id, voiceover_plan=plan)
        if asset is None or not asset.asset_path.exists():
            raise RuntimeError("TTS adapter did not create a local audio asset for HeyGen lip-sync")
        return asset

    def compose_ugc_picture_in_picture(
        self,
        *,
        run_id: str,
        base_video_path: Path,
        presenter_video_path: Path,
        render_mode: UgcRenderModePlan,
        presenter_duration_s: float | None = None,
    ):
        if self.assembly_adapter is None:
            raise RuntimeError("assembly_adapter is required for UGC PIP composition")
        return self.assembly_adapter.compose_picture_in_picture(
            run_id=run_id,
            base_video_path=base_video_path,
            presenter_video_path=presenter_video_path,
            render_mode=render_mode,
            loop_base_to_presenter=True,
            presenter_duration_s=presenter_duration_s,
        )

    def apply_post_pass(self, *, state):
        from creative.production.post_pass import build_post_pass_plan

        renderer = self.post_pass_adapter
        if (
            state.render_plan is not None
            and state.render_plan.render_status == "rendered"
            and "captions" in state.render_plan.required_capabilities
        ):
            renderer = None
        return build_post_pass_plan(
            state=state,
            renderer=renderer,
            normalizer=self.post_pass_normalizer,
            probe_adapter=self.post_pass_probe_adapter,
            caption_aligner=self.caption_alignment_adapter,
        )

    def apply_visual_polish(self, *, state):
        from creative.production.post_pass_visual import build_visual_polish_plan

        return build_visual_polish_plan(
            state=state,
            upscale_adapter=self.visual_polish_upscale_adapter,
            interpolation_adapter=self.visual_polish_interpolation_adapter,
            target_height=self.visual_polish_target_height,
            target_fps=self.visual_polish_target_fps,
        )

    def plan_audio_mix(self, *, state):
        from creative.production.audio import build_audio_mix_plan

        plan = build_audio_mix_plan(
            state=state,
            track_library=self.track_library_adapter,
            sfx_library=self.sfx_library_adapter,
        )
        selected = plan.selected_music_track
        if selected is None or selected.asset_path is not None or self.track_library_adapter is None:
            return plan
        materialize = getattr(self.track_library_adapter, "materialize_track", None)
        if materialize is None:
            plan.mix_notes = _append_mix_note(
                plan.mix_notes,
                f"Selected track `{selected.track_id}` has no local asset path and this library cannot materialize it.",
            )
            plan.selected_music_track = None
            plan.voice_ducking_enabled = False
            return plan
        try:
            materialized = materialize(selected, run_id=state.run_id)
        except Exception as exc:
            plan.mix_notes = _append_mix_note(
                plan.mix_notes,
                f"Selected track `{selected.track_id}` could not be materialized for ffmpeg: {exc}",
            )
            plan.selected_music_track = None
            plan.voice_ducking_enabled = False
            return plan
        if materialized.asset_path is None:
            plan.mix_notes = _append_mix_note(
                plan.mix_notes,
                f"Selected track `{selected.track_id}` could not be materialized to a local asset path.",
            )
            plan.selected_music_track = None
            plan.voice_ducking_enabled = False
            return plan
        plan.selected_music_track = materialized
        return plan

    def apply_audio_mix(self, *, state):
        if self.audio_mix_adapter is None:
            return None
        try:
            return self.audio_mix_adapter.render_audio_mix(state=state)
        except Exception as exc:
            if state.audio_mix_plan is not None:
                state.audio_mix_plan.mix_notes = _append_mix_note(
                    state.audio_mix_plan.mix_notes,
                    f"Audio mix failed; using pre-mix assembly for review: {exc}",
                )
            return None

    def plan_render(self, *, state):
        from creative.production.rendering import FFMPEG, build_render_plan

        available = [FFMPEG]
        if self.render_adapter is not None:
            renderer_name = str(getattr(self.render_adapter, "renderer_name", "") or "").strip()
            if renderer_name:
                available.append(renderer_name)
        return build_render_plan(
            state=state,
            preferred_renderer=self.preferred_renderer,
            available_renderers=available,
        )

    def apply_render(self, *, state):
        if self.render_adapter is None or state.render_plan is None or state.render_plan.renderer == "ffmpeg":
            return None
        render = getattr(self.render_adapter, "render", None)
        if render is None:
            state.render_plan.render_status = "failed"
            state.render_plan.warning = f"renderer `{state.render_plan.renderer}` has no render method"
            return None
        try:
            rendered = render(state=state, render_plan=state.render_plan)
        except Exception as exc:
            state.render_plan.render_status = "failed"
            state.render_plan.warning = (
                f"renderer `{state.render_plan.renderer}` failed; ffmpeg/post-pass fallback remains available: {exc}"
            )
            return None
        if rendered is None:
            state.render_plan.render_status = "failed"
            state.render_plan.warning = (
                f"renderer `{state.render_plan.renderer}` did not return an output; ffmpeg/post-pass fallback remains available"
            )
            return None
        state.render_plan.render_status = "rendered"
        return rendered

    @staticmethod
    def validate_output(*, state):
        from creative.production.output_qa import validate_final_output

        if state.final_assembly is None:
            return None
        return validate_final_output(
            final_assembly=state.final_assembly,
            format_plan=state.format_narrative_plan,
            post_pass_plan=state.post_pass_plan,
        )

    @staticmethod
    def write_production_manifest(state):
        from creative.production.repository import write_production_manifest

        return write_production_manifest(state)


def _append_mix_note(existing: str, note: str) -> str:
    existing = (existing or "").strip()
    return f"{existing} {note}".strip() if existing else note


def _append_route_reason(existing: str | None, note: str) -> str:
    existing = (existing or "").strip()
    if not existing:
        return note
    if note in existing:
        return existing
    return f"{existing}; {note}"


def _estimate_script_duration_s(script: str) -> int:
    words = max(1, len((script or "").split()))
    return max(5, min(60, round(words / 2.2)))


@dataclass(frozen=True, slots=True)
class _UgcPresenterSelection:
    avatar_id: str
    voice_id: str
    avatar_kind: str
    motion_hint: str
    metadata: dict[str, Any]


_PERSONA_PROFILE_KEYWORDS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    ("founder", ("founder", "built this", "why it exists"), "founder energy, confident but informal"),
    ("artist", ("artist", "music", "song", "release"), "artist creator energy, intimate and emotionally specific"),
    ("app", ("app", "workflow", "dashboard", "saas", "planner"), "practical app-demo creator energy"),
    ("style", ("style", "fit", "texture", "fashion", "wear"), "style creator energy, visually aware and casual"),
    ("generic", (), "credible niche creator energy"),
)


def _select_ugc_presenter(adapter: Any, *, ugc_strategy: UgcStrategyPlan | None) -> _UgcPresenterSelection:
    default_avatar_id = str(getattr(adapter, "default_avatar_id", "") or "").strip()
    default_voice_id = str(getattr(adapter, "default_voice_id", "") or "").strip()
    persona_map = getattr(adapter, "persona_map", None) or {}
    if not isinstance(persona_map, dict):
        persona_map = {}

    persona = (ugc_strategy.creator_persona if ugc_strategy is not None else "").strip()
    persona_text = persona.lower()
    profile_key, motion_hint = _profile_for_persona(persona_text)
    config = _profile_config_for_persona(persona_map, profile_key=profile_key, persona_text=persona_text)
    avatar_id = str(config.get("avatar_id") or default_avatar_id).strip()
    voice_id = str(config.get("voice_id") or default_voice_id).strip()
    avatar_kind = str(config.get("avatar_kind") or "photo_avatar_iv").strip()
    source = "persona_map" if config else "default"
    return _UgcPresenterSelection(
        avatar_id=avatar_id,
        voice_id=voice_id,
        avatar_kind=avatar_kind,
        motion_hint=motion_hint,
        metadata={
            "source": source,
            "profile_key": profile_key,
            "creator_persona": persona,
            "avatar_id": avatar_id,
            "voice_id": voice_id,
            "avatar_kind": avatar_kind,
        },
    )


def _profile_for_persona(persona_text: str) -> tuple[str, str]:
    for profile_key, keywords, motion_hint in _PERSONA_PROFILE_KEYWORDS:
        if keywords and any(keyword in persona_text for keyword in keywords):
            return profile_key, motion_hint
    return "generic", "credible niche creator energy"


def _profile_config_for_persona(
    persona_map: dict[str, Any],
    *,
    profile_key: str,
    persona_text: str,
) -> dict[str, str]:
    normalized = {str(key).strip().lower(): value for key, value in persona_map.items() if str(key).strip()}
    raw_config = normalized.get(profile_key) or normalized.get("default")
    if raw_config is None:
        for key, value in normalized.items():
            if key not in {"default", profile_key} and key in persona_text:
                raw_config = value
                break
    if not isinstance(raw_config, dict):
        return {}
    return {
        field: str(raw_config.get(field) or "").strip()
        for field in ("avatar_id", "voice_id", "avatar_kind")
        if str(raw_config.get(field) or "").strip()
    }


def _heygen_background_for_render_mode(render_mode: UgcRenderModePlan) -> dict[str, str] | None:
    if render_mode.mode != "avatar_pip_overlay":
        return None
    if render_mode.background_mode != "solid_green":
        return None
    color = render_mode.chromakey_color.strip().lower()
    if color.startswith("0x") and len(color) == 8:
        color = f"#{color[2:]}"
    return {"type": "color", "value": color}
