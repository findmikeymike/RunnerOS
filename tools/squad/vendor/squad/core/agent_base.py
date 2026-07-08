"""Minimal shared agent contract for the first working loop."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping


class ApprovalPolicy(StrEnum):
    NONE = "none"
    SOFT = "soft"
    REQUIRED = "required"


@dataclass(frozen=True)
class AgentSpec:
    id: str
    mission: str
    system_prompt: str
    tools: tuple[str, ...] = ()
    approval_policy: ApprovalPolicy = ApprovalPolicy.NONE
    output_schema: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class AgentContext:
    run_id: str
    brand_guidelines: Mapping[str, Any] = field(default_factory=dict)
    channel_rules: Mapping[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """Shared interface for all initial agents."""

    spec: AgentSpec

    def __init__(self, spec: AgentSpec) -> None:
        self.spec = spec

    @abstractmethod
    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        """Return a structured output matching the agent's output schema."""

