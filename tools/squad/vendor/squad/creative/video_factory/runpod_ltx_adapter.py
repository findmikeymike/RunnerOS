"""RunPod LTX video adapter contract.

This is intentionally not wired into live routing yet. It gives the production
agent a safe, tested target shape before any RunPod worker/template exists.
"""

from __future__ import annotations

import asyncio
import json
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
    VideoGenerationError,
)


DEFAULT_LTX_MODEL_ID = "runpod/ltx-video-2.3"
DEFAULT_LTX_COST_PER_SECOND_USD = 0.03


@dataclass(frozen=True, slots=True)
class RunPodLTXGeneratedAsset:
    remote_url: str
    duration_s: float | None
    width: int | None
    height: int | None
    provider_request_id: str | None = None
    latency_s: float | None = None
    metadata: dict[str, Any] | None = None


class RunPodLTXTransport(Protocol):
    def generate_video(self, *, payload: dict[str, Any]) -> RunPodLTXGeneratedAsset:
        ...

    def download_file(self, url: str, destination_path: Path) -> None:
        ...


class RunPodLTXTransportError(RuntimeError):
    """Raised when RunPod job submission, polling, or result parsing fails."""


class UnconfiguredRunPodLTXTransport:
    def generate_video(self, *, payload: dict[str, Any]) -> RunPodLTXGeneratedAsset:
        raise RuntimeError("RunPod LTX transport is not configured; inject a live transport or keep this route candidate-only")

    def download_file(self, url: str, destination_path: Path) -> None:
        raise RuntimeError("RunPod LTX transport is not configured; inject a live transport or keep this route candidate-only")


class HttpRunPodLTXTransport:
    def __init__(
        self,
        *,
        api_key: str,
        endpoint_id: str,
        timeout_sec: int = 900,
        poll_interval_s: float = 2.0,
        urlopen=urllib.request.urlopen,
        sleep=time.sleep,
    ) -> None:
        if not api_key.strip():
            raise ValueError("api_key must not be blank")
        if not endpoint_id.strip():
            raise ValueError("endpoint_id must not be blank")
        self.api_key = api_key
        self.endpoint_id = endpoint_id
        self.timeout_sec = timeout_sec
        self.poll_interval_s = poll_interval_s
        self.urlopen = urlopen
        self.sleep = sleep

    def generate_video(self, *, payload: dict[str, Any]) -> RunPodLTXGeneratedAsset:
        run_response = self._request_json(
            "POST",
            f"https://api.runpod.ai/v2/{self.endpoint_id}/run",
            {"input": payload},
        )
        job_id = str(run_response.get("id") or "").strip()
        if not job_id:
            raise RunPodLTXTransportError("RunPod /run response did not include a job id")

        deadline = time.monotonic() + self.timeout_sec
        latest = run_response
        while time.monotonic() < deadline:
            status = str(latest.get("status") or "").upper()
            if status == "COMPLETED":
                return self._asset_from_completed_response(job_id=job_id, response=latest)
            if status in {"FAILED", "CANCELLED", "TIMED_OUT"}:
                error = latest.get("error") or latest.get("output") or latest
                raise RunPodLTXTransportError(f"RunPod job {job_id} failed: {error}")
            self.sleep(self.poll_interval_s)
            latest = self._request_json(
                "GET",
                f"https://api.runpod.ai/v2/{self.endpoint_id}/status/{job_id}",
                None,
            )
        raise RunPodLTXTransportError(f"RunPod job {job_id} timed out after {self.timeout_sec}s")

    def download_file(self, url: str, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=url, method="GET")
        with self.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)

    def _request_json(self, method: str, url: str, body: dict[str, Any] | None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            url=url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with self.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read()
        except Exception as exc:
            raise RunPodLTXTransportError(f"RunPod HTTP request failed: {exc}") from exc
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RunPodLTXTransportError("RunPod response was not valid JSON") from exc
        if not isinstance(payload, dict):
            raise RunPodLTXTransportError("RunPod response JSON was not an object")
        return payload

    def _asset_from_completed_response(self, *, job_id: str, response: dict[str, Any]) -> RunPodLTXGeneratedAsset:
        output = response.get("output") or {}
        if not isinstance(output, dict):
            raise RunPodLTXTransportError(f"RunPod job {job_id} output was not an object")
        remote_url = str(
            output.get("video_url")
            or output.get("videoURL")
            or output.get("url")
            or output.get("remote_url")
            or ""
        ).strip()
        if not remote_url:
            raise RunPodLTXTransportError(f"RunPod job {job_id} completed without a downloadable video URL")
        execution_ms = response.get("executionTime")
        latency_s = float(execution_ms) / 1000 if isinstance(execution_ms, int | float) else None
        return RunPodLTXGeneratedAsset(
            remote_url=remote_url,
            duration_s=_optional_float(output.get("duration_s") or output.get("duration")),
            width=_optional_int(output.get("width")),
            height=_optional_int(output.get("height")),
            provider_request_id=job_id,
            latency_s=latency_s,
            metadata=dict(output.get("metadata") or {}),
        )


@dataclass(slots=True)
class RunPodLTXVideoAdapter:
    runpod_api_key: str
    endpoint_id: str
    model_id: str = DEFAULT_LTX_MODEL_ID
    transport: RunPodLTXTransport | None = None
    cost_per_second_usd: float = DEFAULT_LTX_COST_PER_SECOND_USD

    def __post_init__(self) -> None:
        if not self.runpod_api_key.strip():
            raise ValueError("runpod_api_key must not be blank")
        if not self.endpoint_id.strip():
            raise ValueError("endpoint_id must not be blank")
        if self.cost_per_second_usd <= 0:
            raise ValueError("cost_per_second_usd must be positive")
        if self.transport is None:
            self.transport = UnconfiguredRunPodLTXTransport()

    def estimate_cost(self, duration_s: int) -> float:
        return round(self.cost_per_second_usd * max(1, int(duration_s)), 2)

    async def image_to_video(
        self,
        input_image: Path,
        prompt: str,
        duration_s: int = 20,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        audio_prompt: str | None = None,
        input_image_url: str | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
    ) -> GeneratedAsset:
        if input_image_url is None and not input_image.exists():
            raise VideoGenerationError(f"input image does not exist: {input_image}")
        return await self._generate(
            mode="image_to_video",
            prompt=prompt,
            duration_s=duration_s,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            input_image=input_image,
            audio_prompt=audio_prompt,
            input_image_url=input_image_url,
            budget_cap_usd=budget_cap_usd,
            output_dir=output_dir,
        )

    async def _generate(
        self,
        *,
        mode: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path | None,
        audio_prompt: str | None,
        input_image_url: str | None,
        budget_cap_usd: float | None,
        output_dir: Path | None,
    ) -> GeneratedAsset:
        estimated_cost = self.estimate_cost(duration_s)
        if budget_cap_usd is not None and estimated_cost > float(budget_cap_usd):
            raise BudgetExceededError(
                f"estimated {mode} cost ${estimated_cost:.2f} exceeds budget cap ${float(budget_cap_usd):.2f}"
            )

        destination_dir = output_dir or Path("./.outputs/video-factory/runpod-ltx")
        destination_dir.mkdir(parents=True, exist_ok=True)
        payload = self._build_payload(
            mode=mode,
            prompt=prompt,
            duration_s=duration_s,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
            input_image=input_image,
            audio_prompt=audio_prompt,
            input_image_url=input_image_url,
        )

        start = time.monotonic()
        try:
            generated = await asyncio.to_thread(self.transport.generate_video, payload=payload)  # type: ignore[union-attr]
            local_path = destination_dir / f"{uuid4()}.mp4"
            await asyncio.to_thread(self.transport.download_file, generated.remote_url, local_path)  # type: ignore[union-attr]
        except BudgetExceededError:
            raise
        except Exception as exc:
            raise VideoGenerationError(str(exc)) from exc

        latency_s = generated.latency_s if generated.latency_s is not None else round(time.monotonic() - start, 3)
        return GeneratedAsset(
            file_path=local_path,
            mime_type="video/mp4",
            duration_s=generated.duration_s,
            width=generated.width,
            height=generated.height,
            cost=CostRecord(
                operation=mode,
                model=self.model_id,
                input_params={
                    "prompt": prompt,
                    "duration_s": int(duration_s),
                    "aspect_ratio": aspect_ratio,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "has_input_image": input_image is not None,
                    "has_input_image_url": bool(input_image_url),
                    "has_audio_prompt": bool(audio_prompt),
                },
                cost_usd=estimated_cost,
                duration_s=float(latency_s or 0.0),
                provider_request_id=generated.provider_request_id,
            ),
            metadata={
                "remote_url": generated.remote_url,
                "provider": "runpod",
                "endpoint_id": self.endpoint_id,
                "model_id": self.model_id,
                **dict(generated.metadata or {}),
            },
        )

    def _build_payload(
        self,
        *,
        mode: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path | None,
        audio_prompt: str | None,
        input_image_url: str | None,
    ) -> dict[str, Any]:
        return {
            "endpoint_id": self.endpoint_id,
            "model_id": self.model_id,
            "mode": mode,
            "prompt": prompt,
            "duration_s": int(duration_s),
            "aspect_ratio": aspect_ratio,
            "negative_prompt": negative_prompt,
            "seed": seed,
            "input_image_path": str(input_image) if input_image is not None else None,
            "input_image_url": input_image_url,
            "audio_prompt": audio_prompt,
        }


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
