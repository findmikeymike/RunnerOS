"""Fal-backed Sprint 2 video generation adapter."""

from __future__ import annotations

import asyncio
import os
import shutil
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from creative.video_factory.contracts import (
    BudgetExceededError,
    CostRecord,
    GeneratedAsset,
    QualityTier,
    VideoGenerationError,
)


VIDEO_MODEL_IDS: dict[QualityTier, dict[str, str]] = {
    QualityTier.BUDGET: {
        "image_to_video": "fal-ai/vidu/q2/reference-to-video",
        "text_to_video": "fal-ai/kling-video/v3/standard/text-to-video",
    },
    QualityTier.STANDARD: {
        "image_to_video": "fal-ai/kling-video/v3/standard/image-to-video",
        "text_to_video": "fal-ai/kling-video/v3/standard/text-to-video",
    },
    QualityTier.PREMIUM: {
        "image_to_video": "fal-ai/kling-video/v3/pro/image-to-video",
        "text_to_video": "fal-ai/kling-video/v3/pro/text-to-video",
    },
}

# Cost source of truth: creative/production/model_routing.py default_video_model_registry().
# These per-tier defaults must agree with the per-model spec there for the Kling routes.
# A drift-detection test in tests/test_video_generation_adapter.py guards this invariant —
# update both tables together when adding/changing model pricing.
VIDEO_COST_PER_SECOND: dict[QualityTier, float] = {
    QualityTier.BUDGET: 0.07,
    QualityTier.STANDARD: 0.14,
    QualityTier.PREMIUM: 0.28,
}

VIDEO_COST_PER_SECOND_BY_MODEL: dict[str, float] = {
    model_ids["image_to_video"]: VIDEO_COST_PER_SECOND[quality]
    for quality, model_ids in VIDEO_MODEL_IDS.items()
}
VIDEO_COST_PER_SECOND_BY_MODEL.update(
    {
        model_ids["text_to_video"]: VIDEO_COST_PER_SECOND[quality]
        for quality, model_ids in VIDEO_MODEL_IDS.items()
    }
)

VIDEO_FLAT_COST_BY_MODEL: dict[str, float] = {
    # Low-res Vidu Q2 reference-to-video is the cheap smoke-test path.
    "fal-ai/vidu/q2/reference-to-video": 0.10,
}


@dataclass(frozen=True, slots=True)
class FalVideoGeneratedAsset:
    remote_url: str
    duration_s: float | None
    width: int | None
    height: int | None
    provider_request_id: str | None = None
    latency_s: float | None = None
    metadata: dict[str, Any] | None = None


class FalVideoTransport(Protocol):
    def generate_video(
        self,
        *,
        model_id: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path | None,
    ) -> FalVideoGeneratedAsset:
        ...

    def download_file(self, url: str, destination_path: Path) -> None:
        ...


class HttpFalVideoTransport:
    def __init__(self, *, api_key: str, timeout_sec: int = 300) -> None:
        self.api_key = api_key
        self.timeout_sec = timeout_sec

    def _load_sdk(self):
        os.environ["FAL_KEY"] = self.api_key
        try:
            import fal_client
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("fal-client is required for Sprint 2 video generation") from exc
        return fal_client

    def generate_video(
        self,
        *,
        model_id: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path | None,
    ) -> FalVideoGeneratedAsset:
        fal_client = self._load_sdk()
        image_url = str(fal_client.upload_file(str(input_image))) if input_image is not None else None
        payload = _payload_for_model(
            model_id=model_id,
            prompt=prompt,
            duration_s=duration_s,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            image_url=image_url,
        )
        start = time.monotonic()
        try:
            body = fal_client.subscribe(
                model_id,
                arguments=payload,
                client_timeout=self.timeout_sec,
                on_enqueue=lambda request_id: payload.setdefault("_request_id", request_id),
            )
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(f"Fal video request failed: {exc}") from exc
        provider_request_id = payload.pop("_request_id", None)
        video_payload = body.get("video") or {}
        remote_url = str(video_payload.get("url") or video_payload.get("video_url") or "")
        if not remote_url:
            raise RuntimeError("Fal video response did not include a downloadable URL")
        return FalVideoGeneratedAsset(
            remote_url=remote_url,
            duration_s=float(video_payload.get("duration") or duration_s),
            width=int(video_payload["width"]) if video_payload.get("width") is not None else None,
            height=int(video_payload["height"]) if video_payload.get("height") is not None else None,
            provider_request_id=str(provider_request_id or body.get("request_id") or body.get("id") or ""),
            latency_s=round(time.monotonic() - start, 3),
            metadata={"model_id": model_id},
        )

    def download_file(self, url: str, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=url, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)


@dataclass(slots=True)
class VideoGenerationAdapter:
    fal_api_key: str
    default_quality: QualityTier = QualityTier.BUDGET
    transport: FalVideoTransport | None = None
    timeout_sec: int = 300

    def __post_init__(self) -> None:
        if self.transport is None:
            self.transport = HttpFalVideoTransport(
                api_key=self.fal_api_key,
                timeout_sec=self.timeout_sec,
            )

    def estimate_cost(self, duration_s: int, quality: QualityTier) -> float:
        default_model_id = VIDEO_MODEL_IDS[quality]["image_to_video"]
        return self.estimate_model_cost(duration_s, default_model_id, quality)

    def estimate_model_cost(self, duration_s: int, model_id: str, fallback_quality: QualityTier) -> float:
        if model_id in VIDEO_FLAT_COST_BY_MODEL:
            return VIDEO_FLAT_COST_BY_MODEL[model_id]
        cost_per_second = VIDEO_COST_PER_SECOND_BY_MODEL.get(model_id, VIDEO_COST_PER_SECOND[fallback_quality])
        return round(cost_per_second * int(duration_s), 2)

    async def image_to_video(
        self,
        input_image: Path,
        prompt: str,
        duration_s: int = 5,
        quality: QualityTier | None = None,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
        model_id_override: str | None = None,
    ) -> GeneratedAsset:
        return await self._generate(
            mode="image_to_video",
            prompt=prompt,
            duration_s=duration_s,
            quality=quality or self.default_quality,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            input_image=input_image,
            budget_cap_usd=budget_cap_usd,
            output_dir=output_dir,
            model_id_override=model_id_override,
        )

    async def text_to_video(
        self,
        prompt: str,
        duration_s: int = 5,
        quality: QualityTier | None = None,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
        model_id_override: str | None = None,
    ) -> GeneratedAsset:
        return await self._generate(
            mode="text_to_video",
            prompt=prompt,
            duration_s=duration_s,
            quality=quality or self.default_quality,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            input_image=None,
            budget_cap_usd=budget_cap_usd,
            output_dir=output_dir,
            model_id_override=model_id_override,
        )

    async def _generate(
        self,
        *,
        mode: str,
        prompt: str,
        duration_s: int,
        quality: QualityTier,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path | None,
        budget_cap_usd: float | None,
        output_dir: Path | None,
        model_id_override: str | None,
    ) -> GeneratedAsset:
        model_id = model_id_override.strip() if model_id_override else VIDEO_MODEL_IDS[quality][mode]
        estimated_cost = self.estimate_model_cost(duration_s, model_id, quality)
        if budget_cap_usd is not None and estimated_cost > float(budget_cap_usd):
            raise BudgetExceededError(
                f"estimated {mode} cost ${estimated_cost:.2f} exceeds budget cap ${float(budget_cap_usd):.2f}"
            )
        if input_image is not None and not input_image.exists():
            raise VideoGenerationError(f"input image does not exist: {input_image}")
        destination_dir = output_dir or Path("./.outputs/video-factory")
        destination_dir.mkdir(parents=True, exist_ok=True)

        try:
            generated = await asyncio.to_thread(
                self.transport.generate_video,  # type: ignore[union-attr]
                model_id=model_id,
                prompt=prompt,
                duration_s=int(duration_s),
                aspect_ratio=aspect_ratio,
                negative_prompt=negative_prompt,
                seed=seed,
                input_image=input_image,
            )
            local_path = destination_dir / f"{uuid4()}.mp4"
            await asyncio.to_thread(self.transport.download_file, generated.remote_url, local_path)  # type: ignore[union-attr]
        except BudgetExceededError:
            raise
        except Exception as exc:
            raise VideoGenerationError(str(exc)) from exc

        return GeneratedAsset(
            file_path=local_path,
            mime_type="video/mp4",
            duration_s=generated.duration_s,
            width=generated.width,
            height=generated.height,
            cost=CostRecord(
                operation=mode,
                model=model_id,
                input_params={
                    "prompt": prompt,
                    "duration_s": int(duration_s),
                    "aspect_ratio": aspect_ratio,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "has_input_image": input_image is not None,
                },
                cost_usd=estimated_cost,
                duration_s=float(generated.latency_s or 0.0),
                provider_request_id=generated.provider_request_id,
            ),
            metadata={
                "remote_url": generated.remote_url,
                **dict(generated.metadata or {}),
            },
        )


def _payload_for_model(
    *,
    model_id: str,
    prompt: str,
    duration_s: int,
    aspect_ratio: str,
    negative_prompt: str,
    seed: int | None,
    image_url: str | None,
) -> dict[str, Any]:
    if model_id == "fal-ai/vidu/q2/reference-to-video":
        payload: dict[str, Any] = {
            "prompt": prompt,
            "duration": min(8, max(1, int(duration_s))),
            "aspect_ratio": aspect_ratio,
            "resolution": "360p",
            "movement_amplitude": "small",
            "bgm": False,
        }
        if image_url:
            payload["reference_image_urls"] = [image_url]
        if seed is not None:
            payload["seed"] = seed
        return payload
    payload = {
        "prompt": prompt,
        "duration": str(duration_s),
        "aspect_ratio": aspect_ratio,
    }
    if image_url:
        payload["image_url"] = image_url
    if negative_prompt:
        payload["negative_prompt"] = negative_prompt
    if seed is not None:
        payload["seed"] = seed
    return payload
