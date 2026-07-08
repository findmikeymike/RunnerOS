"""Scoring interfaces for Sprint 1 image-factory quality gates."""

from __future__ import annotations

import base64
from dataclasses import dataclass
import json
import mimetypes
import time
from typing import Protocol
from creative.image_factory.contracts import (
    ImageFactoryRequest,
    ImageGenerationPlan,
    ImageVariant,
    PreparedProductAsset,
)
from creative.image_factory.evals import ImageEvalRecord, verdict_for_score


class ImageScorer(Protocol):
    """Scorer boundary for post-generation image evaluation."""

    def score(
        self,
        *,
        run_id: str,
        request: ImageFactoryRequest,
        prepared_asset: PreparedProductAsset,
        plan: ImageGenerationPlan,
        variant: ImageVariant,
    ) -> ImageScoringResult:
        """Return an evaluation record plus any provider metadata for one variant."""


@dataclass(frozen=True, slots=True)
class ImageScoringResult:
    evaluation: ImageEvalRecord
    provider: str | None = None
    operation: str | None = None
    cost_usd: float = 0.0
    provider_request_id: str | None = None
    latency_ms: float | None = None
    metadata: dict | None = None


SCORER_SYSTEM_PROMPT = """You are a ruthless creative quality scorer for AI-generated marketing images.

Respond only with JSON that matches the supplied schema.
Be honest. Most generated images are average. Do not inflate scores.
Score against the brief, the style intent, the platform, and the product/reference image.
"""


OPENAI_TOKEN_PRICING_PER_1M = {
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
}


def _image_eval_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "product_fidelity": {
                "anyOf": [{"type": "number", "minimum": 1.0, "maximum": 5.0}, {"type": "null"}]
            },
            "scene_believability": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "style_adherence": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "composition": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "platform_readiness": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "weighted_average": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "top_issue": {"type": "string", "minLength": 1},
            "regeneration_hint": {"type": "string", "minLength": 1},
            "verdict": {"type": "string", "enum": ["ship", "regenerate", "human_review"]},
        },
        "required": [
            "product_fidelity",
            "scene_believability",
            "style_adherence",
            "composition",
            "platform_readiness",
            "weighted_average",
            "top_issue",
            "regeneration_hint",
            "verdict",
        ],
        "additionalProperties": False,
    }


def _style_family_for_request(request: ImageFactoryRequest) -> str:
    if request.metadata.get("style_family"):
        return str(request.metadata["style_family"])
    if request.style_tags:
        return ",".join(request.style_tags)
    return "unspecified"


def _image_to_data_url(path) -> str:
    mime_type = mimetypes.guess_type(str(path))[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _estimate_openai_cost_from_usage(model: str, usage_payload: dict[str, int]) -> float | None:
    pricing = OPENAI_TOKEN_PRICING_PER_1M.get(model)
    if pricing is None:
        return None
    input_tokens = int(usage_payload.get("input_tokens", 0))
    output_tokens = int(usage_payload.get("output_tokens", 0))
    cost = (
        (input_tokens / 1_000_000) * float(pricing["input"])
        + (output_tokens / 1_000_000) * float(pricing["output"])
    )
    return round(cost, 6)


@dataclass(frozen=True, slots=True)
class OpenAIResponsesImageScorer:
    api_key: str
    model: str = "gpt-4.1-mini"
    base_url: str | None = None
    estimated_cost_usd: float = 0.0
    timeout_sec: int = 120
    client: object | None = None

    def _client(self):
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("openai package is required for OpenAI image scoring") from exc
        kwargs = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        return OpenAI(**kwargs)

    def score(
        self,
        *,
        run_id: str,
        request: ImageFactoryRequest,
        prepared_asset: PreparedProductAsset,
        plan: ImageGenerationPlan,
        variant: ImageVariant,
    ) -> ImageScoringResult:
        client = self._client()
        style_family = _style_family_for_request(request)
        prompt = (
            "Score this generated marketing image against the brief and reference image.\n\n"
            f"Brief: {request.scene_brief}\n"
            f"Template: {plan.template_id}\n"
            f"Style family: {style_family}\n"
            "Use these dimensions on a 1-5 scale: product_fidelity, scene_believability, "
            "style_adherence, composition, platform_readiness.\n"
            "weighted_average must be the overall judgment on the same 1-5 scale.\n"
            "Return a strict JSON object only."
        )
        content = [
            {"type": "input_text", "text": prompt},
            {"type": "input_image", "image_url": _image_to_data_url(variant.local_path)},
        ]
        if prepared_asset.prepared_path.exists():
            content.append(
                {"type": "input_image", "image_url": _image_to_data_url(prepared_asset.prepared_path)}
            )
        start = time.monotonic()
        response = client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": SCORER_SYSTEM_PROMPT}]},
                {"role": "user", "content": content},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "image_eval",
                    "strict": True,
                    "schema": _image_eval_schema(),
                }
            },
            store=False,
        )
        latency_ms = round((time.monotonic() - start) * 1000.0, 3)
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
            raise RuntimeError("OpenAI image scorer returned no output_text")
        data = json.loads(raw_text)
        weighted_average = float(data["weighted_average"])
        normalized_verdict = verdict_for_score(weighted_average)
        top_issue = str(data["top_issue"])
        if str(data["verdict"]) != normalized_verdict:
            top_issue = f"{top_issue} [normalized verdict from score]"
        evaluation = ImageEvalRecord(
            asset_id=variant.variant_id,
            run_id=run_id,
            template_id=plan.template_id,
            style_family=style_family,
            attempt_index=plan.attempt_index,
            product_fidelity=data.get("product_fidelity"),
            scene_believability=float(data["scene_believability"]),
            style_adherence=float(data["style_adherence"]),
            composition=float(data["composition"]),
            platform_readiness=float(data["platform_readiness"]),
            weighted_average=weighted_average,
            top_issue=top_issue,
            regeneration_hint=str(data["regeneration_hint"]),
            verdict=normalized_verdict,
        )
        usage = getattr(response, "usage", None)
        usage_payload = {}
        if usage is not None:
            for key in ("input_tokens", "output_tokens", "total_tokens"):
                value = getattr(usage, key, None)
                if value is not None:
                    usage_payload[key] = value
        computed_cost = _estimate_openai_cost_from_usage(self.model, usage_payload)
        return ImageScoringResult(
            evaluation=evaluation,
            provider="openai",
            operation="image.score",
            cost_usd=float(computed_cost if computed_cost is not None else self.estimated_cost_usd),
            provider_request_id=getattr(response, "id", None),
            latency_ms=latency_ms,
            metadata={
                "model": self.model,
                "usage": usage_payload,
            },
        )


@dataclass(frozen=True, slots=True)
class StructuralImageScorer:
    """
    Minimal Sprint 1 scorer.

    This is intentionally not a taste/vision model. It only checks structural
    facts we can verify locally so the workflow can persist eval artifacts
    without pretending this is final creative judgment.
    """

    default_score: float = 4.0

    def score(
        self,
        *,
        run_id: str,
        request: ImageFactoryRequest,
        prepared_asset: PreparedProductAsset,
        plan: ImageGenerationPlan,
        variant: ImageVariant,
    ) -> ImageScoringResult:
        style_family = _style_family_for_request(request)
        width, height = int(variant.width), int(variant.height)
        if width <= 0 or height <= 0:
            raise ValueError("generated asset dimensions must be positive")

        top_issue = "structural-only score; creative review still required"
        regeneration_hint = "use a multimodal scorer or human review for creative quality"
        return ImageScoringResult(
            evaluation=ImageEvalRecord(
                asset_id=variant.variant_id,
                run_id=run_id,
                template_id=plan.template_id,
                style_family=style_family,
                attempt_index=plan.attempt_index,
                product_fidelity=self.default_score if prepared_asset.background_removed or prepared_asset.source_path.exists() else 3.0,
                scene_believability=self.default_score,
                style_adherence=self.default_score,
                composition=self.default_score,
                platform_readiness=self.default_score,
                weighted_average=self.default_score,
                top_issue=top_issue,
                regeneration_hint=regeneration_hint,
                verdict="ship",
            )
        )
