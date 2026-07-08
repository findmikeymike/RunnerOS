from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from creative.video_factory.contracts import GeneratedAsset


@dataclass(frozen=True, slots=True)
class ImageToVideoRequest:
    input_image: Path
    prompt: str
    quality: str
    duration_s: int = 5
    aspect_ratio: str = "16:9"
    negative_prompt: str = ""
    seed: int | None = None
    budget_cap_usd: float | None = None
    output_dir: Path | None = None
    model_id_override: str | None = None
    input_image_url: str | None = None
    audio_prompt: str | None = None


class VideoBackend(Protocol):
    async def image_to_video(self, request: ImageToVideoRequest) -> GeneratedAsset:
        ...


@dataclass(slots=True)
class FalKlingVideoBackend:
    adapter: object

    async def image_to_video(self, request: ImageToVideoRequest) -> GeneratedAsset:
        return await self.adapter.image_to_video(
            input_image=request.input_image,
            prompt=request.prompt,
            duration_s=request.duration_s,
            quality=request.quality,
            aspect_ratio=request.aspect_ratio,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
            budget_cap_usd=request.budget_cap_usd,
            output_dir=request.output_dir,
            model_id_override=request.model_id_override,
        )


@dataclass(slots=True)
class RunPodLTXVideoBackend:
    adapter: object

    async def image_to_video(self, request: ImageToVideoRequest) -> GeneratedAsset:
        return await self.adapter.image_to_video(
            input_image=request.input_image,
            input_image_url=request.input_image_url,
            prompt=request.prompt,
            duration_s=request.duration_s,
            aspect_ratio=request.aspect_ratio,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
            audio_prompt=request.audio_prompt,
            budget_cap_usd=request.budget_cap_usd,
            output_dir=request.output_dir,
        )


@dataclass(slots=True)
class ComfyLTXVideoBackend:
    adapter: object

    async def image_to_video(self, request: ImageToVideoRequest) -> GeneratedAsset:
        return await self.adapter.image_to_video(
            input_image=request.input_image,
            prompt=request.prompt,
            duration_s=request.duration_s,
            aspect_ratio=request.aspect_ratio,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
            audio_prompt=request.audio_prompt,
            input_image_url=request.input_image_url,
            budget_cap_usd=request.budget_cap_usd,
            output_dir=request.output_dir,
        )


@dataclass(slots=True)
class WaveSpeedVideoBackend:
    adapter: object

    async def image_to_video(self, request: ImageToVideoRequest) -> GeneratedAsset:
        return await self.adapter.image_to_video(
            input_image=request.input_image,
            prompt=request.prompt,
            duration_s=request.duration_s,
            aspect_ratio=request.aspect_ratio,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
            input_image_url=request.input_image_url,
            budget_cap_usd=request.budget_cap_usd,
            output_dir=request.output_dir,
            model_id_override=request.model_id_override,
        )


@dataclass(slots=True)
class VideoBackendRouter:
    kling_backend: VideoBackend | None
    runpod_ltx_backend: VideoBackend | None = None
    comfy_ltx_backend: VideoBackend | None = None
    wavespeed_backend: VideoBackend | None = None

    async def image_to_video(
        self,
        *,
        input_image: Path,
        prompt: str,
        quality: str,
        duration_s: int = 5,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
        model_id_override: str | None = None,
        input_image_url: str | None = None,
        audio_prompt: str | None = None,
    ) -> GeneratedAsset:
        request = ImageToVideoRequest(
            input_image=input_image,
            prompt=prompt,
            quality=quality,
            duration_s=duration_s,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            budget_cap_usd=budget_cap_usd,
            output_dir=output_dir,
            model_id_override=model_id_override,
            input_image_url=input_image_url,
            audio_prompt=audio_prompt,
        )
        backend = self._select_backend(model_id_override or "")
        return await backend.image_to_video(request)

    def _select_backend(self, model_id: str) -> VideoBackend:
        if model_id.startswith("wavespeed/"):
            if self.wavespeed_backend is None:
                raise RuntimeError("wavespeed_backend is required for WaveSpeed routes")
            return self.wavespeed_backend
        if model_id.startswith("runpod/ltx"):
            if self.runpod_ltx_backend is None:
                raise RuntimeError("runpod_ltx_backend is required for RunPod LTX routes")
            return self.runpod_ltx_backend
        if model_id.startswith("comfy/ltx"):
            if self.comfy_ltx_backend is None:
                raise RuntimeError("comfy_ltx_backend is required for Comfy LTX routes")
            return self.comfy_ltx_backend
        if self.kling_backend is None:
            raise RuntimeError("kling_backend is required for Fal/Kling routes")
        return self.kling_backend
