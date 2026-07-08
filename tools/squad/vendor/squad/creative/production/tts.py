from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib import request
from urllib.error import HTTPError, URLError

from creative.production.contracts import AudioAssetRecord, VoiceoverPlan


INWORLD_TTS_URL = "https://api.inworld.ai/tts/v1/voice"
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
FISH_TTS_URL = "https://api.fish.audio/v1/tts"


class InworldTTSTransport(Protocol):
    def synthesize(self, *, url: str, api_key: str, payload: dict, timeout_sec: int) -> dict:
        ...


class BinaryTTSTransport(Protocol):
    def synthesize(self, *, url: str, api_key: str, payload: dict, timeout_sec: int) -> bytes:
        ...


@dataclass(slots=True)
class HttpInworldTTSTransport:
    def synthesize(self, *, url: str, api_key: str, payload: dict, timeout_sec: int) -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Basic {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with request.urlopen(req, timeout=timeout_sec) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Inworld TTS request failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Inworld TTS request failed: {exc.reason}") from exc


@dataclass(slots=True)
class HttpOpenAITTSTransport:
    def synthesize(self, *, url: str, api_key: str, payload: dict, timeout_sec: int) -> bytes:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
        )
        try:
            with request.urlopen(req, timeout=timeout_sec) as response:
                return response.read()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI TTS request failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"OpenAI TTS request failed: {exc.reason}") from exc


@dataclass(slots=True)
class HttpFishTTSTransport:
    def synthesize(self, *, url: str, api_key: str, payload: dict, timeout_sec: int) -> bytes:
        model_id = str(payload.pop("_model_id"))
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
                "model": model_id,
            },
        )
        try:
            with request.urlopen(req, timeout=timeout_sec) as response:
                return response.read()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Fish TTS request failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Fish TTS request failed: {exc.reason}") from exc


@dataclass(slots=True)
class InworldTTSAdapter:
    api_key: str
    transport: InworldTTSTransport | None = None
    default_voice_id: str = "Ashley"
    default_model_id: str = "inworld-tts-1.5-max"
    timeout_sec: int = 60
    default_audio_encoding: str = "MP3"
    endpoint_url: str = INWORLD_TTS_URL

    def synthesize(
        self,
        *,
        run_id: str,
        voiceover_plan: VoiceoverPlan,
        output_root: Path | str = ".outputs/creative-production",
    ) -> AudioAssetRecord:
        if not voiceover_plan.enabled:
            raise RuntimeError("voiceover plan is disabled")
        if not voiceover_plan.script.strip():
            raise RuntimeError("voiceover plan has no script")

        transport = self.transport or HttpInworldTTSTransport()
        payload = {
            "text": voiceover_plan.script,
            "voiceId": self.default_voice_id,
            "modelId": self.default_model_id,
            "audioConfig": {"audioEncoding": self.default_audio_encoding},
        }
        response = transport.synthesize(
            url=self.endpoint_url,
            api_key=self.api_key,
            payload=payload,
            timeout_sec=self.timeout_sec,
        )
        audio_b64 = response.get("audioContent")
        if not audio_b64:
            raise RuntimeError("Inworld TTS response did not include audioContent")

        output_path = Path(output_root) / run_id / f"voiceover{self._extension_for_encoding()}"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(base64.b64decode(audio_b64))

        usage = response.get("usage") or {}
        return AudioAssetRecord(
            asset_path=output_path,
            provider="inworld",
            model_id=str(usage.get("modelId") or self.default_model_id),
            voice_id=self.default_voice_id,
            mime_type=self._mime_type_for_encoding(),
            duration_s=_optional_float(response.get("audioDurationSeconds")),
            processed_characters=_optional_int(usage.get("processedCharactersCount")),
            metadata={
                "endpoint_url": self.endpoint_url,
                "audio_encoding": self.default_audio_encoding,
                "voice_direction": voiceover_plan.voice_direction,
            },
        )

    def _extension_for_encoding(self) -> str:
        normalized = self.default_audio_encoding.upper()
        if normalized in {"MP3", "MPEG"}:
            return ".mp3"
        if normalized in {"OGG", "OGG_OPUS"}:
            return ".ogg"
        return ".wav"

    def _mime_type_for_encoding(self) -> str:
        normalized = self.default_audio_encoding.upper()
        if normalized in {"MP3", "MPEG"}:
            return "audio/mpeg"
        if normalized in {"OGG", "OGG_OPUS"}:
            return "audio/ogg"
        return "audio/wav"


@dataclass(slots=True)
class FishTTSAdapter:
    api_key: str
    reference_id: str | None = None
    transport: BinaryTTSTransport | None = None
    default_model_id: str = "s2-pro"
    timeout_sec: int = 60
    response_format: str = "mp3"
    endpoint_url: str = FISH_TTS_URL

    def synthesize(
        self,
        *,
        run_id: str,
        voiceover_plan: VoiceoverPlan,
        output_root: Path | str = ".outputs/creative-production",
    ) -> AudioAssetRecord:
        if not voiceover_plan.enabled:
            raise RuntimeError("voiceover plan is disabled")
        if not voiceover_plan.script.strip():
            raise RuntimeError("voiceover plan has no script")

        transport = self.transport or HttpFishTTSTransport()
        payload: dict[str, Any] = {
            "_model_id": self.default_model_id,
            "text": voiceover_plan.script,
            "format": self.response_format,
        }
        if self.reference_id:
            payload["reference_id"] = self.reference_id
        audio_bytes = transport.synthesize(
            url=self.endpoint_url,
            api_key=self.api_key,
            payload=payload,
            timeout_sec=self.timeout_sec,
        )
        if not audio_bytes:
            raise RuntimeError("Fish TTS response did not include audio bytes")

        output_path = Path(output_root) / run_id / f"voiceover-fish.{self.response_format}"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(audio_bytes)

        return AudioAssetRecord(
            asset_path=output_path,
            provider="fish",
            model_id=self.default_model_id,
            voice_id=self.reference_id or "default",
            mime_type=self._mime_type_for_format(),
            processed_characters=len(voiceover_plan.script),
            metadata={
                "endpoint_url": self.endpoint_url,
                "response_format": self.response_format,
                "voice_direction": voiceover_plan.voice_direction,
                "reference_id_provided": bool(self.reference_id),
            },
        )

    def _mime_type_for_format(self) -> str:
        normalized = self.response_format.lower()
        if normalized == "mp3":
            return "audio/mpeg"
        if normalized == "wav":
            return "audio/wav"
        if normalized == "opus":
            return "audio/ogg"
        return "application/octet-stream"


@dataclass(slots=True)
class OpenAITTSAdapter:
    api_key: str
    transport: BinaryTTSTransport | None = None
    default_voice_id: str = "marin"
    default_model_id: str = "gpt-4o-mini-tts"
    timeout_sec: int = 60
    response_format: str = "mp3"
    endpoint_url: str = OPENAI_TTS_URL

    def synthesize(
        self,
        *,
        run_id: str,
        voiceover_plan: VoiceoverPlan,
        output_root: Path | str = ".outputs/creative-production",
    ) -> AudioAssetRecord:
        if not voiceover_plan.enabled:
            raise RuntimeError("voiceover plan is disabled")
        if not voiceover_plan.script.strip():
            raise RuntimeError("voiceover plan has no script")

        transport = self.transport or HttpOpenAITTSTransport()
        payload = {
            "model": self.default_model_id,
            "voice": self.default_voice_id,
            "input": voiceover_plan.script,
            "instructions": voiceover_plan.voice_direction,
            "response_format": self.response_format,
        }
        audio_bytes = transport.synthesize(
            url=self.endpoint_url,
            api_key=self.api_key,
            payload=payload,
            timeout_sec=self.timeout_sec,
        )
        if not audio_bytes:
            raise RuntimeError("OpenAI TTS response did not include audio bytes")

        output_path = Path(output_root) / run_id / f"voiceover-openai.{self.response_format}"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(audio_bytes)

        return AudioAssetRecord(
            asset_path=output_path,
            provider="openai",
            model_id=self.default_model_id,
            voice_id=self.default_voice_id,
            mime_type=self._mime_type_for_format(),
            processed_characters=len(voiceover_plan.script),
            metadata={
                "endpoint_url": self.endpoint_url,
                "response_format": self.response_format,
                "voice_direction": voiceover_plan.voice_direction,
            },
        )

    def _mime_type_for_format(self) -> str:
        normalized = self.response_format.lower()
        if normalized == "mp3":
            return "audio/mpeg"
        if normalized == "opus":
            return "audio/ogg"
        if normalized == "aac":
            return "audio/aac"
        if normalized == "flac":
            return "audio/flac"
        if normalized in {"wav", "pcm"}:
            return "audio/wav"
        return "application/octet-stream"


@dataclass(slots=True)
class FallbackTTSAdapter:
    primary: Any
    fallback: Any

    def synthesize(
        self,
        *,
        run_id: str,
        voiceover_plan: VoiceoverPlan,
        output_root: Path | str = ".outputs/creative-production",
    ) -> AudioAssetRecord:
        try:
            return self.primary.synthesize(
                run_id=run_id,
                voiceover_plan=voiceover_plan,
                output_root=output_root,
            )
        except Exception as primary_error:
            primary_provider = self._provider_name(self.primary)
            try:
                asset = self.fallback.synthesize(
                    run_id=run_id,
                    voiceover_plan=voiceover_plan,
                    output_root=output_root,
                )
            except Exception as fallback_error:
                fallback_provider = self._provider_name(self.fallback)
                raise RuntimeError(
                    "TTS fallback failed after primary provider failed: "
                    f"primary={primary_provider}: {primary_error}; "
                    f"fallback={fallback_provider}: {fallback_error}"
                ) from fallback_error
            existing_metadata = dict(asset.metadata or {})
            previous_chain = existing_metadata.get("fallback_chain")
            fallback_chain = previous_chain if isinstance(previous_chain, list) else []
            asset.metadata = {
                **existing_metadata,
                "fallback_from_provider": primary_provider,
                "fallback_reason": str(primary_error),
                "fallback_chain": [
                    {
                        "from_provider": primary_provider,
                        "reason": str(primary_error),
                    },
                    *fallback_chain,
                ],
            }
            return asset

    @staticmethod
    def _provider_name(adapter: Any) -> str:
        name = adapter.__class__.__name__.lower()
        if "fish" in name:
            return "fish"
        if "inworld" in name:
            return "inworld"
        if "openai" in name:
            return "openai"
        return name


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)
