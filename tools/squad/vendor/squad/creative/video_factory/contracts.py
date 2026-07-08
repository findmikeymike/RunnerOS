"""Typed contracts for Sprint 2 video/voice factory adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path


class QualityTier(StrEnum):
    BUDGET = "budget"
    STANDARD = "standard"
    PREMIUM = "premium"


@dataclass(frozen=True, slots=True)
class CostRecord:
    operation: str
    model: str
    input_params: dict
    cost_usd: float
    duration_s: float
    provider_request_id: str | None = None


@dataclass(frozen=True, slots=True)
class GeneratedAsset:
    file_path: Path
    mime_type: str
    duration_s: float | None
    width: int | None
    height: int | None
    cost: CostRecord
    metadata: dict = field(default_factory=dict)


class VideoFactoryError(RuntimeError):
    """Base runtime error for Sprint 2 video factory work."""


class BudgetExceededError(VideoFactoryError):
    """Raised when a requested generation would exceed the budget cap."""


class VideoGenerationError(VideoFactoryError):
    """Raised when video generation or download fails."""
