from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
from typing import Any

from content.agents.brief_analyzer import BriefAnalysis, analyze_brief_deterministic, analyze_brief_llm
from content.agents.prompt_composer import ComposedPrompt, compose_deterministic, compose_with_llm
from content.agents.template_selector import TemplateSelection, select_template as select_template_impl
from creative.director.contracts import (
    CandidateRecord,
    CreativeDirectorInput,
    CreativeDirectorState,
    DirectorReviewResult,
    HumanReviewPacket,
)
from creative.director.review import build_director_review_artifact
from creative.image_factory.contracts import ImageFactoryRequest, ImageFactoryResult
from creative.image_factory.review import build_review_packet
from creative.production.model_routing import select_image_model_route
from creative.reference_assets.contracts import ReferenceAssetInput
from creative.reference_assets.analyzer import analyze_reference_assets, select_reference_assets_for_generation
from creative.reference_assets.bundles import ROLE_INSTRUCTION
from creative.reference_assets.resolver import ReferenceAssetResolver
from workflows.image_factory_workflow import ImageFactoryWorkflow


QUALITY_TIER_TO_IMAGE_FACTORY = {
    "budget": "draft",
    "standard": "balanced",
    "premium": "premium",
    "draft": "draft",
    "balanced": "balanced",
}

DIRECTOR_TEMPLATE_TO_IMAGE_FACTORY = {
    "IMG-SO-001": "social_thumb",
    "IMG-SO-002": "social_thumb",
    "IMG-SO-003": "social_thumb",
    "IMG-HE-001": "hero_banner",
    "IMG-HE-002": "hero_banner",
    "IMG-MR-001": "product_on_scene",
    "IMG-MR-002": "lifestyle_shot",
    "IMG-PP-001": "product_on_scene",
    "IMG-PP-002": "lifestyle_shot",
    "IMG-AP-001": "app_in_hand",
    "IMG-AP-002": "app_in_hand",
    "IMG-MU-001": "hero_banner",
}


class CreativeDirectorTools:
    def __init__(
        self,
        *,
        workflow: ImageFactoryWorkflow,
        brief_llm_call: Any | None = None,
        prompt_llm_call: Any | None = None,
        reference_asset_resolver: ReferenceAssetResolver | None = None,
    ) -> None:
        self.workflow = workflow
        self.brief_llm_call = brief_llm_call
        self.prompt_llm_call = prompt_llm_call
        self.reference_asset_resolver = reference_asset_resolver

    def analyze_brief(self, director_input: CreativeDirectorInput) -> BriefAnalysis:
        brief = director_input.brief
        analysis = analyze_brief_deterministic(brief)
        if self.brief_llm_call is not None and analysis.confidence < 0.75:
            analysis = self._await(analyze_brief_llm(brief, self.brief_llm_call))
        effective_budget = director_input.effective_budget_cap_usd
        analysis.max_cost_usd = effective_budget
        if effective_budget <= 1.0:
            analysis.budget_tier = "budget"
        elif effective_budget <= 5.0:
            analysis.budget_tier = "standard"
        else:
            analysis.budget_tier = "premium"
        return analysis

    def select_template(self, analysis: BriefAnalysis) -> TemplateSelection:
        return select_template_impl(analysis)

    def compose_prompt(
        self,
        analysis: BriefAnalysis,
        selection: TemplateSelection,
        *,
        prompt_adjustment: str | None = None,
    ) -> ComposedPrompt:
        if self.prompt_llm_call is not None:
            prompt = self._await(compose_with_llm(analysis, selection, self.prompt_llm_call))
        else:
            prompt = compose_deterministic(analysis, selection)
        prompt.reference_image_paths = list(
            Path(path).as_posix()
            for path in getattr(analysis, "reference_image_paths", []) or []
        )
        if prompt_adjustment:
            prompt.image_prompt, prompt.image_negative_prompt = self._apply_prompt_adjustment(
                prompt.image_prompt,
                prompt.image_negative_prompt,
                product_description=analysis.product_description,
                style_family=selection.style_family,
                prompt_adjustment=prompt_adjustment,
            )
        return prompt

    def estimate_cost(
        self,
        selection: TemplateSelection,
        prompt_plan: ComposedPrompt,
        director_input: CreativeDirectorInput,
    ) -> float:
        return round(float(prompt_plan.estimated_cost_usd), 3)

    def run_image_factory(
        self,
        director_input: CreativeDirectorInput,
        selection: TemplateSelection,
        prompt_plan: ComposedPrompt,
        *,
        attempt_index: int,
    ) -> ImageFactoryResult:
        brief = director_input.brief
        reference_selection = self._select_reference_inputs_for_generation(brief, run_id=director_input.run_id)
        if reference_selection is None:
            raise ValueError("creative-director-v1 currently requires at least one reference image")

        product_image_path = Path(reference_selection["product"].value)
        extra_reference_paths = tuple(Path(item.value) for item in reference_selection["references"])
        executable_template_id = self._resolve_image_factory_template_id(selection.image_template_id)
        model_route = select_image_model_route(
            brief=brief,
            budget_cap_usd=director_input.effective_budget_cap_usd,
            require_adapter_ready=True,
        )
        scene_brief = self._with_reference_role_instructions(prompt_plan.image_prompt, reference_selection)
        request = ImageFactoryRequest(
            product_image_path=product_image_path,
            scene_brief=scene_brief,
            template_id=executable_template_id,
            style_tags=(selection.style_family,),
            variant_count=selection.variant_count,
            quality_tier=QUALITY_TIER_TO_IMAGE_FACTORY.get(selection.quality_tier, "balanced"),
            background_mode="auto",
            reference_image_paths=extra_reference_paths,
            negative_prompt=prompt_plan.image_negative_prompt,
            aspect_ratio=prompt_plan.image_aspect_ratio,
            budget_cap_usd=director_input.effective_budget_cap_usd,
            model_id_override=model_route.model_id,
            metadata={
                "creative_director_run_id": director_input.run_id,
                "attempt_index": attempt_index,
                "platform": brief.platform,
                "aspect_ratio": prompt_plan.image_aspect_ratio,
                "director_template_id": selection.image_template_id,
                "render_style": getattr(brief, "render_style", "auto"),
                "model_route": {
                    "model_id": model_route.model_id,
                    "provider": model_route.provider,
                    "estimated_cost_usd": model_route.estimated_cost_usd,
                    "reason": model_route.reason,
                    "confidence": model_route.confidence,
                    "input_contract": model_route.input_contract,
                    "fallback_model_id": model_route.fallback_model_id,
                    "warnings": list(model_route.warnings),
                },
                "reference_asset_roles": self._reference_roles_metadata(reference_selection),
            },
        )
        return self.workflow.run(
            request=request,
            product_subject=brief.product_description,
            extra_variables={
                "campaign_goal": brief.campaign_goal,
                "style_family": selection.style_family,
            },
            max_regeneration_attempts_override=0,
        )

    def review_generation_result(self, generation_result: ImageFactoryResult) -> DirectorReviewResult:
        selected_eval = None
        selected_variant = None
        if generation_result.decision and generation_result.decision.selected_asset_id:
            selected_variant = next(
                (variant for variant in generation_result.variants if variant.variant_id == generation_result.decision.selected_asset_id),
                None,
            )
            selected_eval = next(
                (evaluation for evaluation in generation_result.evaluations if evaluation.asset_id == generation_result.decision.selected_asset_id),
                None,
            )
        if selected_eval is None and generation_result.evaluations:
            selected_eval = max(generation_result.evaluations, key=lambda item: item.weighted_average)
        if selected_variant is None and selected_eval is not None:
            selected_variant = next(
                (variant for variant in generation_result.variants if variant.variant_id == selected_eval.asset_id),
                None,
            )

        candidate = None
        if selected_eval is not None:
            candidate = CandidateRecord(
                candidate_id=selected_eval.asset_id,
                run_id=generation_result.run_id,
                asset_id=selected_eval.asset_id,
                asset_path=selected_variant.local_path if selected_variant else None,
                score=selected_eval.weighted_average,
                verdict=selected_eval.verdict,
                attempt_index=selected_eval.attempt_index,
                style_family=selected_eval.style_family,
                template_id=selected_eval.template_id,
                prompt_summary=selected_variant.prompt_snapshot if selected_variant else "",
                warnings=tuple(generation_result.warnings),
            )

        verdict = generation_result.decision.verdict if generation_result.decision else "unscored"
        return DirectorReviewResult(
            run_id=generation_result.run_id,
            selected_candidate=candidate,
            score=selected_eval.weighted_average if selected_eval else generation_result.decision.selected_score if generation_result.decision else None,
            verdict=verdict,
            top_issue=selected_eval.top_issue if selected_eval else "unscored",
            regeneration_hint=selected_eval.regeneration_hint if selected_eval else "none",
            warnings=tuple(generation_result.warnings),
            review_summary=f"run {generation_result.run_id}: verdict={verdict}",
        )

    def request_human_review(
        self,
        *,
        state: CreativeDirectorState,
        review_reason: str,
    ) -> HumanReviewPacket:
        generation_result = state.review_generation or state.latest_generation
        image_factory_review_path = None
        image_factory_payload: dict[str, Any] | None = None
        if isinstance(generation_result, ImageFactoryResult):
            packet = build_review_packet(generation_result)
            image_factory_review_path = packet.review_path
            image_factory_payload = packet.approval_payload
        review_path, approval_payload, summary = build_director_review_artifact(
            state=state,
            review_reason=review_reason,
            image_factory_review_path=image_factory_review_path,
            image_factory_payload=image_factory_payload,
        )
        return HumanReviewPacket(
            summary=summary,
            selected_candidate=state.best_candidate,
            review_path=review_path,
            approval_payload=approval_payload,
            warnings=tuple(state.latest_result.warnings if state.latest_result else ()),
        )

    @staticmethod
    def _await(value: Any) -> Any:
        if inspect.isawaitable(value):
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(value)
            raise RuntimeError("async tool wrappers cannot be used inside an active event loop")
        return value

    @staticmethod
    def _resolve_image_factory_template_id(template_id: str) -> str:
        return DIRECTOR_TEMPLATE_TO_IMAGE_FACTORY.get(template_id, template_id)

    def _select_reference_inputs_for_generation(self, brief, *, run_id: str) -> dict[str, Any] | None:
        structured = getattr(brief, "reference_assets", []) or []
        if structured:
            inputs = tuple(CreativeDirectorTools._coerce_reference_asset_input(item) for item in structured)
        else:
            paths = tuple(getattr(brief, "reference_image_paths", []) or [])
            inputs = tuple(
                ReferenceAssetInput(
                    source_kind="local_path",
                    value=str(path),
                    declared_role=("product" if index == 0 else "unknown"),
                )
                for index, path in enumerate(paths)
            )
        if not inputs:
            return None
        has_non_local_inputs = any(item.source_kind != "local_path" for item in inputs)
        if has_non_local_inputs and self.reference_asset_resolver is None:
            raise ValueError("reference_asset_resolver is required for non-local reference assets")
        if self.reference_asset_resolver is not None and has_non_local_inputs:
            resolved = self.reference_asset_resolver.resolve_many(inputs, run_id=run_id)
            analyzed = analyze_reference_assets(resolved, brief=brief)
            selected = select_reference_assets_for_generation(analyzed)
            resolved_product = selected.primary_product
            resolved_references = tuple(
                ReferenceAssetInput(
                    source_kind="local_path",
                    value=str(path),
                    declared_role=next(
                        (asset.inferred_role for asset in analyzed if asset.local_path == path),
                        "unknown",
                    ),
                )
                for path in selected.ordered_generation_paths
                if path != resolved_product.local_path
            )
            return {
                "product": ReferenceAssetInput(
                    source_kind="local_path",
                    value=str(resolved_product.local_path),
                    declared_role=resolved_product.inferred_role,
                    label=resolved_product.label,
                    metadata=resolved_product.metadata,
                ),
                "references": resolved_references,
                "all": tuple(
                    ReferenceAssetInput(
                        source_kind="local_path",
                        value=str(asset.local_path),
                        declared_role=asset.inferred_role,
                        label=asset.label,
                        metadata=asset.metadata,
                    )
                    for asset in analyzed
                ),
            }
        product = next((item for item in inputs if item.declared_role == "product"), inputs[0])
        references = tuple(item for item in inputs if item is not product)
        return {"product": product, "references": references, "all": inputs}

    @staticmethod
    def _coerce_reference_asset_input(item: Any) -> ReferenceAssetInput:
        if isinstance(item, ReferenceAssetInput):
            return item
        if isinstance(item, dict):
            return ReferenceAssetInput(
                source_kind=item.get("source_kind", "local_path"),
                value=str(item["value"]),
                declared_role=item.get("declared_role", "unknown"),
                label=item.get("label"),
                metadata=dict(item.get("metadata") or {}),
            )
        return ReferenceAssetInput(source_kind="local_path", value=str(item))

    @staticmethod
    def _reference_roles_metadata(selection: dict[str, Any]) -> dict[str, Any]:
        product = selection["product"]
        all_items = (product,) + tuple(selection["references"])
        return {
            "primary_reference_path": product.value,
            "primary_reference_role": product.declared_role,
            "product": product.value if product.declared_role == "product" else None,
            "face": [item.value for item in all_items if item.declared_role == "face"],
            "style": [item.value for item in all_items if item.declared_role == "style"],
            "scene": [item.value for item in all_items if item.declared_role == "scene"],
            "logo": [item.value for item in all_items if item.declared_role == "logo"],
            "unknown": [item.value for item in all_items if item.declared_role == "unknown"],
            "continuity_pack": CreativeDirectorTools._continuity_pack_metadata(selection),
        }

    @staticmethod
    def _with_reference_role_instructions(prompt: str, selection: dict[str, Any]) -> str:
        items = (selection["product"],) + tuple(selection["references"])
        lines = [
            "Reference image role map:",
            "Use the numbered input images according to these constraints.",
        ]
        for index, item in enumerate(items, start=1):
            role = item.declared_role if item.declared_role in ROLE_INSTRUCTION else "unknown"
            label, instruction = ROLE_INSTRUCTION[role]
            lines.append(f"Image {index}: {label} - {instruction}.")
        return f"{prompt}\n\n" + "\n".join(lines)

    @staticmethod
    def _continuity_pack_metadata(selection: dict[str, Any]) -> dict[str, Any]:
        product = selection["product"]
        items = (product,) + tuple(selection["references"])
        pack_items: list[dict[str, Any]] = []
        instruction_lines: list[str] = []
        for index, item in enumerate(items, start=1):
            role = item.declared_role if item.declared_role in ROLE_INSTRUCTION else "unknown"
            label, instruction = ROLE_INSTRUCTION[role]
            pack_items.append(
                {
                    "role": role,
                    "path": item.value,
                    "label": item.label or label,
                    "instruction": instruction,
                    "asset_id": item.metadata.get("asset_id") if item.metadata else None,
                    "priority": index,
                }
            )
            instruction_lines.append(f"Image {index}: {label} - {instruction}.")
        primary_role = product.declared_role if product.declared_role in ROLE_INSTRUCTION else "unknown"
        return {
            "source": "creative_director_reference_roles_v1",
            "primary_role": primary_role,
            "primary_path": product.value,
            "items": pack_items,
            "prompt_instructions": "\n".join(instruction_lines),
            "preservation_rules": CreativeDirectorTools._continuity_preservation_rules(primary_role, pack_items),
            "warnings": [],
        }

    @staticmethod
    def _continuity_preservation_rules(primary_role: str, items: list[dict[str, Any]]) -> list[str]:
        roles = {str(item.get("role") or "unknown") for item in items}
        rules = ["preserve the selected still as the exact opening frame"]
        if primary_role == "face" or "face" in roles:
            rules.append("preserve face identity and recognizable person details across motion")
        if primary_role == "product" or "product" in roles:
            rules.append("preserve product shape, markings, logo/text, color, material, and silhouette")
        if "style" in roles:
            rules.append("preserve the reference visual style, lighting, palette, and composition language")
        if "scene" in roles:
            rules.append("preserve scene geography and spatial layout")
        if "logo" in roles:
            rules.append("preserve logo geometry, text, color, and placement")
        rules.append("animate camera, atmosphere, and requested action only; do not redesign the subject")
        return list(dict.fromkeys(rules))

    @staticmethod
    def _apply_prompt_adjustment(
        base_prompt: str,
        negative_prompt: str,
        *,
        product_description: str,
        style_family: str,
        prompt_adjustment: str,
    ) -> tuple[str, str]:
        normalized_adjustment = " ".join(prompt_adjustment.strip().split())
        if not normalized_adjustment:
            return base_prompt, negative_prompt

        if CreativeDirectorTools._is_product_fidelity_adjustment(normalized_adjustment):
            constraints = [
                f"Preserve the actual product exactly: {product_description}.",
                "Keep the product centered and fully recognizable.",
                "No unrelated objects, props, dioramas, globes, houses, or scene substitutions.",
            ]
            if style_family == "EDITORIAL":
                constraints.append("Keep the frame minimal, clean, and magazine-editorial.")
            revised_prompt = (
                f"{base_prompt}. Critical constraints: {' '.join(constraints)} "
                f"Correction: {normalized_adjustment}"
            )
            revised_negative = ", ".join(
                value
                for value in (
                    negative_prompt.strip(),
                    "unrelated objects",
                    "house",
                    "globe",
                    "diorama",
                    "miniature scene",
                    "environment inside product",
                    "graphic mismatch",
                    "wrong garment artwork",
                )
                if value
            )
            return revised_prompt, revised_negative

        return f"{base_prompt}. Adjustment: {normalized_adjustment}", negative_prompt

    @staticmethod
    def _is_product_fidelity_adjustment(prompt_adjustment: str) -> bool:
        text = prompt_adjustment.lower()
        markers = (
            "graphic",
            "print",
            "product fidelity",
            "does not match",
            "match the brief",
            "replace the graphic",
            "bold white",
            "black t-shirt",
            "shirt graphic",
            "garment",
            "product communication",
        )
        return any(marker in text for marker in markers)


def normalize_model_decision(raw: Any) -> dict[str, Any]:
    if hasattr(raw, "__dict__"):
        return dict(raw.__dict__)
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    raise TypeError(f"unsupported decision payload: {type(raw)!r}")
