"""Research agent for topic and campaign-angle discovery."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent
from tools.web_search import SearchClient, read_env_client


@dataclass(frozen=True)
class ResearchRequest:
    topic: str
    query: str | None = None
    max_results: int = 5


class ResearchAgent(BaseAgent):
    def __init__(self, search_client: SearchClient | None = None) -> None:
        super().__init__(
            AgentSpec(
                id="research-agent",
                mission="Gather useful external research and convert it into a compact brief.",
                system_prompt="Find high-signal evidence and summarize it into usable campaign input.",
                tools=("web_search",),
                approval_policy=ApprovalPolicy.NONE,
                output_schema={"query": "str", "summary": "str", "insights": "list[str]", "sources": "list[dict]"},
            )
        )
        self.search_client = search_client or read_env_client()

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        del context
        request = ResearchRequest(
            topic=str(payload["topic"]).strip(),
            query=str(payload.get("query") or payload["topic"]).strip(),
            max_results=int(payload.get("max_results", 5)),
        )
        response = self.search_client.search(request.query, max_results=request.max_results)
        insights = [
            f"{result.title}: {result.snippet}".strip(": ")
            for result in response.results[: request.max_results]
        ]
        summary = (
            f"Research for '{request.topic}' surfaced {len(response.results)} results. "
            f"Focus on the strongest themes and practical examples."
        )
        return {
            "query": request.query,
            "topic": request.topic,
            "summary": summary,
            "insights": insights,
            "sources": [result.__dict__ for result in response.results],
            "warnings": response.warnings or [],
        }
