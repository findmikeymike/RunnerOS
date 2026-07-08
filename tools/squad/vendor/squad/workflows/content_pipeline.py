"""First end-to-end workflow for research -> draft -> approval -> scheduling."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypedDict

from agents.analytics_agent import AnalyticsAgent
from agents.brand_agent import BrandAgent
from agents.channel_agent import ChannelAgent
from agents.content_agent import ContentAgent
from agents.research_agent import ResearchAgent
from core.agent_base import AgentContext
from core.approval import ApprovalBackend, ApprovalStatus, InMemoryApprovalBackend
from core.config import Settings, load_settings
from evals.cost_tracker import CostTracker
from memory.store import InMemoryStore, MemoryStore, make_memory_store
from tools.postiz_client import PostizClient

try:  # pragma: no cover - exercised indirectly when langgraph is installed
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover - safe fallback when dependency missing at runtime
    END = "__end__"
    StateGraph = None


class PipelineState(TypedDict, total=False):
    run_id: str
    topic: str
    channel: str
    scheduled_at: str | None
    campaign: str | None
    research: dict[str, Any]
    content: dict[str, Any]
    brand_review: dict[str, Any]
    channel_output: dict[str, Any]
    approval: dict[str, Any]
    publish: dict[str, Any]
    analytics: dict[str, Any]


@dataclass
class ContentPipeline:
    settings: Settings = field(default_factory=load_settings)
    store: MemoryStore = field(default_factory=InMemoryStore)
    approval_backend: ApprovalBackend = field(default_factory=InMemoryApprovalBackend)
    research_agent: ResearchAgent = field(default_factory=ResearchAgent)
    content_agent: ContentAgent = field(default_factory=ContentAgent)
    brand_agent: BrandAgent = field(default_factory=BrandAgent)
    channel_agent: ChannelAgent = field(default_factory=ChannelAgent)
    analytics_agent: AnalyticsAgent = field(default_factory=AnalyticsAgent)
    postiz_client: PostizClient = field(default_factory=PostizClient.from_env)
    cost_tracker: CostTracker = field(default_factory=CostTracker)

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "ContentPipeline":
        settings = settings or load_settings()
        store = make_memory_store(settings.postgres_dsn)
        return cls(settings=settings, store=store)

    def _make_context(self, run_id: str, *, channel: str, campaign: str | None = None) -> AgentContext:
        channel_rules = {
            "x": {"min_words": 10, "max_words": 60, "cta_required": True, "cta_terms": ["reply", "comment", "learn more"], "pass_threshold": 0.6},
            "linkedin": {"min_words": 30, "max_words": 220, "cta_required": False, "pass_threshold": 0.62},
            "reddit": {"min_words": 40, "max_words": 260, "cta_required": False, "pass_threshold": 0.65},
        }.get(channel.lower(), {"min_words": 10, "max_words": 120, "pass_threshold": 0.6})
        return AgentContext(
            run_id=run_id,
            brand_guidelines=self.settings.brand_guidelines,
            channel_rules=channel_rules,
            metadata={"channel": channel, "campaign": campaign},
        )

    def run(
        self,
        *,
        topic: str,
        channel: str | None = None,
        scheduled_at: str | None = None,
        campaign: str | None = None,
        auto_approve: bool = False,
        reviewer: str | None = None,
    ) -> PipelineState:
        target_channel = channel or self.settings.default_channel
        run = self.store.start_run(
            workflow="content_pipeline",
            input_payload={
                "topic": topic,
                "channel": target_channel,
                "scheduled_at": scheduled_at,
                "campaign": campaign,
            },
        )
        context = self._make_context(run.id, channel=target_channel, campaign=campaign)
        state: PipelineState = {
            "run_id": run.id,
            "topic": topic,
            "channel": target_channel,
            "scheduled_at": scheduled_at,
            "campaign": campaign,
        }

        research = self.research_agent.run({"topic": topic}, context)
        self.store.save_artifact(run.id, stage="research", payload=research)
        state["research"] = research

        content = self.content_agent.run(
            {
                "topic": topic,
                "research_summary": research["summary"],
                "insights": research["insights"],
            },
            context,
        )
        self.store.save_artifact(run.id, stage="content", payload=content)
        state["content"] = content

        brand_review = self.brand_agent.run(
            {"text": content["draft"], "channel": target_channel},
            context,
        )
        self.store.save_artifact(run.id, stage="brand_review", payload=brand_review)
        state["brand_review"] = brand_review

        channel_output = self.channel_agent.run(
            {
                "draft": content["draft"],
                "cta": content["cta"],
                "channel": target_channel,
            },
            context,
        )
        self.store.save_artifact(run.id, stage="channel_output", payload=channel_output)
        state["channel_output"] = channel_output

        approval_request = self.approval_backend.submit(
            run_id=run.id,
            stage="publish",
            summary=f"Approve {target_channel} post for topic '{topic}'",
            payload=channel_output,
        )
        self.store.save_approval(
            run_id=run.id,
            stage="publish",
            summary=approval_request.summary,
            payload=approval_request.payload,
            status=approval_request.status,
        )
        if auto_approve:
            approval_request = self.approval_backend.decide(
                approval_request.id,
                status=ApprovalStatus.APPROVED,
                reviewer=reviewer,
                reason="Auto-approved for controlled run.",
            )
        state["approval"] = {
            "id": approval_request.id,
            "status": approval_request.status,
            "summary": approval_request.summary,
        }

        publish = {
            "success": False,
            "external_call_performed": False,
            "message": "Approval pending; not scheduled.",
        }
        if approval_request.status == ApprovalStatus.APPROVED:
            publish_result = self.postiz_client.schedule_content(
                channel_output["content"],
                target_channel,
                scheduled_at=scheduled_at,
                metadata={"run_id": run.id, "campaign": campaign or ""},
            )
            publish = publish_result.__dict__
        self.store.save_artifact(run.id, stage="publish", payload=publish)
        state["publish"] = publish

        cost_summary = self.cost_tracker.summary().get("default")
        analytics = self.analytics_agent.run(
            {
                "approval_status": approval_request.status,
                "score_overall": brand_review["overall"],
                "scheduled": publish["success"] and publish["external_call_performed"],
                "total_cost_usd": getattr(cost_summary, "total_cost_usd", 0.0),
            },
            context,
        )
        self.store.save_artifact(run.id, stage="analytics", payload=analytics)
        state["analytics"] = analytics
        self.store.complete_run(
            run.id,
            status="completed" if approval_request.status == ApprovalStatus.APPROVED else "awaiting_approval",
        )
        return state

    def build_langgraph(self):
        """Return a LangGraph state machine if the dependency is available."""
        if StateGraph is None:
            return None

        graph = StateGraph(PipelineState)

        def research_node(state: PipelineState) -> PipelineState:
            context = self._make_context(state["run_id"], channel=state["channel"], campaign=state.get("campaign"))
            research = self.research_agent.run({"topic": state["topic"]}, context)
            return {"research": research}

        def content_node(state: PipelineState) -> PipelineState:
            context = self._make_context(state["run_id"], channel=state["channel"], campaign=state.get("campaign"))
            content = self.content_agent.run(
                {
                    "topic": state["topic"],
                    "research_summary": state["research"]["summary"],
                    "insights": state["research"]["insights"],
                },
                context,
            )
            return {"content": content}

        graph.add_node("research", research_node)
        graph.add_node("content", content_node)
        graph.set_entry_point("research")
        graph.add_edge("research", "content")
        graph.add_edge("content", END)
        return graph.compile()
