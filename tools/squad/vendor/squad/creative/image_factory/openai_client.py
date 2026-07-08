"""OpenAI GPT Image adapter for the image factory."""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from creative.image_factory.billing import CreativeBillingLedger
from creative.image_factory.contracts import ImageGenerationPlan, ImageVariant, PreparedProductAsset, VariantSpec
from creative.image_factory.prompting import openai_size_for_aspect_ratio


DEFAULT_OPENAI_IMAGE_COST_BY_QUALITY = {
    "low": 0.009,
    "medium": 0.034,
    "high": 0.133,
}


@dataclass(frozen=True, slots=True)
class OpenAIGeneratedAsset:
    b64_json: str
    width: int
    height: int
    provider_request_id: str | None = None
    revised_prompt: str | None = None
    latency_ms: float | None = None


class OpenAIImageTransport(Protocol):
    def generate_image(
        self,
        *,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
        quality: str,
        size: str,
        input_fidelity: str,
    ) -> OpenAIGeneratedAsset:
        ...


class HttpOpenAIImageTransport:
    def __init__(self, *, api_key: str, base_url: str | None = None, timeout_sec: int = 120) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.timeout_sec = timeout_sec

    def _client(self):
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - dependency issue
            raise RuntimeError("openai package is required for live GPT Image generation") from exc
        kwargs: dict[str, Any] = {"api_key": self.api_key, "timeout": self.timeout_sec}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def generate_image(
        self,
        *,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        reference_paths: tuple[Path, ...],
        variant: VariantSpec,
        quality: str,
        size: str,
        input_fidelity: str,
    ) -> OpenAIGeneratedAsset:
        client = self._client()
        start = time.monotonic()
        prompt_with_negative = _prompt_with_negative(prompt, negative_prompt)
        if reference_paths:
            handles = [path.open("rb") for path in reference_paths]
            try:
                response = client.images.edit(
                    model=model_id,
                    image=handles if len(handles) > 1 else handles[0],
                    prompt=prompt_with_negative,
                    size=size,
                    quality=quality,
                    input_fidelity=input_fidelity,
                    n=1,
                )
            finally:
                for handle in handles:
                    handle.close()
        else:
            response = client.images.generate(
                model=model_id,
                prompt=prompt_with_negative,
                size=size,
                quality=quality,
                n=1,
            )
        data = response.data[0]
        b64_json = getattr(data, "b64_json", None)
        if not b64_json:
            raise RuntimeError("OpenAI image response did not include b64_json")
        return OpenAIGeneratedAsset(
            b64_json=b64_json,
            width=_size_width(size),
            height=_size_height(size),
            provider_request_id=str(getattr(response, "_request_id", "") or ""),
            revised_prompt=getattr(data, "revised_prompt", None),
            latency_ms=round((time.monotonic() - start) * 1000.0, 3),
        )


@dataclass
class OpenAIImageClient:
    transport: OpenAIImageTransport
    cost_by_quality_usd: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_OPENAI_IMAGE_COST_BY_QUALITY))

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
        reference_paths = _dedupe_reference_paths((prepared_asset.prepared_path,) + tuple(prepared_asset.reference_paths))
        quality = str(plan.model_parameters.get("quality") or "medium")
        size = str(plan.model_parameters.get("size") or _size_for_plan(plan))
        input_fidelity = str(plan.model_parameters.get("input_fidelity") or "high")

        for variant in plan.variant_specs:
            model_cost_usd = self._cost_for_quality(quality)
            ledger.assert_can_afford(model_cost_usd, provider="openai", operation="image.generate")
            generated = self.transport.generate_image(
                model_id=plan.model_id,
                prompt=plan.resolved_prompt,
                negative_prompt=plan.negative_prompt,
                reference_paths=reference_paths,
                variant=variant,
                quality=quality,
                size=size,
                input_fidelity=input_fidelity,
            )
            cost_event = ledger.record(
                provider="openai",
                operation="image.generate",
                cost_usd=model_cost_usd,
                provider_request_id=generated.provider_request_id,
                latency_ms=generated.latency_ms,
                metadata={
                    "model_id": plan.model_id,
                    "variant_id": variant.variant_id,
                    "quality": quality,
                    "size": size,
                },
            )
            local_path = variants_dir / f"{variant.variant_id}.png"
            local_path.write_bytes(base64.b64decode(generated.b64_json))
            outputs.append(
                ImageVariant(
                    variant_id=variant.variant_id,
                    model_id=plan.model_id,
                    seed=variant.seed,
                    remote_url=None,
                    local_path=local_path,
                    width=generated.width,
                    height=generated.height,
                    cost_usd=cost_event.cost_usd,
                    latency_ms=generated.latency_ms,
                    prompt_snapshot=generated.revised_prompt or plan.resolved_prompt,
                    attempt_index=plan.attempt_index,
                )
            )
            if on_variant_ready is not None:
                on_variant_ready(outputs[-1])
        return tuple(outputs)

    def _cost_for_quality(self, quality: str) -> float:
        return float(self.cost_by_quality_usd.get(quality, self.cost_by_quality_usd["medium"]))


def _prompt_with_negative(prompt: str, negative_prompt: str | None) -> str:
    if not negative_prompt:
        return prompt
    return f"{prompt}\nAvoid: {negative_prompt}"


def _size_for_plan(plan: ImageGenerationPlan) -> str:
    variant_specs = tuple(plan.variant_specs or ())
    if not variant_specs:
        return "1024x1024"
    return openai_size_for_aspect_ratio(variant_specs[0].aspect_ratio)


def _size_width(size: str) -> int:
    return int(str(size).split("x", 1)[0])


def _size_height(size: str) -> int:
    return int(str(size).split("x", 1)[1])


def _dedupe_reference_paths(reference_paths: tuple[Path, ...]) -> tuple[Path, ...]:
    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in reference_paths:
        resolved = Path(path).expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(path)
    return tuple(deduped)
