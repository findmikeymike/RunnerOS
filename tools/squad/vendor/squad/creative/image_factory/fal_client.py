"""Fal image-generation adapter for the Sprint 1 image factory."""

from __future__ import annotations

import json
import os
import shutil
import time
import urllib.error
import urllib.request
from hashlib import sha256
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from creative.image_factory.billing import CreativeBillingLedger
from creative.image_factory.contracts import (
    ImageGenerationPlan,
    ImageVariant,
    PreparedProductAsset,
    VariantSpec,
)


DEFAULT_FAL_IMAGE_COST_BY_MODEL = {
    "fal-ai/flux/dev/redux": 0.03,
    "fal-ai/flux-pro/kontext": 0.04,
    "fal-ai/flux-pro/kontext/max": 0.08,
    "fal-ai/ideogram/character": 0.08,
}


@dataclass(frozen=True, slots=True)
class FalGeneratedAsset:
    remote_url: str
    width: int
    height: int
    provider_request_id: str | None = None
    seed: int | None = None
    latency_ms: float | None = None


class FalTransport(Protocol):
    def generate_image(
        self,
        *,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
    ) -> FalGeneratedAsset:
        ...

    def download_file(self, url: str, destination_path: Path) -> None:
        ...


class HttpFalTransport:
    def __init__(self, *, api_key: str, base_url: str = "https://fal.run", timeout_sec: int = 120) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def _load_sdk(self):
        os.environ["FAL_KEY"] = self.api_key
        try:
            import fal_client
        except ImportError as exc:  # pragma: no cover - dependency issue
            raise RuntimeError("fal-client is required for live Fal image generation") from exc
        return fal_client

    @staticmethod
    def _upload_reference_urls(fal_client_module, reference_paths: tuple[Path, ...]) -> list[str]:
        urls: list[str] = []
        for path in reference_paths:
            urls.append(str(fal_client_module.upload_file(str(path))))
        return urls

    def generate_image(
        self,
        *,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
    ) -> FalGeneratedAsset:
        fal_client = self._load_sdk()
        start = time.monotonic()
        payload = self._build_payload(
            fal_client_module=fal_client,
            model_id=model_id,
            prompt=prompt,
            negative_prompt=negative_prompt,
            reference_paths=reference_paths,
            variant=variant,
        )
        provider_request_id: str | None = None
        try:
            body = fal_client.subscribe(
                model_id,
                arguments=payload,
                client_timeout=self.timeout_sec,
                on_enqueue=lambda request_id: payload.setdefault("_request_id", request_id),
            )
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"Fal request failed: {exc}") from exc
        provider_request_id = payload.pop("_request_id", None)

        images = body.get("images") or []
        if not images:
            raise RuntimeError("Fal response did not include any generated images")
        first = images[0]
        remote_url = str(first.get("url") or first.get("image"))
        if not remote_url:
            raise RuntimeError("Fal response image did not include a URL")
        return FalGeneratedAsset(
            remote_url=remote_url,
            width=int(first.get("width") or 0),
            height=int(first.get("height") or 0),
            provider_request_id=str(provider_request_id or body.get("request_id") or body.get("id") or ""),
            seed=int(first["seed"]) if first.get("seed") is not None else variant.seed,
            latency_ms=round((time.monotonic() - start) * 1000.0, 3),
        )

    def _build_payload(
        self,
        *,
        fal_client_module,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
    ) -> dict[str, Any]:
        if model_id == "fal-ai/ideogram/character":
            return self._build_ideogram_character_payload(
                fal_client_module=fal_client_module,
                prompt=prompt,
                negative_prompt=negative_prompt,
                reference_paths=reference_paths,
                variant=variant,
            )

        payload: dict[str, Any] = {"prompt": prompt}
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if variant.seed is not None:
            payload["seed"] = variant.seed
        if reference_paths:
            uploaded_urls = self._upload_reference_urls(fal_client_module, reference_paths)
            if len(uploaded_urls) == 1:
                payload["image_url"] = uploaded_urls[0]
            else:
                payload["image_urls"] = uploaded_urls
        return payload

    def _build_ideogram_character_payload(
        self,
        *,
        fal_client_module,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
    ) -> dict[str, Any]:
        if not reference_paths:
            raise ValueError("fal-ai/ideogram/character requires at least one reference image")
        uploaded_urls = self._upload_reference_urls(fal_client_module, reference_paths[:1])
        payload: dict[str, Any] = {
            "prompt": prompt,
            "reference_image_urls": uploaded_urls,
            "image_size": self._fal_image_size_for_aspect_ratio(variant.aspect_ratio),
            "num_images": 1,
            "expand_prompt": True,
            "rendering_speed": "BALANCED",
            "style": "AUTO",
        }
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if variant.seed is not None:
            payload["seed"] = variant.seed
        return payload

    @staticmethod
    def _fal_image_size_for_aspect_ratio(aspect_ratio: str) -> str:
        normalized = str(aspect_ratio).strip()
        return {
            "1:1": "square_hd",
            "4:3": "landscape_4_3",
            "3:4": "portrait_4_3",
            "16:9": "landscape_16_9",
            "9:16": "portrait_16_9",
        }.get(normalized, "square_hd")

    def download_file(self, url: str, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=url, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)


@dataclass
class FalImageClient:
    transport: FalTransport
    default_cost_per_image_usd: float = 0.03
    cost_by_model_usd: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_FAL_IMAGE_COST_BY_MODEL))

    def generate_variants(
        self,
        *,
        run_id: str,
        plan: ImageGenerationPlan,
        prepared_asset: PreparedProductAsset,
        output_root: Path,
        ledger: CreativeBillingLedger,
        on_variant_ready=None,
    ) -> tuple[ImageVariant, ...]:
        variants_dir = Path(output_root) / run_id / "variants"
        variants_dir.mkdir(parents=True, exist_ok=True)
        outputs: list[ImageVariant] = []
        reference_paths = self._dedupe_reference_paths(
            (prepared_asset.prepared_path,) + tuple(prepared_asset.reference_paths)
        )
        for variant in plan.variant_specs:
            model_cost_usd = self._cost_for_model(plan.model_id)
            ledger.assert_can_afford(
                model_cost_usd,
                provider="fal",
                operation="image.generate",
            )
            generated = self.transport.generate_image(
                model_id=plan.model_id,
                prompt=plan.resolved_prompt,
                negative_prompt=plan.negative_prompt,
                reference_paths=reference_paths,
                variant=variant,
            )
            cost_event = ledger.record(
                provider="fal",
                operation="image.generate",
                cost_usd=model_cost_usd,
                provider_request_id=generated.provider_request_id,
                latency_ms=generated.latency_ms,
                metadata={
                    "model_id": plan.model_id,
                    "variant_id": variant.variant_id,
                    "remote_url": generated.remote_url,
                },
            )
            local_path = variants_dir / f"{variant.variant_id}.png"
            self.transport.download_file(generated.remote_url, local_path)
            outputs.append(
                ImageVariant(
                    variant_id=variant.variant_id,
                    model_id=plan.model_id,
                    seed=generated.seed,
                    remote_url=generated.remote_url,
                    local_path=local_path,
                    width=generated.width,
                    height=generated.height,
                    cost_usd=cost_event.cost_usd,
                    latency_ms=generated.latency_ms,
                    prompt_snapshot=plan.resolved_prompt,
                    attempt_index=plan.attempt_index,
                )
            )
            if on_variant_ready is not None:
                on_variant_ready(outputs[-1])
        return tuple(outputs)

    def _cost_for_model(self, model_id: str) -> float:
        return float(self.cost_by_model_usd.get(model_id, self.default_cost_per_image_usd))

    @staticmethod
    def _dedupe_reference_paths(reference_paths: tuple[Path, ...]) -> tuple[Path, ...]:
        deduped: list[Path] = []
        seen_paths: set[Path] = set()
        seen_content_keys: set[tuple[int, str]] = set()

        for path in reference_paths:
            resolved = Path(path).expanduser().resolve()
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)

            content_key = FalImageClient._reference_content_key(resolved)
            if content_key in seen_content_keys:
                continue
            seen_content_keys.add(content_key)
            deduped.append(path)

        return tuple(deduped)

    @staticmethod
    def _reference_content_key(path: Path) -> tuple[int, str]:
        try:
            stat = path.stat()
            digest = sha256(path.read_bytes()).hexdigest()
            return (stat.st_size, digest)
        except OSError:
            return (-1, str(path))
