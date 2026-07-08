from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from creative.production.contracts import CreativeProductionState, ProductionFinalStatus
from creative.production.recipe_registry import recommend_recipe, recipe_recommendation_to_payload


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def write_production_manifest(
    state: CreativeProductionState,
    *,
    output_root: Path | str = ".outputs/creative-production",
) -> Path:
    root = Path(output_root)
    run_dir = root / state.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "manifest.json"
    integrity_findings = _manifest_integrity_findings(state)
    if integrity_findings and state.final_status == ProductionFinalStatus.REVIEW_READY:
        messages = "; ".join(finding["message"] for finding in integrity_findings)
        raise RuntimeError(f"refusing to write review-ready manifest with invalid final artifact: {messages}")

    manifest = {
        "run_id": state.run_id,
        "generated_at": _utc_now(),
        "final_status": state.final_status.value,
        "brief": _jsonable(state.brief_input.brief),
        "recommended_recipe": recipe_recommendation_to_payload(recommend_recipe(state.brief_input.brief)),
        "creative_goal": state.creative_goal,
        "budget_cap_usd": state.budget_cap_usd,
        "total_spend_usd": state.total_spend_usd,
        "remaining_budget_usd": round(max(0.0, state.budget_cap_usd - state.total_spend_usd), 6),
        "max_attempts": state.max_attempts,
        "format_narrative_plan": _jsonable(state.format_narrative_plan),
        "selected_still": _jsonable(state.selected_still),
        "selected_still_history": _jsonable(state.selected_still_history),
        "image_to_video_handoff": _jsonable(state.image_to_video_handoff),
        "image_to_video_handoff_history": _jsonable(state.image_to_video_handoff_history),
        "motion_plan": _jsonable(state.motion_plan),
        "motion_plan_history": _jsonable(state.motion_plan_history),
        "plan_review": _jsonable(state.plan_review),
        "plan_review_history": _jsonable(state.plan_review_history),
        "shotlist_director_error": state.shotlist_director_error,
        "sequence_treatment_error": state.sequence_treatment_error,
        "narrative_script_error": state.narrative_script_error,
        "capability_warning": state.capability_warning,
        "faceless_asset_intents": _jsonable(state.faceless_asset_intents),
        "ugc_render_mode_plan": _jsonable(state.ugc_render_mode_plan),
        "ugc_presenter_clip": _jsonable(state.ugc_presenter_clip),
        "ugc_base_assembly": _jsonable(state.ugc_base_assembly),
        "voiceover_plan": _jsonable(state.voiceover_plan),
        "voice_asset": _jsonable(state.voice_asset),
        "voiceover_error": state.voiceover_error,
        "audio_mix_plan": _jsonable(state.audio_mix_plan),
        "video_attempt_history": _jsonable(state.video_attempt_history),
        "video_generation_error": state.video_generation_error,
        "final_assembly": _jsonable(state.final_assembly),
        "post_pass_plan": _jsonable(state.post_pass_plan),
        "output_qa_report": _jsonable(state.output_qa_report),
        "manifest_integrity_findings": integrity_findings,
        "human_review_packet": _jsonable(state.human_review_packet),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest_path


def _manifest_integrity_findings(state: CreativeProductionState) -> list[dict[str, str]]:
    if state.final_assembly is None:
        if state.final_status == ProductionFinalStatus.REVIEW_READY:
            return [
                {
                    "severity": "error",
                    "code": "final_assembly_missing",
                    "message": "review-ready production has no final assembly",
                }
            ]
        return []
    path = state.final_assembly.asset_path
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
