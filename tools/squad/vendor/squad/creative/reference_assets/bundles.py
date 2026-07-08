from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from creative.reference_assets.contracts import ResolvedReferenceAsset


ROLE_PRIORITY = {
    "product": 0,
    "face": 1,
    "logo": 2,
    "style": 3,
    "scene": 4,
    "unknown": 5,
}

ROLE_INSTRUCTION = {
    "product": (
        "PRODUCT_REFERENCE",
        "preserve product shape, markings, logo/text, color, and material exactly; do not redesign it",
    ),
    "face": (
        "FACE_REFERENCE",
        "preserve identity and facial structure, hair, skin tone, and recognizable character details",
    ),
    "logo": (
        "LOGO_REFERENCE",
        "preserve logo geometry, text, color, and placement rules exactly when used",
    ),
    "style": (
        "STYLE_REFERENCE",
        "borrow mood, lighting, palette, composition only; do not copy subject identity or objects",
    ),
    "scene": (
        "SCENE_REFERENCE",
        "borrow environment and spatial layout only; adapt the subject naturally into the scene",
    ),
    "unknown": (
        "GENERAL_REFERENCE",
        "use only where helpful; do not override explicit product, face, style, or scene references",
    ),
}


@dataclass(frozen=True, slots=True)
class ReferenceBundlePolicy:
    max_assets: int = 4
    role_priority: tuple[str, ...] = ("product", "face", "logo", "style", "scene", "unknown")
    provider_model_id: str | None = None

    def __post_init__(self) -> None:
        if self.max_assets < 1:
            raise ValueError("max_assets must be at least 1")
        invalid_roles = tuple(role for role in self.role_priority if role not in ROLE_INSTRUCTION)
        if invalid_roles:
            raise ValueError(f"role_priority contains unsupported role(s): {', '.join(invalid_roles)}")


@dataclass(frozen=True, slots=True)
class ReferenceBundleItem:
    position: int
    asset: ResolvedReferenceAsset
    role: str
    instruction_label: str
    instruction: str


@dataclass(frozen=True, slots=True)
class ReferenceBundle:
    items: tuple[ReferenceBundleItem, ...]
    omitted_assets: tuple[ResolvedReferenceAsset, ...]
    prompt_instructions: str
    provider_model_id: str | None = None
    warnings: tuple[str, ...] = ()

    @property
    def ordered_paths(self) -> tuple[Path, ...]:
        return tuple(item.asset.local_path for item in self.items)


def build_reference_bundle(
    assets: tuple[ResolvedReferenceAsset, ...] | list[ResolvedReferenceAsset],
    *,
    policy: ReferenceBundlePolicy,
    generation_goal: str,
) -> ReferenceBundle:
    del generation_goal  # reserved for future goal-aware prioritization.
    resolved_assets = tuple(assets)
    if not resolved_assets:
        raise ValueError("at least one reference asset is required")

    ordered = tuple(sorted(resolved_assets, key=lambda asset: _asset_sort_key(asset, policy)))
    selected = ordered[: policy.max_assets]
    omitted = ordered[policy.max_assets :]
    items = tuple(
        ReferenceBundleItem(
            position=index,
            asset=asset,
            role=_normalized_role(asset),
            instruction_label=_role_instruction(asset)[0],
            instruction=_role_instruction(asset)[1],
        )
        for index, asset in enumerate(selected, start=1)
    )
    warnings = ()
    if omitted:
        warnings = (f"omitted {len(omitted)} reference asset(s) due to max_assets={policy.max_assets}",)
    return ReferenceBundle(
        items=items,
        omitted_assets=omitted,
        prompt_instructions=_build_prompt_instructions(items),
        provider_model_id=policy.provider_model_id,
        warnings=warnings,
    )


def _asset_sort_key(asset: ResolvedReferenceAsset, policy: ReferenceBundlePolicy) -> tuple[int, float, str]:
    role = _normalized_role(asset)
    priority = policy.role_priority.index(role) if role in policy.role_priority else ROLE_PRIORITY.get(role, 99)
    return (priority, -float(asset.confidence), str(asset.local_path))


def _normalized_role(asset: ResolvedReferenceAsset) -> str:
    role = (asset.inferred_role or asset.declared_role or "unknown").strip()
    return role if role in ROLE_INSTRUCTION else "unknown"


def _role_instruction(asset: ResolvedReferenceAsset) -> tuple[str, str]:
    return ROLE_INSTRUCTION[_normalized_role(asset)]


def _build_prompt_instructions(items: tuple[ReferenceBundleItem, ...]) -> str:
    lines = [
        "Reference image role map:",
        "Use the numbered input images according to these constraints.",
    ]
    for item in items:
        lines.append(f"Image {item.position}: {item.instruction_label} - {item.instruction}.")
    return "\n".join(lines)
