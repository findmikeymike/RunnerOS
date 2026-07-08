from __future__ import annotations

import json
import mimetypes
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


HEYGEN_API_BASE_URL = "https://api.heygen.com"
HEYGEN_UPLOAD_BASE_URL = "https://upload.heygen.com"
HEYGEN_CREATE_VIDEO_PATH = "/v2/videos"
HEYGEN_UPLOAD_ASSET_PATH = "/v1/asset"
HEYGEN_PHOTO_AVATAR_IV_COST_PER_SECOND_USD = 0.05
HEYGEN_DIGITAL_TWIN_IV_COST_PER_SECOND_USD = 0.0667


@dataclass(frozen=True, slots=True)
class HeyGenUgcRequest:
    avatar_id: str
    voice_id: str
    script: str = ""
    title: str = "Squad UGC smoke"
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    duration_estimate_s: int = 20
    avatar_kind: str = "photo_avatar_iv"
    motion_prompt: str = "natural selfie-style creator delivery, casual hand gestures, direct eye contact"
    expressiveness: str = "medium"
    remove_background: bool = False
    background: dict[str, Any] | None = None
    audio_url: str | None = None
    audio_asset_id: str | None = None


def build_heygen_ugc_video_request(request: HeyGenUgcRequest) -> dict[str, Any]:
    has_script = bool(request.script.strip())
    has_audio = bool((request.audio_url or "").strip() or (request.audio_asset_id or "").strip())
    if has_script and has_audio:
        raise ValueError("HeyGen request must use either script or audio_url/audio_asset_id, not both")
    if not has_script and not has_audio:
        raise ValueError("HeyGen request requires script or audio_url/audio_asset_id")
    payload: dict[str, Any] = {
        "type": "avatar",
        "title": request.title,
        "avatar_id": request.avatar_id,
        "voice_id": request.voice_id if has_script else None,
        "script": request.script if has_script else None,
        "audio_url": request.audio_url,
        "audio_asset_id": request.audio_asset_id,
        "aspect_ratio": request.aspect_ratio,
        "resolution": request.resolution,
        "background": request.background,
        "remove_background": request.remove_background,
    }
    if request.avatar_kind == "photo_avatar_iv":
        payload["motion_prompt"] = request.motion_prompt
        payload["expressiveness"] = request.expressiveness
    return _strip_empty(payload)


@dataclass(frozen=True, slots=True)
class HeyGenUgcResult:
    video_id: str
    status: str
    asset_path: Path | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    estimated_cost_usd: float = 0.0
    raw_status: dict[str, Any] = field(default_factory=dict)


class HeyGenProviderError(RuntimeError):
    pass


class HeyGenUgcAvatarAdapter:
    def __init__(
        self,
        *,
        api_key: str,
        api_base_url: str = HEYGEN_API_BASE_URL,
        upload_base_url: str = HEYGEN_UPLOAD_BASE_URL,
        timeout_sec: int = 60,
        poll_interval_sec: float = 5.0,
        default_avatar_id: str | None = None,
        default_voice_id: str | None = None,
        persona_map: dict[str, dict[str, str]] | None = None,
    ) -> None:
        self.api_key = api_key.strip()
        self.api_base_url = api_base_url.rstrip("/")
        self.upload_base_url = upload_base_url.rstrip("/")
        self.timeout_sec = int(timeout_sec)
        self.poll_interval_sec = float(poll_interval_sec)
        self.default_avatar_id = (default_avatar_id or "").strip()
        self.default_voice_id = (default_voice_id or "").strip()
        self.persona_map = _clean_persona_map(persona_map)
        if not self.api_key:
            raise ValueError("api_key is required")

    def estimate_cost_usd(self, request: HeyGenUgcRequest) -> float:
        rate = (
            HEYGEN_DIGITAL_TWIN_IV_COST_PER_SECOND_USD
            if request.avatar_kind == "digital_twin_iv"
            else HEYGEN_PHOTO_AVATAR_IV_COST_PER_SECOND_USD
        )
        return round(max(1, int(request.duration_estimate_s)) * rate, 4)

    def build_payload(self, request: HeyGenUgcRequest) -> dict[str, Any]:
        return build_heygen_ugc_video_request(request)

    def upload_asset(self, file_path: Path, *, content_type: str | None = None) -> str:
        path = Path(file_path)
        if not path.exists():
            raise HeyGenProviderError(f"HeyGen asset upload file does not exist: {path}")
        mime_type = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        request = urllib.request.Request(
            f"{self.upload_base_url}{HEYGEN_UPLOAD_ASSET_PATH}",
            data=body,
            method="POST",
            headers={
                "X-Api-Key": self.api_key,
                "Content-Type": mime_type,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise HeyGenProviderError(f"HeyGen upload HTTP {exc.code}: {details[:500]}") from exc
        except urllib.error.URLError as exc:
            raise HeyGenProviderError(f"HeyGen upload failed: {exc}") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HeyGenProviderError(f"HeyGen upload returned non-JSON response: {raw[:500]}") from exc
        asset_id = _extract_asset_id(payload)
        if not asset_id:
            raise HeyGenProviderError(f"HeyGen upload did not return an asset_id: {_safe_payload(payload)}")
        return asset_id

    def generate(
        self,
        *,
        request: HeyGenUgcRequest,
        output_path: Path,
        max_cost_usd: float,
        wait: bool = True,
    ) -> HeyGenUgcResult:
        estimated_cost = self.estimate_cost_usd(request)
        if estimated_cost > max_cost_usd:
            raise HeyGenProviderError(
                f"estimated HeyGen cost ${estimated_cost:.2f} exceeds max_cost_usd ${max_cost_usd:.2f}"
            )

        create_response = self._json_request(
            "POST",
            HEYGEN_CREATE_VIDEO_PATH,
            body=self.build_payload(request),
        )
        video_id = _extract_video_id(create_response)
        if not video_id:
            raise HeyGenProviderError(f"HeyGen did not return a video_id: {_safe_payload(create_response)}")
        if not wait:
            return HeyGenUgcResult(
                video_id=video_id,
                status="submitted",
                estimated_cost_usd=estimated_cost,
                raw_status=create_response,
            )

        deadline = time.monotonic() + self.timeout_sec
        last_status: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last_status = self.retrieve_status(video_id)
            status = _extract_status(last_status)
            if status == "completed":
                video_url = _extract_video_url(last_status)
                if not video_url:
                    raise HeyGenProviderError(f"HeyGen completed without a video URL: {_safe_payload(last_status)}")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                self._download(video_url, output_path)
                return HeyGenUgcResult(
                    video_id=video_id,
                    status=status,
                    asset_path=output_path,
                    video_url=video_url,
                    thumbnail_url=_extract_thumbnail_url(last_status),
                    estimated_cost_usd=estimated_cost,
                    raw_status=last_status,
                )
            if status == "failed":
                raise HeyGenProviderError(f"HeyGen video failed: {_safe_payload(last_status)}")
            time.sleep(self.poll_interval_sec)
        raise HeyGenProviderError(f"timed out waiting for HeyGen video {video_id}: {_safe_payload(last_status)}")

    def retrieve_status(self, video_id: str) -> dict[str, Any]:
        try:
            return self._json_request("GET", f"/v2/videos/{video_id}")
        except HeyGenProviderError:
            return self._json_request("GET", f"/v1/video_status.get?video_id={video_id}")

    def list_avatars(self) -> dict[str, Any]:
        return self._json_request("GET", "/v2/avatars")

    def _json_request(self, method: str, path: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{self.api_base_url}{path}",
            data=data,
            method=method,
            headers={
                "X-Api-Key": self.api_key,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise HeyGenProviderError(f"HeyGen HTTP {exc.code}: {details[:500]}") from exc
        except urllib.error.URLError as exc:
            raise HeyGenProviderError(f"HeyGen request failed: {exc}") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HeyGenProviderError(f"HeyGen returned non-JSON response: {raw[:500]}") from exc
        error = payload.get("error")
        if error:
            raise HeyGenProviderError(f"HeyGen API error: {error}")
        return payload

    def _download(self, url: str, output_path: Path) -> None:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
            output_path.write_bytes(response.read())


def _extract_video_id(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return str(data.get("video_id") or payload.get("video_id") or "").strip() or None


def _extract_status(payload: dict[str, Any]) -> str:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return str(data.get("status") or payload.get("status") or "").strip().lower()


def _extract_video_url(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return str(data.get("video_url") or payload.get("video_url") or "").strip() or None


def _extract_thumbnail_url(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return str(data.get("thumbnail_url") or payload.get("thumbnail_url") or "").strip() or None


def _extract_asset_id(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return str(
        data.get("asset_id")
        or data.get("id")
        or payload.get("asset_id")
        or payload.get("id")
        or ""
    ).strip() or None


def _strip_empty(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _strip_empty(item) for key, item in value.items() if item not in (None, "")}
    if isinstance(value, list):
        return [_strip_empty(item) for item in value]
    return value


def _safe_payload(payload: dict[str, Any]) -> str:
    clean = dict(payload)
    if "api_key" in clean:
        clean["api_key"] = "[redacted]"
    return json.dumps(clean, sort_keys=True)[:1000]


def _clean_persona_map(persona_map: dict[str, dict[str, str]] | None) -> dict[str, dict[str, str]]:
    cleaned: dict[str, dict[str, str]] = {}
    for raw_key, raw_config in (persona_map or {}).items():
        key = str(raw_key or "").strip().lower()
        if not key or not isinstance(raw_config, dict):
            continue
        config = {
            str(field): str(value).strip()
            for field, value in raw_config.items()
            if str(field) in {"avatar_id", "voice_id", "avatar_kind"} and str(value).strip()
        }
        if config:
            cleaned[key] = config
    return cleaned
