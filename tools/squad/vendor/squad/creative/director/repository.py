from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from creative.director.contracts import CreativeDirectorState


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


def write_director_manifest(
    state: CreativeDirectorState,
    *,
    output_root: Path | str = ".outputs/creative-director",
) -> Path:
    root = Path(output_root)
    run_dir = root / state.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = run_dir / "manifest.json"

    manifest = {
        "run_id": state.run_id,
        "generated_at": _utc_now(),
        "final_status": state.final_status.value,
        "brief": _jsonable(state.brief_input.brief),
        "creative_goal": state.creative_goal,
        "budget_cap_usd": state.budget_cap_usd,
        "total_spend_usd": state.total_spend_usd,
        "remaining_budget_usd": round(max(0.0, state.budget_cap_usd - state.total_spend_usd), 6),
        "attempt_count": state.attempt_count,
        "max_attempts": state.max_attempts,
        "brief_analysis": _jsonable(state.brief_analysis),
        "current_direction": _jsonable(state.current_direction),
        "current_prompt_plan": _jsonable(state.current_prompt_plan),
        "best_candidate": _jsonable(state.best_candidate),
        "latest_result": _jsonable(state.latest_result),
        "latest_decision": _jsonable(state.latest_decision),
        "attempt_history": _jsonable(state.attempt_history),
        "review_required": state.review_required,
        "human_review_packet": _jsonable(state.human_review_packet),
        "linked_generation_run_ids": sorted(state.generation_history),
        "review_generation_run_id": _read_generation_field(state.review_generation, "run_id"),
        "latest_generation_run_id": _read_generation_field(state.latest_generation, "run_id"),
    }

    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest_path


def _read_generation_field(generation: object | None, field_name: str) -> Any:
    if generation is None:
        return None
    if isinstance(generation, dict):
        return generation.get(field_name)
    return getattr(generation, field_name, None)
