"""Brand review agent built on top of the first-loop scorer."""

from __future__ import annotations

from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent
from evals.scorer import EvaluationContext, score_content


class BrandAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            AgentSpec(
                id="brand-agent",
                mission="Score drafts for brand and policy fit before approval.",
                system_prompt="Review drafts for voice, banned terms, and channel fit.",
                tools=(),
                approval_policy=ApprovalPolicy.NONE,
                output_schema={"passed": "bool", "overall": "float", "risk_flags": "list[str]"},
            )
        )

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        text = str(payload.get("text") or payload.get("draft") or "").strip()
        channel = str(payload.get("channel") or context.metadata.get("channel") or "x")
        result = score_content(
            text,
            EvaluationContext(
                agent_id=self.spec.id,
                channel=channel,
                brand_guidelines=context.brand_guidelines,
                channel_rules=context.channel_rules,
            ),
        )
        recommendations = []
        if not result.passed:
            recommendations.append("Tighten the draft before approval.")
        if result.risk_flags:
            recommendations.append("Resolve flagged policy or channel issues.")
        return {
            "passed": result.passed,
            "overall": result.overall,
            "breakdown": result.breakdown.__dict__,
            "risk_flags": result.risk_flags,
            "notes": result.notes,
            "recommendations": recommendations,
        }
