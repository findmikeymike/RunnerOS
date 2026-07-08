from __future__ import annotations

from textwrap import dedent

from creative.director.contracts import ALLOWED_DIRECTOR_ACTIONS, CreativeDirectorState


CREATIVE_DIRECTOR_SYSTEM_PROMPT = dedent(
    """
    You are `creative-director-v1`.

    This is not an open-ended chat agent. You are a bounded production director for image generation only.
    You must choose exactly one allowed action after each reviewed attempt:
    - retry_same_direction
    - retry_with_prompt_adjustment
    - switch_style_family
    - switch_template
    - downgrade_scope_to_image_only
    - escalate_to_human_review
    - ship_candidate_for_review

    Rules:
    - Human review is always mandatory before anything is considered done.
    - Internal scores help, but they are not final taste authority.
    - Do not invent tools or actions outside the allowed list.
    - Prefer prompt adjustment before style/template pivots only when the latest score is close to shippable.
    - If the latest score is 3.0 or below, assume the current approach is strategically weak unless the evidence strongly says otherwise.
    - When the top issue is style_adherence or scene_believability, prefer a style/template pivot over another wording-only retry.
    - Avoid spending the final attempt on a cosmetic retry when a structural pivot is available.
    - If the latest verdict is ship and the score is at least 3.6, default to shipping unless there is a strong structural reason to pivot.
    - Keep the best candidate across all attempts, even if the latest attempt is worse.
    - Respect the budget cap and max-attempt boundary.
    """
).strip()


def build_decision_prompt(state: CreativeDirectorState) -> tuple[str, str]:
    latest = state.latest_result
    best = state.best_candidate
    direction = state.current_direction
    user_prompt = dedent(
        f"""
        Creative goal: {state.creative_goal}
        Budget cap usd: {state.budget_cap_usd}
        Attempt count: {state.attempt_count}/{state.max_attempts}
        Current style: {direction.style_family if direction else 'unknown'}
        Current template: {direction.template_id if direction else 'unknown'}
        Latest verdict: {latest.verdict if latest else 'none'}
        Latest score: {latest.score if latest else 'none'}
        Latest top issue: {latest.top_issue if latest else 'none'}
        Latest regeneration hint: {latest.regeneration_hint if latest else 'none'}
        Best candidate id: {best.candidate_id if best else 'none'}
        Best candidate score: {best.score if best else 'none'}
        Attempt history verdicts: {[item.decision_verdict for item in state.attempt_history]}
        Attempt history templates: {[item.template_id for item in state.attempt_history]}
        Attempt history styles: {[item.style_family for item in state.attempt_history]}
        Return a single bounded decision with rationale, and optional prompt/style/template updates only when required.
        """
    ).strip()
    return CREATIVE_DIRECTOR_SYSTEM_PROMPT, user_prompt


def director_decision_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(ALLOWED_DIRECTOR_ACTIONS)},
            "rationale": {"type": "string", "minLength": 1},
            "prompt_adjustment": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "next_style_family": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "next_template_id": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "confidence": {"anyOf": [{"type": "number", "minimum": 0.0, "maximum": 1.0}, {"type": "null"}]},
        },
        "required": [
            "action",
            "rationale",
            "prompt_adjustment",
            "next_style_family",
            "next_template_id",
            "confidence",
        ],
        "additionalProperties": False,
    }
