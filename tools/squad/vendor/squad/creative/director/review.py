from __future__ import annotations

from pathlib import Path
from typing import Any

from creative.director.contracts import CreativeDirectorState


def build_director_review_artifact(
    *,
    state: CreativeDirectorState,
    review_reason: str,
    image_factory_review_path: Path | None,
    image_factory_payload: dict[str, Any] | None,
) -> tuple[Path, dict[str, Any], str]:
    review_path = _resolve_review_path(state, image_factory_review_path)
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(
        _render_markdown(
            state=state,
            review_reason=review_reason,
            image_factory_review_path=image_factory_review_path,
            image_factory_payload=image_factory_payload,
        ),
        encoding="utf-8",
    )

    approval_payload = {
        "reason": review_reason,
        "director_run_id": state.run_id,
        "director_review_path": str(review_path),
        "director_final_status": str(state.final_status),
        "attempt_count": state.attempt_count,
        "max_attempts": state.max_attempts,
        "budget_cap_usd": state.budget_cap_usd,
        "total_spend_usd": state.total_spend_usd,
        "remaining_budget_usd": round(max(0.0, state.budget_cap_usd - state.total_spend_usd), 6),
        "best_candidate_id": state.best_candidate.candidate_id if state.best_candidate else None,
        "best_candidate_score": state.best_candidate.score if state.best_candidate else None,
        "current_direction": {
            "style_family": state.current_direction.style_family if state.current_direction else None,
            "template_id": state.current_direction.template_id if state.current_direction else None,
            "quality_tier": state.current_direction.quality_tier if state.current_direction else None,
            "variant_count": state.current_direction.variant_count if state.current_direction else None,
            "model_id": state.current_direction.model_id if state.current_direction else None,
        },
        "latest_decision": {
            "action": state.latest_decision.action if state.latest_decision else None,
            "rationale": state.latest_decision.rationale if state.latest_decision else None,
            "prompt_adjustment": state.latest_decision.prompt_adjustment if state.latest_decision else None,
            "next_style_family": state.latest_decision.next_style_family if state.latest_decision else None,
            "next_template_id": state.latest_decision.next_template_id if state.latest_decision else None,
        },
        "attempt_history": [
            {
                "attempt_index": attempt.attempt_index,
                "style_family": attempt.style_family,
                "template_id": attempt.template_id,
                "quality_tier": attempt.quality_tier,
                "prompt_summary": attempt.prompt_summary,
                "result_run_id": attempt.result_run_id,
                "selected_variant_id": attempt.selected_variant_id,
                "score_summary": attempt.score_summary,
                "decision_verdict": attempt.decision_verdict,
                "regeneration_hint": attempt.regeneration_hint,
                "cost_usd": attempt.cost_usd,
            }
            for attempt in state.attempt_history
        ],
        "warnings": list(state.latest_result.warnings if state.latest_result else ()),
        "image_factory_review_path": str(image_factory_review_path) if image_factory_review_path else None,
        "image_factory_payload": image_factory_payload,
    }

    summary = (
        f"{review_reason}. "
        f"Best candidate: {state.best_candidate.candidate_id if state.best_candidate else 'none'}. "
        f"Spend: ${state.total_spend_usd:.2f}/${state.budget_cap_usd:.2f}."
    )
    return review_path, approval_payload, summary


def _resolve_review_path(state: CreativeDirectorState, image_factory_review_path: Path | None) -> Path:
    if image_factory_review_path is not None:
        return image_factory_review_path.with_name("creative-director-review.md")
    return Path(".outputs/creative-director") / state.run_id / "review.md"


def _render_markdown(
    *,
    state: CreativeDirectorState,
    review_reason: str,
    image_factory_review_path: Path | None,
    image_factory_payload: dict[str, Any] | None,
) -> str:
    brief = state.brief_input.brief
    lines = [
        "# Creative Director Review",
        "",
        f"- Director run: `{state.run_id}`",
        f"- Final status: `{state.final_status}`",
        f"- Review reason: {review_reason}",
        f"- Attempts: `{state.attempt_count}` / `{state.max_attempts}`",
        f"- Spend: `${state.total_spend_usd:.2f}` / `${state.budget_cap_usd:.2f}`",
        "",
        "## Brief",
        f"- Product: {brief.product_description}",
        f"- Goal: {brief.campaign_goal}",
        f"- Platform: `{brief.platform}`",
        f"- Output type: `{brief.output_type}`",
        f"- Style suggestion: `{brief.style_family_suggestion or 'none'}`",
    ]
    if brief.mood_keywords:
        lines.append(f"- Mood keywords: {', '.join(brief.mood_keywords)}")
    if state.current_direction:
        lines.extend(
            [
                "",
                "## Current Direction",
                f"- Style family: `{state.current_direction.style_family}`",
                f"- Template: `{state.current_direction.template_id}`",
                f"- Quality tier: `{state.current_direction.quality_tier}`",
                f"- Variant count: `{state.current_direction.variant_count}`",
                f"- Model: `{state.current_direction.model_id}`",
            ]
        )
    if state.latest_decision:
        lines.extend(
            [
                "",
                "## Latest Decision",
                f"- Action: `{state.latest_decision.action}`",
                f"- Rationale: {state.latest_decision.rationale}",
            ]
        )
        if state.latest_decision.prompt_adjustment:
            lines.append(f"- Prompt adjustment: {state.latest_decision.prompt_adjustment}")
        if state.latest_decision.next_style_family:
            lines.append(f"- Next style family: `{state.latest_decision.next_style_family}`")
        if state.latest_decision.next_template_id:
            lines.append(f"- Next template: `{state.latest_decision.next_template_id}`")
    if state.best_candidate:
        lines.extend(
            [
                "",
                "## Best Candidate",
                f"- Candidate: `{state.best_candidate.candidate_id}`",
                f"- Score: `{state.best_candidate.score:.2f}`",
                f"- Verdict: `{state.best_candidate.verdict}`",
                f"- Attempt: `{state.best_candidate.attempt_index}`",
                f"- Run: `{state.best_candidate.run_id}`",
                f"- Asset path: `{state.best_candidate.asset_path}`",
            ]
        )
    if state.attempt_history:
        lines.extend(["", "## Attempt History"])
        for attempt in state.attempt_history:
            lines.extend(
                [
                    f"### Attempt `{attempt.attempt_index}`",
                    f"- Direction: `{attempt.style_family}` / `{attempt.template_id}` / `{attempt.quality_tier}`",
                    f"- Result run: `{attempt.result_run_id}`",
                    f"- Selected variant: `{attempt.selected_variant_id}`",
                    f"- Score: `{attempt.score_summary}`",
                    f"- Verdict: `{attempt.decision_verdict}`",
                    f"- Regeneration hint: {attempt.regeneration_hint}",
                    f"- Cost: `${attempt.cost_usd:.2f}`",
                    f"- Prompt summary: {attempt.prompt_summary}",
                ]
            )
    if state.latest_result and state.latest_result.warnings:
        lines.extend(["", "## Warnings"])
        lines.extend(f"- {warning}" for warning in state.latest_result.warnings)
    if image_factory_review_path is not None:
        lines.extend(
            [
                "",
                "## Linked Image Factory Review",
                f"- Review path: `{image_factory_review_path}`",
            ]
        )
    if image_factory_payload and image_factory_payload.get("selected_asset_path"):
        lines.append(f"- Selected asset path: `{image_factory_payload['selected_asset_path']}`")
    return "\n".join(lines) + "\n"
