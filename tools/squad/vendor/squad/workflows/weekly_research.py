"""Simple scheduled workflow for recurring topic scans."""

from __future__ import annotations

from dataclasses import dataclass, field

from agents.research_agent import ResearchAgent
from core.agent_base import AgentContext
from memory.store import InMemoryStore, MemoryStore


@dataclass
class WeeklyResearchWorkflow:
    research_agent: ResearchAgent = field(default_factory=ResearchAgent)
    store: MemoryStore = field(default_factory=InMemoryStore)

    def run(self, *, topic: str, run_id: str = "weekly-research") -> dict[str, object]:
        context = AgentContext(run_id=run_id, metadata={"workflow": "weekly_research"})
        result = self.research_agent.run({"topic": topic}, context)
        self.store.save_artifact(run_id, stage="weekly_research", payload=result)
        return result
