from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal


AssetSourceStrategy = Literal["generated", "stock_or_local", "hybrid"]
VisualSlot = Literal["A", "B"]

GENERATED: AssetSourceStrategy = "generated"
STOCK_OR_LOCAL: AssetSourceStrategy = "stock_or_local"
HYBRID: AssetSourceStrategy = "hybrid"


@dataclass(frozen=True, slots=True)
class FacelessAssetIntent:
    scene_index: int
    visual_slot: VisualSlot
    prompt: str
    search_terms: tuple[str, ...]
    strategy: AssetSourceStrategy
    provenance_requirement: str
    rationale: str


def build_faceless_asset_intents(script_or_scenes: object) -> tuple[FacelessAssetIntent, ...]:
    """Plan visual sourcing for faceless scenes without calling any provider."""
    scenes = _coerce_scenes(script_or_scenes)
    intents: list[FacelessAssetIntent] = []
    for fallback_index, scene in enumerate(scenes, start=1):
        scene_index = _scene_index(scene, fallback_index)
        scene_terms = _scene_search_terms(scene)
        scene_strategy = _scene_strategy(scene, scene_terms)
        for slot, prompt in (
            ("A", _slot_prompt(scene, "A")),
            ("B", _slot_prompt(scene, "B")),
        ):
            slot_terms = scene_terms or _fallback_search_terms(prompt)
            strategy = _slot_strategy(scene_strategy, prompt, slot_terms)
            intents.append(
                FacelessAssetIntent(
                    scene_index=scene_index,
                    visual_slot=slot,
                    prompt=prompt,
                    search_terms=slot_terms,
                    strategy=strategy,
                    provenance_requirement=_provenance_requirement(strategy),
                    rationale=_rationale(scene, slot, strategy),
                )
            )
    return tuple(intents)


def _coerce_scenes(script_or_scenes: object) -> tuple[object, ...]:
    scenes = getattr(script_or_scenes, "scenes", script_or_scenes)
    if scenes is None:
        return ()
    if isinstance(scenes, (str, bytes)):
        return ()
    if isinstance(scenes, Iterable):
        return tuple(scenes)
    return ()


def _scene_index(scene: object, fallback_index: int) -> int:
    raw = _first_value(scene, ("scene_index", "beat_index", "index"))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return fallback_index


def _slot_prompt(scene: object, slot: VisualSlot) -> str:
    if slot == "A":
        fields = (
            "visual_a_prompt",
            "visual_prompt_a",
            "image_a_prompt",
            "visual_prompt",
            "image_prompt_focus",
            "visual_premise",
        )
    else:
        fields = (
            "visual_b_prompt",
            "visual_prompt_b",
            "image_b_prompt",
            "b_roll_prompt",
            "motion_direction",
            "motion_intent",
        )
    prompt = _first_text(scene, fields)
    if prompt:
        return prompt
    fallback = _first_text(scene, ("visual_prompt", "image_prompt_focus", "visual_premise"))
    if fallback and slot == "B":
        return f"alternate supporting visual for: {fallback}"
    return fallback


def _scene_search_terms(scene: object) -> tuple[str, ...]:
    raw = _first_value(scene, ("stock_search_terms", "search_terms", "reference_search_terms"))
    return _normalize_terms(raw)


def _scene_strategy(scene: object, search_terms: tuple[str, ...]) -> AssetSourceStrategy:
    raw = _first_text(scene, ("visual_source_strategy", "asset_strategy", "reference_strategy"))
    normalized = raw.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in {GENERATED, STOCK_OR_LOCAL, HYBRID}:
        return normalized  # type: ignore[return-value]
    if search_terms:
        return HYBRID
    return GENERATED


def _slot_strategy(
    scene_strategy: AssetSourceStrategy,
    prompt: str,
    search_terms: tuple[str, ...],
) -> AssetSourceStrategy:
    if scene_strategy == STOCK_OR_LOCAL:
        return STOCK_OR_LOCAL
    if scene_strategy == GENERATED:
        return GENERATED
    if prompt and search_terms:
        return HYBRID
    if search_terms:
        return STOCK_OR_LOCAL
    return GENERATED


def _provenance_requirement(strategy: AssetSourceStrategy) -> str:
    if strategy == GENERATED:
        return "record generated prompt, model/provider, seed when available, and generation timestamp"
    if strategy == STOCK_OR_LOCAL:
        return "record source URL or local path, license/usage rights, creator when known, and retrieval timestamp"
    return "record both generation metadata and source URL/local path with license/usage rights"


def _rationale(scene: object, slot: VisualSlot, strategy: AssetSourceStrategy) -> str:
    role = _first_text(scene, ("beat_role", "scene_role", "role")) or "scene"
    retention = _first_text(scene, ("retention_reason", "retention_note", "retention_hook"))
    base = f"slot {slot} supports the {role} beat with {strategy} sourcing"
    if retention:
        return f"{base}: {retention}"
    return base


def _first_text(obj: object, fields: tuple[str, ...]) -> str:
    value = _first_value(obj, fields)
    if value is None:
        return ""
    return str(value).strip()


def _first_value(obj: object, fields: tuple[str, ...]) -> object | None:
    for field in fields:
        value = getattr(obj, field, None)
        if value:
            return value
    return None


def _normalize_terms(raw: object) -> tuple[str, ...]:
    if raw is None:
        return ()
    if isinstance(raw, str):
        parts = raw.replace(";", ",").split(",")
    elif isinstance(raw, Iterable):
        parts = [str(item) for item in raw]
    else:
        parts = [str(raw)]
    terms = tuple(part.strip() for part in parts if part and part.strip())
    return tuple(dict.fromkeys(terms))


def _fallback_search_terms(prompt: str) -> tuple[str, ...]:
    words = [
        word.strip(".,:;!?()[]{}\"'").lower()
        for word in prompt.split()
        if len(word.strip(".,:;!?()[]{}\"'")) > 3
    ]
    blocked = {"with", "from", "that", "this", "about", "visual", "image", "scene"}
    terms = [word for word in words if word not in blocked]
    return tuple(dict.fromkeys(terms[:6]))
