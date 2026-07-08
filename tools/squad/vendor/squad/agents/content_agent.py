"""Content drafting agent for the first working loop."""

from __future__ import annotations

from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent


class ContentAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            AgentSpec(
                id="content-agent",
                mission="Turn research and brand context into a usable draft.",
                system_prompt="Create a concise, practical draft grounded in the supplied research and brand cues.",
                tools=(),
                approval_policy=ApprovalPolicy.NONE,
                output_schema={"draft": "str", "cta": "str", "source_count": "int"},
            )
        )

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        topic = str(payload.get("topic") or "the topic").strip()
        research_summary = str(payload.get("research_summary") or "").strip()
        insights = [str(item).strip() for item in payload.get("insights", []) if str(item).strip()]
        required_terms = [str(item) for item in context.brand_guidelines.get("required_terms", []) if str(item)]
        cta = str(payload.get("cta") or "Reply if you want the full breakdown.").strip()

        sections: list[str] = []
        if required_terms:
            sections.append(
                f"{' and '.join(required_terms[:2]).title()} matter more than noise when talking about {topic}."
            )
        else:
            sections.append(f"Here is the clearest practical angle on {topic}.")

        if research_summary:
            sections.append(research_summary)

        if insights:
            lead_points = insights[:2]
            sections.extend(lead_points)

        sections.append(cta)
        draft = " ".join(section for section in sections if section).strip()
        return {
            "draft": draft,
            "cta": cta,
            "source_count": len(insights),
        }
