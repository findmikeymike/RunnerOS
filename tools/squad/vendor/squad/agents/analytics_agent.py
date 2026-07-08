"""Analytics and retro agent for the first working loop."""

from __future__ import annotations

from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent


class AnalyticsAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            AgentSpec(
                id="analytics-agent",
                mission="Summarize outcome quality, costs, and next-step recommendations.",
                system_prompt="Turn run artifacts into a compact retrospective.",
                tools=(),
                approval_policy=ApprovalPolicy.NONE,
                output_schema={"status": "str", "recommendations": "list[str]", "summary": "str"},
            )
        )

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        del context
        approval_status = str(payload.get("approval_status") or "pending")
        score = float(payload.get("score_overall") or 0.0)
        scheduled = bool(payload.get("scheduled"))
        total_cost = float(payload.get("total_cost_usd") or 0.0)
        recommendations: list[str] = []
        if approval_status != "approved":
            recommendations.append("Resolve approval feedback before scheduling.")
        if score < 0.65:
            recommendations.append("Improve brand or channel fit before the next run.")
        if total_cost > 0:
            recommendations.append("Compare cost against outcome quality before scaling.")
        if scheduled:
            recommendations.append("Track performance after publish and feed it back into the next brief.")

        summary = (
            f"Run status: approval={approval_status}, score={score:.2f}, "
            f"scheduled={'yes' if scheduled else 'no'}, cost=${total_cost:.4f}."
        )
        return {
            "status": approval_status,
            "recommendations": recommendations,
            "summary": summary,
        }
