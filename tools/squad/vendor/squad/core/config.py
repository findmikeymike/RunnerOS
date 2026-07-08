"""Environment-driven runtime settings."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any


def _split_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


DEFAULT_FISH_TTS_REFERENCE_ID = "fd53c49c6273477793ebac03b0ee70bd"


@dataclass(frozen=True)
class Settings:
    app_env: str = "development"
    postgres_dsn: str | None = None
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str | None = None
    default_channel: str = "x"
    search_provider: str = "auto"
    image_factory_output_root: str = "./.outputs/image-factory"
    fal_api_key: str | None = None
    fal_api_base_url: str = "https://fal.run"
    fal_timeout_sec: int = 120
    wavespeed_api_key: str | None = None
    wavespeed_api_base_url: str = "https://api.wavespeed.ai/api"
    wavespeed_timeout_sec: int = 300
    wavespeed_poll_interval_sec: float = 2.0
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_story_writer_model: str = "gpt-4.1-mini"
    openai_shotlist_director_model: str = "gpt-4.1-mini"
    image_eval_provider: str = "off"
    openai_image_scorer_model: str = "gpt-4.1-mini"
    openai_image_scorer_cost_usd: float = 0.0
    image_factory_max_regeneration_attempts: int = 1
    image_background_removal_provider: str = "auto"
    fal_background_removal_model: str = "fal-ai/imageutils/rembg"
    fal_background_removal_cost_usd: float = 0.0
    fish_tts_api_key: str | None = None
    fish_tts_reference_id: str | None = DEFAULT_FISH_TTS_REFERENCE_ID
    fish_tts_model_id: str = "s2-pro"
    inworld_tts_api_key: str | None = None
    inworld_tts_voice_id: str = "Ashley"
    heygen_api_key: str | None = None
    heygen_avatar_id: str | None = None
    heygen_voice_id: str | None = None
    heygen_persona_map: dict[str, dict[str, str]] = field(default_factory=dict)
    heygen_timeout_sec: int = 900
    heygen_poll_interval_sec: float = 5.0
    ugc_heygen_audio_source: str = "heygen_script"
    brand_required_terms: tuple[str, ...] = field(default_factory=tuple)
    brand_forbidden_terms: tuple[str, ...] = field(default_factory=tuple)
    policy_banned_phrases: tuple[str, ...] = field(default_factory=tuple)

    @property
    def brand_guidelines(self) -> dict[str, Any]:
        return {
            "required_terms": list(self.brand_required_terms),
            "forbidden_terms": list(self.brand_forbidden_terms),
            "policy_banned_phrases": list(self.policy_banned_phrases),
        }


def load_settings(prefix: str = "SQUAD") -> Settings:
    return Settings(
        app_env=os.getenv(f"{prefix}_ENV", "development"),
        postgres_dsn=os.getenv(f"{prefix}_POSTGRES_DSN"),
        langsmith_tracing=os.getenv(f"{prefix}_LANGSMITH_TRACING", "").lower() in {"1", "true", "yes"},
        langsmith_api_key=os.getenv(f"{prefix}_LANGSMITH_API_KEY"),
        langsmith_project=os.getenv(f"{prefix}_LANGSMITH_PROJECT"),
        default_channel=os.getenv(f"{prefix}_DEFAULT_CHANNEL", "x"),
        search_provider=os.getenv(f"{prefix}_SEARCH_PROVIDER", "auto"),
        image_factory_output_root=os.getenv(f"{prefix}_IMAGE_FACTORY_OUTPUT_ROOT", "./.outputs/image-factory"),
        fal_api_key=os.getenv(f"{prefix}_FAL_API_KEY"),
        fal_api_base_url=os.getenv(f"{prefix}_FAL_API_BASE_URL", "https://fal.run"),
        fal_timeout_sec=int(os.getenv(f"{prefix}_FAL_TIMEOUT_SEC", "120")),
        wavespeed_api_key=os.getenv(f"{prefix}_WAVESPEED_API_KEY") or os.getenv("WAVESPEED_API_KEY"),
        wavespeed_api_base_url=os.getenv(
            f"{prefix}_WAVESPEED_API_BASE_URL",
            "https://api.wavespeed.ai/api",
        ).rstrip("/"),
        wavespeed_timeout_sec=int(os.getenv(f"{prefix}_WAVESPEED_TIMEOUT_SEC", "300")),
        wavespeed_poll_interval_sec=float(os.getenv(f"{prefix}_WAVESPEED_POLL_INTERVAL_SEC", "2.0")),
        openai_api_key=os.getenv(f"{prefix}_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"),
        openai_base_url=os.getenv(f"{prefix}_OPENAI_BASE_URL"),
        openai_story_writer_model=os.getenv(f"{prefix}_OPENAI_STORY_WRITER_MODEL", "gpt-4.1-mini"),
        openai_shotlist_director_model=os.getenv(f"{prefix}_OPENAI_SHOTLIST_DIRECTOR_MODEL", "gpt-4.1-mini"),
        image_eval_provider=os.getenv(f"{prefix}_IMAGE_EVAL_PROVIDER", "off"),
        openai_image_scorer_model=os.getenv(
            f"{prefix}_OPENAI_IMAGE_SCORER_MODEL",
            "gpt-4.1-mini",
        ),
        openai_image_scorer_cost_usd=float(
            os.getenv(f"{prefix}_OPENAI_IMAGE_SCORER_COST_USD", "0.0")
        ),
        image_factory_max_regeneration_attempts=int(
            os.getenv(f"{prefix}_IMAGE_FACTORY_MAX_REGENERATION_ATTEMPTS", "1")
        ),
        image_background_removal_provider=os.getenv(f"{prefix}_IMAGE_BACKGROUND_REMOVAL_PROVIDER", "auto"),
        fal_background_removal_model=os.getenv(
            f"{prefix}_FAL_BACKGROUND_REMOVAL_MODEL",
            "fal-ai/imageutils/rembg",
        ),
        fal_background_removal_cost_usd=float(
            os.getenv(f"{prefix}_FAL_BACKGROUND_REMOVAL_COST_USD", "0.0")
        ),
        fish_tts_api_key=os.getenv(f"{prefix}_FISH_TTS_API_KEY") or os.getenv("FISH_AUDIO_API_KEY"),
        fish_tts_reference_id=(
            os.getenv(f"{prefix}_FISH_TTS_REFERENCE_ID")
            or os.getenv(f"{prefix}_FISH_TTS_VOICE_ID")
            or os.getenv("FISH_TTS_REFERENCE_ID")
            or os.getenv("FISH_TTS_VOICE_ID")
            or DEFAULT_FISH_TTS_REFERENCE_ID
        ),
        fish_tts_model_id=os.getenv(f"{prefix}_FISH_TTS_MODEL_ID", "s2-pro"),
        inworld_tts_api_key=os.getenv(f"{prefix}_INWORLD_TTS_API_KEY") or os.getenv("INWORLD_TTS_API_KEY"),
        inworld_tts_voice_id=os.getenv(f"{prefix}_INWORLD_TTS_VOICE_ID") or os.getenv("INWORLD_TTS_VOICE_ID") or "Ashley",
        heygen_api_key=os.getenv(f"{prefix}_HEYGEN_API_KEY") or os.getenv("HEYGEN_API_KEY"),
        heygen_avatar_id=os.getenv(f"{prefix}_HEYGEN_AVATAR_ID"),
        heygen_voice_id=os.getenv(f"{prefix}_HEYGEN_VOICE_ID"),
        heygen_persona_map=_load_json_mapping(os.getenv(f"{prefix}_HEYGEN_PERSONA_MAP_JSON")),
        heygen_timeout_sec=int(os.getenv(f"{prefix}_HEYGEN_TIMEOUT_SEC", "900")),
        heygen_poll_interval_sec=float(os.getenv(f"{prefix}_HEYGEN_POLL_INTERVAL_SEC", "5.0")),
        ugc_heygen_audio_source=os.getenv(f"{prefix}_UGC_HEYGEN_AUDIO_SOURCE", "heygen_script").strip().lower(),
        brand_required_terms=_split_csv(os.getenv(f"{prefix}_BRAND_REQUIRED_TERMS")),
        brand_forbidden_terms=_split_csv(os.getenv(f"{prefix}_BRAND_FORBIDDEN_TERMS")),
        policy_banned_phrases=_split_csv(os.getenv(f"{prefix}_POLICY_BANNED_PHRASES")),
    )


def _load_json_mapping(value: str | None) -> dict[str, dict[str, str]]:
    if not value:
        return {}
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RuntimeError("SQUAD_HEYGEN_PERSONA_MAP_JSON must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("SQUAD_HEYGEN_PERSONA_MAP_JSON must be a JSON object")
    cleaned: dict[str, dict[str, str]] = {}
    for raw_key, raw_config in payload.items():
        if not isinstance(raw_config, dict):
            continue
        key = str(raw_key or "").strip().lower()
        if not key:
            continue
        config = {
            field: str(raw_config.get(field) or "").strip()
            for field in ("avatar_id", "voice_id", "avatar_kind")
            if str(raw_config.get(field) or "").strip()
        }
        if config:
            cleaned[key] = config
    return cleaned
