from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from content.agents.brief_analyzer import BriefAnalysis
from content.agents.prompt_composer import ComposedPrompt
from content.agents.template_selector import TemplateSelection
from content.writing.brief_generator import CreativeBrief
from creative.director.contracts import (
    AttemptRecord,
    CandidateRecord,
    CreativeDirectorDecision,
    CreativeDirectorInput,
    CreativeDirectorState,
    DirectionPlan,
    DirectorFinalStatus,
    DirectorReviewResult,
    HumanReviewPacket,
)
from creative.image_factory.contracts import ImageFactoryResult, ImageVariant
from creative.image_factory.evals import ImageEvalRecord, ImageRunDecision
from creative.production.contracts import (
    AudioAssetRecord,
    AudioMixPlan,
    CaptionCue,
    CaptionStyle,
    CaptionValidationFinding,
    CreativeTreatmentPlan,
    CreativeProductionInput,
    CreativeProductionState,
    FinalAssemblyRecord,
    FormatNarrativePlan,
    MusicTrackQuery,
    MusicTrackRecord,
    NarrativeSceneScript,
    NarrativeScriptPlan,
    OutputValidationFinding,
    PlatformProfile,
    PostPassOutputProbe,
    PostPassPlan,
    ProductionFinalStatus,
    RenderPlan,
    SceneBeat,
    SequenceTreatment,
    ShotDirective,
    ShotGrammar,
    UgcPresenterRecord,
    UgcRenderModePlan,
    UgcStrategyPlan,
    SfxCuePlan,
    VideoClipRecord,
    VoiceoverPlan,
)
from creative.production.output_qa import OutputQAExpectation, OutputQAFinding, OutputQAReport, validate_final_output
from creative.production.recipe_registry import recommend_recipe, recipe_recommendation_to_payload


DBOS_PRODUCTION_STEP_BOUNDARIES = (
    "analyze_and_select_still",
    "run_image_factory",
    "director_decision",
    "generate_video_beat",
    "generate_ugc_presenter",
    "compose_ugc_picture_in_picture",
    "generate_voiceover",
    "assemble_final_video",
    "apply_audio_mix",
    "apply_render",
    "apply_post_pass",
    "validate_output",
    "write_manifest",
)

TRUTHY = {"1", "true", "yes", "on"}
DBOS_APP_NAME = "squad-creative-production"


@dataclass(frozen=True, slots=True)
class DBOSReadiness:
    enabled: bool
    package_available: bool
    database_url_configured: bool
    ready: bool
    blockers: tuple[str, ...] = ()


def dbos_readiness_from_env(environ: Mapping[str, str] | None = None) -> DBOSReadiness:
    env = environ if environ is not None else os.environ
    enabled = str(env.get("SQUAD_DBOS_ENABLED", "")).strip().lower() in TRUTHY
    package_available = importlib.util.find_spec("dbos") is not None
    database_url_configured = bool(str(env.get("DBOS_SYSTEM_DATABASE_URL", "")).strip())
    blockers: list[str] = []
    if enabled and not package_available:
        blockers.append("dbos package is not installed")
    if enabled and not database_url_configured:
        blockers.append("DBOS_SYSTEM_DATABASE_URL is not configured")
    return DBOSReadiness(
        enabled=enabled,
        package_available=package_available,
        database_url_configured=database_url_configured,
        ready=enabled and package_available and database_url_configured,
        blockers=tuple(blockers),
    )


def require_dbos_ready(environ: Mapping[str, str] | None = None) -> DBOSReadiness:
    readiness = dbos_readiness_from_env(environ)
    if readiness.enabled and not readiness.ready:
        raise RuntimeError(f"DBOS production runner is not ready: {'; '.join(readiness.blockers)}")
    return readiness


def dbos_config_from_env(environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    env = environ if environ is not None else os.environ
    return {
        "name": env.get("SQUAD_DBOS_APP_NAME", DBOS_APP_NAME),
        "system_database_url": env.get("DBOS_SYSTEM_DATABASE_URL"),
    }


def durable_workflow_id(payload: Mapping[str, Any], explicit_workflow_id: str | None = None) -> str:
    if explicit_workflow_id:
        return explicit_workflow_id
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return f"creative-production-{hashlib.sha256(encoded).hexdigest()[:16]}"


class DurableVideoGenerationTools:
    def __init__(self, delegate: Any, run_video_generation_step: Any) -> None:
        self._delegate = delegate
        self._run_video_generation_step = run_video_generation_step

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    def run_video_generation(self, **kwargs: Any) -> VideoClipRecord:
        payload = _video_generation_kwargs_to_payload(kwargs)
        result = self._run_video_generation_step(payload)
        validate_video_clip_artifacts(result)
        return video_clip_record_from_payload(result)


class DurableCreativeProductionTools(DurableVideoGenerationTools):
    def __init__(self, delegate: Any, run_video_generation_step: Any, run_creative_director_step: Any) -> None:
        super().__init__(delegate, run_video_generation_step)
        self._run_creative_director_step = run_creative_director_step

    def run_creative_director(self, production_input: CreativeProductionInput) -> CreativeDirectorState:
        payload = creative_production_input_to_payload(production_input)
        result = self._run_creative_director_step(payload)
        return creative_director_state_from_payload(result)


class DurableProductionOutputTools(DurableVideoGenerationTools):
    def __init__(
        self,
        delegate: Any,
        run_video_generation_step: Any,
        generate_voiceover_step: Any,
        assemble_final_video_step: Any,
        validate_output_step: Any | None = None,
        write_manifest_step: Any | None = None,
        apply_post_pass_step: Any | None = None,
        apply_audio_mix_step: Any | None = None,
        apply_render_step: Any | None = None,
        generate_ugc_presenter_step: Any | None = None,
        compose_ugc_picture_in_picture_step: Any | None = None,
    ) -> None:
        super().__init__(delegate, run_video_generation_step)
        self._generate_voiceover_step = generate_voiceover_step
        self._assemble_final_video_step = assemble_final_video_step
        self._validate_output_step = validate_output_step
        self._write_manifest_step = write_manifest_step
        self._apply_post_pass_step = apply_post_pass_step
        self._apply_audio_mix_step = apply_audio_mix_step
        self._apply_render_step = apply_render_step
        self._generate_ugc_presenter_step = generate_ugc_presenter_step
        self._compose_ugc_picture_in_picture_step = compose_ugc_picture_in_picture_step

    def generate_voiceover(self, *, run_id: str, voiceover_plan: VoiceoverPlan) -> AudioAssetRecord | None:
        result = self._generate_voiceover_step(
            {
                "run_id": run_id,
                "voiceover_plan": voiceover_plan_to_payload(voiceover_plan),
            }
        )
        validate_audio_asset_artifacts(result)
        return audio_asset_record_from_payload(result) if result else None

    def assemble_final_video(
        self,
        *,
        run_id: str,
        clips: list[VideoClipRecord],
        voice_asset: AudioAssetRecord | None = None,
    ) -> FinalAssemblyRecord:
        result = self._assemble_final_video_step(
            {
                "run_id": run_id,
                "clips": [video_clip_record_to_payload(clip) for clip in clips],
                "voice_asset": audio_asset_record_to_payload(voice_asset) if voice_asset else None,
            }
        )
        validate_final_assembly_artifacts(result)
        return final_assembly_record_from_payload(result)

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
        if self._generate_ugc_presenter_step is None:
            return self._delegate.generate_ugc_presenter(
                run_id=run_id,
                script=script,
                render_mode=render_mode,
                aspect_ratio=aspect_ratio,
                budget_cap_usd=budget_cap_usd,
                ugc_strategy=ugc_strategy,
            )
        result = self._generate_ugc_presenter_step(
            {
                "run_id": run_id,
                "script": script,
                "render_mode": ugc_render_mode_plan_to_payload(render_mode),
                "aspect_ratio": aspect_ratio,
                "budget_cap_usd": budget_cap_usd,
                "ugc_strategy": ugc_strategy_to_payload(ugc_strategy) if ugc_strategy else None,
            }
        )
        validate_ugc_presenter_artifacts(result)
        return ugc_presenter_record_from_payload(result)

    def compose_ugc_picture_in_picture(
        self,
        *,
        run_id: str,
        base_video_path: Path,
        presenter_video_path: Path,
        render_mode: UgcRenderModePlan,
        presenter_duration_s: float | None = None,
    ) -> FinalAssemblyRecord:
        if self._compose_ugc_picture_in_picture_step is None:
            return self._delegate.compose_ugc_picture_in_picture(
                run_id=run_id,
                base_video_path=base_video_path,
                presenter_video_path=presenter_video_path,
                render_mode=render_mode,
                presenter_duration_s=presenter_duration_s,
            )
        result = self._compose_ugc_picture_in_picture_step(
            {
                "run_id": run_id,
                "base_video_path": str(base_video_path),
                "presenter_video_path": str(presenter_video_path),
                "render_mode": ugc_render_mode_plan_to_payload(render_mode),
                "presenter_duration_s": presenter_duration_s,
            }
        )
        validate_final_assembly_artifacts(result)
        return final_assembly_record_from_payload(result)

    def validate_output(self, *, state: CreativeProductionState) -> OutputQAReport | None:
        if self._validate_output_step is None:
            return self._delegate.validate_output(state=state)
        if state.final_assembly is None:
            return None
        result = self._validate_output_step(output_validation_input_to_payload(state))
        return output_qa_report_from_payload(result)

    def apply_post_pass(self, *, state: CreativeProductionState) -> PostPassPlan:
        if self._apply_post_pass_step is None:
            return self._delegate.apply_post_pass(state=state)
        result = self._apply_post_pass_step(post_pass_input_to_payload(state))
        validate_post_pass_artifacts(result)
        return post_pass_plan_from_payload(result)

    def apply_audio_mix(self, *, state: CreativeProductionState) -> FinalAssemblyRecord | None:
        if self._apply_audio_mix_step is None:
            return self._delegate.apply_audio_mix(state=state)
        result = self._apply_audio_mix_step(production_state_to_payload(state))
        state.audio_mix_plan = audio_mix_plan_from_payload(result.get("audio_mix_plan")) if result.get("audio_mix_plan") else None
        assembly_payload = result.get("final_assembly")
        validate_final_assembly_artifacts(assembly_payload)
        return final_assembly_record_from_payload(assembly_payload) if assembly_payload else None

    def apply_render(self, *, state: CreativeProductionState) -> FinalAssemblyRecord | None:
        if self._apply_render_step is None:
            return self._delegate.apply_render(state=state)
        result = self._apply_render_step(production_state_to_payload(state))
        state.render_plan = render_plan_from_payload(result.get("render_plan")) if result.get("render_plan") else None
        assembly_payload = result.get("final_assembly")
        validate_final_assembly_artifacts(assembly_payload)
        return final_assembly_record_from_payload(assembly_payload) if assembly_payload else None

    def write_production_manifest(self, state: CreativeProductionState) -> Path:
        if self._write_manifest_step is None:
            return self._delegate.write_production_manifest(state)
        return Path(str(self._write_manifest_step(production_state_to_payload(state))))


class DurableCreativeDirectorTools:
    def __init__(self, delegate: Any, run_image_factory_step: Any) -> None:
        self._delegate = delegate
        self._run_image_factory_step = run_image_factory_step

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    def run_image_factory(
        self,
        director_input: CreativeDirectorInput,
        selection: TemplateSelection,
        prompt_plan: ComposedPrompt,
        *,
        attempt_index: int,
    ) -> ImageFactoryResult:
        payload = image_factory_step_input_to_payload(
            director_input=director_input,
            selection=selection,
            prompt_plan=prompt_plan,
            attempt_index=attempt_index,
        )
        result = self._run_image_factory_step(payload)
        validate_image_factory_artifacts(result)
        return image_factory_result_from_payload(result)


class DurableDirectorDecisionModel:
    def __init__(self, delegate: Any, run_director_decision_step: Any) -> None:
        self._delegate = delegate
        self._run_director_decision_step = run_director_decision_step

    def __call__(
        self,
        state: CreativeDirectorState | None,
        system_prompt: str | None = None,
        user_prompt: str | None = None,
    ) -> CreativeDirectorDecision:
        if state is None:
            raw = self._delegate(state=state, system_prompt=system_prompt, user_prompt=user_prompt)
            return raw if isinstance(raw, CreativeDirectorDecision) else CreativeDirectorDecision(**dict(raw))
        payload = {
            "state": creative_director_state_to_payload(state),
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        }
        return _director_decision_from_payload(self._run_director_decision_step(payload))


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def creative_production_input_to_payload(production_input: CreativeProductionInput) -> dict[str, Any]:
    return {
        "brief": production_input.brief.to_dict(),
        "budget_cap_usd": production_input.budget_cap_usd,
        "max_attempts": production_input.max_attempts,
        "video_quality": production_input.video_quality,
        "run_id": production_input.run_id,
    }


def creative_production_input_from_payload(payload: Mapping[str, Any]) -> CreativeProductionInput:
    return CreativeProductionInput(
        brief=CreativeBrief(**dict(payload["brief"])),
        budget_cap_usd=payload.get("budget_cap_usd"),
        max_attempts=int(payload.get("max_attempts", 2)),
        video_quality=str(payload.get("video_quality", "budget")),
        run_id=str(payload["run_id"]),
    )


def production_state_to_payload(state: CreativeProductionState) -> dict[str, Any]:
    return _jsonable(state)


def write_production_manifest_from_payload(
    payload: Mapping[str, Any],
    *,
    output_root: Path | str = ".outputs/creative-production",
) -> Path:
    root = Path(output_root)
    run_id = str(payload["run_id"])
    run_dir = root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "manifest.json"
    budget_cap_usd = float(payload.get("budget_cap_usd") or 0.0)
    total_spend_usd = float(payload.get("total_spend_usd") or 0.0)
    brief_input = dict(payload.get("brief_input") or {})
    integrity_findings = _payload_manifest_integrity_findings(payload)
    if integrity_findings and payload.get("final_status") == ProductionFinalStatus.REVIEW_READY.value:
        messages = "; ".join(finding["message"] for finding in integrity_findings)
        raise RuntimeError(f"refusing to write review-ready manifest with invalid final artifact: {messages}")

    manifest = {
        "run_id": run_id,
        "generated_at": _utc_now(),
        "final_status": payload.get("final_status"),
        "brief": brief_input.get("brief"),
        "recommended_recipe": _recommended_recipe_payload_from_brief_payload(brief_input.get("brief")),
        "creative_goal": payload.get("creative_goal"),
        "budget_cap_usd": budget_cap_usd,
        "total_spend_usd": total_spend_usd,
        "remaining_budget_usd": round(max(0.0, budget_cap_usd - total_spend_usd), 6),
        "max_attempts": payload.get("max_attempts"),
        "format_narrative_plan": payload.get("format_narrative_plan"),
        "selected_still": payload.get("selected_still"),
        "selected_still_history": payload.get("selected_still_history"),
        "image_to_video_handoff": payload.get("image_to_video_handoff"),
        "image_to_video_handoff_history": payload.get("image_to_video_handoff_history"),
        "motion_plan": payload.get("motion_plan"),
        "motion_plan_history": payload.get("motion_plan_history"),
        "plan_review": payload.get("plan_review"),
        "plan_review_history": payload.get("plan_review_history"),
        "shotlist_director_error": payload.get("shotlist_director_error"),
        "sequence_treatment_error": payload.get("sequence_treatment_error"),
        "narrative_script_error": payload.get("narrative_script_error"),
        "capability_warning": payload.get("capability_warning"),
        "faceless_asset_intents": payload.get("faceless_asset_intents"),
        "voiceover_plan": payload.get("voiceover_plan"),
        "voice_asset": payload.get("voice_asset"),
        "voiceover_error": payload.get("voiceover_error"),
        "audio_mix_plan": payload.get("audio_mix_plan"),
        "video_attempt_history": payload.get("video_attempt_history"),
        "video_generation_error": payload.get("video_generation_error"),
        "final_assembly": payload.get("final_assembly"),
        "post_pass_plan": payload.get("post_pass_plan"),
        "output_qa_report": payload.get("output_qa_report"),
        "manifest_integrity_findings": integrity_findings,
        "human_review_packet": payload.get("human_review_packet"),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest_path


def _payload_manifest_integrity_findings(payload: Mapping[str, Any]) -> list[dict[str, str]]:
    final_status = payload.get("final_status")
    final_assembly = payload.get("final_assembly")
    if not isinstance(final_assembly, Mapping):
        if final_status == ProductionFinalStatus.REVIEW_READY.value:
            return [
                {
                    "severity": "error",
                    "code": "final_assembly_missing",
                    "message": "review-ready production has no final assembly",
                }
            ]
        return []
    raw_path = final_assembly.get("asset_path")
    if not raw_path:
        return [
            {
                "severity": "error",
                "code": "final_asset_missing",
                "message": "final assembly asset path is missing",
            }
        ]
    path = Path(str(raw_path))
    if not path.exists():
        return [
            {
                "severity": "error",
                "code": "final_asset_missing",
                "message": f"final assembly asset does not exist: {path}",
            }
        ]
    if path.stat().st_size <= 0:
        return [
            {
                "severity": "error",
                "code": "final_asset_empty",
                "message": f"final assembly asset is empty: {path}",
            }
        ]
    return []


def _recommended_recipe_payload_from_brief_payload(brief_payload: Any) -> dict[str, object] | None:
    if not isinstance(brief_payload, Mapping):
        return None
    try:
        brief = CreativeBrief(**dict(brief_payload))
    except Exception:
        return None
    return recipe_recommendation_to_payload(recommend_recipe(brief))


def creative_director_input_to_payload(director_input: CreativeDirectorInput) -> dict[str, Any]:
    return {
        "brief": director_input.brief.to_dict(),
        "budget_cap_usd": director_input.budget_cap_usd,
        "max_attempts": director_input.max_attempts,
        "run_id": director_input.run_id,
    }


def creative_director_input_from_payload(payload: Mapping[str, Any]) -> CreativeDirectorInput:
    return CreativeDirectorInput(
        brief=CreativeBrief(**dict(payload["brief"])),
        budget_cap_usd=payload.get("budget_cap_usd"),
        max_attempts=int(payload.get("max_attempts", 3)),
        run_id=str(payload["run_id"]),
    )


def image_factory_step_input_to_payload(
    *,
    director_input: CreativeDirectorInput,
    selection: TemplateSelection,
    prompt_plan: ComposedPrompt,
    attempt_index: int,
) -> dict[str, Any]:
    return {
        "director_input": creative_director_input_to_payload(director_input),
        "selection": _jsonable(selection),
        "prompt_plan": _jsonable(prompt_plan),
        "attempt_index": attempt_index,
    }


def image_factory_step_input_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "director_input": creative_director_input_from_payload(dict(payload["director_input"])),
        "selection": TemplateSelection(**dict(payload["selection"])),
        "prompt_plan": ComposedPrompt(**dict(payload["prompt_plan"])),
        "attempt_index": int(payload["attempt_index"]),
    }


def creative_director_decision_to_payload(decision: CreativeDirectorDecision) -> dict[str, Any]:
    return _jsonable(decision)


def creative_director_state_to_payload(state: CreativeDirectorState) -> dict[str, Any]:
    return _jsonable(
        {
            "run_id": state.run_id,
            "brief_raw": state.brief_raw,
            "brief_input": {
                "brief": state.brief_input.brief.to_dict(),
                "budget_cap_usd": state.brief_input.budget_cap_usd,
                "max_attempts": state.brief_input.max_attempts,
                "run_id": state.brief_input.run_id,
            },
            "creative_goal": state.creative_goal,
            "budget_cap_usd": state.budget_cap_usd,
            "attempt_count": state.attempt_count,
            "max_attempts": state.max_attempts,
            "attempt_history": state.attempt_history,
            "total_spend_usd": state.total_spend_usd,
            "brief_analysis": state.brief_analysis,
            "current_direction": state.current_direction,
            "current_prompt_plan": state.current_prompt_plan,
            "best_candidate": state.best_candidate,
            "latest_result": state.latest_result,
            "latest_decision": state.latest_decision,
            "latest_generation": state.latest_generation,
            "generation_history": state.generation_history,
            "review_generation": state.review_generation,
            "review_required": state.review_required,
            "final_status": state.final_status,
            "human_review_packet": state.human_review_packet,
            "director_manifest_path": state.director_manifest_path,
        }
    )


def creative_director_state_from_payload(payload: Mapping[str, Any]) -> CreativeDirectorState:
    brief_input_payload = dict(payload["brief_input"])
    state = CreativeDirectorState(
        run_id=str(payload["run_id"]),
        brief_raw=str(payload.get("brief_raw") or ""),
        brief_input=CreativeDirectorInput(
            brief=CreativeBrief(**dict(brief_input_payload["brief"])),
            budget_cap_usd=brief_input_payload.get("budget_cap_usd"),
            max_attempts=int(brief_input_payload.get("max_attempts", 3)),
            run_id=str(brief_input_payload.get("run_id") or payload["run_id"]),
        ),
        creative_goal=str(payload["creative_goal"]),
        budget_cap_usd=float(payload["budget_cap_usd"]),
        attempt_count=int(payload["attempt_count"]),
        max_attempts=int(payload["max_attempts"]),
        attempt_history=[_attempt_record_from_payload(item) for item in payload.get("attempt_history", [])],
        total_spend_usd=float(payload.get("total_spend_usd") or 0.0),
        brief_analysis=_brief_analysis_from_payload(payload.get("brief_analysis")),
        current_direction=_direction_plan_from_payload(payload.get("current_direction")),
        current_prompt_plan=_composed_prompt_from_payload(payload.get("current_prompt_plan")),
        best_candidate=_candidate_record_from_payload(payload.get("best_candidate")),
        latest_result=_director_review_result_from_payload(payload.get("latest_result")),
        latest_decision=_director_decision_from_payload(payload.get("latest_decision")),
        latest_generation=payload.get("latest_generation"),
        generation_history=dict(payload.get("generation_history") or {}),
        review_generation=payload.get("review_generation"),
        review_required=bool(payload.get("review_required", True)),
        final_status=DirectorFinalStatus(payload.get("final_status", DirectorFinalStatus.RUNNING)),
        human_review_packet=_human_review_packet_from_payload(payload.get("human_review_packet")),
        director_manifest_path=_path_or_none(payload.get("director_manifest_path")),
    )
    return state


def _path_or_none(value: Any) -> Path | None:
    return Path(str(value)) if value else None


def _require_existing_artifact(path: Any, *, label: str) -> None:
    if not path:
        return
    artifact_path = Path(str(path))
    if not artifact_path.exists():
        raise RuntimeError(f"DBOS cached {label} is missing: {artifact_path}")
    if artifact_path.is_file() and artifact_path.stat().st_size <= 0:
        raise RuntimeError(f"DBOS cached {label} is empty: {artifact_path}")


def validate_image_factory_artifacts(payload: Mapping[str, Any]) -> None:
    _require_existing_artifact(payload.get("manifest_path"), label="image factory manifest")
    for index, variant in enumerate(payload.get("variants") or (), start=1):
        _require_existing_artifact(dict(variant).get("local_path"), label=f"image variant {index}")
    _require_existing_artifact(payload.get("review_packet_path"), label="image factory review packet")


def validate_video_clip_artifacts(payload: Mapping[str, Any] | None) -> None:
    if payload is None:
        return
    _require_existing_artifact(payload.get("asset_path"), label="video clip")


def validate_audio_asset_artifacts(payload: Mapping[str, Any] | None) -> None:
    if payload is None:
        return
    _require_existing_artifact(payload.get("asset_path"), label="voiceover asset")


def validate_final_assembly_artifacts(payload: Mapping[str, Any] | None) -> None:
    if payload is None:
        return
    _require_existing_artifact(payload.get("asset_path"), label="final assembly")
    _require_existing_artifact(payload.get("audio_asset_path"), label="final assembly audio asset")


def validate_ugc_presenter_artifacts(payload: Mapping[str, Any] | None) -> None:
    if payload is None:
        return
    _require_existing_artifact(payload.get("asset_path"), label="UGC presenter clip")


def validate_post_pass_artifacts(payload: Mapping[str, Any] | None) -> None:
    if payload is None:
        return
    for key in (
        "srt_path",
        "json_path",
        "source_asset_path",
        "rendered_asset_path",
        "normalized_asset_path",
        "final_asset_path",
    ):
        _require_existing_artifact(payload.get(key), label=f"post pass {key}")


def voiceover_plan_to_payload(plan: VoiceoverPlan) -> dict[str, Any]:
    return _jsonable(plan)


def voiceover_plan_from_payload(payload: Mapping[str, Any]) -> VoiceoverPlan:
    return VoiceoverPlan(**dict(payload))


def audio_asset_record_to_payload(asset: AudioAssetRecord) -> dict[str, Any]:
    return _jsonable(asset)


def audio_asset_record_from_payload(payload: Mapping[str, Any]) -> AudioAssetRecord:
    data = dict(payload)
    data["asset_path"] = Path(str(data["asset_path"]))
    data["metadata"] = dict(data.get("metadata") or {})
    return AudioAssetRecord(**data)


def final_assembly_record_to_payload(assembly: FinalAssemblyRecord) -> dict[str, Any]:
    return _jsonable(assembly)


def final_assembly_record_from_payload(payload: Mapping[str, Any]) -> FinalAssemblyRecord:
    data = dict(payload)
    data["asset_path"] = Path(str(data["asset_path"]))
    data["audio_asset_path"] = _path_or_none(data.get("audio_asset_path"))
    data["source_clip_ids"] = tuple(data.get("source_clip_ids") or ())
    return FinalAssemblyRecord(**data)


def post_pass_input_to_payload(state: CreativeProductionState) -> dict[str, Any]:
    return production_state_to_payload(state)


def production_output_state_from_payload(payload: Mapping[str, Any]) -> CreativeProductionState:
    data = dict(payload)
    state = CreativeProductionState(
        run_id=str(data["run_id"]),
        brief_input=creative_production_input_from_payload(dict(data["brief_input"])),
        creative_goal=str(data.get("creative_goal") or ""),
        budget_cap_usd=float(data.get("budget_cap_usd") or 0.0),
        max_attempts=int(data.get("max_attempts") or 1),
        total_spend_usd=float(data.get("total_spend_usd") or 0.0),
        format_narrative_plan=format_narrative_plan_from_payload(data.get("format_narrative_plan")),
        ugc_render_mode_plan=ugc_render_mode_plan_from_payload(data.get("ugc_render_mode_plan")),
        ugc_presenter_clip=ugc_presenter_record_from_payload(data.get("ugc_presenter_clip"))
        if data.get("ugc_presenter_clip")
        else None,
        ugc_base_assembly=final_assembly_record_from_payload(dict(data["ugc_base_assembly"]))
        if data.get("ugc_base_assembly")
        else None,
        voiceover_plan=voiceover_plan_from_payload(dict(data["voiceover_plan"])) if data.get("voiceover_plan") else None,
        voice_asset=audio_asset_record_from_payload(dict(data["voice_asset"])) if data.get("voice_asset") else None,
        shotlist_director_error=data.get("shotlist_director_error"),
        sequence_treatment_error=data.get("sequence_treatment_error"),
        narrative_script_error=data.get("narrative_script_error"),
        audio_mix_plan=audio_mix_plan_from_payload(data.get("audio_mix_plan")),
        video_attempt_history=[
            video_clip_record_from_payload(item) for item in data.get("video_attempt_history", ())
        ],
        final_assembly=final_assembly_record_from_payload(dict(data["final_assembly"]))
        if data.get("final_assembly")
        else None,
        render_plan=render_plan_from_payload(data.get("render_plan")),
    )
    return state


def post_pass_state_from_payload(payload: Mapping[str, Any]) -> CreativeProductionState:
    return production_output_state_from_payload(payload)


def audio_mix_step_result_to_payload(*, state: CreativeProductionState, final_assembly: FinalAssemblyRecord | None) -> dict[str, Any]:
    return {
        "final_assembly": final_assembly_record_to_payload(final_assembly) if final_assembly else None,
        "audio_mix_plan": audio_mix_plan_to_payload(state.audio_mix_plan) if state.audio_mix_plan else None,
    }


def render_step_result_to_payload(*, state: CreativeProductionState, final_assembly: FinalAssemblyRecord | None) -> dict[str, Any]:
    return {
        "final_assembly": final_assembly_record_to_payload(final_assembly) if final_assembly else None,
        "render_plan": render_plan_to_payload(state.render_plan) if state.render_plan else None,
    }


def audio_mix_plan_to_payload(plan: AudioMixPlan) -> dict[str, Any]:
    return _jsonable(plan)


def audio_mix_plan_from_payload(payload: Mapping[str, Any] | None) -> AudioMixPlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["track_query"] = _music_track_query_from_payload(data.get("track_query"))
    data["selected_music_track"] = _music_track_record_from_payload(data.get("selected_music_track"))
    data["rejected_track_ids"] = tuple(data.get("rejected_track_ids") or ())
    data["sfx_cues"] = tuple(SfxCuePlan(**dict(item)) for item in data.get("sfx_cues", ()))
    return AudioMixPlan(**data)


def render_plan_to_payload(plan: RenderPlan) -> dict[str, Any]:
    return _jsonable(plan)


def render_plan_from_payload(payload: Mapping[str, Any] | None) -> RenderPlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["required_capabilities"] = tuple(data.get("required_capabilities") or ())
    return RenderPlan(**data)


def format_narrative_plan_from_payload(payload: Mapping[str, Any] | None) -> FormatNarrativePlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["intent"] = tuple(data.get("intent") or ())
    data["platform_profile"] = PlatformProfile(**dict(data["platform_profile"]))
    data["scene_beats"] = tuple(_scene_beat_from_payload(item) for item in data.get("scene_beats", ()))
    data["base_scene_beats"] = tuple(_scene_beat_from_payload(item) for item in data.get("base_scene_beats", ()))
    data["script_plan"] = _narrative_script_plan_from_payload(data.get("script_plan"))
    data["creative_treatment"] = _creative_treatment_from_payload(data.get("creative_treatment"))
    data["ugc_strategy"] = _ugc_strategy_from_payload(data.get("ugc_strategy"))
    data["sequence_treatment"] = _sequence_treatment_from_payload(data.get("sequence_treatment"))
    return FormatNarrativePlan(**data)


def _sequence_treatment_from_payload(payload: Any) -> SequenceTreatment | None:
    if not payload:
        return None
    return SequenceTreatment(**dict(payload))


def _scene_beat_from_payload(payload: Mapping[str, Any]) -> SceneBeat:
    data = dict(payload)
    shot_directive = data.get("shot_directive")
    data["shot_directive"] = _shot_directive_from_payload(shot_directive)
    return SceneBeat(**data)


def _shot_directive_from_payload(payload: Any) -> ShotDirective | None:
    if not payload:
        return None
    data = dict(payload)
    grammar = data.get("shot_grammar")
    data["shot_grammar"] = ShotGrammar(**dict(grammar)) if grammar else None
    return ShotDirective(**data)


def _narrative_script_plan_from_payload(payload: Mapping[str, Any] | None) -> NarrativeScriptPlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["scenes"] = tuple(_narrative_scene_script_from_payload(item) for item in data.get("scenes", ()))
    return NarrativeScriptPlan(**data)


def _narrative_scene_script_from_payload(payload: Mapping[str, Any]) -> NarrativeSceneScript:
    data = dict(payload)
    data["stock_search_terms"] = tuple(data.get("stock_search_terms") or ())
    return NarrativeSceneScript(**data)


def _creative_treatment_from_payload(payload: Mapping[str, Any] | None) -> CreativeTreatmentPlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["edit_rules"] = tuple(data.get("edit_rules") or ())
    data["scene_directives"] = tuple(data.get("scene_directives") or ())
    data["prompt_directives"] = tuple(data.get("prompt_directives") or ())
    data["negative_constraints"] = tuple(data.get("negative_constraints") or ())
    return CreativeTreatmentPlan(**data)


def _ugc_strategy_from_payload(payload: Mapping[str, Any] | None) -> UgcStrategyPlan | None:
    if payload is None:
        return None
    data = dict(payload)
    data["shot_archetypes"] = tuple(data.get("shot_archetypes") or ())
    data["script_rules"] = tuple(data.get("script_rules") or ())
    data["render_modes"] = tuple(data.get("render_modes") or ())
    data["unsupported_requests"] = tuple(data.get("unsupported_requests") or ())
    return UgcStrategyPlan(**data)


def ugc_strategy_to_payload(plan: UgcStrategyPlan) -> dict[str, Any]:
    return _jsonable(plan)


def ugc_render_mode_plan_from_payload(payload: Mapping[str, Any] | None) -> UgcRenderModePlan | None:
    if payload is None:
        return None
    return UgcRenderModePlan(**dict(payload))


def ugc_render_mode_plan_to_payload(plan: UgcRenderModePlan) -> dict[str, Any]:
    return _jsonable(plan)


def ugc_presenter_record_to_payload(record: UgcPresenterRecord) -> dict[str, Any]:
    return _jsonable(record)


def ugc_presenter_record_from_payload(payload: Mapping[str, Any]) -> UgcPresenterRecord:
    data = dict(payload)
    data["asset_path"] = Path(str(data["asset_path"]))
    data["metadata"] = dict(data.get("metadata") or {})
    return UgcPresenterRecord(**data)


def generate_ugc_presenter_input_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "run_id": str(payload["run_id"]),
        "script": str(payload["script"]),
        "render_mode": ugc_render_mode_plan_from_payload(dict(payload["render_mode"])),
        "aspect_ratio": str(payload["aspect_ratio"]),
        "budget_cap_usd": float(payload["budget_cap_usd"]),
        "ugc_strategy": _ugc_strategy_from_payload(payload.get("ugc_strategy")),
    }


def compose_ugc_picture_in_picture_input_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "run_id": str(payload["run_id"]),
        "base_video_path": Path(str(payload["base_video_path"])),
        "presenter_video_path": Path(str(payload["presenter_video_path"])),
        "render_mode": ugc_render_mode_plan_from_payload(dict(payload["render_mode"])),
        "presenter_duration_s": float(payload["presenter_duration_s"])
        if payload.get("presenter_duration_s") is not None
        else None,
    }


def _music_track_query_from_payload(payload: Mapping[str, Any] | None) -> MusicTrackQuery | None:
    if payload is None:
        return None
    data = dict(payload)
    data["mood"] = tuple(data.get("mood") or ())
    data["genre"] = tuple(data.get("genre") or ())
    data["instrumentation"] = tuple(data.get("instrumentation") or ())
    return MusicTrackQuery(**data)


def _music_track_record_from_payload(payload: Mapping[str, Any] | None) -> MusicTrackRecord | None:
    if payload is None:
        return None
    data = dict(payload)
    data["asset_path"] = _path_or_none(data.get("asset_path"))
    data["mood"] = tuple(data.get("mood") or ())
    data["genre"] = tuple(data.get("genre") or ())
    data["instrumentation"] = tuple(data.get("instrumentation") or ())
    data["metadata"] = dict(data.get("metadata") or {})
    return MusicTrackRecord(**data)


def post_pass_plan_to_payload(plan: PostPassPlan) -> dict[str, Any]:
    return _jsonable(plan)


def post_pass_plan_from_payload(payload: Mapping[str, Any]) -> PostPassPlan:
    data = dict(payload)
    data["caption_cues"] = tuple(_caption_cue_from_payload(item) for item in data.get("caption_cues", ()))
    data["caption_style"] = _caption_style_from_payload(data.get("caption_style"))
    data["validation_findings"] = tuple(
        CaptionValidationFinding(**dict(item)) for item in data.get("validation_findings", ())
    )
    data["srt_path"] = _path_or_none(data.get("srt_path"))
    data["json_path"] = _path_or_none(data.get("json_path"))
    data["source_asset_path"] = _path_or_none(data.get("source_asset_path"))
    data["rendered_asset_path"] = _path_or_none(data.get("rendered_asset_path"))
    data["normalized_asset_path"] = _path_or_none(data.get("normalized_asset_path"))
    data["final_asset_path"] = _path_or_none(data.get("final_asset_path"))
    data["output_probe"] = _post_pass_output_probe_from_payload(data.get("output_probe"))
    data["output_validation_findings"] = tuple(
        OutputValidationFinding(**dict(item)) for item in data.get("output_validation_findings", ())
    )
    return PostPassPlan(**data)


def _caption_cue_from_payload(payload: Mapping[str, Any]) -> CaptionCue:
    return CaptionCue(**dict(payload))


def _caption_style_from_payload(payload: Mapping[str, Any] | None) -> CaptionStyle | None:
    if payload is None:
        return None
    return CaptionStyle(**dict(payload))


def _post_pass_output_probe_from_payload(payload: Mapping[str, Any] | None) -> PostPassOutputProbe | None:
    if payload is None:
        return None
    data = dict(payload)
    data["asset_path"] = Path(str(data["asset_path"]))
    data["video_codecs"] = tuple(data.get("video_codecs") or ())
    data["audio_codecs"] = tuple(data.get("audio_codecs") or ())
    return PostPassOutputProbe(**data)


def output_validation_input_to_payload(state: CreativeProductionState) -> dict[str, Any]:
    return {
        "final_assembly": final_assembly_record_to_payload(state.final_assembly) if state.final_assembly else None,
        "format_plan": _jsonable(state.format_narrative_plan),
        "post_pass_plan": _jsonable(state.post_pass_plan),
    }


def validate_output_from_payload(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    final_assembly_payload = payload.get("final_assembly")
    if final_assembly_payload is None:
        return None
    report = validate_final_output(
        final_assembly=final_assembly_record_from_payload(dict(final_assembly_payload)),
        format_plan=_namespace_from_payload(payload.get("format_plan")),
        post_pass_plan=_namespace_from_payload(payload.get("post_pass_plan")),
    )
    return output_qa_report_to_payload(report)


def output_qa_report_to_payload(report: OutputQAReport) -> dict[str, Any]:
    return _jsonable(report)


def output_qa_report_from_payload(payload: Mapping[str, Any] | None) -> OutputQAReport | None:
    if payload is None:
        return None
    expectation_payload = dict(payload.get("expectations") or {})
    findings_payload = tuple(dict(item) for item in payload.get("findings", ()))
    return OutputQAReport(
        expectations=OutputQAExpectation(**expectation_payload),
        findings=tuple(OutputQAFinding(**item) for item in findings_payload),
    )


def _namespace_from_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _PayloadNamespace(**{str(key): _namespace_from_payload(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_namespace_from_payload(item) for item in value)
    return value


class _PayloadNamespace:
    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)


def _brief_analysis_from_payload(payload: Mapping[str, Any] | None) -> BriefAnalysis | None:
    if payload is None:
        return None
    return BriefAnalysis(**dict(payload))


def _composed_prompt_from_payload(payload: Mapping[str, Any] | None) -> ComposedPrompt | None:
    if payload is None:
        return None
    return ComposedPrompt(**dict(payload))


def _direction_plan_from_payload(payload: Mapping[str, Any] | None) -> DirectionPlan | None:
    if payload is None:
        return None
    return DirectionPlan(**dict(payload))


def _candidate_record_from_payload(payload: Mapping[str, Any] | None) -> CandidateRecord | None:
    if payload is None:
        return None
    data = dict(payload)
    data["asset_path"] = _path_or_none(data.get("asset_path"))
    data["warnings"] = tuple(data.get("warnings") or ())
    return CandidateRecord(**data)


def _director_review_result_from_payload(payload: Mapping[str, Any] | None) -> DirectorReviewResult | None:
    if payload is None:
        return None
    data = dict(payload)
    data["selected_candidate"] = _candidate_record_from_payload(data.get("selected_candidate"))
    data["warnings"] = tuple(data.get("warnings") or ())
    return DirectorReviewResult(**data)


def _director_decision_from_payload(payload: Mapping[str, Any] | None) -> CreativeDirectorDecision | None:
    if payload is None:
        return None
    return CreativeDirectorDecision(**dict(payload))


def _attempt_record_from_payload(payload: Mapping[str, Any]) -> AttemptRecord:
    return AttemptRecord(**dict(payload))


def _human_review_packet_from_payload(payload: Mapping[str, Any] | None) -> HumanReviewPacket | None:
    if payload is None:
        return None
    data = dict(payload)
    data["selected_candidate"] = _candidate_record_from_payload(data.get("selected_candidate"))
    data["review_path"] = _path_or_none(data.get("review_path"))
    data["warnings"] = tuple(data.get("warnings") or ())
    return HumanReviewPacket(**data)


def image_factory_result_to_payload(result: ImageFactoryResult) -> dict[str, Any]:
    return _jsonable(result)


def image_factory_result_from_payload(payload: Mapping[str, Any]) -> ImageFactoryResult:
    data = dict(payload)
    data["manifest_path"] = Path(str(data["manifest_path"]))
    data["variants"] = tuple(_image_variant_from_payload(item) for item in data.get("variants", ()))
    data["evaluations"] = tuple(_image_eval_record_from_payload(item) for item in data.get("evaluations", ()))
    data["decision"] = _image_run_decision_from_payload(data.get("decision"))
    data["warnings"] = tuple(data.get("warnings") or ())
    data["review_packet_path"] = _path_or_none(data.get("review_packet_path"))
    return ImageFactoryResult(**data)


def _image_variant_from_payload(payload: Mapping[str, Any]) -> ImageVariant:
    data = dict(payload)
    data["local_path"] = Path(str(data["local_path"]))
    return ImageVariant(**data)


def _image_eval_record_from_payload(payload: Mapping[str, Any]) -> ImageEvalRecord:
    return ImageEvalRecord(**dict(payload))


def _image_run_decision_from_payload(payload: Mapping[str, Any] | None) -> ImageRunDecision | None:
    if payload is None:
        return None
    return ImageRunDecision(**dict(payload))


def _video_generation_kwargs_to_payload(kwargs: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(kwargs)
    still_path = payload.get("still_path")
    if still_path is not None:
        payload["still_path"] = str(still_path)
    return payload


def video_generation_kwargs_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    kwargs = dict(payload)
    still_path = kwargs.get("still_path")
    if still_path:
        kwargs["still_path"] = Path(str(still_path))
    return kwargs


def video_clip_record_to_payload(clip: VideoClipRecord) -> dict[str, Any]:
    return {
        "clip_id": clip.clip_id,
        "source_still_id": clip.source_still_id,
        "asset_path": str(clip.asset_path) if clip.asset_path is not None else None,
        "duration_s": clip.duration_s,
        "score": clip.score,
        "verdict": clip.verdict,
        "prompt_summary": clip.prompt_summary,
        "attempt_index": clip.attempt_index,
        "cost_usd": clip.cost_usd,
        "model_id": clip.model_id,
        "model_route_reason": clip.model_route_reason,
        "provider_request_id": clip.provider_request_id,
    }


def video_clip_record_from_payload(payload: Mapping[str, Any]) -> VideoClipRecord:
    asset_path = payload.get("asset_path")
    return VideoClipRecord(
        clip_id=str(payload["clip_id"]),
        source_still_id=payload.get("source_still_id"),
        asset_path=Path(str(asset_path)) if asset_path else None,
        duration_s=float(payload["duration_s"]) if payload.get("duration_s") is not None else None,
        score=float(payload["score"]) if payload.get("score") is not None else None,
        verdict=str(payload["verdict"]),
        prompt_summary=str(payload["prompt_summary"]),
        attempt_index=int(payload["attempt_index"]),
        cost_usd=float(payload.get("cost_usd") or 0.0),
        model_id=payload.get("model_id"),
        model_route_reason=payload.get("model_route_reason"),
        provider_request_id=payload.get("provider_request_id"),
    )
