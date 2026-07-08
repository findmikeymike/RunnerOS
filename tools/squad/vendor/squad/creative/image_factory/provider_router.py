"""Provider dispatcher for image factory generation clients."""

from __future__ import annotations

from dataclasses import is_dataclass, replace
from typing import Any

from creative.production.model_routing import default_image_model_registry


class ImageProviderRoutingClient:
    def __init__(
        self,
        *,
        fal_client: Any | None,
        openai_client: Any | None,
        allow_cross_provider_fallback: bool = False,
    ) -> None:
        self.fal_client = fal_client
        self.openai_client = openai_client
        self.allow_cross_provider_fallback = allow_cross_provider_fallback
        self._provider_by_model = {
            model.model_id: model.provider
            for model in default_image_model_registry()
        }

    def generate_variants(self, **kwargs):
        plan = kwargs["plan"]
        provider = self._provider_by_model.get(plan.model_id)
        if provider is None:
            provider = "fal" if str(plan.model_id).startswith("fal-ai/") else "openai"
        if provider == "openai":
            if self.openai_client is None:
                raise RuntimeError("OpenAI image client is not configured")
            return self.openai_client.generate_variants(**kwargs)
        if provider == "fal":
            if self.fal_client is None:
                if self.openai_client is not None and self.allow_cross_provider_fallback:
                    kwargs = {
                        **kwargs,
                        "plan": _fallback_to_openai_plan(plan),
                    }
                    return self.openai_client.generate_variants(**kwargs)
                raise RuntimeError("Fal image client is not configured")
            try:
                return self.fal_client.generate_variants(**kwargs)
            except Exception as exc:
                if (
                    self.openai_client is not None
                    and self.allow_cross_provider_fallback
                    and _is_safe_fal_fallback_error(exc)
                ):
                    kwargs = {
                        **kwargs,
                        "plan": _fallback_to_openai_plan(plan),
                    }
                    return self.openai_client.generate_variants(**kwargs)
                raise
        raise RuntimeError(f"Unsupported image provider for model {plan.model_id!r}: {provider}")


def _fallback_to_openai_plan(plan):
    if not is_dataclass(plan):
        raise RuntimeError("Fal image client is not configured")
    variant_count = len(getattr(plan, "variant_specs", ()) or ())
    return replace(
        plan,
        model_id="gpt-image-1.5",
        estimated_cost_usd=round(0.009 * max(1, variant_count), 4),
        model_parameters={
            "quality": "low",
            "size": "1024x1024",
            "input_fidelity": "high",
            "fallback_from_model_id": str(getattr(plan, "model_id", "")),
            "fallback_reason": "fal_client_missing",
        },
    )


def _is_safe_fal_fallback_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    current = exc.__cause__ or exc.__context__
    seen: set[int] = {id(exc)}
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message += "\n" + str(current).lower()
        current = current.__cause__ or current.__context__

    safe_markers = (
        "storage/auth/token",
        "upload_file",
        "upload file",
        "fal-cdn",
        "fal image client is not configured",
    )
    auth_markers = ("403 forbidden", "401 unauthorized", "unauthorized", "forbidden")
    return any(marker in message for marker in safe_markers) and any(marker in message for marker in auth_markers)
