"""Sprint 1 image-factory planning agent."""

from __future__ import annotations

from typing import Any, Mapping

from core.agent_base import AgentContext, AgentSpec, ApprovalPolicy, BaseAgent
from creative.image_factory.contracts import ImageFactoryRequest
from creative.image_factory.prompting import build_image_plan


class ImageFactoryAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            AgentSpec(
                id="image-factory-agent",
                mission="Turn an image-factory request into a generation plan.",
                system_prompt="Choose the right template path and output a cost-aware image generation plan.",
                tools=("fal",),
                approval_policy=ApprovalPolicy.NONE,
                output_schema={"plan": "ImageGenerationPlan"},
            )
        )

    def run(self, payload: Mapping[str, Any], context: AgentContext) -> dict[str, Any]:
        request = payload["request"]
        if not isinstance(request, ImageFactoryRequest):
            raise TypeError("payload['request'] must be an ImageFactoryRequest")
        product_subject = str(
            payload.get("product_subject")
            or request.metadata.get("product_subject")
            or "the product"
        ).strip()
        extra_variables = dict(payload.get("extra_variables") or {})
        plan = build_image_plan(
            request,
            product_subject=product_subject,
            extra_variables=extra_variables,
            attempt_index=int(payload.get("attempt_index") or 1),
            regeneration_hint=payload.get("regeneration_hint"),
        )
        return {"plan": plan}
