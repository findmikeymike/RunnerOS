from __future__ import annotations

from dataclasses import replace

from creative.production.audio import build_audio_mix_plan
from creative.production.contracts import (
    CreativeProductionInput,
    CreativeProductionState,
    FinalAssemblyRecord,
    HumanProductionReviewPacket,
    ProductionFinalStatus,
    UgcRenderModePlan,
    VideoClipRecord,
)
from creative.production.faceless_assets import build_faceless_asset_intents
from creative.production.output_qa import build_output_qa_expectation, validate_final_output
from creative.production.prompt import (
    build_motion_prompt_plan,
    compact_motion_prompt_for_provider,
    enrich_motion_prompt_for_video_tier,
)
from creative.production.plan_review import apply_plan_review
from creative.production.provider_prompt_compiler import compile_video_provider_prompt
from creative.production.post_pass import build_post_pass_plan
from creative.production.repository import write_production_manifest
from creative.production.review import build_production_review_artifact
from creative.production.model_routing import default_video_model_registry, select_video_model_route
from creative.production.rendering import build_render_plan
from creative.production.voice import build_voiceover_plan
from creative.production.handoff import apply_handoff_to_motion_plan, build_image_to_video_handoff
from creative.production.narrative import build_format_narrative_plan
from creative.production.sequence_treatment_director import (
    merge_sequence_treatment,
    render_sequence_treatment_prose,
)
from creative.production.shotlist_director import (
    render_shot_grammar_image_prose,
    render_shot_grammar_motion_prose,
)
from creative.production.ugc import build_ugc_presenter_script


MINIMUM_VIDEO_BUDGET_USD = 0.10
MAX_VIDEO_GENERATION_ATTEMPTS_PER_BEAT = 2


class CreativeProductionGraph:
    def __init__(self, *, tools) -> None:
        self.tools = tools

    def run(self, production_input: CreativeProductionInput) -> CreativeProductionState:
        state = CreativeProductionState(
            run_id=production_input.run_id,
            brief_input=production_input,
            creative_goal=production_input.brief.campaign_goal,
            budget_cap_usd=production_input.effective_budget_cap_usd,
            max_attempts=production_input.max_attempts,
        )
        state.format_narrative_plan = build_format_narrative_plan(production_input.brief)
        if self._should_escalate_carousel_scope(state=state):
            state.final_status = ProductionFinalStatus.ESCALATED
            state.capability_warning = (
                "This brief asks for a social carousel. The creative-production graph is video/still oriented; "
                "route this through content.carousel.build_carousel_plan before any image or video provider spend."
            )
            self._finalize(
                state,
                review_reason="carousel scope requires the carousel planner, not video production",
            )
            return state
        self._apply_llm_narrative_script_plan(state=state, production_input=production_input)
        if self._should_run_ugc_presenter_lane(state=state):
            self._apply_llm_sequence_treatment(state=state, production_input=production_input)
            self._apply_llm_shotlist_director(state=state, production_input=production_input)
            return self._run_ugc_presenter_lane(state, production_input)
        if self._should_escalate_unsupported_ugc(state=state):
            state.final_status = ProductionFinalStatus.ESCALATED
            state.capability_warning = (
                "This UGC brief asks for talking-head, lip-sync, avatar, or on-camera creator performance. "
                "The current production loop only supports still-to-video animation, so it is escalated before spend."
            )
            self._finalize(
                state,
                review_reason="UGC creator-performance request requires a talking-head/lip-sync provider lane",
            )
            return state
        self._apply_llm_sequence_treatment(state=state, production_input=production_input)
        self._apply_llm_shotlist_director(state=state, production_input=production_input)
        if self._should_run_multi_shot(state):
            return self._run_multi_shot_ad(state, production_input)

        director_state = self.tools.run_creative_director(production_input)
        director_spend = float(getattr(director_state, "total_spend_usd", 0.0) or 0.0)
        selected_still = self.tools.select_still_for_animation(director_state)
        state.selected_still = selected_still
        state.selected_still_history.append(selected_still)
        if self._should_escalate_after_still(state):
            state.total_spend_usd = self._total_spend(
                director_spend_usd=director_spend,
                state=state,
            )
            state.final_status = ProductionFinalStatus.ESCALATED
            self._finalize(
                state,
                review_reason="selected still is not strong enough to justify motion generation",
            )
            return state
        if self._should_stop_at_still(state):
            state.total_spend_usd = self._total_spend(
                director_spend_usd=director_spend,
                state=state,
            )
            self._set_still_review_assembly(state)
            state.final_status = ProductionFinalStatus.REVIEW_READY
            self._finalize(
                state,
                review_reason=self._still_only_review_reason(state),
            )
            return state
        remaining_video_budget_usd = self._remaining_budget(
            state=state,
            director_spend_usd=director_spend,
        )
        if remaining_video_budget_usd < MINIMUM_VIDEO_BUDGET_USD:
            state.total_spend_usd = self._total_spend(
                director_spend_usd=director_spend,
                state=state,
            )
            self._set_still_review_assembly(state)
            state.final_status = ProductionFinalStatus.REVIEW_READY
            self._finalize(
                state,
                review_reason="budget remaining after still generation is too tight for motion; selected still is ready for review",
            )
            return state
        ok = self._generate_video_beat(
            state=state,
            production_input=production_input,
            selected_still=selected_still,
            attempt_index=1,
            per_clip_budget_usd=remaining_video_budget_usd,
        )
        if not ok:
            state.total_spend_usd = self._total_spend(
                director_spend_usd=director_spend,
                state=state,
            )
            self._finalize_after_failed_video(state)
            return state
        self._generate_voiceover(state=state, production_input=production_input, selected_still=selected_still)
        state.audio_mix_plan = self._build_audio_mix_plan(state)
        self._apply_faceless_asset_plan(state)
        state.final_assembly = self.tools.assemble_final_video(
            run_id=state.run_id,
            clips=state.video_attempt_history,
            voice_asset=state.voice_asset,
        )
        self._apply_audio_mix(state)
        state.render_plan = self._build_render_plan(state)
        self._apply_render(state)
        state.visual_polish_plan = self._build_visual_polish(state)
        self._promote_polished_asset(state)
        state.post_pass_plan = self._build_post_pass(state)
        self._promote_captioned_asset(state)
        self._apply_output_qa(state)
        state.total_spend_usd = self._total_spend(
            director_spend_usd=director_spend,
            state=state,
        )
        review_reason = self._review_reason_after_output_qa(
            state,
            ready_reason="production package is ready for review",
        )
        self._finalize(state, review_reason=review_reason)
        return state

    def _run_ugc_presenter_lane(
        self,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
    ) -> CreativeProductionState:
        render_mode = self._ugc_render_mode_plan(state)
        state.ugc_render_mode_plan = render_mode
        script = self._ugc_presenter_script(state)
        try:
            state.ugc_presenter_clip = self.tools.generate_ugc_presenter(
                run_id=state.run_id,
                script=script,
                render_mode=render_mode,
                aspect_ratio=self._video_aspect_ratio(state),
                budget_cap_usd=state.budget_cap_usd,
                ugc_strategy=state.format_narrative_plan.ugc_strategy if state.format_narrative_plan else None,
            )
        except Exception as exc:
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = f"UGC presenter generation failed before final assembly: {exc}"
            self._finalize(state, review_reason=state.video_generation_error)
            return state

        if render_mode.mode == "avatar_fullscreen":
            state.final_assembly = FinalAssemblyRecord(
                asset_path=state.ugc_presenter_clip.asset_path,
                clip_count=1,
                duration_s=state.ugc_presenter_clip.duration_s,
                assembly_method="heygen_avatar_fullscreen",
                source_clip_ids=(state.ugc_presenter_clip.clip_id,),
                audio_asset_path=state.ugc_presenter_clip.asset_path,
            )
            return self._finalize_ugc_presenter_lane(state, review_reason="UGC avatar presenter package is ready for review")

        remaining_budget_usd = max(0.0, state.budget_cap_usd - state.ugc_presenter_clip.cost_usd)
        if remaining_budget_usd < MINIMUM_VIDEO_BUDGET_USD:
            state.final_assembly = FinalAssemblyRecord(
                asset_path=state.ugc_presenter_clip.asset_path,
                clip_count=1,
                duration_s=state.ugc_presenter_clip.duration_s,
                assembly_method="heygen_avatar_fullscreen_budget_fallback",
                source_clip_ids=(state.ugc_presenter_clip.clip_id,),
                audio_asset_path=state.ugc_presenter_clip.asset_path,
            )
            return self._finalize_ugc_presenter_lane(
                state,
                review_reason="UGC avatar presenter package is ready for review; PIP B-roll skipped because remaining budget was too tight",
            )

        base_ok, base_director_spend = self._generate_ugc_base_broll(
            state=state,
            production_input=production_input,
            remaining_budget_usd=remaining_budget_usd,
        )
        if not base_ok:
            state.total_spend_usd = self._total_spend(director_spend_usd=base_director_spend, state=state)
            self._finalize_after_failed_video(state)
            return state
        base_assembly = self.tools.assemble_final_video(
            run_id=state.run_id,
            clips=state.video_attempt_history,
            voice_asset=None,
        )
        state.ugc_base_assembly = base_assembly
        try:
            state.final_assembly = self.tools.compose_ugc_picture_in_picture(
                run_id=state.run_id,
                base_video_path=base_assembly.asset_path,
                presenter_video_path=state.ugc_presenter_clip.asset_path,
                render_mode=render_mode,
                presenter_duration_s=state.ugc_presenter_clip.duration_s,
            )
        except Exception as exc:
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = f"UGC PIP assembly failed after presenter/base generation: {exc}"
            self._finalize(state, review_reason=state.video_generation_error)
            return state
        return self._finalize_ugc_presenter_lane(
            state,
            review_reason="UGC presenter PIP package is ready for review",
            director_spend_usd=base_director_spend,
        )

    def _generate_ugc_base_broll(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
        remaining_budget_usd: float,
    ) -> tuple[bool, float]:
        beats = tuple(state.format_narrative_plan.scene_beats if state.format_narrative_plan else ())
        base_beat = next((beat for beat in beats if beat.beat_role in {"solution", "proof", "value", "feature"}), beats[0] if beats else None)
        if base_beat is None:
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = "UGC PIP lane had no scene beat available for base B-roll"
            return False, 0.0
        per_beat_budget = max(MINIMUM_VIDEO_BUDGET_USD, remaining_budget_usd)
        beat_input = self._production_input_for_beat(
            state=state,
            production_input=production_input,
            beat=base_beat,
            per_beat_budget_usd=per_beat_budget,
        )
        director_state = self.tools.run_creative_director(beat_input)
        director_spend = float(getattr(director_state, "total_spend_usd", 0.0) or 0.0)
        selected_still = self.tools.select_still_for_animation(director_state)
        state.selected_still = selected_still
        state.selected_still_history.append(selected_still)
        if self._still_is_not_animatable(selected_still):
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = "UGC PIP base B-roll still is not strong enough to animate"
            return False, director_spend
        remaining_after_director_usd = max(0.0, remaining_budget_usd - director_spend)
        if remaining_after_director_usd < MINIMUM_VIDEO_BUDGET_USD:
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = (
                "UGC PIP base B-roll skipped because remaining budget after still generation was too tight"
            )
            return False, director_spend
        before_count = len(state.video_attempt_history)
        ok = self._generate_video_beat(
            state=state,
            production_input=beat_input,
            selected_still=selected_still,
            attempt_index=base_beat.beat_index,
            per_clip_budget_usd=remaining_after_director_usd,
        )
        if ok and len(state.video_attempt_history) > before_count:
            state.video_attempt_history[-1].clip_id = "ugc-base-broll"
        return ok, director_spend

    def _finalize_ugc_presenter_lane(
        self,
        state: CreativeProductionState,
        *,
        review_reason: str,
        director_spend_usd: float = 0.0,
    ) -> CreativeProductionState:
        self._apply_audio_mix(state)
        state.render_plan = self._build_render_plan(state)
        self._apply_render(state)
        state.visual_polish_plan = self._build_visual_polish(state)
        self._promote_polished_asset(state)
        state.post_pass_plan = self._build_post_pass(state)
        self._promote_captioned_asset(state)
        self._apply_output_qa(state)
        state.total_spend_usd = self._total_spend(director_spend_usd=director_spend_usd, state=state)
        self._finalize(
            state,
            review_reason=self._review_reason_after_output_qa(state, ready_reason=review_reason),
        )
        return state

    def _run_multi_shot_ad(
        self,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
    ) -> CreativeProductionState:
        beats = tuple(state.format_narrative_plan.scene_beats if state.format_narrative_plan else ())
        if not beats:
            state.final_status = ProductionFinalStatus.ESCALATED
            self._finalize(state, review_reason="multi-shot ad plan had no scene beats")
            return state

        director_spend = 0.0
        per_beat_budget = max(MINIMUM_VIDEO_BUDGET_USD, state.budget_cap_usd / len(beats))
        for beat in beats:
            remaining_before_beat = self._remaining_budget(
                state=state,
                director_spend_usd=director_spend,
            )
            if remaining_before_beat < MINIMUM_VIDEO_BUDGET_USD:
                state.total_spend_usd = self._total_spend(
                    director_spend_usd=director_spend,
                    state=state,
                )
                state.final_status = ProductionFinalStatus.ESCALATED
                self._finalize(
                    state,
                    review_reason=f"budget exhausted before scene beat {beat.beat_index}; stopped before more provider spend",
                )
                return state
            beat_input = self._production_input_for_beat(
                state=state,
                production_input=production_input,
                beat=beat,
                per_beat_budget_usd=min(per_beat_budget, remaining_before_beat),
            )
            director_state = self.tools.run_creative_director(beat_input)
            director_spend += float(getattr(director_state, "total_spend_usd", 0.0) or 0.0)
            remaining_after_director = self._remaining_budget(
                state=state,
                director_spend_usd=director_spend,
            )
            selected_still = self.tools.select_still_for_animation(director_state)
            state.selected_still_history.append(selected_still)
            state.selected_still = selected_still if state.selected_still is None else state.selected_still
            if self._still_is_not_animatable(selected_still):
                state.total_spend_usd = self._total_spend(
                    director_spend_usd=director_spend,
                    state=state,
                )
                state.final_status = ProductionFinalStatus.ESCALATED
                self._finalize(
                    state,
                    review_reason=f"scene beat {beat.beat_index} still is not strong enough to animate",
                )
                return state
            if remaining_after_director < MINIMUM_VIDEO_BUDGET_USD:
                state.total_spend_usd = self._total_spend(
                    director_spend_usd=director_spend,
                    state=state,
                )
                state.final_status = ProductionFinalStatus.ESCALATED
                self._finalize(
                    state,
                    review_reason=f"budget exhausted after still generation for scene beat {beat.beat_index}; stopped before video provider spend",
                )
                return state
            ok = self._generate_video_beat(
                state=state,
                production_input=beat_input,
                selected_still=selected_still,
                attempt_index=beat.beat_index,
                per_clip_budget_usd=min(per_beat_budget, remaining_after_director),
            )
            if not ok:
                state.total_spend_usd = self._total_spend(
                    director_spend_usd=director_spend,
                    state=state,
                )
                self._finalize_after_failed_video(state)
                return state

        self._generate_voiceover(state=state, production_input=production_input, selected_still=state.selected_still)
        state.audio_mix_plan = self._build_audio_mix_plan(state)
        self._apply_faceless_asset_plan(state)
        state.final_assembly = self.tools.assemble_final_video(
            run_id=state.run_id,
            clips=state.video_attempt_history,
            voice_asset=state.voice_asset,
        )
        self._apply_audio_mix(state)
        state.render_plan = self._build_render_plan(state)
        self._apply_render(state)
        state.visual_polish_plan = self._build_visual_polish(state)
        self._promote_polished_asset(state)
        state.post_pass_plan = self._build_post_pass(state)
        self._promote_captioned_asset(state)
        self._apply_output_qa(state)
        state.total_spend_usd = self._total_spend(
            director_spend_usd=director_spend,
            state=state,
        )
        review_reason = self._review_reason_after_output_qa(
            state,
            ready_reason=self._sequence_review_reason(state),
        )
        self._finalize(state, review_reason=review_reason)
        return state

    def _generate_video_beat(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
        selected_still,
        attempt_index: int,
        per_clip_budget_usd: float,
    ) -> bool:
        handoff = self._build_handoff(selected_still)
        if self._is_no_face_youtube_state(state):
            self._sanitize_handoff_for_faceless_narrative(handoff)
        state.image_to_video_handoff = handoff
        state.image_to_video_handoff_history.append(handoff)
        production_input = self._production_input_with_motion_notes(
            state=state,
            production_input=production_input,
            beat_index=attempt_index,
        )
        motion_plan = build_motion_prompt_plan(
            brief=production_input.brief,
            selected_still=selected_still,
            format_hint=(
                state.format_narrative_plan.format_type
                if state.format_narrative_plan is not None
                else None
            ),
        )
        motion_plan = apply_handoff_to_motion_plan(
            motion_plan=motion_plan,
            handoff=handoff,
        )
        plan_review = self.tools.review_motion_plan(
            production_input=production_input,
            motion_plan=motion_plan,
        )
        state.plan_review = plan_review
        if plan_review:
            state.plan_review_history.append(plan_review)
        if plan_review and plan_review.verdict == "escalate":
            state.final_status = ProductionFinalStatus.ESCALATED
            self._finalize(
                state,
                review_reason=f"plan reviewer escalated before provider spend: {plan_review.rationale}",
            )
            return False
        motion_plan = apply_plan_review(
            motion_plan=motion_plan,
            review=plan_review,
        )
        motion_plan = compact_motion_prompt_for_provider(motion_plan)
        state.motion_plan = motion_plan
        state.motion_plan_history.append(motion_plan)
        video_route = select_video_model_route(
            brief=production_input.brief,
            motion_prompt=motion_plan.motion_prompt,
            duration_s=motion_plan.duration_s,
            budget_cap_usd=per_clip_budget_usd,
            requested_quality=production_input.video_quality,
            mode="image_to_video",
            aspect_ratio=self._video_aspect_ratio(state),
            require_adapter_ready=True,
        )
        motion_plan = enrich_motion_prompt_for_video_tier(
            motion_plan,
            quality_tier=video_route.quality_tier,
        )
        motion_plan = compact_motion_prompt_for_provider(motion_plan)
        state.motion_plan = motion_plan
        state.motion_plan_history[-1] = motion_plan
        video_routes = self._video_route_attempts(video_route, duration_s=motion_plan.duration_s)
        last_error: Exception | None = None
        attempted_model_ids: list[str] = []
        for provider_attempt, active_route in enumerate(video_routes, start=1):
            attempted_model_ids.append(active_route.model_id)
            try:
                provider_prompt = compile_video_provider_prompt(
                    motion_plan=motion_plan,
                    model_id=active_route.model_id,
                    aspect_ratio=self._video_aspect_ratio(state),
                )
                clip = self.tools.run_video_generation(
                    still_path=handoff.selected_still_path,
                    motion_prompt=provider_prompt.prompt,
                    negative_prompt=provider_prompt.negative_prompt,
                    provider_prompt_profile=provider_prompt.profile,
                    attempt_index=attempt_index,
                    source_still_id=handoff.selected_still_id,
                    quality=active_route.quality_tier,
                    aspect_ratio=self._video_aspect_ratio(state),
                    budget_cap_usd=per_clip_budget_usd,
                    model_id_override=active_route.model_id,
                    model_route_reason=active_route.reason,
                )
                state.video_attempt_history.append(clip)
                return True
            except Exception as exc:
                last_error = exc
            state.final_status = ProductionFinalStatus.ESCALATED
            state.video_generation_error = (
                f"video generation failed on beat {attempt_index} after "
                f"{len(attempted_model_ids)} provider attempts "
                f"({', '.join(attempted_model_ids)}); "
                f"continuing to human review with partial assets: {last_error}"
            )
            return False
        return False

    @staticmethod
    def _video_route_attempts(video_route, *, duration_s: int):
        # Provider exceptions may happen after a paid job was submitted. Do not
        # automatically spend again on a second provider unless a future adapter
        # can prove the failure happened before submission.
        return (video_route,)

    @staticmethod
    def _fallback_video_route(video_route, *, duration_s: int):
        fallback_model_id = video_route.fallback_model_id
        if not fallback_model_id:
            return None
        for model in default_video_model_registry():
            if model.model_id != fallback_model_id:
                continue
            return replace(
                video_route,
                model_id=model.model_id,
                provider=model.provider,
                estimated_cost_usd=model.estimated_cost_per_second_usd * duration_s,
                estimated_cost_per_second_usd=model.estimated_cost_per_second_usd,
                reason=model.description,
                confidence=min(video_route.confidence, 0.68),
                quality_tier=model.quality_tier,
                mode=model.mode,
                adapter_ready=model.adapter_ready,
                fallback_model_id=None,
                warnings=video_route.warnings + (f"fallback route activated: {model.model_id}",),
            )
        return None

    def _should_stop_at_still(self, state: CreativeProductionState) -> bool:
        return (
            state.brief_input.brief.output_type == "image"
            or state.budget_cap_usd < self._minimum_motion_budget(state)
        )

    def _should_escalate_after_still(self, state: CreativeProductionState) -> bool:
        still = state.selected_still
        if still is None:
            return True
        return self._still_is_not_animatable(still)

    @staticmethod
    def _still_is_not_animatable(still) -> bool:
        if still.verdict == "human_review":
            return True
        return still.score < 3.0

    @staticmethod
    def _set_still_review_assembly(state: CreativeProductionState) -> None:
        if state.selected_still is None or state.selected_still.asset_path is None:
            return
        state.final_assembly = FinalAssemblyRecord(
            asset_path=state.selected_still.asset_path,
            clip_count=1,
            duration_s=None,
            assembly_method="still_review",
            source_clip_ids=(state.selected_still.candidate_id,),
            audio_asset_path=None,
        )

    def _finalize(self, state: CreativeProductionState, *, review_reason: str) -> None:
        review_path, approval_payload, summary = build_production_review_artifact(
            state=state,
            review_reason=review_reason,
        )
        state.human_review_packet = HumanProductionReviewPacket(
            summary=summary,
            review_path=review_path,
            approval_payload=approval_payload,
        )
        state.manifest_path = self._write_manifest(state)

    def _finalize_after_failed_video(self, state: CreativeProductionState) -> None:
        if state.human_review_packet is None:
            self._finalize(
                state,
                review_reason=state.video_generation_error or "production stopped before video completion",
            )
            return
        state.manifest_path = self._write_manifest(state)

    def _write_manifest(self, state: CreativeProductionState):
        if hasattr(self.tools, "write_production_manifest"):
            return self.tools.write_production_manifest(state)
        return write_production_manifest(state)

    def _still_only_review_reason(self, state: CreativeProductionState) -> str:
        if state.brief_input.brief.output_type == "image":
            return "scope is image-only; selected still is ready for review"
        if state.budget_cap_usd < MINIMUM_VIDEO_BUDGET_USD:
            return "budget corridor is too tight for motion; selected still is ready for review"
        if state.budget_cap_usd < self._minimum_motion_budget(state):
            return "budget corridor is too tight for the planned multi-shot sequence; selected still is ready for review"
        return "selected still is ready for review"

    def _sequence_review_reason(self, state: CreativeProductionState) -> str:
        format_type = state.format_narrative_plan.format_type if state.format_narrative_plan else ""
        return {
            "no_face_youtube": "faceless YouTube narrative package is ready for review",
            "lyric_video": "lyric video package is ready for review",
            "ugc_scripted_ad": "UGC scripted ad package is ready for review",
            "narrative_sequence": "narrative sequence package is ready for review",
        }.get(format_type, "multi-shot ad package is ready for review")

    def _build_handoff(self, selected_still):
        if hasattr(self.tools, "build_image_to_video_handoff"):
            return self.tools.build_image_to_video_handoff(selected_still)
        return build_image_to_video_handoff(selected_still)

    def _apply_llm_narrative_script_plan(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
    ) -> None:
        plan = state.format_narrative_plan
        if plan is None or plan.format_type != "no_face_youtube":
            return
        if not hasattr(self.tools, "plan_narrative_script"):
            return
        try:
            script_plan = self.tools.plan_narrative_script(
                brief=production_input.brief,
                fallback_plan=plan,
            )
        except Exception as exc:
            state.narrative_script_error = f"LLM narrative script planner failed; using fallback plan: {exc}"
            return
        if script_plan is not None:
            state.format_narrative_plan = replace(plan, script_plan=script_plan)

    def _apply_llm_sequence_treatment(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
    ) -> None:
        plan = state.format_narrative_plan
        if plan is None:
            return
        if plan.sequence_treatment is not None:
            return
        if not self._should_direct_sequence_treatment(state):
            return
        if not hasattr(self.tools, "direct_sequence_treatment"):
            return
        try:
            treatment = self.tools.direct_sequence_treatment(
                brief=production_input.brief,
                fallback_plan=plan,
            )
        except Exception as exc:
            state.sequence_treatment_error = f"LLM sequence treatment director failed; continuing without through-line: {exc}"
            return
        if treatment is not None:
            state.format_narrative_plan = merge_sequence_treatment(plan, treatment)

    @staticmethod
    def _should_direct_sequence_treatment(state: CreativeProductionState) -> bool:
        plan = state.format_narrative_plan
        if plan is None:
            return False
        if state.brief_input.brief.output_type != "full_production":
            return False
        return plan.production_mode in {"sequence_first", "audio_first"} and bool(plan.scene_beats)

    def _apply_llm_shotlist_director(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
    ) -> None:
        plan = state.format_narrative_plan
        if plan is None or not plan.scene_beats:
            return
        if not hasattr(self.tools, "direct_shotlist"):
            return
        try:
            directed_plan = self.tools.direct_shotlist(
                brief=production_input.brief,
                fallback_plan=plan,
            )
        except Exception as exc:
            state.shotlist_director_error = f"LLM shotlist director failed; using fallback shotlist: {exc}"
            return
        if directed_plan is not None:
            state.format_narrative_plan = directed_plan

    @staticmethod
    def _is_no_face_youtube_state(state: CreativeProductionState) -> bool:
        return bool(state.format_narrative_plan and state.format_narrative_plan.format_type == "no_face_youtube")

    @staticmethod
    def _sanitize_handoff_for_faceless_narrative(handoff) -> None:
        roles = dict(handoff.reference_asset_roles or {})
        roles.pop("product", None)
        roles["primary_reference_role"] = "scene"
        roles.setdefault("scene", [str(handoff.selected_still_path)])
        handoff.reference_asset_roles = roles
        handoff.primary_reference_role = "scene"
        handoff.preservation_rules = (
            "preserve the selected still as the exact opening frame",
            "preserve scene geography, spatial layout, lighting, palette, and atmosphere",
            "animate camera, environment, and requested reveal only; do not turn the scene into a product ad",
        )
        handoff.motion_context = "Primary reference role: scene. Source reference roles: scene:1."

    def _build_post_pass(self, state: CreativeProductionState):
        if hasattr(self.tools, "apply_post_pass"):
            return self.tools.apply_post_pass(state=state)
        return build_post_pass_plan(state=state)

    def _build_visual_polish(self, state: CreativeProductionState):
        if hasattr(self.tools, "apply_visual_polish"):
            return self.tools.apply_visual_polish(state=state)
        return None

    @staticmethod
    def _promote_polished_asset(state: CreativeProductionState) -> None:
        if (
            state.final_assembly is not None
            and state.visual_polish_plan is not None
            and state.visual_polish_plan.polished_asset_path is not None
            and state.visual_polish_plan.polished_asset_path != state.final_assembly.asset_path
        ):
            state.final_assembly.asset_path = state.visual_polish_plan.polished_asset_path

    def _build_render_plan(self, state: CreativeProductionState):
        if hasattr(self.tools, "plan_render"):
            return self.tools.plan_render(state=state)
        return build_render_plan(state=state)

    def _apply_render(self, state: CreativeProductionState) -> None:
        if hasattr(self.tools, "apply_render"):
            rendered = self.tools.apply_render(state=state)
            if rendered is not None:
                state.final_assembly = rendered

    def _build_audio_mix_plan(self, state: CreativeProductionState):
        if hasattr(self.tools, "plan_audio_mix"):
            return self.tools.plan_audio_mix(state=state)
        return build_audio_mix_plan(state=state)

    def _generate_voiceover(
        self,
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
        selected_still,
    ) -> None:
        state.voiceover_plan = build_voiceover_plan(
            brief=self._brief_with_narrative_script(state=state, production_input=production_input),
            selected_still=selected_still,
            target_duration_s=self._voiceover_target_duration_s(state),
        )
        try:
            state.voice_asset = self.tools.generate_voiceover(
                run_id=state.run_id,
                voiceover_plan=state.voiceover_plan,
            )
        except Exception as exc:
            state.voice_asset = None
            state.voiceover_error = f"voiceover generation failed; continuing without VO: {exc}"

    def _apply_audio_mix(self, state: CreativeProductionState) -> None:
        if hasattr(self.tools, "apply_audio_mix"):
            mixed = self.tools.apply_audio_mix(state=state)
            if mixed is not None:
                state.final_assembly = mixed

    @staticmethod
    def _apply_faceless_asset_plan(state: CreativeProductionState) -> None:
        plan = state.format_narrative_plan
        script_plan = plan.script_plan if plan else None
        if plan is None or plan.format_type != "no_face_youtube" or script_plan is None:
            return
        state.faceless_asset_intents = build_faceless_asset_intents(script_plan)

    def _apply_output_qa(self, state: CreativeProductionState) -> None:
        if state.final_assembly is None:
            return
        if hasattr(self.tools, "validate_output"):
            state.output_qa_report = self.tools.validate_output(state=state)
            return
        state.output_qa_report = validate_final_output(
            final_assembly=state.final_assembly,
            format_plan=state.format_narrative_plan,
            post_pass_plan=state.post_pass_plan,
            expectations=self._output_qa_expectations(state),
        )

    @staticmethod
    def _output_qa_expectations(state: CreativeProductionState):
        if state.ugc_presenter_clip is not None and state.final_assembly is not None:
            return build_output_qa_expectation(
                format_plan=state.format_narrative_plan,
                expected_clip_count=state.final_assembly.clip_count,
                require_audio=True,
            )
        return None

    @staticmethod
    def _review_reason_after_output_qa(state: CreativeProductionState, *, ready_reason: str) -> str:
        qa_report = state.output_qa_report
        findings = tuple(getattr(qa_report, "findings", ()) or ())
        hard_errors = tuple(finding for finding in findings if getattr(finding, "severity", "") == "error")
        if not hard_errors:
            state.final_status = ProductionFinalStatus.REVIEW_READY
            return ready_reason
        state.final_status = ProductionFinalStatus.ESCALATED
        codes = ", ".join(str(getattr(finding, "code", "output_qa_error")) for finding in hard_errors)
        return f"hard output QA failed; escalate before approval: {codes}"

    @staticmethod
    def _promote_captioned_asset(state: CreativeProductionState) -> None:
        if (
            state.final_assembly is not None
            and state.post_pass_plan is not None
        ):
            promoted = (
                state.post_pass_plan.normalized_asset_path
                or state.post_pass_plan.rendered_asset_path
                or state.post_pass_plan.final_asset_path
            )
            if promoted is not None:
                state.final_assembly.asset_path = promoted

    def _should_run_multi_shot(self, state: CreativeProductionState) -> bool:
        return (
            state.format_narrative_plan is not None
            and state.format_narrative_plan.production_mode in {"sequence_first", "audio_first"}
            and bool(state.format_narrative_plan.scene_beats)
            and state.brief_input.brief.output_type == "full_production"
            and state.budget_cap_usd >= self._minimum_motion_budget(state)
        )

    @staticmethod
    def _should_escalate_carousel_scope(*, state: CreativeProductionState) -> bool:
        return state.brief_input.brief.output_type == "carousel"

    def _should_run_ugc_presenter_lane(self, *, state: CreativeProductionState) -> bool:
        plan = state.format_narrative_plan
        if plan is None or plan.format_type != "ugc_scripted_ad" or plan.ugc_strategy is None:
            return False
        if not self._ugc_needs_presenter_provider(state):
            return False
        generate = getattr(self.tools, "generate_ugc_presenter", None)
        if generate is None:
            return False
        if hasattr(self.tools, "ugc_presenter_adapter"):
            return getattr(self.tools, "ugc_presenter_adapter", None) is not None
        return callable(generate)

    @staticmethod
    def _should_escalate_unsupported_ugc(*, state: CreativeProductionState) -> bool:
        plan = state.format_narrative_plan
        if plan is None or plan.format_type != "ugc_scripted_ad":
            return False
        if plan.ugc_strategy is not None and CreativeProductionGraph._ugc_needs_presenter_provider(state):
            return True
        return CreativeProductionGraph._ugc_text_needs_presenter_provider(state)

    @staticmethod
    def _ugc_needs_presenter_provider(state: CreativeProductionState) -> bool:
        plan = state.format_narrative_plan
        if plan is None or plan.format_type != "ugc_scripted_ad":
            return False
        if plan.ugc_strategy is not None and plan.ugc_strategy.unsupported_requests:
            return True
        return CreativeProductionGraph._ugc_text_needs_presenter_provider(state)

    @staticmethod
    def _ugc_text_needs_presenter_provider(state: CreativeProductionState) -> bool:
        text = " ".join(
            part
            for part in (
                state.brief_input.brief.product_description,
                state.brief_input.brief.campaign_goal,
                state.brief_input.brief.aesthetic_notes,
                state.brief_input.brief.voiceover_script or "",
            )
            if part
        ).lower()
        unsupported_terms = (
            "talking head",
            "talking-head",
            "lip sync",
            "lipsync",
            "lip-sync",
            "avatar",
            "heygen",
            "presenter",
            "on-camera",
            "creator speaks on camera",
            "creator talking on camera",
            "creator on camera",
            "creator on-camera",
            "creator speaking",
            "creator talking",
            "selfie testimonial",
            "presenter talking to camera",
            "on-camera creator",
            "on camera creator",
        )
        return any(term in text for term in unsupported_terms)

    @staticmethod
    def _ugc_render_mode_plan(state: CreativeProductionState) -> UgcRenderModePlan:
        strategy = state.format_narrative_plan.ugc_strategy if state.format_narrative_plan else None
        mode = strategy.preferred_render_mode if strategy else "avatar_pip_overlay"
        if mode not in {"avatar_fullscreen", "avatar_pip_overlay"}:
            mode = "avatar_pip_overlay"
        return UgcRenderModePlan(mode=mode)

    @staticmethod
    def _ugc_presenter_script(state: CreativeProductionState) -> str:
        brief = state.brief_input.brief
        strategy = state.format_narrative_plan.ugc_strategy if state.format_narrative_plan else None
        return build_ugc_presenter_script(brief=brief, strategy=strategy)

    @staticmethod
    def _minimum_motion_budget(state: CreativeProductionState) -> float:
        if (
            state.format_narrative_plan is not None
            and state.format_narrative_plan.production_mode in {"sequence_first", "audio_first"}
            and state.format_narrative_plan.scene_beats
        ):
            return round(MINIMUM_VIDEO_BUDGET_USD * len(state.format_narrative_plan.scene_beats), 2)
        return MINIMUM_VIDEO_BUDGET_USD

    @staticmethod
    def _video_aspect_ratio(state: CreativeProductionState) -> str:
        if state.format_narrative_plan is not None:
            aspect_ratio = state.format_narrative_plan.platform_profile.aspect_ratio.strip()
            if aspect_ratio:
                return aspect_ratio
        platform = state.brief_input.brief.platform.strip().lower()
        if platform in {"tiktok", "reels", "instagram_reel", "instagram_story"}:
            return "9:16"
        if platform in {"youtube", "youtube_shorts"}:
            return "16:9" if platform == "youtube" else "9:16"
        return "1:1"

    @staticmethod
    def _production_input_for_beat(*, state: CreativeProductionState, production_input, beat, per_beat_budget_usd: float):
        brief = production_input.brief
        scene_script = CreativeProductionGraph._scene_script_for_beat(state=state, beat_index=beat.beat_index)
        script_context = ""
        if scene_script is not None:
            scene_visual_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_prompt")
            visual_a_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_a_prompt")
            visual_b_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_b_prompt")
            retention_reason = (
                CreativeProductionGraph._scene_text(scene_script, "retention_reason")
                or CreativeProductionGraph._scene_text(scene_script, "retention_note")
            )
            script_parts = [
                f"Story title: {state.format_narrative_plan.script_plan.title}.",
                f"Curiosity gap: {state.format_narrative_plan.script_plan.curiosity_gap}.",
                f"Scene narration: {CreativeProductionGraph._scene_text(scene_script, 'narration')}.",
                f"Scene visual prompt: {scene_visual_prompt}." if scene_visual_prompt else "",
                f"Visual A idea: {visual_a_prompt}." if visual_a_prompt else "",
                f"Visual B idea: {visual_b_prompt}." if visual_b_prompt else "",
                f"Caption phrase: {CreativeProductionGraph._scene_text(scene_script, 'caption_text')}.",
                f"Retention reason: {retention_reason}." if retention_reason else "",
            ]
            script_context = " ".join(part for part in script_parts if part)
        beat_goal = (
            f"{brief.campaign_goal}. Scene beat {beat.beat_index}: {beat.beat_role}. "
            f"Intent: {beat.intent}. Viewer emotion: {beat.viewer_emotion}. "
            f"Visual goal: {beat.visual_goal}. Visual premise: {beat.visual_premise}. "
            f"Image focus: {beat.image_prompt_focus}. "
            f"{CreativeProductionGraph._shot_directive_goal_notes(beat)} {script_context}".strip()
        )
        beat_notes = " ".join(
            part
            for part in (
                brief.aesthetic_notes,
                render_sequence_treatment_prose(
                    state.format_narrative_plan.sequence_treatment
                    if state.format_narrative_plan
                    else None
                ),
                CreativeProductionGraph._scene_prompt_notes(scene_script) if scene_script else "",
                f"Motion intent: {CreativeProductionGraph._beat_motion_note(beat=beat, scene_script=scene_script)}.",
                CreativeProductionGraph._shot_directive_image_prompt_notes(beat),
            )
            if part
        )
        return replace(
            production_input,
            brief=replace(
                brief,
                campaign_goal=beat_goal,
                aesthetic_notes=beat_notes,
                max_cost_usd=per_beat_budget_usd,
                output_type="image",
                variant_count=1,
            ),
            budget_cap_usd=per_beat_budget_usd,
            max_attempts=1,
        )

    @staticmethod
    def _production_input_with_motion_notes(
        *,
        state: CreativeProductionState,
        production_input: CreativeProductionInput,
        beat_index: int,
    ) -> CreativeProductionInput:
        beat = CreativeProductionGraph._scene_beat_for_index(state=state, beat_index=beat_index)
        if beat is None:
            return production_input
        motion_notes = CreativeProductionGraph._shot_directive_motion_prompt_notes(beat)
        if not motion_notes:
            return production_input
        scene_script = CreativeProductionGraph._scene_script_for_beat(state=state, beat_index=beat_index)
        base_motion = CreativeProductionGraph._beat_motion_note(beat=beat, scene_script=scene_script)
        motion_clause = base_motion if scene_script is not None else "; ".join(part for part in (base_motion, motion_notes) if part)
        existing_notes = production_input.brief.aesthetic_notes.strip()
        next_notes = " ".join(part for part in (f"Motion intent: {motion_clause}.", existing_notes) if part)
        return replace(
            production_input,
            brief=replace(
                production_input.brief,
                aesthetic_notes=next_notes,
            ),
        )

    @staticmethod
    def _scene_beat_for_index(*, state: CreativeProductionState, beat_index: int):
        plan = state.format_narrative_plan
        if plan is None:
            return None
        return next((beat for beat in plan.scene_beats if beat.beat_index == beat_index), None)

    @staticmethod
    def _beat_motion_note(*, beat, scene_script) -> str:
        if scene_script is not None:
            return CreativeProductionGraph._scene_text(scene_script, "motion_direction")
        directive = getattr(beat, "shot_directive", None)
        if directive is not None and directive.visual_action:
            return directive.visual_action
        return beat.motion_intent

    @staticmethod
    def _shot_directive_goal_notes(beat) -> str:
        directive = getattr(beat, "shot_directive", None)
        if directive is None:
            return ""
        return " ".join(
            part
            for part in (
                f"Shot purpose: {directive.purpose}." if directive.purpose else "",
                f"Framing: {directive.framing}." if directive.framing else "",
                f"Continuity anchor: {directive.continuity_anchor}." if directive.continuity_anchor else "",
            )
            if part
        )

    @staticmethod
    def _shot_directive_image_prompt_notes(beat) -> str:
        directive = getattr(beat, "shot_directive", None)
        if directive is None:
            return ""
        return " ".join(
            part
            for part in (
                f"Shot action: {directive.visual_action}." if directive.visual_action else "",
                f"Caption role: {directive.caption_role}." if directive.caption_role else "",
                CreativeProductionGraph._shot_grammar_image_note(directive),
            )
            if part
        )

    @staticmethod
    def _shot_directive_motion_prompt_notes(beat) -> str:
        directive = getattr(beat, "shot_directive", None)
        if directive is None:
            return ""
        return " ".join(
            part
            for part in (
                f"shot purpose: {directive.purpose}" if directive.purpose else "",
                f"shot action: {directive.visual_action}" if directive.visual_action else "",
                f"framing: {directive.framing}" if directive.framing else "",
                f"continuity anchor: {directive.continuity_anchor}" if directive.continuity_anchor else "",
                CreativeProductionGraph._shot_grammar_motion_note(directive),
            )
            if part
        ).replace(". ", "; ")

    @staticmethod
    def _shot_grammar_image_note(directive) -> str:
        grammar = getattr(directive, "shot_grammar", None)
        return render_shot_grammar_image_prose(grammar)

    @staticmethod
    def _shot_grammar_motion_note(directive) -> str:
        grammar = getattr(directive, "shot_grammar", None)
        return render_shot_grammar_motion_prose(grammar)

    @staticmethod
    def _scene_prompt_notes(scene_script) -> str:
        visual_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_prompt")
        visual_a_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_a_prompt")
        visual_b_prompt = CreativeProductionGraph._scene_text(scene_script, "visual_b_prompt")
        stock_terms = CreativeProductionGraph._scene_terms(scene_script, "stock_search_terms")
        retention_reason = (
            CreativeProductionGraph._scene_text(scene_script, "retention_reason")
            or CreativeProductionGraph._scene_text(scene_script, "retention_note")
        )
        audio_emphasis = CreativeProductionGraph._scene_text(scene_script, "audio_emphasis")
        parts = [
            f"Story scene direction: {visual_prompt}." if visual_prompt else "",
            f"Visual A idea: {visual_a_prompt}." if visual_a_prompt else "",
            f"Visual B idea: {visual_b_prompt}." if visual_b_prompt else "",
            f"Stock search terms: {', '.join(stock_terms)}." if stock_terms else "",
            f"Retention reason: {retention_reason}." if retention_reason else "",
            f"Audio emphasis: {audio_emphasis}." if audio_emphasis else "",
        ]
        return " ".join(part for part in parts if part)

    @staticmethod
    def _scene_text(scene_script, field_name: str) -> str:
        return " ".join(str(getattr(scene_script, field_name, "") or "").split()).strip()

    @staticmethod
    def _scene_terms(scene_script, field_name: str) -> tuple[str, ...]:
        value = getattr(scene_script, field_name, ()) or ()
        if isinstance(value, str):
            terms = [part.strip() for part in value.split(",")]
        else:
            terms = [str(part).strip() for part in value]
        return tuple(part for part in terms if part)

    @staticmethod
    def _scene_script_for_beat(*, state: CreativeProductionState, beat_index: int):
        script_plan = state.format_narrative_plan.script_plan if state.format_narrative_plan else None
        if script_plan is None:
            return None
        for scene in script_plan.scenes:
            if scene.beat_index == beat_index:
                return scene
        return None

    @staticmethod
    def _brief_with_narrative_script(*, state: CreativeProductionState, production_input: CreativeProductionInput):
        brief = production_input.brief
        script_plan = state.format_narrative_plan.script_plan if state.format_narrative_plan else None
        if script_plan is None or not script_plan.narration_script.strip():
            return brief
        return replace(
            brief,
            voiceover_script=script_plan.narration_script,
            aesthetic_notes=" ".join(
                part
                for part in (
                    brief.aesthetic_notes,
                    f"Narrative pacing: {script_plan.pacing_notes}",
                    f"Music mood: {script_plan.music_mood}",
                )
                if part
            ),
        )

    @staticmethod
    def _voiceover_target_duration_s(state: CreativeProductionState) -> float | int | None:
        clip_duration = sum(
            float(clip.duration_s or 0.0)
            for clip in state.video_attempt_history
            if clip.duration_s is not None
        )
        if clip_duration > 0:
            return round(clip_duration, 3)
        if state.final_assembly and state.final_assembly.duration_s:
            return state.final_assembly.duration_s
        if state.format_narrative_plan:
            return state.format_narrative_plan.duration_target_s
        return None

    @staticmethod
    def _total_spend(*, director_spend_usd: float, state: CreativeProductionState) -> float:
        return round(
            float(director_spend_usd or 0.0)
            + sum(float(item.cost_usd or 0.0) for item in state.video_attempt_history)
            + float(getattr(state.ugc_presenter_clip, "cost_usd", 0.0) if state.ugc_presenter_clip else 0.0)
            + float(getattr(state.voice_asset, "cost_usd", 0.0) if state.voice_asset else 0.0),
            6,
        )

    @staticmethod
    def _remaining_budget(*, state: CreativeProductionState, director_spend_usd: float) -> float:
        return max(
            0.0,
            round(state.budget_cap_usd - CreativeProductionGraph._total_spend(
                director_spend_usd=director_spend_usd,
                state=state,
            ), 6),
        )
