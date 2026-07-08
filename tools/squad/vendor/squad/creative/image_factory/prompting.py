"""Prompt template library and planning helpers for the Sprint 1 image factory."""

from __future__ import annotations

import re
from pathlib import Path
from string import Formatter

from content.writing.creative_modes import normalize_render_style
from creative.image_factory.contracts import (
    ImageFactoryRequest,
    ImageGenerationPlan,
    PromptTemplate,
    VariantSpec,
    normalize_aspect_ratio,
)


MODEL_BY_TIER = {
    "draft": "gpt-image-1.5",
    "balanced": "gpt-image-1.5",
    "premium": "gpt-image-1.5",
}

ESTIMATED_COST_BY_TIER = {
    "draft": 0.009,
    "balanced": 0.034,
    "premium": 0.133,
}

MODEL_COSTS = {
    "gpt-image-1.5": 0.034,
    "fal-ai/flux/dev/redux": 0.03,
    "fal-ai/flux-pro/kontext": 0.04,
    "fal-ai/flux-pro/kontext/max": 0.08,
    "fal-ai/ideogram/character": 0.08,
}

TEMPLATE_LIBRARY: dict[str, PromptTemplate] = {
    "product_on_scene": PromptTemplate(
        id="product_on_scene",
        name="Product In Scene",
        category="product_placement",
        base_prompt=(
            "{product_subject} placed naturally in {scene_brief}, "
            "{style_phrase}, premium commercial photography, clear product visibility"
        ),
        style_modifiers=("photorealistic", "cinematic lighting", "high detail"),
        negative_prompt="blurry, distorted product, duplicate product, watermark, extra objects",
        recommended_model=MODEL_BY_TIER["premium"],
        reference_image_slots=1,
    ),
    "lifestyle_shot": PromptTemplate(
        id="lifestyle_shot",
        name="Lifestyle Product Shot",
        category="lifestyle_shot",
        base_prompt=(
            "{product_subject} featured in a believable lifestyle moment, {scene_brief}, "
            "{style_phrase}, warm editorial product photography"
        ),
        style_modifiers=("natural light", "editorial", "shallow depth of field"),
        negative_prompt="staged, awkward pose, low detail, distorted hands, unreadable product",
        recommended_model=MODEL_BY_TIER["balanced"],
        reference_image_slots=1,
    ),
    "app_in_hand": PromptTemplate(
        id="app_in_hand",
        name="App In Hand",
        category="product_placement",
        base_prompt=(
            "person holding a phone showing {product_subject}, {scene_brief}, "
            "{style_phrase}, realistic hand placement, readable screen"
        ),
        style_modifiers=("lifestyle photography", "clean composition", "sharp focus"),
        negative_prompt="blurry screen, extra fingers, warped phone, unreadable UI",
        recommended_model=MODEL_BY_TIER["balanced"],
        reference_image_slots=2,
    ),
    "hero_banner": PromptTemplate(
        id="hero_banner",
        name="Hero Banner",
        category="hero_banner",
        base_prompt=(
            "{product_subject} as the hero of a premium ad banner, {scene_brief}, "
            "{style_phrase}, striking composition, clean negative space reserved for later caption overlay, "
            "no rendered headline text"
        ),
        style_modifiers=("bold framing", "luxury ad style", "high contrast"),
        negative_prompt=(
            "cluttered frame, weak focal point, low contrast, distorted product, rendered text, headline, "
            "typography, letters, captions, subtitles, watermark"
        ),
        recommended_model=MODEL_BY_TIER["premium"],
        reference_image_slots=1,
    ),
    "social_thumb": PromptTemplate(
        id="social_thumb",
        name="Social Thumbnail",
        category="social_thumb",
        base_prompt=(
            "{product_subject} designed for a scroll-stopping social thumbnail, {scene_brief}, "
            "{style_phrase}, punchy composition, instantly readable"
        ),
        style_modifiers=("high energy", "bold color", "thumbnail clarity"),
        negative_prompt="muddy colors, weak focal point, tiny product, unreadable composition",
        recommended_model=MODEL_BY_TIER["draft"],
        reference_image_slots=1,
    ),
}


def list_template_ids() -> tuple[str, ...]:
    return tuple(TEMPLATE_LIBRARY.keys())


def get_template(template_id: str) -> PromptTemplate:
    try:
        return TEMPLATE_LIBRARY[template_id]
    except KeyError as exc:
        raise ValueError(f"Unknown image factory template: {template_id}") from exc


def _required_fields(template: PromptTemplate) -> tuple[str, ...]:
    fields: list[str] = []
    for _, field_name, _, _ in Formatter().parse(template.base_prompt):
        if field_name:
            fields.append(field_name)
    return tuple(fields)


# Render-style → STILL style phrase. The image-to-video clip inherits the still's
# look, so a painterly/illustrated/animated brief must produce a matching still —
# not a photoreal one with the realism merely suppressed downstream. Applied only
# for an explicit non-photoreal render_style; auto/photoreal keep the template
# style modifiers verbatim (byte-identical default behavior).
_NON_PHOTOREAL_STILL_PHRASES = {
    "painterly": "rendered as a painting with visible brushwork and canvas texture, painterly illustration, not photographic",
    "illustrated": "hand-drawn illustration with clean inked linework and flat shading, illustrated art, not photographic",
    "animated": "2D animation cel with bold flat colors and clean linework, animated cartoon style, not photographic",
    "stylized": "stylized non-photoreal rendering with a clear artistic look, not photographic",
}
# Template/tag tokens that assert photorealism — dropped when render_style is
# non-photoreal so the prompt does not fight itself ("photorealistic ... oil painting").
_PHOTOREAL_MODIFIER_TOKENS = (
    "photorealistic", "photoreal", "realistic", "photography", "photographic",
    "cinematic lighting", "high detail", "sharp focus", "shallow depth of field",
    "lifestyle photography",
)


def _normalize_render_style(value: str | None) -> str:
    return normalize_render_style(value) or "auto"


def _still_style_phrase_for(render_style: str | None) -> str:
    return _NON_PHOTOREAL_STILL_PHRASES.get(_normalize_render_style(render_style), "")


def _is_photoreal_modifier(token: str) -> bool:
    low = token.lower()
    return any(tok in low for tok in _PHOTOREAL_MODIFIER_TOKENS)


# Photoreal phrases baked into the template BASE strings (not just the modifiers).
# Removed for non-photoreal render styles so the prompt doesn't say both
# "rendered as a painting" and "commercial photography".
_PHOTOREAL_BASE_PHRASES = (
    "premium commercial photography",
    "warm editorial product photography",
    "commercial photography",
    "product photography",
    "realistic hand placement",
)


def _strip_photoreal_base_phrases(prompt: str) -> str:
    out = prompt
    for phrase in _PHOTOREAL_BASE_PHRASES:
        out = re.sub(r"\s*,?\s*" + re.escape(phrase), "", out, flags=re.IGNORECASE)
    return " ".join(out.split()).strip()


def _join_style(
    style_tags: tuple[str, ...], template: PromptTemplate, *, render_style: str | None = None
) -> str:
    tags = tuple(tag.strip() for tag in style_tags if tag.strip())
    still_phrase = _still_style_phrase_for(render_style)
    if still_phrase:
        # Non-photoreal: drop photoreal-coded modifiers/tags and lead with the
        # render-style phrase so the still actually renders in that medium.
        kept_modifiers = tuple(m for m in template.style_modifiers if not _is_photoreal_modifier(m))
        kept_tags = tuple(t for t in tags if not _is_photoreal_modifier(t))
        merged = (still_phrase,) + kept_modifiers + kept_tags
    else:
        merged = template.style_modifiers + tags
    return ", ".join(dict.fromkeys(merged))


def render_prompt(
    template_id: str,
    *,
    product_subject: str,
    scene_brief: str,
    style_tags: tuple[str, ...] = (),
    render_style: str | None = None,
    **variables: str,
) -> str:
    template = get_template(template_id)
    values = {
        "product_subject": product_subject.strip(),
        "scene_brief": scene_brief.strip(),
        "style_phrase": _join_style(style_tags, template, render_style=render_style),
        **{key: value.strip() for key, value in variables.items()},
    }
    missing = [field for field in _required_fields(template) if not values.get(field)]
    if missing:
        raise ValueError(f"Missing prompt variables for template '{template_id}': {', '.join(missing)}")
    rendered = template.base_prompt.format(**values).strip()
    if _still_style_phrase_for(render_style):
        rendered = _strip_photoreal_base_phrases(rendered)
    return rendered


def _merge_negative_prompt(request: ImageFactoryRequest, template: PromptTemplate) -> str | None:
    template_negative = (template.negative_prompt or "").strip()
    request_negative = (request.negative_prompt or "").strip()
    values = [value for value in (template_negative, request_negative) if value]
    if not values:
        return None
    return ", ".join(values)


def _apply_regeneration_hint(
    prompt: str,
    negative_prompt: str | None,
    regeneration_hint: str | None,
) -> tuple[str, str | None]:
    hint = (regeneration_hint or "").strip()
    if not hint:
        return prompt, negative_prompt
    revised_prompt = f"{prompt}. Revision guidance: {hint}"
    revised_negative = negative_prompt
    return revised_prompt, revised_negative


def _resolve_model_id(request: ImageFactoryRequest, template: PromptTemplate) -> str:
    if request.model_id_override:
        return request.model_id_override.strip()
    if request.quality_tier == "draft":
        return MODEL_BY_TIER["draft"]
    if template.recommended_model.strip():
        return template.recommended_model
    return MODEL_BY_TIER[request.quality_tier]


def _estimate_model_cost(model_id: str, quality_tier: str, variant_count: int) -> float:
    if model_id == "gpt-image-1.5":
        return round(ESTIMATED_COST_BY_TIER[quality_tier] * max(1, variant_count), 4)
    unit_cost = MODEL_COSTS.get(model_id, ESTIMATED_COST_BY_TIER[quality_tier])
    return round(unit_cost * max(1, variant_count), 4)


OPENAI_SIZE_BY_ASPECT_RATIO = {
    "1:1": "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "4:3": "1536x1024",
    "3:4": "1024x1536",
}


def openai_size_for_aspect_ratio(aspect_ratio: str) -> str:
    return OPENAI_SIZE_BY_ASPECT_RATIO.get(normalize_aspect_ratio(aspect_ratio), "1024x1024")


def _model_parameters_for_request(request: ImageFactoryRequest, model_id: str) -> dict[str, str]:
    if model_id != "gpt-image-1.5":
        return {}
    quality = {
        "draft": "low",
        "balanced": "medium",
        "premium": "high",
    }.get(request.quality_tier, "medium")
    return {
        "quality": quality,
        "size": openai_size_for_aspect_ratio(request.aspect_ratio),
        "aspect_ratio": request.aspect_ratio,
        "input_fidelity": "high",
    }


def _reference_paths(request: ImageFactoryRequest) -> tuple[Path, ...]:
    ordered_paths = (request.product_image_path,) + tuple(request.reference_image_paths)
    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in ordered_paths:
        normalized = Path(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return tuple(deduped)


def _validate_reference_slots(request: ImageFactoryRequest, template: PromptTemplate) -> None:
    available_references = len(_reference_paths(request))
    if available_references < template.reference_image_slots:
        raise ValueError(
            "template "
            f"'{template.id}' requires {template.reference_image_slots} reference image slots, "
            f"but only {available_references} were provided"
        )


def build_image_plan(
    request: ImageFactoryRequest,
    *,
    product_subject: str,
    extra_variables: dict[str, str] | None = None,
    attempt_index: int = 1,
    regeneration_hint: str | None = None,
) -> ImageGenerationPlan:
    template = get_template(request.template_id)
    _validate_reference_slots(request, template)
    model_id = _resolve_model_id(request, template)
    prompt = render_prompt(
        request.template_id,
        product_subject=product_subject,
        scene_brief=request.scene_brief,
        style_tags=request.style_tags,
        render_style=str(request.metadata.get("render_style") or "auto"),
        **(extra_variables or {}),
    )
    negative_prompt = _merge_negative_prompt(request, template)
    prompt, negative_prompt = _apply_regeneration_hint(prompt, negative_prompt, regeneration_hint)
    variants = tuple(
        VariantSpec(
            variant_id=(
                f"{request.template_id}-{index + 1}"
                if attempt_index == 1
                else f"{request.template_id}-retry{attempt_index - 1}-{index + 1}"
            ),
            aspect_ratio=request.aspect_ratio,
        )
        for index in range(request.variant_count)
    )
    estimated_cost = _estimate_model_cost(model_id, request.quality_tier, len(variants))
    if estimated_cost > request.budget_cap_usd:
        raise ValueError(
            f"Estimated generation cost ${estimated_cost:.2f} exceeds budget cap ${request.budget_cap_usd:.2f}"
        )
    return ImageGenerationPlan(
        model_id=model_id,
        resolved_prompt=prompt,
        negative_prompt=negative_prompt,
        reference_paths=_reference_paths(request),
        variant_specs=variants,
        estimated_cost_usd=estimated_cost,
        template_id=template.id,
        attempt_index=attempt_index,
        regeneration_hint=(regeneration_hint or "").strip() or None,
        model_parameters=_model_parameters_for_request(request, model_id),
    )
