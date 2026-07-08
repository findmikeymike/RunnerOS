"""WaveSpeed image-to-video adapter."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from creative.video_factory.contracts import BudgetExceededError, CostRecord, GeneratedAsset, VideoGenerationError


DEFAULT_WAVESPEED_I2V_MODEL_ID = "wavespeed/bytedance/seedance-v1-lite-i2v-480p"
WAVESPEED_FLAT_COST_BY_MODEL: dict[str, float] = {
    "wavespeed/wavespeed-ai/ltx-2.3-image-to-video": 0.04,
}
WAVESPEED_COST_PER_5S_BY_MODEL: dict[str, float] = {
    "wavespeed/bytedance/seedance-v1-lite-i2v-480p": 0.08,
}


@dataclass(frozen=True, slots=True)
class WaveSpeedGeneratedAsset:
    remote_url: str
    duration_s: float | None
    width: int | None
    height: int | None
    provider_request_id: str | None = None
    latency_s: float | None = None
    metadata: dict[str, Any] | None = None


class WaveSpeedTransport(Protocol):
    def generate_video(
        self,
        *,
        model_id: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path,
        input_image_url: str | None = None,
    ) -> WaveSpeedGeneratedAsset:
        ...

    def download_file(self, url: str, destination_path: Path) -> None:
        ...


class HttpWaveSpeedTransport:
    def __init__(
        self,
        *,
        api_key: str,
        api_base_url: str = "https://api.wavespeed.ai/api",
        timeout_sec: int = 300,
        poll_interval_sec: float = 2.0,
    ) -> None:
        self.api_key = api_key
        self.api_base_url = api_base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.poll_interval_sec = poll_interval_sec

    def generate_video(
        self,
        *,
        model_id: str,
        prompt: str,
        duration_s: int,
        aspect_ratio: str,
        negative_prompt: str,
        seed: int | None,
        input_image: Path,
        input_image_url: str | None = None,
    ) -> WaveSpeedGeneratedAsset:
        start = time.monotonic()
        image_url = input_image_url or self.upload_file(input_image)
        api_model_id = _api_model_id(model_id)
        payload = _payload_for_wavespeed_model(
            model_id=model_id,
            image_url=image_url,
            prompt=prompt,
            duration_s=duration_s,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            seed=seed,
        )
        run_body = self._request_json(
            "POST",
            f"/v3/{api_model_id}",
            payload,
            headers={"Content-Type": "application/json"},
        )
        request_id = _extract_request_id(run_body)
        result = self._poll_result(request_id)
        remote_url = _extract_output_url(result)
        return WaveSpeedGeneratedAsset(
            remote_url=remote_url,
            duration_s=float(duration_s),
            width=None,
            height=None,
            provider_request_id=request_id,
            latency_s=round(time.monotonic() - start, 3),
            metadata={
                "provider": "wavespeed",
                "model_id": model_id,
                "api_model_id": api_model_id,
                "status": _response_status(result),
            },
        )

    def upload_file(self, file_path: Path) -> str:
        boundary = f"squad-{uuid4().hex}"
        body = _multipart_file_body(boundary=boundary, field_name="file", file_path=file_path)
        response = self._request_json(
            "POST",
            "/v2/media/upload/binary",
            body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        download_url = response.get("data", {}).get("download_url") if isinstance(response.get("data"), dict) else None
        if not download_url:
            raise RuntimeError("WaveSpeed upload response did not include data.download_url")
        return str(download_url)

    def download_file(self, url: str, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=url, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)

    def _poll_result(self, request_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.timeout_sec
        last_body: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            body = self._get_prediction_result(request_id)
            last_body = body
            status = _response_status(body)
            if status == "completed":
                return body
            if status in {"failed", "error", "canceled", "cancelled"}:
                raise RuntimeError(f"WaveSpeed request {request_id} failed: {body}")
            time.sleep(self.poll_interval_sec)
        raise TimeoutError(f"WaveSpeed request {request_id} timed out; last response: {last_body}")

    def _get_prediction_result(self, request_id: str) -> dict[str, Any]:
        try:
            return self._request_json(
                "GET",
                f"/v3/predictions/{urllib.parse.quote(request_id)}/result",
                None,
                wrap_http_errors=False,
            )
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
            return self._request_json("GET", f"/v3/predictions/{urllib.parse.quote(request_id)}", None)

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | bytes | None,
        *,
        headers: dict[str, str] | None = None,
        wrap_http_errors: bool = True,
    ) -> dict[str, Any]:
        body: bytes | None
        if isinstance(payload, bytes):
            body = payload
        elif payload is None:
            body = None
        else:
            body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url=f"{self.api_base_url}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            if not wrap_http_errors:
                raise
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"WaveSpeed HTTP {exc.code}: {detail}") from exc
        parsed = json.loads(raw.decode("utf-8"))
        code = parsed.get("code")
        if code not in (None, 200):
            raise RuntimeError(f"WaveSpeed API error: {parsed}")
        return parsed


@dataclass(slots=True)
class WaveSpeedVideoAdapter:
    api_key: str
    transport: WaveSpeedTransport | None = None
    default_model_id: str = DEFAULT_WAVESPEED_I2V_MODEL_ID
    timeout_sec: int = 300
    api_base_url: str = "https://api.wavespeed.ai/api"
    poll_interval_sec: float = 2.0

    def __post_init__(self) -> None:
        if self.transport is None:
            self.transport = HttpWaveSpeedTransport(
                api_key=self.api_key,
                api_base_url=self.api_base_url,
                timeout_sec=self.timeout_sec,
                poll_interval_sec=self.poll_interval_sec,
            )

    def estimate_model_cost(self, duration_s: int, model_id: str | None = None) -> float:
        selected_model = model_id or self.default_model_id
        if selected_model in WAVESPEED_FLAT_COST_BY_MODEL:
            return WAVESPEED_FLAT_COST_BY_MODEL[selected_model]
        if selected_model in WAVESPEED_COST_PER_5S_BY_MODEL:
            api_model_id = _api_model_id(selected_model)
            normalized_duration = _normalize_wavespeed_duration(api_model_id, duration_s)
            return round((normalized_duration / 5.0) * WAVESPEED_COST_PER_5S_BY_MODEL[selected_model], 2)
        return round(0.02 * max(1, int(duration_s)), 2)

    async def image_to_video(
        self,
        *,
        input_image: Path,
        prompt: str,
        duration_s: int = 5,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        input_image_url: str | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
        model_id_override: str | None = None,
    ) -> GeneratedAsset:
        model_id = model_id_override.strip() if model_id_override else self.default_model_id
        estimated_cost = self.estimate_model_cost(duration_s, model_id)
        if budget_cap_usd is not None and estimated_cost > float(budget_cap_usd):
            raise BudgetExceededError(
                f"estimated WaveSpeed image_to_video cost ${estimated_cost:.2f} exceeds budget cap ${float(budget_cap_usd):.2f}"
            )
        if not input_image.exists():
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
                input_image_url=input_image_url,
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
                operation="image_to_video",
                model=model_id,
                input_params={
                    "prompt": prompt,
                    "duration_s": int(duration_s),
                    "aspect_ratio": aspect_ratio,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "has_input_image": True,
                    "has_input_image_url": bool(input_image_url),
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


def _api_model_id(model_id: str) -> str:
    return model_id.removeprefix("wavespeed/")


def _payload_for_wavespeed_model(
    *,
    model_id: str,
    image_url: str,
    prompt: str,
    duration_s: int,
    aspect_ratio: str,
    negative_prompt: str,
    seed: int | None,
) -> dict[str, Any]:
    api_model_id = _api_model_id(model_id)
    payload: dict[str, Any] = {
        "image": image_url,
        "prompt": prompt,
        "duration": _normalize_wavespeed_duration(api_model_id, duration_s),
    }
    if negative_prompt and "ltx-2.3" in api_model_id:
        payload["negative_prompt"] = negative_prompt
    if seed is not None:
        payload["seed"] = seed
    if aspect_ratio:
        payload["aspect_ratio"] = aspect_ratio
    return payload


def _normalize_wavespeed_duration(api_model_id: str, duration_s: int) -> int:
    duration = max(1, int(duration_s))
    if "seedance-v1-lite" in api_model_id:
        if duration <= 5:
            return 5
        if duration <= 10:
            return 10
        if duration <= 15:
            return 15
        return 20
    if "ltx-2.3" in api_model_id:
        return min(8, max(2, duration))
    return duration


def _extract_request_id(body: dict[str, Any]) -> str:
    data = body.get("data")
    request_id = data.get("id") if isinstance(data, dict) else None
    if not request_id:
        raise RuntimeError(f"WaveSpeed run response did not include data.id: {body}")
    return str(request_id)


def _response_status(body: dict[str, Any]) -> str:
    data = body.get("data")
    status = data.get("status") if isinstance(data, dict) else body.get("status")
    return str(status or "").lower()


def _extract_output_url(body: dict[str, Any]) -> str:
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    outputs = data.get("outputs") if isinstance(data, dict) else None
    if isinstance(outputs, list) and outputs:
        return str(outputs[0])
    output = data.get("output") if isinstance(data, dict) else None
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output:
        return str(output[0])
    raise RuntimeError(f"WaveSpeed completed response did not include output URL: {body}")


def _multipart_file_body(*, boundary: str, field_name: str, file_path: Path) -> bytes:
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    return head + file_path.read_bytes() + tail
