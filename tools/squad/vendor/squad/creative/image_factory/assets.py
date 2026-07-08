"""Asset preparation helpers for the Sprint 1 image factory."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import struct
import time
import urllib.request
from typing import Any, Protocol

from creative.image_factory.contracts import ImageFactoryRequest, PreparedProductAsset


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_GIF87A = b"GIF87a"
_GIF89A = b"GIF89a"
_JPEG_SOI = b"\xff\xd8"
_WEBP_RIFF = b"RIFF"
_WEBP_WEBP = b"WEBP"


@dataclass(frozen=True, slots=True)
class BackgroundRemovalResult:
    applied: bool
    provider_name: str
    output_path: Path
    provider_request_id: str | None = None
    latency_ms: float | None = None
    cost_usd: float = 0.0
    metadata: dict[str, Any] | None = None
    warning: str | None = None


class BackgroundRemovalProvider(Protocol):
    """Provider interface for background-removal backends."""

    provider_name: str
    cost_usd: float

    def remove_background(
        self,
        source_path: Path,
        destination_path: Path,
    ) -> BackgroundRemovalResult:
        """Prepare a background-removed output at ``destination_path``."""


class DeterministicCopyBackgroundRemovalProvider:
    """Offline-safe fallback that stages files without claiming removal."""

    provider_name = "deterministic-copy"
    cost_usd = 0.0

    def remove_background(
        self,
        source_path: Path,
        destination_path: Path,
    ) -> BackgroundRemovalResult:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
        return BackgroundRemovalResult(
            applied=False,
            provider_name=self.provider_name,
            output_path=destination_path,
            warning="background removal unavailable; staged source asset instead",
        )


@dataclass(frozen=True, slots=True)
class FalBackgroundRemovalProvider:
    api_key: str
    model_id: str = "fal-ai/imageutils/rembg"
    timeout_sec: int = 120
    cost_usd: float = 0.0
    provider_name: str = "fal-rembg"

    def _load_sdk(self):
        os.environ["FAL_KEY"] = self.api_key
        try:
            import fal_client
        except ImportError as exc:  # pragma: no cover - dependency issue
            raise RuntimeError("fal-client is required for Fal background removal") from exc
        return fal_client

    def remove_background(
        self,
        source_path: Path,
        destination_path: Path,
    ) -> BackgroundRemovalResult:
        fal_client = self._load_sdk()
        upload_url = str(fal_client.upload_file(str(source_path)))
        start = time.monotonic()
        enqueue: dict[str, str] = {}
        try:
            result = fal_client.subscribe(
                self.model_id,
                arguments={"image_url": upload_url},
                client_timeout=self.timeout_sec,
                on_enqueue=lambda request_id: enqueue.setdefault("request_id", request_id),
            )
        except Exception as exc:  # pragma: no cover - live provider failure
            raise RuntimeError(f"Fal background removal failed: {exc}") from exc
        enqueue_request_id = None
        if isinstance(result, dict):
            enqueue_request_id = result.get("request_id") or result.get("id")
        enqueue_request_id = str(enqueue_request_id or enqueue.get("request_id") or "")

        image = result.get("image") or {}
        remote_url = str(image.get("url") or "")
        if not remote_url:
            raise RuntimeError("Fal background removal response did not include image.url")

        destination_path = destination_path.with_suffix(".png")
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=remote_url, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)

        latency_ms = round((time.monotonic() - start) * 1000.0, 3)
        warning = None
        if latency_ms > (self.timeout_sec * 1000):
            warning = "background removal completed but exceeded expected latency budget"
        return BackgroundRemovalResult(
            applied=True,
            provider_name=self.provider_name,
            output_path=destination_path,
            provider_request_id=enqueue_request_id,
            latency_ms=latency_ms,
            cost_usd=self.cost_usd,
            metadata={"model_id": self.model_id},
            warning=warning,
        )


@dataclass(frozen=True, slots=True)
class StagedAssetPaths:
    prepared_path: Path
    reference_paths: tuple[Path, ...]


def prepare_product_asset(
    request: ImageFactoryRequest,
    *,
    run_id: str,
    output_root: Path,
    background_provider: BackgroundRemovalProvider | None = None,
) -> PreparedProductAsset:
    """Validate and stage the primary product asset plus references."""

    source_path = validate_image_path(request.product_image_path, label="product image")
    staged_paths = stage_output_paths(
        request=request,
        run_id=run_id,
        output_root=output_root,
    )
    provider = background_provider or DeterministicCopyBackgroundRemovalProvider()

    removal_requested = should_remove_background(request.background_mode, source_path)

    if removal_requested:
        removal_target = staged_paths.prepared_path.with_suffix(".png")
        result = provider.remove_background(source_path, removal_target)
        prepared_path = result.output_path
        background_removed = result.applied
        warnings = tuple(value for value in (result.warning,) if value)
    else:
        staged_paths.prepared_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, staged_paths.prepared_path)
        prepared_path = staged_paths.prepared_path
        background_removed = False
        warnings = ()

    width, height = detect_image_dimensions(prepared_path)

    return PreparedProductAsset(
        source_path=source_path,
        prepared_path=prepared_path,
        background_removed=background_removed,
        width=width,
        height=height,
        reference_paths=staged_paths.reference_paths,
        background_provider_name=(result.provider_name if removal_requested else None),
        background_removal_request_id=(result.provider_request_id if removal_requested else None),
        background_removal_latency_ms=(result.latency_ms if removal_requested else None),
        background_removal_cost_usd=(result.cost_usd if removal_requested else 0.0),
        warnings=warnings,
    )


def validate_image_path(path: Path, *, label: str = "image") -> Path:
    """Return a resolved image path or raise a deterministic validation error."""

    resolved = Path(path).expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"{label} does not exist: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"{label} is not a file: {resolved}")
    detect_image_dimensions(resolved)
    return resolved


def should_remove_background(mode: str, image_path: Path) -> bool:
    return _should_remove_background(mode, image_path)


def detect_image_dimensions(path: Path) -> tuple[int, int]:
    """Read basic dimensions from PNG, GIF, JPEG, or WEBP headers."""

    raw = Path(path).read_bytes()
    if raw.startswith(_PNG_SIGNATURE):
        if len(raw) < 24:
            raise ValueError(f"unsupported or corrupt image file: {path}")
        width, height = struct.unpack(">II", raw[16:24])
        return width, height

    if raw.startswith(_GIF87A) or raw.startswith(_GIF89A):
        if len(raw) < 10:
            raise ValueError(f"unsupported or corrupt image file: {path}")
        width, height = struct.unpack("<HH", raw[6:10])
        return width, height

    if raw.startswith(_JPEG_SOI):
        return _read_jpeg_dimensions(raw, path)

    if raw[:4] == _WEBP_RIFF and raw[8:12] == _WEBP_WEBP:
        return _read_webp_dimensions(raw, path)

    raise ValueError(f"unsupported or corrupt image file: {path}")


def stage_output_paths(
    *,
    request: ImageFactoryRequest,
    run_id: str,
    output_root: Path,
) -> StagedAssetPaths:
    """Create stable staged file paths for the prepared asset and references."""

    run_root = Path(output_root) / run_id
    prepared_dir = run_root / "prepared"
    reference_dir = run_root / "references"
    prepared_dir.mkdir(parents=True, exist_ok=True)
    reference_dir.mkdir(parents=True, exist_ok=True)

    source_path = Path(request.product_image_path)
    prepared_name = f"{_safe_stem(source_path.stem)}-prepared{source_path.suffix.lower()}"
    prepared_path = prepared_dir / prepared_name

    staged_references: list[Path] = []
    for index, reference_path in enumerate(request.reference_image_paths, start=1):
        resolved = validate_image_path(reference_path, label=f"reference image {index}")
        staged_reference = reference_dir / (
            f"reference-{index:02d}-{_safe_stem(resolved.stem)}{resolved.suffix.lower()}"
        )
        shutil.copy2(resolved, staged_reference)
        staged_references.append(staged_reference)

    return StagedAssetPaths(
        prepared_path=prepared_path,
        reference_paths=tuple(staged_references),
    )


def _should_remove_background(mode: str, image_path: Path) -> bool:
    if mode == "keep":
        return False
    if mode == "remove":
        return True
    return not _has_embedded_transparency(image_path)


def _has_embedded_transparency(path: Path) -> bool:
    raw = Path(path).read_bytes()
    if raw.startswith(_PNG_SIGNATURE):
        return _png_has_transparency(raw)
    if raw.startswith(_GIF87A) or raw.startswith(_GIF89A):
        return _gif_has_transparency(raw)
    if raw[:4] == _WEBP_RIFF and raw[8:12] == _WEBP_WEBP:
        return _webp_has_transparency(raw)
    return False


def _safe_stem(value: str) -> str:
    cleaned = [
        character.lower() if character.isalnum() else "-"
        for character in value.strip()
    ]
    compact = "".join(cleaned).strip("-")
    return compact or "asset"


def _read_jpeg_dimensions(raw: bytes, path: Path) -> tuple[int, int]:
    offset = 2
    while offset + 8 <= len(raw):
        if raw[offset] != 0xFF:
            offset += 1
            continue
        marker = raw[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if offset + 2 > len(raw):
            break
        segment_length = struct.unpack(">H", raw[offset : offset + 2])[0]
        if segment_length < 2 or offset + segment_length > len(raw):
            break
        if marker in {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }:
            if segment_length < 7:
                break
            height, width = struct.unpack(">HH", raw[offset + 3 : offset + 7])
            return width, height
        offset += segment_length
    raise ValueError(f"unsupported or corrupt image file: {path}")


def _read_webp_dimensions(raw: bytes, path: Path) -> tuple[int, int]:
    chunk_type = raw[12:16]
    if chunk_type == b"VP8X" and len(raw) >= 30:
        width = int.from_bytes(raw[24:27], "little") + 1
        height = int.from_bytes(raw[27:30], "little") + 1
        return width, height
    if chunk_type == b"VP8 " and len(raw) >= 30:
        width = struct.unpack("<H", raw[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", raw[28:30])[0] & 0x3FFF
        return width, height
    if chunk_type == b"VP8L" and len(raw) >= 25:
        bits = int.from_bytes(raw[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    raise ValueError(f"unsupported or corrupt image file: {path}")


def _png_has_transparency(raw: bytes) -> bool:
    if len(raw) < 33:
        return False
    color_type = raw[25]
    if color_type in {4, 6}:
        return True
    offset = 8
    while offset + 8 <= len(raw):
        chunk_length = struct.unpack(">I", raw[offset : offset + 4])[0]
        chunk_type = raw[offset + 4 : offset + 8]
        chunk_end = offset + 8 + chunk_length
        if chunk_end + 4 > len(raw):
            break
        if chunk_type == b"tRNS":
            return True
        if chunk_type == b"IEND":
            break
        offset = chunk_end + 4
    return False


def _gif_has_transparency(raw: bytes) -> bool:
    marker = b"\x21\xf9\x04"
    offset = 0
    while True:
        index = raw.find(marker, offset)
        if index == -1 or index + 4 >= len(raw):
            return False
        packed = raw[index + 3]
        if packed & 0x01:
            return True
        offset = index + 1


def _webp_has_transparency(raw: bytes) -> bool:
    chunk_type = raw[12:16]
    if chunk_type == b"VP8X" and len(raw) >= 21:
        return bool(raw[20] & 0b00010000)
    return b"ALPH" in raw
