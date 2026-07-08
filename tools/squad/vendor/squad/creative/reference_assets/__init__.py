"""Reference asset normalization for creative generation workflows."""

from creative.reference_assets.analyzer import (
    analyze_reference_assets,
    select_reference_assets_for_generation,
)
from creative.reference_assets.contracts import (
    ReferenceAssetInput,
    ReferenceAssetRole,
    ReferenceAssetSelection,
    ReferenceAssetSourceKind,
    ResolvedReferenceAsset,
)
from creative.reference_assets.bundles import (
    ReferenceBundle,
    ReferenceBundleItem,
    ReferenceBundlePolicy,
    build_reference_bundle,
)
from creative.reference_assets.resolver import ReferenceAssetResolver

__all__ = [
    "ReferenceAssetInput",
    "ReferenceAssetRole",
    "ReferenceAssetSelection",
    "ReferenceAssetSourceKind",
    "ResolvedReferenceAsset",
    "ReferenceBundle",
    "ReferenceBundleItem",
    "ReferenceBundlePolicy",
    "ReferenceAssetResolver",
    "analyze_reference_assets",
    "build_reference_bundle",
    "select_reference_assets_for_generation",
]
