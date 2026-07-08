from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Literal, TypedDict
from uuid import uuid4

from content.agents.brief_analyzer import BriefAnalysis
from content.agents.prompt_composer import ComposedPrompt
from content.agents.template_selector import TemplateSelection
from content.writing.brief_generator import CreativeBrief


ALLOWED_DIRECTOR_ACTIONS = (
    "retry_same_direction",
    "retry_with_prompt_adjustment",
    "switch_style_family",
    "switch_template",
    "downgrade_scope_to_image_only",
    "escalate_to_human_review",
    "ship_candidate_for_review",
)


AllowedDirectorAction = Literal[
    "retry_same_direction",
    "retry_with_prompt_adjustment",
    "switch_style_family",
    "switch_template",
    "downgrade_scope_to_image_only",
    "escalate_to_human_review",
    "ship_candidate_for_review",
]


class DirectorFinalStatus(StrEnum):
    RUNNING = "running"
    REVIEW_READY = "review_ready"
    ESCALATED = "escalated"


@dataclass(slots=True)
class CreativeDirectorInput:
    brief: CreativeBrief
    budget_cap_usd: float | None = None
    max_attempts: int = 3
    run_id: str = field(default_factory=lambda: f"creative-director-{uuid4().hex[:12]}")

    @property
    def effective_budget_cap_usd(self) -> float:
        return float(self.budget_cap_usd if self.budget_cap_usd is not None else self.brief.max_cost_usd)


@dataclass(slots=True)
class DirectionPlan:
    style_family: str
    template_id: str
    quality_tier: str
    variant_count: int
    model_id: str
    reasoning: str = ""


@dataclass(slots=True)
class CandidateRecord:
    candidate_id: str
    run_id: str
    asset_id: str
    asset_path: Path | None
    score: float
    verdict: str
    attempt_index: int
    style_family: str
    template_id: str
    prompt_summary: str
    warnings: tuple[str, ...] = ()


@dataclass(slots=True)
class DirectorReviewResult:
    run_id: str
    selected_candidate: CandidateRecord | None
    score: float | None
    verdict: str
    top_issue: str
    regeneration_hint: str
    warnings: tuple[str, ...] = ()
    review_summary: str = ""


@dataclass(slots=True)
class CreativeDirectorDecision:
    action: AllowedDirectorAction
    rationale: str
    prompt_adjustment: str | None = None
    next_style_family: str | None = None
    next_template_id: str | None = None
    confidence: float | None = None


@dataclass(slots=True)
class AttemptRecord:
    attempt_index: int
    style_family: str
    template_id: str
    quality_tier: str
    prompt_summary: str
    result_run_id: str
    selected_variant_id: str | None
    score_summary: float | None
    decision_verdict: str
    regeneration_hint: str
    cost_usd: float


@dataclass(slots=True)
class HumanReviewPacket:
    summary: str
    selected_candidate: CandidateRecord | None
    review_path: Path | None
    approval_payload: dict
    warnings: tuple[str, ...] = ()


@dataclass(slots=True)
class CreativeDirectorState:
    run_id: str
    brief_raw: str
    brief_input: CreativeDirectorInput
    creative_goal: str
    budget_cap_usd: float
    attempt_count: int
    max_attempts: int
    attempt_history: list[AttemptRecord]
    total_spend_usd: float = 0.0
    brief_analysis: BriefAnalysis | None = None
    current_direction: DirectionPlan | None = None
    current_prompt_plan: ComposedPrompt | None = None
    best_candidate: CandidateRecord | None = None
    latest_result: DirectorReviewResult | None = None
    latest_decision: CreativeDirectorDecision | None = None
    latest_generation: object | None = None
    generation_history: dict[str, object] = field(default_factory=dict)
    review_generation: object | None = None
    review_required: bool = True
    final_status: DirectorFinalStatus = DirectorFinalStatus.RUNNING
    human_review_packet: HumanReviewPacket | None = None
    director_manifest_path: Path | None = None


class GraphEnvelope(TypedDict):
    director_state: CreativeDirectorState
