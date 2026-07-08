from __future__ import annotations

import re
from dataclasses import replace

from content.writing.brief_generator import CreativeBrief
from creative.reference_assets.contracts import (
    ReferenceAssetSelection,
    ResolvedReferenceAsset,
)


ROLE_KEYWORDS = {
    "face": ("face", "headshot", "selfie", "portrait", "person", "founder", "identity", "character"),
    "product": ("product", "shirt", "tee", "tshirt", "hoodie", "app", "package", "bottle", "merch"),
    "style": ("style", "mood", "moodboard", "aesthetic", "inspiration", "vibe", "look", "palette", "a24"),
    "scene": ("scene", "background", "location", "room", "street", "motel", "landscape", "environment"),
    "logo": ("logo", "mark", "brandmark", "wordmark"),
}


def analyze_reference_assets(
    assets: tuple[ResolvedReferenceAsset, ...] | list[ResolvedReferenceAsset],
    *,
    brief: CreativeBrief | None = None,
) -> tuple[ResolvedReferenceAsset, ...]:
    return tuple(_analyze_one(asset, brief=brief) for asset in assets)


def select_reference_assets_for_generation(
    assets: tuple[ResolvedReferenceAsset, ...] | list[ResolvedReferenceAsset],
) -> ReferenceAssetSelection:
    analyzed = tuple(assets)
    if not analyzed:
        raise ValueError("at least one resolved reference asset is required")
    product = _first_role(analyzed, "product") or analyzed[0]
    face_refs = tuple(asset for asset in analyzed if asset.inferred_role == "face" and asset.local_path != product.local_path)
    style_refs = tuple(asset for asset in analyzed if asset.inferred_role == "style" and asset.local_path != product.local_path)
    scene_refs = tuple(asset for asset in analyzed if asset.inferred_role == "scene" and asset.local_path != product.local_path)
    logo_refs = tuple(asset for asset in analyzed if asset.inferred_role == "logo" and asset.local_path != product.local_path)
    ordered = _dedupe_paths(
        (product.local_path,)
        + tuple(asset.local_path for asset in face_refs)
        + tuple(asset.local_path for asset in style_refs)
        + tuple(asset.local_path for asset in scene_refs)
        + tuple(asset.local_path for asset in logo_refs)
        + tuple(asset.local_path for asset in analyzed if asset.local_path != product.local_path)
    )
    return ReferenceAssetSelection(
        primary_product=product,
        face_references=face_refs,
        style_references=style_refs,
        scene_references=scene_refs,
        logo_references=logo_refs,
        ordered_generation_paths=ordered,
    )


def _analyze_one(asset: ResolvedReferenceAsset, *, brief: CreativeBrief | None) -> ResolvedReferenceAsset:
    if asset.declared_role != "unknown":
        return replace(asset, inferred_role=asset.declared_role, confidence=max(asset.confidence, 0.95))
    text = " ".join(
        value
        for value in (
            asset.local_path.name,
            asset.label or "",
            str(asset.metadata.get("description", "")),
            brief.campaign_goal if brief else "",
            brief.product_description if brief else "",
        )
        if value
    ).lower()
    role, confidence = _infer_role_from_text(text)
    return replace(asset, inferred_role=role, confidence=confidence)


def _infer_role_from_text(text: str) -> tuple[str, float]:
    if not text.strip():
        return "unknown", 0.25
    scores = {role: sum(_keyword_hits(text, keyword) for keyword in keywords) for role, keywords in ROLE_KEYWORDS.items()}
    role, score = max(scores.items(), key=lambda item: item[1])
    if score <= 0:
        return "unknown", 0.35
    return role, min(0.9, 0.55 + (score * 0.15))


def _keyword_hits(text: str, keyword: str) -> int:
    pattern = rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"
    return len(re.findall(pattern, text))


def _first_role(assets: tuple[ResolvedReferenceAsset, ...], role: str) -> ResolvedReferenceAsset | None:
    return next((asset for asset in assets if asset.inferred_role == role), None)


def _dedupe_paths(paths: tuple) -> tuple:
    seen = set()
    deduped = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return tuple(deduped)
