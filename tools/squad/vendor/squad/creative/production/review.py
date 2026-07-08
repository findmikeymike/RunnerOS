from __future__ import annotations

from pathlib import Path
from typing import Any

from creative.production.contracts import CreativeProductionState


def build_production_review_artifact(
    *,
    state: CreativeProductionState,
    review_reason: str,
    output_root: Path | str = ".outputs/creative-production",
) -> tuple[Path, dict[str, Any], str]:
    review_path = Path(output_root) / state.run_id / "review.md"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(_render_markdown(state=state, review_reason=review_reason), encoding="utf-8")

    approval_payload = {
        "reason": review_reason,
        "production_run_id": state.run_id,
        "production_review_path": str(review_path),
        "final_status": state.final_status.value,
        "selected_still_id": state.selected_still.candidate_id if state.selected_still else None,
        "video_attempt_count": len(state.video_attempt_history),
        "video_attempts": [
            {
                "clip_id": clip.clip_id,
                "asset_path": str(clip.asset_path) if clip.asset_path else None,
                "model_id": clip.model_id,
                "cost_usd": clip.cost_usd,
                "provider_request_id": clip.provider_request_id,
            }
            for clip in state.video_attempt_history
        ],
        "video_generation_error": state.video_generation_error,
        "plan_review_verdict": state.plan_review.verdict if state.plan_review else None,
        "voice_asset_path": str(state.voice_asset.asset_path) if state.voice_asset else None,
        "voiceover_error": state.voiceover_error,
        "final_asset_path": str(state.final_assembly.asset_path) if state.final_assembly else None,
        "final_assembly_method": state.final_assembly.assembly_method if state.final_assembly else None,
        "continuity_pack": _continuity_pack_payload(state),
        "faceless_asset_intent_count": len(state.faceless_asset_intents),
        "output_qa_passed": state.output_qa_report.passed if state.output_qa_report else None,
        "output_qa_findings": [
            {
                "severity": finding.severity,
                "code": finding.code,
                "message": finding.message,
            }
            for finding in (state.output_qa_report.findings if state.output_qa_report else ())
        ],
        "budget_cap_usd": state.budget_cap_usd,
        "total_spend_usd": state.total_spend_usd,
        "remaining_budget_usd": round(max(0.0, state.budget_cap_usd - state.total_spend_usd), 6),
    }
    summary = (
        f"{review_reason}. "
        f"Still: {state.selected_still.candidate_id if state.selected_still else 'none'}. "
        f"Clips: {len(state.video_attempt_history)}."
    )
    return review_path, approval_payload, summary


def _continuity_pack_payload(state: CreativeProductionState) -> dict[str, Any] | None:
    if state.image_to_video_handoff is None or state.image_to_video_handoff.continuity_pack is None:
        return None
    pack = state.image_to_video_handoff.continuity_pack
    return {
        "source": pack.source,
        "primary_role": pack.primary_role,
        "primary_path": str(pack.primary_path) if pack.primary_path else None,
        "item_count": len(pack.items),
        "items": [
            {
                "role": item.role,
                "path": str(item.path),
                "label": item.label,
                "instruction": item.instruction,
                "asset_id": item.asset_id,
            }
            for item in pack.items
        ],
        "warnings": list(pack.warnings),
    }


def _render_markdown(*, state: CreativeProductionState, review_reason: str) -> str:
    brief = state.brief_input.brief
    lines = [
        "# Creative Production Review",
        "",
        f"- Production run: `{state.run_id}`",
        f"- Final status: `{state.final_status.value}`",
        f"- Review reason: {review_reason}",
        f"- Spend: `${state.total_spend_usd:.2f}` / `${state.budget_cap_usd:.2f}`",
        "",
        "## Brief",
        f"- Product: {brief.product_description}",
        f"- Goal: {brief.campaign_goal}",
        f"- Platform: `{brief.platform}`",
        f"- Output type: `{brief.output_type}`",
    ]
    if state.capability_warning:
        lines.extend(
            [
                "",
                "## Production Capability Warning",
                f"- {state.capability_warning}",
            ]
        )
    if state.selected_still:
        lines.extend(
            [
                "",
                "## Selected Still",
                f"- Candidate: `{state.selected_still.candidate_id}`",
                f"- Style family: `{state.selected_still.style_family}`",
                f"- Template: `{state.selected_still.template_id}`",
                f"- Score: `{state.selected_still.score:.2f}`",
                f"- Asset path: `{state.selected_still.asset_path}`",
            ]
        )
    if state.format_narrative_plan:
        plan = state.format_narrative_plan
        lines.extend(
            [
                "",
                "## Format & Narrative Plan",
                f"- Format: `{plan.format_type}`",
                f"- Production mode: `{plan.production_mode}`",
                f"- Intent: `{plan.primary_intent}` ({', '.join(plan.intent)})",
                f"- Emotional arc: {plan.emotional_arc}",
                f"- Audio mode: `{plan.audio_mode}`",
                f"- Caption strategy: `{plan.caption_strategy}`",
                f"- Platform profile: `{plan.platform_profile.platform}` `{plan.platform_profile.aspect_ratio}`",
                f"- Scene beats: `{len(plan.scene_beats)}`",
            ]
            )
        if state.narrative_script_error:
            lines.extend(
                [
                    "",
                    "## Narrative Script Planner Fallback",
                    f"- {state.narrative_script_error}",
                ]
            )
        if plan.creative_treatment:
            treatment = plan.creative_treatment
            lines.extend(
                [
                    "",
                    "## Creative Treatment",
                    f"- Concept: {treatment.concept}",
                    f"- Aesthetic lane: `{treatment.aesthetic_lane}`",
                    f"- Visual language: {treatment.visual_language}",
                    f"- Pacing: {treatment.pacing}",
                    f"- Negative constraints: {', '.join(treatment.negative_constraints)}",
                    f"- Source: `{treatment.source}`",
                ]
            )
        if plan.ugc_strategy:
            strategy = plan.ugc_strategy
            lines.extend(
                [
                    "",
                    "## UGC Strategy",
                    f"- Creator persona: {strategy.creator_persona}",
                    f"- Hook pattern: {strategy.hook_pattern}",
                    f"- Proof mechanism: {strategy.proof_mechanism}",
                    f"- Objection to answer: {strategy.objection_to_answer}",
                    f"- Provider strategy: `{strategy.provider_strategy}`",
                    f"- Preferred render mode: `{strategy.preferred_render_mode}`",
                ]
            )
        if state.ugc_presenter_clip:
            presenter = state.ugc_presenter_clip
            lines.extend(
                [
                    "",
                    "## UGC Presenter Asset",
                    f"- Provider: `{presenter.provider}`",
                    f"- Render mode: `{presenter.render_mode}`",
                    f"- Asset path: `{presenter.asset_path}`",
                    f"- Provider request id: `{presenter.provider_request_id}`",
                    f"- Cost: `${presenter.cost_usd:.4f}`",
                ]
            )
        if state.ugc_base_assembly:
            lines.extend(
                [
                    "",
                    "## UGC Base B-Roll",
                    f"- Asset path: `{state.ugc_base_assembly.asset_path}`",
                    f"- Assembly method: `{state.ugc_base_assembly.assembly_method}`",
                ]
            )
        if plan.scene_beats:
            lines.extend(["", "## Sequence Plan"])
            for beat in plan.scene_beats:
                lines.extend(
                    [
                        f"### Beat {beat.beat_index}: `{beat.beat_role}`",
                        f"- Duration: `{beat.duration_s}s`",
                        f"- Intent/emotion: `{beat.intent}` / `{beat.viewer_emotion}`",
                        f"- Visual premise: {beat.visual_premise}",
                        f"- Image focus: {beat.image_prompt_focus}",
                        f"- Motion intent: {beat.motion_intent}",
                        f"- Voiceover goal: {beat.voiceover_goal}",
                        f"- Caption goal: {beat.caption_goal}",
                        f"- Music/SFX goal: {beat.music_sfx_goal}",
                        f"- Reference strategy: {beat.reference_strategy}",
                    ]
                )
        if plan.script_plan:
            script_plan = plan.script_plan
            lines.extend(
                [
                    "",
                    "## Narrative Script Plan",
                    f"- Title: {script_plan.title}",
                    f"- Topic: {script_plan.topic}",
                    f"- Thesis: {script_plan.thesis}",
                    f"- Curiosity gap: {script_plan.curiosity_gap}",
                    f"- Music mood: {script_plan.music_mood}",
                    f"- Pacing notes: {script_plan.pacing_notes}",
                    f"- Source: `{script_plan.source}`",
                ]
            )
            for scene in script_plan.scenes:
                scene_lines = [
                    f"### Script Beat {scene.beat_index}: `{scene.beat_role}`",
                    f"- Hook question: {scene.hook_question}",
                    f"- Narration: {scene.narration}",
                    f"- Visual prompt: {scene.visual_prompt}",
                    f"- Motion direction: {scene.motion_direction}",
                    f"- Caption text: {scene.caption_text}",
                    f"- Retention note: {scene.retention_note}",
                ]
                if scene.visual_a_prompt:
                    scene_lines.append(f"- Visual A: {scene.visual_a_prompt}")
                if scene.visual_b_prompt:
                    scene_lines.append(f"- Visual B: {scene.visual_b_prompt}")
                if scene.stock_search_terms:
                    scene_lines.append(f"- Stock search terms: {', '.join(scene.stock_search_terms)}")
                if scene.retention_reason:
                    scene_lines.append(f"- Retention reason: {scene.retention_reason}")
                if scene.scene_duration_s:
                    scene_lines.append(f"- Scene duration: `{scene.scene_duration_s}s`")
                if scene.audio_emphasis:
                    scene_lines.append(f"- Audio emphasis: {scene.audio_emphasis}")
                lines.extend(scene_lines)
        if state.faceless_asset_intents:
            lines.extend(["", "## Faceless Asset Intent Plan"])
            for intent in state.faceless_asset_intents:
                lines.extend(
                    [
                        f"### Scene {intent.scene_index} Visual {intent.visual_slot}",
                        f"- Strategy: `{intent.strategy}`",
                        f"- Prompt: {intent.prompt}",
                        f"- Search terms: {', '.join(intent.search_terms)}",
                        f"- Provenance requirement: {intent.provenance_requirement}",
                        f"- Rationale: {intent.rationale}",
                    ]
                )
    if state.video_attempt_history:
        lines.extend(["", "## Video Attempts"])
        for clip in state.video_attempt_history:
            lines.extend(
                [
                    f"### Clip `{clip.clip_id}`",
                    f"- Source still: `{clip.source_still_id}`",
                    f"- Duration: `{clip.duration_s}`",
                    f"- Model: `{clip.model_id}`",
                    f"- Cost: `${clip.cost_usd:.4f}`",
                    f"- Provider request: `{clip.provider_request_id}`",
                    f"- Verdict: `{clip.verdict}`",
                    f"- Score: `{clip.score}`",
                    f"- Asset path: `{clip.asset_path}`",
                    f"- Prompt summary: {clip.prompt_summary}",
                ]
            )
    if state.video_generation_error:
        lines.extend(
            [
                "",
                "## Video Generation Failure",
                f"- {state.video_generation_error}",
            ]
        )
    if state.voiceover_plan:
        lines.extend(
            [
                "",
                "## Voiceover Plan",
                f"- Enabled: `{state.voiceover_plan.enabled}`",
                f"- Template: `{state.voiceover_plan.template_id}`",
                f"- Direction: {state.voiceover_plan.voice_direction}",
                f"- Rationale: {state.voiceover_plan.rationale}",
                f"- Script: {state.voiceover_plan.script}",
            ]
        )
    if state.motion_plan and state.motion_plan.shot_plan:
        shot = state.motion_plan.shot_plan
        lines.extend(
            [
                "",
                "## Shot Plan",
                f"- Opening frame: {shot.opening_frame}",
                f"- Camera move: {shot.camera_move}",
                f"- Subject action: {shot.subject_action}",
                f"- Environment motion: {shot.environment_motion}",
                f"- Ending frame: {shot.ending_frame}",
                f"- Pacing: {shot.pacing}",
                f"- Preserve: {shot.preservation_constraints}",
                f"- Avoid: {shot.negative_constraints}",
            ]
        )
    if state.image_to_video_handoff:
        lines.extend(
            [
                "",
                "## Image-To-Video Handoff",
                f"- Selected still: `{state.image_to_video_handoff.selected_still_path}`",
                f"- Primary reference role: `{state.image_to_video_handoff.primary_reference_role}`",
                f"- Preservation rules: {'; '.join(state.image_to_video_handoff.preservation_rules)}",
                f"- Motion context: {state.image_to_video_handoff.motion_context}",
            ]
        )
        pack = state.image_to_video_handoff.continuity_pack
        if pack is not None:
            lines.extend(
                [
                    f"- Continuity pack: `{len(pack.items)}` item(s), primary `{pack.primary_role}`",
                    f"- Continuity primary path: `{pack.primary_path}`",
                ]
            )
            for item in pack.items:
                lines.append(f"  - `{item.role}` `{item.path}`: {item.instruction}")
            if pack.warnings:
                lines.append(f"- Continuity warnings: {'; '.join(pack.warnings)}")
    if state.plan_review:
        lines.extend(
            [
                "",
                "## Plan Review",
                f"- Verdict: `{state.plan_review.verdict}`",
                f"- Confidence: `{state.plan_review.confidence}`",
                f"- Rationale: {state.plan_review.rationale}",
            ]
        )
    if state.voice_asset:
        lines.extend(
            [
                "",
                "## Voice Asset",
                f"- Provider: `{state.voice_asset.provider}`",
                f"- Model: `{state.voice_asset.model_id}`",
                f"- Voice: `{state.voice_asset.voice_id}`",
                f"- MIME type: `{state.voice_asset.mime_type}`",
                f"- Processed characters: `{state.voice_asset.processed_characters}`",
                f"- Asset path: `{state.voice_asset.asset_path}`",
            ]
        )
    if state.voiceover_error:
        lines.extend(
            [
                "",
                "## Voiceover Failure",
                f"- {state.voiceover_error}",
            ]
        )
    if state.audio_mix_plan:
        mix = state.audio_mix_plan
        lines.extend(
            [
                "",
                "## Audio Mix Plan",
                f"- Audio mode: `{mix.audio_mode}`",
                f"- Music role: `{mix.music_role}`",
                f"- Selected track: `{mix.selected_music_track.title if mix.selected_music_track else None}`",
                f"- Voice ducking: `{mix.voice_ducking_enabled}`",
                f"- Music gain dB: `{mix.music_gain_db}`",
                f"- SFX gain dB: `{mix.sfx_gain_db}`",
                f"- Loudness target LUFS: `{mix.loudness_target_lufs}`",
                f"- Mix notes: {mix.mix_notes}",
                f"- Selection rationale: {mix.selection_rationale}",
            ]
        )
        if mix.track_query:
            query = mix.track_query
            lines.extend(
                [
                    f"- Query mood: `{', '.join(query.mood)}`",
                    f"- Query energy: `{query.energy}`",
                    f"- Query tempo: `{query.tempo_bpm_min}-{query.tempo_bpm_max}`",
                    f"- Query vocal policy: `{query.vocal_policy}`",
                    f"- Query license: `{query.license_required}`",
                ]
            )
        if mix.sfx_cues:
            lines.append("")
            lines.append("### SFX Cues")
            for cue in mix.sfx_cues:
                lines.append(
                    f"- `{cue.start_s:.2f}s-{cue.end_s:.2f}s` beat `{cue.beat_index}` `{cue.intensity}`: {cue.purpose} ({', '.join(cue.search_tags)})"
                )
    if state.render_plan:
        lines.extend(
            [
                "",
                "## Render Plan",
                f"- Renderer: `{state.render_plan.renderer}`",
                f"- Polish level: `{state.render_plan.polish_level}`",
                f"- Status: `{state.render_plan.render_status}`",
                f"- Fallback renderer: `{state.render_plan.fallback_renderer}`",
                f"- Required capabilities: `{', '.join(state.render_plan.required_capabilities)}`",
                f"- Reason: {state.render_plan.reason}",
            ]
        )
        if state.render_plan.warning:
            lines.append(f"- Warning: {state.render_plan.warning}")
    if state.post_pass_plan:
        lines.extend(
            [
                "",
                "## Post Pass",
                f"- Caption strategy: `{state.post_pass_plan.caption_strategy}`",
                f"- Captions enabled: `{state.post_pass_plan.captions_enabled}`",
                f"- SRT path: `{state.post_pass_plan.srt_path}`",
                f"- Captions JSON path: `{state.post_pass_plan.json_path}`",
                f"- Source asset path: `{state.post_pass_plan.source_asset_path}`",
                f"- Rendered captioned asset path: `{state.post_pass_plan.rendered_asset_path}`",
                f"- Render status: `{state.post_pass_plan.render_status}`",
                f"- Normalized asset path: `{state.post_pass_plan.normalized_asset_path}`",
                f"- Normalize status: `{state.post_pass_plan.normalize_status}`",
                f"- Final post-pass asset path: `{state.post_pass_plan.final_asset_path}`",
                f"- Burn-in recommended: `{state.post_pass_plan.burn_in_recommended}`",
                f"- Loudness target LUFS: `{state.post_pass_plan.loudness_target_lufs}`",
                f"- Platform notes: {state.post_pass_plan.platform_notes}",
            ]
        )
        if state.post_pass_plan.output_probe:
            probe = state.post_pass_plan.output_probe
            lines.extend(
                [
                    f"- Output probe: `{probe.video_stream_count}` video streams, `{probe.audio_stream_count}` audio streams, duration `{probe.duration_s}`s",
                    f"- Output dimensions: `{probe.width}x{probe.height}`, codecs video `{', '.join(probe.video_codecs)}`, audio `{', '.join(probe.audio_codecs)}`",
                ]
            )
        if state.post_pass_plan.output_validation_findings:
            lines.append("")
            lines.append("### Output Validation")
            for finding in state.post_pass_plan.output_validation_findings:
                lines.append(f"- `{finding.severity}`: {finding.message}")
        if state.post_pass_plan.caption_style:
            style = state.post_pass_plan.caption_style
            lines.extend(
                [
                    f"- Caption style: `{style.font}` `{style.font_size}px`, max `{style.max_lines}` lines x `{style.max_chars_per_line}` chars",
                    f"- Caption position: alignment `{style.alignment}`, vertical margin `{style.margin_v}`",
                ]
            )
        if state.post_pass_plan.validation_findings:
            lines.append("")
            lines.append("### Caption Validation")
            for finding in state.post_pass_plan.validation_findings:
                cue = "global" if finding.cue_index is None else f"cue {finding.cue_index}"
                lines.append(f"- `{finding.severity}` `{cue}`: {finding.message}")
        if state.post_pass_plan.caption_cues:
            lines.append("")
            lines.append("### Caption Cues")
            for cue in state.post_pass_plan.caption_cues:
                lines.append(
                    f"- `{cue.start_s:.2f}s-{cue.end_s:.2f}s` `{cue.beat_role}`: {cue.text}"
                )
    if state.output_qa_report:
        lines.extend(
            [
                "",
                "## Output QA Gate",
                f"- Passed: `{state.output_qa_report.passed}`",
            ]
        )
        if state.output_qa_report.findings:
            for finding in state.output_qa_report.findings:
                lines.append(f"- `{finding.severity}` `{finding.code}`: {finding.message}")
        else:
            lines.append("- No QA findings.")
    if state.final_assembly:
        lines.extend(
            [
                "",
                "## Final Assembly",
                f"- Asset path: `{state.final_assembly.asset_path}`",
                f"- Clip count: `{state.final_assembly.clip_count}`",
                f"- Duration: `{state.final_assembly.duration_s}`",
                f"- Method: `{state.final_assembly.assembly_method}`",
                f"- Audio asset path: `{state.final_assembly.audio_asset_path}`",
            ]
        )
    return "\n".join(lines) + "\n"
