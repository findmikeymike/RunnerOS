"""Channel formatting agent for X, LinkedIn, and Reddit-style drafts."""

from __future__ import annotations

from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent


class ChannelAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            AgentSpec(
                id="channel-agent",
                mission="Format a generic draft for a target channel.",
                system_prompt="Shape approved or near-approved content to fit the channel.",
                tools=(),
                approval_policy=ApprovalPolicy.REQUIRED,
                output_schema={"channel": "str", "content": "str"},
            )
        )

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        draft = str(payload.get("draft") or payload.get("text") or "").strip()
        channel = str(payload.get("channel") or context.metadata.get("channel") or "x").lower()
        cta = str(payload.get("cta") or "Reply if you want more.").strip()

        if channel == "linkedin":
            content = f"{draft}\n\n{cta}"
        elif channel == "reddit":
            content = f"{draft}\n\nIf helpful, I can share more context."
        else:
            trimmed = draft[:260].strip()
            content = trimmed if trimmed.endswith((".", "!", "?")) else f"{trimmed} {cta}"

        return {
            "channel": channel,
            "content": content.strip(),
        }
