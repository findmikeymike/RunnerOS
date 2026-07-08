from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


ReferenceAssetSourceKind = Literal["local_path", "url", "data_uri", "asset_id", "run_artifact_id"]
ReferenceAssetRole = Literal["product", "face", "style", "scene", "logo", "unknown"]

ALLOWED_SOURCE_KINDS = {"local_path", "url", "data_uri", "asset_id", "run_artifact_id"}
ALLOWED_REFERENCE_ROLES = {"product", "face", "style", "scene", "logo", "unknown"}


@dataclass(frozen=True, slots=True)
class ReferenceAssetInput:
    source_kind: ReferenceAssetSourceKind
    value: str
    declared_role: ReferenceAssetRole = "unknown"
    label: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.source_kind not in ALLOWED_SOURCE_KINDS:
            raise ValueError(f"source_kind must be one of: {', '.join(sorted(ALLOWED_SOURCE_KINDS))}")
        if not str(self.value).strip():
            raise ValueError("value must not be empty")
        if self.declared_role not in ALLOWED_REFERENCE_ROLES:
            raise ValueError(f"declared_role must be one of: {', '.join(sorted(ALLOWED_REFERENCE_ROLES))}")


@dataclass(frozen=True, slots=True)
class ResolvedReferenceAsset:
    asset_id: str
    source_kind: ReferenceAssetSourceKind
    value: str
    local_path: Path
    mime_type: str
    width: int
    height: int
    sha256: str
    declared_role: ReferenceAssetRole = "unknown"
    inferred_role: ReferenceAssetRole = "unknown"
    confidence: float = 0.0
    provider_url: str | None = None
    provenance: str = ""
    label: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ReferenceAssetSelection:
    primary_product: ResolvedReferenceAsset
    face_references: tuple[ResolvedReferenceAsset, ...] = ()
    style_references: tuple[ResolvedReferenceAsset, ...] = ()
    scene_references: tuple[ResolvedReferenceAsset, ...] = ()
    logo_references: tuple[ResolvedReferenceAsset, ...] = ()
    ordered_generation_paths: tuple[Path, ...] = ()
