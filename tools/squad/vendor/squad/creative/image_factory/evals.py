"""Evaluation contracts for Sprint 1 image-factory quality gating."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


EvalVerdict = Literal["ship", "regenerate", "human_review"]
RunDecisionVerdict = Literal["ship", "regenerate", "human_review", "unscored"]

SHIP_THRESHOLD = 3.5
REGENERATE_THRESHOLD = 2.5

IMAGE_EVAL_WEIGHTS = {
    "product_fidelity": 0.25,
    "scene_believability": 0.20,
    "style_adherence": 0.20,
    "composition": 0.20,
    "platform_readiness": 0.15,
}


def verdict_for_score(weighted_average: float) -> EvalVerdict:
    score = float(weighted_average)
    if score >= SHIP_THRESHOLD:
        return "ship"
    if score >= REGENERATE_THRESHOLD:
        return "regenerate"
    return "human_review"


@dataclass(frozen=True, slots=True)
class ImageEvalRecord:
    asset_id: str
    run_id: str
    template_id: str
    style_family: str
    attempt_index: int
    product_fidelity: float | None
    scene_believability: float
    style_adherence: float
    composition: float
    platform_readiness: float
    weighted_average: float
    top_issue: str
    regeneration_hint: str
    verdict: EvalVerdict

    def __post_init__(self) -> None:
        self._validate_optional_score("product_fidelity", self.product_fidelity)
        self._validate_score("scene_believability", self.scene_believability)
        self._validate_score("style_adherence", self.style_adherence)
        self._validate_score("composition", self.composition)
        self._validate_score("platform_readiness", self.platform_readiness)
        self._validate_score("weighted_average", self.weighted_average)
        if self.verdict != verdict_for_score(self.weighted_average):
            raise ValueError("verdict does not match weighted_average thresholds")
        if not self.asset_id.strip():
            raise ValueError("asset_id must not be empty")
        if not self.run_id.strip():
            raise ValueError("run_id must not be empty")
        if not self.template_id.strip():
            raise ValueError("template_id must not be empty")
        if not self.style_family.strip():
            raise ValueError("style_family must not be empty")
        if int(self.attempt_index) < 1:
            raise ValueError("attempt_index must be at least 1")
        if not self.top_issue.strip():
            raise ValueError("top_issue must not be empty")
        if not self.regeneration_hint.strip():
            raise ValueError("regeneration_hint must not be empty")

    @staticmethod
    def _validate_score(field_name: str, value: float) -> None:
        score = float(value)
        if score < 1.0 or score > 5.0:
            raise ValueError(f"{field_name} must be between 1.0 and 5.0")

    @classmethod
    def _validate_optional_score(cls, field_name: str, value: float | None) -> None:
        if value is None:
            return
        cls._validate_score(field_name, value)


@dataclass(frozen=True, slots=True)
class ImageRunDecision:
    verdict: RunDecisionVerdict
    selected_asset_id: str | None
    selected_score: float | None
    reason: str
    attempt_index: int = 1

    def __post_init__(self) -> None:
        if not self.reason.strip():
            raise ValueError("reason must not be empty")
        if int(self.attempt_index) < 1:
            raise ValueError("attempt_index must be at least 1")


def choose_run_decision(
    evaluations: tuple[ImageEvalRecord, ...] | list[ImageEvalRecord],
) -> ImageRunDecision:
    records = tuple(evaluations)
    if not records:
        return ImageRunDecision(
            verdict="unscored",
            selected_asset_id=None,
            selected_score=None,
            reason="no evaluations were produced for this run",
            attempt_index=1,
        )

    ranked = sorted(records, key=lambda item: item.weighted_average, reverse=True)
    shippable = [item for item in ranked if item.verdict == "ship"]
    if shippable:
        winner = shippable[0]
        return ImageRunDecision(
            verdict="ship",
            selected_asset_id=winner.asset_id,
            selected_score=winner.weighted_average,
            reason="at least one variant met the ship threshold",
            attempt_index=winner.attempt_index,
        )

    regeneratable = [item for item in ranked if item.verdict == "regenerate"]
    if regeneratable:
        winner = regeneratable[0]
        return ImageRunDecision(
            verdict="regenerate",
            selected_asset_id=winner.asset_id,
            selected_score=winner.weighted_average,
            reason="no variant shipped, but at least one is worth a regeneration pass",
            attempt_index=winner.attempt_index,
        )

    winner = ranked[0]
    return ImageRunDecision(
        verdict="human_review",
        selected_asset_id=winner.asset_id,
        selected_score=winner.weighted_average,
        reason="all evaluated variants fell below the regeneration threshold",
        attempt_index=winner.attempt_index,
    )
