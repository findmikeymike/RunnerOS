"""Contracts for the Sprint 1 image factory path."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, TypedDict

from creative.image_factory.evals import ImageEvalRecord, ImageRunDecision


TemplateCategory = Literal[
    "product_placement",
    "lifestyle_shot",
    "social_thumb",
    "hero_banner",
]

QualityTier = Literal["draft", "balanced", "premium"]
BackgroundMode = Literal["keep", "remove", "auto"]
WorkflowStatus = Literal["pending", "running", "awaiting_review", "completed", "failed"]

ALLOWED_QUALITY_TIERS = {"draft", "balanced", "premium"}
ALLOWED_BACKGROUND_MODES = {"keep", "remove", "auto"}
ALLOWED_ASPECT_RATIOS = {"1:1", "9:16", "16:9", "4:3", "3:4"}


def normalize_aspect_ratio(aspect_ratio: str | None) -> str:
    normalized = str(aspect_ratio or "1:1").strip()
    if not normalized:
        raise ValueError("aspect_ratio must not be blank")
    if normalized not in ALLOWED_ASPECT_RATIOS:
        raise ValueError(
            "aspect_ratio must be one of: "
            f"{', '.join(sorted(ALLOWED_ASPECT_RATIOS))}"
        )
    return normalized


@dataclass(frozen=True, slots=True)
class PromptTemplate:
    id: str
    name: str
    category: TemplateCategory
    base_prompt: str
    style_modifiers: tuple[str, ...]
    negative_prompt: str | None
    recommended_model: str
    reference_image_slots: int = 1


@dataclass(frozen=True, slots=True)
class ImageFactoryRequest:
    product_image_path: Path
    scene_brief: str
    template_id: str
    style_tags: tuple[str, ...] = ()
    variant_count: int = 3
    quality_tier: QualityTier = "balanced"
    background_mode: BackgroundMode = "auto"
    reference_image_paths: tuple[Path, ...] = ()
    negative_prompt: str | None = None
    aspect_ratio: str = "1:1"
    budget_cap_usd: float = 0.5
    model_id_override: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not str(self.scene_brief).strip():
            raise ValueError("scene_brief must not be empty")
        if not str(self.template_id).strip():
            raise ValueError("template_id must not be empty")
        if str(self.quality_tier) not in ALLOWED_QUALITY_TIERS:
            raise ValueError(
                "quality_tier must be one of: draft, balanced, premium"
            )
        if str(self.background_mode) not in ALLOWED_BACKGROUND_MODES:
            raise ValueError(
                "background_mode must be one of: keep, remove, auto"
            )
        if int(self.variant_count) < 1:
            raise ValueError("variant_count must be at least 1")
        if float(self.budget_cap_usd) < 0.0:
            raise ValueError("budget_cap_usd must be non-negative")
        if self.model_id_override is not None and not self.model_id_override.strip():
            raise ValueError("model_id_override must not be blank when provided")
        object.__setattr__(self, "aspect_ratio", normalize_aspect_ratio(self.aspect_ratio))


@dataclass(frozen=True, slots=True)
class PreparedProductAsset:
    source_path: Path
    prepared_path: Path
    background_removed: bool
    width: int
    height: int
    reference_paths: tuple[Path, ...] = ()
    background_provider_name: str | None = None
    background_removal_request_id: str | None = None
    background_removal_latency_ms: float | None = None
    background_removal_cost_usd: float = 0.0
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class VariantSpec:
    variant_id: str
    seed: int | None = None
    aspect_ratio: str = "1:1"


@dataclass(frozen=True, slots=True)
class ImageGenerationPlan:
    model_id: str
    resolved_prompt: str
    negative_prompt: str | None
    reference_paths: tuple[Path, ...]
    variant_specs: tuple[VariantSpec, ...]
    estimated_cost_usd: float
    template_id: str
    attempt_index: int = 1
    regeneration_hint: str | None = None
    model_parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ImageVariant:
    variant_id: str
    model_id: str
    seed: int | None
    remote_url: str | None
    local_path: Path
    width: int
    height: int
    cost_usd: float
    latency_ms: float | None
    prompt_snapshot: str
    attempt_index: int = 1


@dataclass(frozen=True, slots=True)
class ImageFactoryResult:
    run_id: str
    status: WorkflowStatus
    variants: tuple[ImageVariant, ...]
    total_cost_usd: float
    manifest_path: Path
    evaluations: tuple[ImageEvalRecord, ...] = ()
    decision: ImageRunDecision | None = None
    warnings: tuple[str, ...] = ()
    trace_url: str | None = None
    attempts_run: int = 1
    review_packet_path: Path | None = None
    approval_request_id: str | None = None


class ImageFactoryState(TypedDict, total=False):
    run_id: str
    request: ImageFactoryRequest
    prepared_asset: PreparedProductAsset
    plan: ImageGenerationPlan
    variants: tuple[ImageVariant, ...]
    evaluations: tuple[ImageEvalRecord, ...]
    decision: ImageRunDecision | None
    total_cost_usd: float
    attempts_run: int
    warnings: list[str]
    errors: list[str]
