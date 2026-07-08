from __future__ import annotations

from dataclasses import replace
from typing import Any

from creative.director.contracts import (
    AttemptRecord,
    CandidateRecord,
    CreativeDirectorDecision,
    CreativeDirectorInput,
    CreativeDirectorState,
    DirectorFinalStatus,
    DirectionPlan,
    GraphEnvelope,
)
from creative.director.prompt import build_decision_prompt
from creative.director.repository import write_director_manifest
from creative.director.tools import normalize_model_decision

try:  # pragma: no cover
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover
    END = "__end__"
    StateGraph = None


class CreativeDirectorGraph:
    def __init__(
        self,
        *,
        tools: Any,
        decision_model: Any | None = None,
    ) -> None:
        self.tools = tools
        self.decision_model = decision_model

    def run(self, director_input: CreativeDirectorInput) -> CreativeDirectorState:
        state = CreativeDirectorState(
            run_id=director_input.run_id,
            brief_raw=director_input.brief.product_description,
            brief_input=director_input,
            creative_goal=director_input.brief.campaign_goal,
            budget_cap_usd=director_input.effective_budget_cap_usd,
            attempt_count=0,
            max_attempts=director_input.max_attempts,
            attempt_history=[],
        )
        graph = self.build_langgraph()
        if graph is not None:
            return graph.invoke({"director_state": state})["director_state"]
        return self._run_without_langgraph(state)

    def build_langgraph(self):
        if StateGraph is None:
            return None
        graph = StateGraph(GraphEnvelope)
        graph.add_node("analyze_brief", self._analyze_brief_node)
        graph.add_node("plan_attempt", self._plan_attempt_node)
        graph.add_node("execute_attempt", self._execute_attempt_node)
        graph.add_node("review_attempt", self._review_attempt_node)
        graph.add_node("decide_next_step", self._decide_next_step_node)
        graph.add_node("human_review", self._human_review_node)
        graph.add_node("finish", self._finish_node)
        graph.set_entry_point("analyze_brief")
        graph.add_edge("analyze_brief", "plan_attempt")
        graph.add_conditional_edges(
            "plan_attempt",
            self._route_after_plan,
            {
                "execute": "execute_attempt",
                "review": "human_review",
            },
        )
        graph.add_edge("execute_attempt", "review_attempt")
        graph.add_edge("review_attempt", "decide_next_step")
        graph.add_conditional_edges(
            "decide_next_step",
            self._route_after_decision,
            {
                "loop": "plan_attempt",
                "review": "human_review",
            },
        )
        graph.add_edge("human_review", "finish")
        graph.add_edge("finish", END)
        return graph.compile()

    def _run_without_langgraph(self, state: CreativeDirectorState) -> CreativeDirectorState:
        envelope = {"director_state": state}
        envelope = self._analyze_brief_node(envelope)
        while True:
            envelope = self._plan_attempt_node(envelope)
            if self._route_after_decision(envelope) == "review":
                envelope = self._human_review_node(envelope)
                return self._finish_node(envelope)["director_state"]
            envelope = self._execute_attempt_node(envelope)
            envelope = self._review_attempt_node(envelope)
            envelope = self._decide_next_step_node(envelope)
            if self._route_after_decision(envelope) == "review":
                envelope = self._human_review_node(envelope)
                return self._finish_node(envelope)["director_state"]

    def _analyze_brief_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        analysis = self.tools.analyze_brief(state.brief_input)
        selection = self.tools.select_template(analysis)
        state.brief_analysis = analysis
        state.current_direction = self._direction_from_selection(selection)
        return {"director_state": state}

    def _plan_attempt_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        selection = self._selection_from_state(state)
        prompt_adjustment = state.latest_decision.prompt_adjustment if state.latest_decision else None
        prompt_plan = self.tools.compose_prompt(
            state.brief_analysis,
            selection,
            prompt_adjustment=prompt_adjustment,
        )
        prompt_plan.reference_image_paths = list(state.brief_input.brief.reference_image_paths)
        estimated_cost = self.tools.estimate_cost(selection, prompt_plan, state.brief_input)
        remaining_budget = max(0.0, state.budget_cap_usd - state.total_spend_usd)
        if estimated_cost > remaining_budget:
            if state.attempt_count > 0:
                state.latest_decision = CreativeDirectorDecision(
                    action="escalate_to_human_review",
                    rationale=(
                        f"budget exhausted: remaining ${remaining_budget:.2f}, "
                        f"next attempt estimated ${estimated_cost:.2f}"
                    ),
                )
                state.final_status = DirectorFinalStatus.ESCALATED
                return {"director_state": state}
            selection.variant_count = 1
            selection.quality_tier = "budget"
            prompt_plan = self.tools.compose_prompt(
                state.brief_analysis,
                selection,
                prompt_adjustment="stay inside budget",
            )
            prompt_plan.reference_image_paths = list(state.brief_input.brief.reference_image_paths)
        state.current_direction = self._direction_from_selection(selection)
        state.current_prompt_plan = prompt_plan
        return {"director_state": state}

    def _execute_attempt_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        selection = self._selection_from_state(state)
        attempt_index = state.attempt_count + 1
        generation_result = self.tools.run_image_factory(
            state.brief_input,
            selection,
            state.current_prompt_plan,
            attempt_index=attempt_index,
        )
        state.latest_generation = generation_result
        run_id = self._read_generation_field(generation_result, "run_id")
        if isinstance(run_id, str) and run_id:
            state.generation_history[run_id] = generation_result
        state.attempt_count = attempt_index
        return {"director_state": state}

    def _review_attempt_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        review = self.tools.review_generation_result(state.latest_generation)
        state.latest_result = review
        if review.selected_candidate and self._is_better_candidate(review.selected_candidate, state.best_candidate):
            state.best_candidate = review.selected_candidate
        state.total_spend_usd += float(self._read_generation_field(state.latest_generation, "total_cost_usd", 0.0))
        state.attempt_history.append(
            AttemptRecord(
                attempt_index=state.attempt_count,
                style_family=state.current_direction.style_family,
                template_id=state.current_direction.template_id,
                quality_tier=state.current_direction.quality_tier,
                prompt_summary=state.current_prompt_plan.image_prompt,
                result_run_id=review.run_id,
                selected_variant_id=review.selected_candidate.candidate_id if review.selected_candidate else None,
                score_summary=review.score,
                decision_verdict=review.verdict,
                regeneration_hint=review.regeneration_hint,
                cost_usd=float(self._read_generation_field(state.latest_generation, "total_cost_usd", 0.0)),
            )
        )
        return {"director_state": state}

    def _decide_next_step_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        decision = self._apply_decision_guardrails(state, self._decide(state))
        state.latest_decision = decision

        if decision.next_style_family and state.current_direction:
            state.current_direction.style_family = decision.next_style_family
            if state.brief_analysis:
                state.brief_analysis.style_family = decision.next_style_family
        if decision.next_template_id and state.current_direction:
            state.current_direction.template_id = decision.next_template_id
        if decision.action == "downgrade_scope_to_image_only":
            state.brief_input.brief.output_type = "image"
            if state.brief_analysis is not None:
                state.brief_analysis.output_scope = "image_only"

        if decision.action == "ship_candidate_for_review":
            state.final_status = DirectorFinalStatus.REVIEW_READY
        elif decision.action == "escalate_to_human_review":
            state.final_status = DirectorFinalStatus.ESCALATED
        elif state.attempt_count >= state.max_attempts:
            if state.latest_result and state.latest_result.verdict == "ship" and state.best_candidate is not None:
                state.latest_decision = CreativeDirectorDecision(
                    action="ship_candidate_for_review",
                    rationale="max attempts reached; best candidate cleared ship threshold",
                )
                state.final_status = DirectorFinalStatus.REVIEW_READY
            else:
                state.latest_decision = CreativeDirectorDecision(
                    action="escalate_to_human_review",
                    rationale="max attempts reached",
                )
                state.final_status = DirectorFinalStatus.ESCALATED
        return {"director_state": state}

    @staticmethod
    def _apply_decision_guardrails(
        state: CreativeDirectorState,
        decision: CreativeDirectorDecision,
    ) -> CreativeDirectorDecision:
        latest = state.latest_result
        best = state.best_candidate
        if latest is None or best is None:
            return decision

        sticky_ship_actions = {
            "retry_same_direction",
            "retry_with_prompt_adjustment",
            "switch_style_family",
            "switch_template",
        }
        if (
            decision.action in sticky_ship_actions
            and latest.verdict == "ship"
            and latest.score is not None
            and latest.score >= 3.6
            and best.score >= latest.score
        ):
            return CreativeDirectorDecision(
                action="ship_candidate_for_review",
                rationale=(
                    "latest attempt already cleared ship threshold and remains the best candidate; "
                    "avoid spending another attempt on a likely regression"
                ),
            )
        if (
            decision.action in sticky_ship_actions
            and state.current_direction is not None
            and state.current_direction.style_family == "BRUTALIST"
            and latest.score is not None
            and latest.score >= 3.4
            and best.score >= latest.score
            and CreativeDirectorGraph._is_brutalist_intensification_feedback(latest)
        ):
            return CreativeDirectorDecision(
                action="ship_candidate_for_review",
                rationale=(
                    "latest brutalist attempt is already borderline strong, and the remaining feedback is mostly "
                    "style intensification; avoid overcooking it with another retry"
                ),
            )
        if (
            decision.action in sticky_ship_actions
            and state.current_direction is not None
            and state.current_direction.style_family == "EDITORIAL"
            and latest.score is not None
            and latest.score >= 3.4
            and best.score >= latest.score
            and CreativeDirectorGraph._is_editorial_graphic_refinement_feedback(latest)
        ):
            return CreativeDirectorDecision(
                action="ship_candidate_for_review",
                rationale=(
                    "latest editorial attempt is visually viable, and the remaining issue is narrow graphic refinement; "
                    "send it to human review instead of risking another drift-heavy retry"
                ),
            )
        if (
            decision.action in sticky_ship_actions
            and state.current_direction is not None
            and state.current_direction.style_family == "PREMIUM"
            and latest.score is not None
            and latest.score >= 3.0
            and best.score >= latest.score
            and CreativeDirectorGraph._is_premium_graphic_refinement_feedback(latest)
        ):
            return CreativeDirectorDecision(
                action="ship_candidate_for_review",
                rationale=(
                    "latest premium attempt is commercially usable, and the remaining issue is mainly graphic refinement; "
                    "send it to human review instead of spending more budget on a risky retry"
                ),
            )
        return decision

    @staticmethod
    def _is_brutalist_intensification_feedback(review: DirectorReviewResult) -> bool:
        text = " ".join(
            value for value in (review.top_issue, review.regeneration_hint) if value
        ).lower()
        intensification_markers = (
            "harsh",
            "shadow",
            "concrete",
            "steel",
            "grain",
            "monochrome",
            "clinical",
            "brutalist",
            "lighting",
            "texture",
        )
        structural_markers = (
            "graphic",
            "logo",
            "product visibility",
            "cropping",
            "crop",
            "wrong template",
            "platform mismatch",
            "composition unreadable",
            "text unreadable",
        )
        return any(marker in text for marker in intensification_markers) and not any(
            marker in text for marker in structural_markers
        )

    @staticmethod
    def _is_editorial_graphic_refinement_feedback(review: DirectorReviewResult) -> bool:
        text = " ".join(
            value for value in (review.top_issue, review.regeneration_hint) if value
        ).lower()
        required_markers = (
            "graphic",
            "print",
            "white",
        )
        allowed_context = (
            "clean background",
            "dramatic shadows",
            "sharp focus",
            "editorial",
            "magazine",
            "fashion",
            "studio",
            "minimal",
            "rectangle",
        )
        hard_failure_markers = (
            "unrelated object",
            "house",
            "globe",
            "diorama",
            "miniature scene",
            "platform mismatch",
            "wrong template",
            "unreadable composition",
        )
        return (
            all(marker in text for marker in required_markers)
            and any(marker in text for marker in allowed_context)
            and not any(marker in text for marker in hard_failure_markers)
        )

    @staticmethod
    def _is_premium_graphic_refinement_feedback(review: DirectorReviewResult) -> bool:
        text = " ".join(
            value for value in (review.top_issue, review.regeneration_hint) if value
        ).lower()
        required_markers = (
            "graphic",
            "print",
            "white",
        )
        premium_context = (
            "soft studio",
            "warm neutral",
            "luxury",
            "pedestal",
            "frosted glass",
            "premium",
            "depth of field",
            "hero",
        )
        hard_failure_markers = (
            "unrelated object",
            "house",
            "globe",
            "diorama",
            "miniature scene",
            "platform mismatch",
            "wrong template",
            "unreadable composition",
        )
        return (
            all(marker in text for marker in required_markers)
            and any(marker in text for marker in premium_context)
            and not any(marker in text for marker in hard_failure_markers)
        )

    def _human_review_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        if state.best_candidate is not None:
            state.review_generation = state.generation_history.get(state.best_candidate.run_id)
        else:
            state.review_generation = state.latest_generation
        state.human_review_packet = self.tools.request_human_review(
            state=state,
            review_reason=state.latest_decision.rationale if state.latest_decision else "human review required",
        )
        return {"director_state": state}

    def _finish_node(self, envelope: GraphEnvelope) -> GraphEnvelope:
        state = envelope["director_state"]
        state.director_manifest_path = write_director_manifest(state)
        if state.human_review_packet is not None:
            state.human_review_packet.approval_payload["director_manifest_path"] = str(state.director_manifest_path)
        return envelope

    def _route_after_decision(self, envelope: GraphEnvelope) -> str:
        state = envelope["director_state"]
        if state.final_status in {DirectorFinalStatus.REVIEW_READY, DirectorFinalStatus.ESCALATED}:
            return "review"
        if state.latest_decision and state.latest_decision.action == "downgrade_scope_to_image_only":
            return "loop"
        if state.latest_decision and state.latest_decision.action == "retry_same_direction":
            return "loop"
        if state.latest_decision and state.latest_decision.action == "retry_with_prompt_adjustment":
            return "loop"
        if state.latest_decision and state.latest_decision.action == "switch_style_family":
            return "loop"
        if state.latest_decision and state.latest_decision.action == "switch_template":
            return "loop"
        return "loop"

    def _route_after_plan(self, envelope: GraphEnvelope) -> str:
        state = envelope["director_state"]
        if state.final_status in {DirectorFinalStatus.REVIEW_READY, DirectorFinalStatus.ESCALATED}:
            return "review"
        return "execute"

    def _selection_from_state(self, state: CreativeDirectorState):
        direction = state.current_direction
        return replace(
            self.tools.select_template(state.brief_analysis),
            image_template_id=direction.template_id,
            style_family=direction.style_family,
            quality_tier=direction.quality_tier,
            variant_count=direction.variant_count,
            model_id=direction.model_id,
        )

    @staticmethod
    def _direction_from_selection(selection: Any) -> DirectionPlan:
        return DirectionPlan(
            style_family=selection.style_family,
            template_id=selection.image_template_id,
            quality_tier=selection.quality_tier,
            variant_count=selection.variant_count,
            model_id=selection.model_id,
            reasoning=getattr(selection, "reasoning", ""),
        )

    def _decide(self, state: CreativeDirectorState) -> CreativeDirectorDecision:
        if self.decision_model is None:
            return self._heuristic_decision(state)

        system_prompt, user_prompt = build_decision_prompt(state)
        try:
            raw = self.decision_model(state=state, system_prompt=system_prompt, user_prompt=user_prompt)
        except TypeError:
            raw = self.decision_model(state)
        if isinstance(raw, CreativeDirectorDecision):
            return raw
        payload = normalize_model_decision(raw)
        return CreativeDirectorDecision(**payload)

    def _heuristic_decision(self, state: CreativeDirectorState) -> CreativeDirectorDecision:
        review = state.latest_result
        if review is None:
            return CreativeDirectorDecision(action="ship_candidate_for_review", rationale="no review available")
        if review.verdict == "ship":
            return CreativeDirectorDecision(action="ship_candidate_for_review", rationale="strong enough for human review")
        if state.attempt_count >= state.max_attempts:
            return CreativeDirectorDecision(action="escalate_to_human_review", rationale="max attempts reached")
        low_score = review.score is not None and review.score <= 3.0
        top_issue = review.top_issue.lower()
        if low_score and "style" in top_issue:
            next_style = "EDITORIAL" if state.current_direction.style_family == "BRUTALIST" else "BRUTALIST"
            return CreativeDirectorDecision(
                action="switch_style_family",
                rationale="low score and style mismatch indicate a strategic pivot",
                next_style_family=next_style,
                next_template_id="IMG-HE-002" if next_style == "BRUTALIST" else "IMG-MR-001",
                prompt_adjustment=review.regeneration_hint,
            )
        if low_score and ("scene" in top_issue or "believability" in top_issue or "composition" in top_issue):
            if state.current_direction.style_family == "PREMIUM":
                next_template = "IMG-MR-001" if state.current_direction.template_id == "IMG-HE-002" else "IMG-HE-002"
            else:
                next_template = "IMG-HE-002" if state.current_direction.template_id != "IMG-HE-002" else "IMG-PP-002"
            return CreativeDirectorDecision(
                action="switch_template",
                rationale="low score and scene/composition issues indicate the template is wrong",
                next_template_id=next_template,
            )
        if "style" in review.top_issue.lower():
            return CreativeDirectorDecision(
                action="switch_style_family",
                rationale="style mismatch is strategic",
                next_style_family="BRUTALIST" if state.current_direction.style_family != "BRUTALIST" else "EDITORIAL",
                prompt_adjustment=review.regeneration_hint,
            )
        if "platform" in review.top_issue.lower() or "composition" in review.top_issue.lower():
            return CreativeDirectorDecision(
                action="switch_template",
                rationale="composition/template mismatch is strategic",
                next_template_id="IMG-HE-001",
            )
        return CreativeDirectorDecision(
            action="retry_with_prompt_adjustment",
            rationale="same direction is viable with a tighter prompt",
            prompt_adjustment=review.regeneration_hint,
        )

    @staticmethod
    def _is_better_candidate(candidate: CandidateRecord, incumbent: CandidateRecord | None) -> bool:
        if incumbent is None:
            return True
        return (candidate.score, -candidate.attempt_index) > (incumbent.score, -incumbent.attempt_index)

    @staticmethod
    def _read_generation_field(generation: object | None, field_name: str, default: Any = None) -> Any:
        if generation is None:
            return default
        if isinstance(generation, dict):
            return generation.get(field_name, default)
        return getattr(generation, field_name, default)
