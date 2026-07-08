from __future__ import annotations

import base64
import mimetypes
import re
import shutil
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import replace
from hashlib import sha256
from pathlib import Path

from creative.image_factory.assets import detect_image_dimensions, validate_image_path
from creative.reference_assets.contracts import ReferenceAssetInput, ResolvedReferenceAsset


AssetLookup = Callable[[str], ReferenceAssetInput]


class ReferenceAssetResolver:
    """Normalize caller-specific reference handles into local typed assets."""

    def __init__(
        self,
        *,
        storage_root: Path | str = ".outputs/reference-assets",
        asset_lookup: AssetLookup | None = None,
        run_artifact_lookup: AssetLookup | None = None,
        timeout_sec: int = 30,
    ) -> None:
        self.storage_root = Path(storage_root)
        self.asset_lookup = asset_lookup
        self.run_artifact_lookup = run_artifact_lookup
        self.timeout_sec = timeout_sec

    def resolve_many(
        self,
        inputs: list[ReferenceAssetInput] | tuple[ReferenceAssetInput, ...],
        *,
        run_id: str,
    ) -> tuple[ResolvedReferenceAsset, ...]:
        return tuple(self.resolve(item, run_id=run_id, index=index) for index, item in enumerate(inputs, start=1))

    def resolve(self, item: ReferenceAssetInput, *, run_id: str, index: int = 1) -> ResolvedReferenceAsset:
        if item.source_kind == "asset_id":
            return self._resolve_indirect(
                item=item,
                run_id=run_id,
                index=index,
                lookup=self.asset_lookup,
                lookup_label="asset_lookup",
            )
        if item.source_kind == "run_artifact_id":
            return self._resolve_indirect(
                item=item,
                run_id=run_id,
                index=index,
                lookup=self.run_artifact_lookup,
                lookup_label="run_artifact_lookup",
            )
        if item.source_kind == "local_path":
            source_path = validate_image_path(Path(item.value), label="reference image")
            staged_path = self._stage_existing_file(source_path, run_id=run_id, index=index)
            return self._build_resolved(item=item, local_path=staged_path, provenance="local_path")
        if item.source_kind == "data_uri":
            staged_path, mime_type = self._stage_data_uri(item.value, run_id=run_id, index=index)
            return self._build_resolved(item=item, local_path=staged_path, provenance="data_uri", mime_type=mime_type)
        if item.source_kind == "url":
            staged_path = self._download_url(item.value, run_id=run_id, index=index)
            return self._build_resolved(
                item=item,
                local_path=staged_path,
                provenance="url",
                provider_url=item.value,
            )
        raise ValueError(f"unsupported source_kind: {item.source_kind}")

    def _resolve_indirect(
        self,
        *,
        item: ReferenceAssetInput,
        run_id: str,
        index: int,
        lookup: AssetLookup | None,
        lookup_label: str,
    ) -> ResolvedReferenceAsset:
        if lookup is None:
            raise ValueError(f"{lookup_label} is required to resolve {item.source_kind}")
        target = lookup(item.value)
        merged = ReferenceAssetInput(
            source_kind=target.source_kind,
            value=target.value,
            declared_role=target.declared_role if target.declared_role != "unknown" else item.declared_role,
            label=target.label or item.label,
            metadata={**item.metadata, **target.metadata},
        )
        resolved = self.resolve(merged, run_id=run_id, index=index)
        return replace(
            resolved,
            source_kind=item.source_kind,
            value=item.value,
            declared_role=merged.declared_role,
            label=merged.label,
            metadata=merged.metadata,
            provenance=f"{item.source_kind}:{resolved.provenance}",
        )

    def _stage_existing_file(self, source_path: Path, *, run_id: str, index: int) -> Path:
        destination = self._run_dir(run_id) / source_path.name
        if destination.exists():
            destination = self._run_dir(run_id) / f"{index:02d}-{source_path.name}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)
        return destination

    def _stage_data_uri(self, value: str, *, run_id: str, index: int) -> tuple[Path, str]:
        match = re.match(r"^data:(?P<mime>[-\w.]+/[-\w.+]+);base64,(?P<data>.+)$", value, flags=re.DOTALL)
        if not match:
            raise ValueError("data_uri reference must be a base64 data URI")
        mime_type = match.group("mime")
        extension = mimetypes.guess_extension(mime_type) or ".bin"
        raw = base64.b64decode(match.group("data"), validate=True)
        digest = sha256(raw).hexdigest()[:12]
        destination = self._run_dir(run_id) / f"{index:02d}-{digest}{extension}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        detect_image_dimensions(destination)
        return destination, mime_type

    def _download_url(self, value: str, *, run_id: str, index: int) -> Path:
        parsed_name = Path(urllib.parse.urlparse(value).path).name or f"reference-{index}.img"
        destination = self._run_dir(run_id) / parsed_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=value, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            destination.write_bytes(response.read())
        detect_image_dimensions(destination)
        return destination

    def _build_resolved(
        self,
        *,
        item: ReferenceAssetInput,
        local_path: Path,
        provenance: str,
        mime_type: str | None = None,
        provider_url: str | None = None,
    ) -> ResolvedReferenceAsset:
        width, height = detect_image_dimensions(local_path)
        raw = local_path.read_bytes()
        digest = sha256(raw).hexdigest()
        identity_digest = sha256(f"{item.source_kind}:{item.value}:{local_path}".encode("utf-8")).hexdigest()
        return ResolvedReferenceAsset(
            asset_id=f"ref-{identity_digest[:16]}",
            source_kind=item.source_kind,
            value=item.value,
            local_path=local_path,
            provider_url=provider_url,
            mime_type=mime_type or mimetypes.guess_type(local_path.name)[0] or "application/octet-stream",
            width=width,
            height=height,
            sha256=digest,
            declared_role=item.declared_role,
            inferred_role=item.declared_role,
            confidence=1.0 if item.declared_role != "unknown" else 0.0,
            provenance=provenance,
            label=item.label,
            metadata=dict(item.metadata),
        )

    def _run_dir(self, run_id: str) -> Path:
        safe_run_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", run_id).strip("-") or "run"
        return self.storage_root / safe_run_id
