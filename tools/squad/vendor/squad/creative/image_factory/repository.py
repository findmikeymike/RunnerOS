"""Persistence helpers for Sprint 1 image-factory runs."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from creative.image_factory.contracts import (
    ImageFactoryRequest,
    ImageFactoryState,
    ImageGenerationPlan,
    ImageVariant,
    PreparedProductAsset,
)
from creative.image_factory.billing import CreativeBillingSummary, CreativeCostEvent
from creative.image_factory.evals import ImageEvalRecord, ImageRunDecision
from memory.store import ArtifactRecord, MemoryStore, RunRecord


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


@dataclass(frozen=True, slots=True)
class ManifestWriteResult:
    run_id: str
    manifest_path: Path
    artifact_count: int
    stage_counts: dict[str, int]


class ImageFactoryRepository:
    """Wraps a MemoryStore with image-factory-specific persistence helpers."""

    workflow_name = "image_factory"

    def __init__(self, *, store: MemoryStore, output_root: Path) -> None:
        self.store = store
        self.output_root = Path(output_root)
        self.output_root.mkdir(parents=True, exist_ok=True)

    def start_run(
        self,
        request: ImageFactoryRequest,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> RunRecord:
        return self.store.start_run(
            workflow=self.workflow_name,
            input_payload=_jsonable(request),
            metadata=dict(metadata or {}),
        )

    def persist_plan(self, run_id: str, plan: ImageGenerationPlan) -> ArtifactRecord:
        return self._persist(run_id, stage="plan", payload=plan)

    def persist_asset(self, run_id: str, asset: PreparedProductAsset) -> ArtifactRecord:
        return self._persist(run_id, stage="asset", payload=asset)

    def persist_variant(self, run_id: str, variant: ImageVariant) -> ArtifactRecord:
        return self._persist(run_id, stage="variant", payload=variant)

    def persist_billing_event(self, run_id: str, event: CreativeCostEvent) -> ArtifactRecord:
        return self._persist(run_id, stage="billing_event", payload=event)

    def persist_billing_summary(self, run_id: str, summary: CreativeBillingSummary) -> ArtifactRecord:
        return self._persist(run_id, stage="billing_summary", payload=summary)

    def persist_eval(self, run_id: str, evaluation: ImageEvalRecord) -> ArtifactRecord:
        return self._persist(run_id, stage="evaluation", payload=evaluation)

    def persist_decision(self, run_id: str, decision: ImageRunDecision) -> ArtifactRecord:
        return self._persist(run_id, stage="decision", payload=decision)

    def complete_run(self, run_id: str, *, status: str) -> None:
        self.store.complete_run(run_id, status=status)

    def write_manifest(
        self,
        run_id: str,
        *,
        state: ImageFactoryState | None = None,
        status: str = "completed",
        trace_url: str | None = None,
        warnings: list[str] | tuple[str, ...] | None = None,
        billing_summary: CreativeBillingSummary | None = None,
        billing_events: list[CreativeCostEvent] | tuple[CreativeCostEvent, ...] | None = None,
    ) -> ManifestWriteResult:
        artifacts = self.store.list_artifacts(run_id)
        stage_counts: dict[str, int] = {}
        for artifact in artifacts:
            stage_counts[artifact.stage] = stage_counts.get(artifact.stage, 0) + 1

        manifest = {
            "run_id": run_id,
            "status": status,
            "generated_at": _utc_now(),
            "artifact_count": len(artifacts),
            "stage_counts": stage_counts,
            "artifacts": [self._artifact_payload(artifact) for artifact in artifacts],
            "state": _jsonable(state or {}),
            "trace_url": trace_url,
            "warnings": list(warnings or ()),
            "billing_summary": _jsonable(billing_summary) if billing_summary else None,
            "billing_events": _jsonable(billing_events or ()),
        }

        run_dir = self.output_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

        return ManifestWriteResult(
            run_id=run_id,
            manifest_path=manifest_path,
            artifact_count=len(artifacts),
            stage_counts=stage_counts,
        )

    def _persist(self, run_id: str, *, stage: str, payload: Any) -> ArtifactRecord:
        return self.store.save_artifact(run_id, stage=stage, payload=_jsonable(payload))

    @staticmethod
    def _artifact_payload(artifact: ArtifactRecord) -> dict[str, Any]:
        return {
            "run_id": artifact.run_id,
            "stage": artifact.stage,
            "payload": _jsonable(artifact.payload),
            "created_at": artifact.created_at,
        }
