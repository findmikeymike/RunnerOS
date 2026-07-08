from __future__ import annotations

from pathlib import Path
from typing import Any

from creative.production.contracts import (
    CandidateStillRecord,
    ContinuityPack,
    ContinuityPackItem,
    ImageToVideoHandoff,
    MotionPromptPlan,
)


def build_image_to_video_handoff(selected_still: CandidateStillRecord) -> ImageToVideoHandoff:
    if selected_still.asset_path is None:
        raise ValueError("selected still must have an asset_path for image-to-video handoff")
    roles = dict(selected_still.reference_asset_roles or {})
    continuity_pack = _coerce_continuity_pack(roles.get("continuity_pack"))
    primary_role = str(roles.get("primary_reference_role") or _infer_primary_role(roles))
    rules = _preservation_rules_for_roles(
        roles=roles,
        primary_role=primary_role,
        continuity_pack=continuity_pack,
    )
    return ImageToVideoHandoff(
        selected_still_path=Path(selected_still.asset_path),
        selected_still_id=selected_still.candidate_id,
        source_run_id=selected_still.source_run_id,
        reference_asset_roles=roles,
        primary_reference_role=primary_role,
        preservation_rules=rules,
        motion_context=_motion_context_for_roles(
            roles=roles,
            primary_role=primary_role,
            continuity_pack=continuity_pack,
        ),
        continuity_pack=continuity_pack,
    )


def apply_handoff_to_motion_plan(
    motion_plan: MotionPromptPlan,
    handoff: ImageToVideoHandoff,
) -> MotionPromptPlan:
    if not handoff.preservation_rules:
        return motion_plan
    preservation_text = _provider_prompt_preservation_clause(handoff)
    internal_preservation_text = "; ".join(handoff.preservation_rules)
    motion_plan.motion_prompt = (
        f"{motion_plan.motion_prompt} "
        f"{preservation_text}"
    ).strip()
    if motion_plan.shot_plan is not None:
        motion_plan.shot_plan.preservation_constraints = _merge_constraint_text(
            motion_plan.shot_plan.preservation_constraints,
            internal_preservation_text,
        )
    return motion_plan


def _infer_primary_role(roles: dict[str, Any]) -> str:
    for role in ("face", "product", "logo", "style", "scene"):
        values = roles.get(role) or []
        if isinstance(values, list) and values:
            return role
    return "unknown"


def _preservation_rules_for_roles(
    *,
    roles: dict[str, Any],
    primary_role: str,
    continuity_pack: ContinuityPack | None = None,
) -> tuple[str, ...]:
    rules: list[str] = ["preserve the selected still as the exact opening frame"]
    if continuity_pack is not None:
        rules.extend(continuity_pack.preservation_rules)
    if primary_role == "face" or _has_role(roles, "face"):
        rules.append("preserve face identity, facial structure, hair, skin tone, and recognizable person details")
    if primary_role == "product" or _has_role(roles, "product"):
        rules.append("preserve product shape, markings, logo/text, color, material, and silhouette")
    if _has_role(roles, "logo"):
        rules.append("preserve logo geometry, text, color, and placement; do not redraw or distort it")
    if _has_role(roles, "style"):
        rules.append("preserve the established visual style, lighting, palette, grain, and composition language")
    if _has_role(roles, "scene"):
        rules.append("preserve the scene geography and spatial layout while adding only intentional motion")
    rules.append("animate camera, atmosphere, and requested action only; do not redesign the subject")
    return tuple(dict.fromkeys(rules))


def _motion_context_for_roles(
    *,
    roles: dict[str, Any],
    primary_role: str,
    continuity_pack: ContinuityPack | None = None,
) -> str:
    role_counts = {
        role: len(value)
        for role, value in roles.items()
        if role in {"face", "product", "logo", "style", "scene", "unknown"} and isinstance(value, list)
    }
    active = ", ".join(f"{role}:{count}" for role, count in role_counts.items() if count)
    if not active:
        active = "no extra reference roles"
    continuity = ""
    if continuity_pack is not None and continuity_pack.items:
        continuity = f" Continuity pack: {len(continuity_pack.items)} reference item(s)."
    return f"Primary reference role: {primary_role}. Source reference roles: {active}.{continuity}"


def _has_role(roles: dict[str, Any], role: str) -> bool:
    value = roles.get(role)
    if role == "product" and isinstance(value, str):
        return bool(value)
    return isinstance(value, list) and bool(value)


def _merge_constraint_text(existing: str, addition: str) -> str:
    existing = existing.strip()
    addition = addition.strip()
    if not existing:
        return addition
    if addition in existing:
        return existing
    return f"{existing}; {addition}"


def _provider_prompt_preservation_clause(handoff: ImageToVideoHandoff) -> str:
    details = _compact_provider_details(handoff)
    if details:
        details_text = ", ".join(details)
        return (
            "Preserve the provided image exactly as the opening frame: "
            f"same {details_text}, composition, and lighting. "
            "Add motion only through camera movement, atmosphere, and the requested action."
        )
    return (
        "Preserve the provided image exactly as the opening frame: same subject, composition, and lighting. "
        "Add motion only through camera movement, atmosphere, and the requested action."
    )


def _compact_provider_details(handoff: ImageToVideoHandoff) -> tuple[str, ...]:
    roles = handoff.reference_asset_roles
    details: list[str] = []
    if handoff.primary_reference_role == "face" or _has_role(roles, "face"):
        details.append("face identity")
    if handoff.primary_reference_role == "product" or _has_role(roles, "product"):
        details.append("product shape")
    if _has_role(roles, "logo"):
        details.append("logo/text details")
    if not details:
        details.append("subject")
    return tuple(dict.fromkeys(details))


def _coerce_continuity_pack(raw: Any) -> ContinuityPack | None:
    if isinstance(raw, ContinuityPack):
        return raw
    if not isinstance(raw, dict):
        return None
    items: list[ContinuityPackItem] = []
    for index, item in enumerate(raw.get("items") or (), start=1):
        if not isinstance(item, dict) or not item.get("path"):
            continue
        items.append(
            ContinuityPackItem(
                role=str(item.get("role") or "unknown"),
                path=Path(str(item["path"])),
                label=item.get("label"),
                instruction=str(item.get("instruction") or ""),
                asset_id=item.get("asset_id"),
                priority=int(item.get("priority") or index),
            )
        )
    primary_path = raw.get("primary_path")
    return ContinuityPack(
        primary_role=str(raw.get("primary_role") or "unknown"),
        primary_path=Path(str(primary_path)) if primary_path else None,
        items=tuple(items),
        preservation_rules=tuple(str(rule) for rule in raw.get("preservation_rules") or () if str(rule).strip()),
        prompt_instructions=str(raw.get("prompt_instructions") or ""),
        warnings=tuple(str(warning) for warning in raw.get("warnings") or () if str(warning).strip()),
        source=str(raw.get("source") or "continuity_pack_v1"),
    )
