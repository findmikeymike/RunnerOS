from __future__ import annotations

from dataclasses import dataclass

from content.writing.brief_generator import CreativeBrief


@dataclass(frozen=True, slots=True)
class GenerativeModelSpec:
    model_id: str
    provider: str
    display_name: str
    description: str
    estimated_cost_usd: float
    pricing_note: str
    strengths: tuple[str, ...]
    supports: tuple[str, ...]
    input_contract: str
    adapter_ready: bool
    source_url: str
    notes: str = ""


@dataclass(frozen=True, slots=True)
class ModelRoute:
    model_id: str
    provider: str
    estimated_cost_usd: float
    reason: str
    confidence: float
    adapter_ready: bool
    input_contract: str
    fallback_model_id: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class VideoModelSpec:
    model_id: str
    provider: str
    display_name: str
    description: str
    estimated_cost_per_second_usd: float
    strengths: tuple[str, ...]
    supports: tuple[str, ...]
    mode: str
    quality_tier: str
    adapter_ready: bool
    source_url: str
    notes: str = ""
    supported_aspect_ratios: tuple[str, ...] = ()
    supported_durations_s: tuple[int, ...] = ()
    min_duration_s: int | None = None
    max_duration_s: int | None = None


@dataclass(frozen=True, slots=True)
class VideoModelRoute:
    model_id: str
    provider: str
    estimated_cost_usd: float
    estimated_cost_per_second_usd: float
    reason: str
    confidence: float
    quality_tier: str
    mode: str
    adapter_ready: bool
    fallback_model_id: str | None = None
    warnings: tuple[str, ...] = ()


def default_image_model_registry() -> tuple[GenerativeModelSpec, ...]:
    return (
        GenerativeModelSpec(
            model_id="gpt-image-1.5",
            provider="openai",
            display_name="GPT Image 1.5",
            description="Default high-quality image route for prompt adherence, text rendering, edits, and multi-reference inputs.",
            estimated_cost_usd=0.009,
            pricing_note="OpenAI listed medium 1024x1024 output at $0.034/image on 2026-04-19; low is $0.009 and high is $0.133.",
            strengths=("default", "budget", "photoreal", "product", "reference_image", "multi_reference", "face_reference", "typography", "prompt_adherence"),
            supports=("text_to_image", "image_reference", "multi_reference", "face_reference", "input_fidelity"),
            input_contract="openai_images_edits",
            adapter_ready=True,
            source_url="https://developers.openai.com/api/docs/guides/image-generation",
            notes="Uses Image API generations without refs and edits with one or more reference images; default for face refs unless a later eval proves a specialist beats it.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/flux/dev/redux",
            provider="fal",
            display_name="FLUX Dev Redux",
            description="Cheap reference-image route for fast product and smoke-test iterations.",
            estimated_cost_usd=0.03,
            pricing_note="Internal estimate per generated image; verify against provider billing before production pricing.",
            strengths=("budget", "photoreal", "reference_image", "product"),
            supports=("image_reference",),
            input_contract="image_url",
            adapter_ready=False,
            source_url="local:creative/image_factory/prompting.py",
            notes="Sidelined for live routing after repeated Fal storage auth 403 failures; keep as candidate only until account/CDN auth is fixed.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/flux-pro/kontext",
            provider="fal",
            display_name="FLUX Pro Kontext",
            description="Balanced reference-image model for photoreal product placement and prompt adherence.",
            estimated_cost_usd=0.04,
            pricing_note="Internal estimate per generated image; verify against provider billing before production pricing.",
            strengths=("photoreal", "product", "reference_image", "prompt_adherence"),
            supports=("image_reference",),
            input_contract="image_url",
            adapter_ready=False,
            source_url="local:creative/image_factory/prompting.py",
            notes="Sidelined for live routing after repeated Fal storage auth 403 failures; keep as candidate only until account/CDN auth is fixed.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/flux-pro/kontext/max",
            provider="fal",
            display_name="FLUX Pro Kontext Max",
            description="Higher-quality reference-image route for premium photoreal product scenes.",
            estimated_cost_usd=0.08,
            pricing_note="Internal estimate per generated image from image-factory prompt table.",
            strengths=("premium", "photoreal", "product", "reference_image", "prompt_adherence"),
            supports=("image_reference",),
            input_contract="image_url",
            adapter_ready=False,
            source_url="local:creative/image_factory/prompting.py",
            notes="Sidelined for live routing after repeated Fal storage auth 403 failures; keep as candidate only until account/CDN auth is fixed.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/ideogram/character",
            provider="fal",
            display_name="Ideogram V3 Character",
            description="Character and face-reference generation when identity preservation matters.",
            estimated_cost_usd=0.08,
            pricing_note="Planning estimate only; provider pricing should be checked for exact run cost.",
            strengths=("face_reference", "character_reference", "photoreal", "identity"),
            supports=("face_reference", "character_reference"),
            input_contract="reference_image_urls",
            adapter_ready=False,
            source_url="https://fal.ai/models/fal-ai/ideogram/character/api",
            notes="Sidelined for live routing after repeated Fal storage auth 403 failures; keep as candidate only until account/CDN auth is fixed.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/ideogram/v3",
            provider="fal",
            display_name="Ideogram V3",
            description="Text-to-image route for posters, logos, commercial graphics, and crisp typography.",
            estimated_cost_usd=0.08,
            pricing_note="Planning estimate only; provider pricing should be checked for exact run cost.",
            strengths=("typography", "poster", "logo", "marketing", "prompt_adherence"),
            supports=("text_to_image",),
            input_contract="prompt",
            adapter_ready=False,
            source_url="https://fal.ai/models/fal-ai/ideogram/v3/api",
            notes="Candidate route until text-to-image-only factory path is wired.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/ideogram/v3/remix",
            provider="fal",
            display_name="Ideogram V3 Remix",
            description="Image-to-image remix route for graphic redesigns while preserving an input image.",
            estimated_cost_usd=0.08,
            pricing_note="Planning estimate only; provider pricing should be checked for exact run cost.",
            strengths=("typography", "remix", "poster", "style_transfer", "marketing"),
            supports=("image_reference",),
            input_contract="image_url",
            adapter_ready=False,
            source_url="https://fal.ai/models/fal-ai/ideogram/v3/remix/api",
            notes="Candidate route until remix strength/style options are exposed safely.",
        ),
        GenerativeModelSpec(
            model_id="imagen-3.0-generate-002",
            provider="lumenfall",
            display_name="Google Imagen 3 via Lumenfall",
            description="Commercial text-to-image model candidate for high prompt adherence, typography, and marketing imagery.",
            estimated_cost_usd=0.03,
            pricing_note="Planning estimate from Lumenfall model page at time of implementation.",
            strengths=("typography", "prompt_adherence", "marketing", "photoreal", "product"),
            supports=("text_to_image",),
            input_contract="openai_images_generations",
            adapter_ready=False,
            source_url="https://lumenfall.ai/models/google/imagen-3.0-generate-002",
            notes="Candidate route only until Lumenfall image adapter exists.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/flux/schnell",
            provider="fal",
            display_name="FLUX Schnell",
            description="Very cheap fast-iteration model for abstract, background, and throwaway concept passes.",
            estimated_cost_usd=0.01,
            pricing_note="Planning estimate only; use for routing pressure, not exact invoices.",
            strengths=("budget", "fast_iteration", "abstract", "backgrounds"),
            supports=("text_to_image",),
            input_contract="prompt",
            adapter_ready=False,
            source_url="local:prompt_templates/TEMPLATES_STRUCTURED.py",
            notes="Candidate cheap abstract/background route; not wired to current reference-image client.",
        ),
        GenerativeModelSpec(
            model_id="fal-ai/kling-image/v3/image-to-image",
            provider="fal",
            display_name="Kling Image v3 Image-to-Image",
            description="Image-to-image candidate for cinematic transformations and stylized scene changes.",
            estimated_cost_usd=0.05,
            pricing_note="Planning estimate only; provider page documents image-to-image constraints but exact cost should be verified.",
            strengths=("cinematic", "style_transfer", "image_to_image", "scene_transform"),
            supports=("image_reference",),
            input_contract="image_url",
            adapter_ready=False,
            source_url="https://fal.ai/models/fal-ai/kling-image/v3/image-to-image/api",
            notes="Candidate route until prompt/size constraints are wrapped and tested.",
        ),
    )


def default_video_model_registry() -> tuple[VideoModelSpec, ...]:
    return (
        VideoModelSpec(
            model_id="wavespeed/wavespeed-ai/ltx-2.3-image-to-video",
            provider="wavespeed",
            display_name="WaveSpeed LTX 2.3 I2V",
            description="Cheapest hosted image-to-video route for scaled smoke tests and budget production clips.",
            estimated_cost_per_second_usd=0.008,
            strengths=("budget", "smoke_test", "fast_iteration", "image_to_video", "open_source"),
            supports=("image_to_video", "reference_frame", "hosted_scale"),
            mode="image_to_video",
            quality_tier="budget",
            adapter_ready=False,
            source_url="https://wavespeed.ai/docs/docs-api/wavespeed-ai/ltx-2.3-image-to-video",
            notes="WaveSpeed-hosted LTX 2.3; pricing observed as $0.04/video. Candidate-only until this exact model has a clean live smoke.",
            min_duration_s=2,
            max_duration_s=8,
        ),
        VideoModelSpec(
            model_id="wavespeed/bytedance/seedance-v1-lite-i2v-480p",
            provider="wavespeed",
            display_name="WaveSpeed Seedance Lite I2V 480p",
            description="Cheap hosted image-to-video route for reliable scaled tests when prompt adherence matters.",
            estimated_cost_per_second_usd=0.016,
            strengths=("budget", "scale", "prompt_adherence", "image_to_video", "fast_iteration"),
            supports=("image_to_video", "reference_frame", "hosted_scale"),
            mode="image_to_video",
            quality_tier="budget",
            adapter_ready=True,
            source_url="https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedance-v1-lite-i2v-480p",
            notes="WaveSpeed-hosted Seedance Lite; pricing observed as $0.08/video for 480p I2V.",
            supported_durations_s=(5, 10),
        ),
        VideoModelSpec(
            model_id="fal-ai/vidu/q2/reference-to-video",
            provider="fal",
            display_name="Vidu Q2 Reference-to-Video",
            description="Cheapest live test route for low-resolution reference-driven image-to-video validation.",
            estimated_cost_per_second_usd=0.02,
            strengths=("budget", "smoke_test", "fast_iteration", "image_to_video"),
            supports=("image_to_video", "reference_to_video", "aspect_ratio"),
            mode="image_to_video",
            quality_tier="budget",
            adapter_ready=True,
            source_url="https://fal.ai/models/fal-ai/vidu/q2/reference-to-video",
            notes="Adapter sends reference_image_urls at 360p. Internal smoke estimate is $0.10 per clip.",
            min_duration_s=1,
            max_duration_s=8,
        ),
        VideoModelSpec(
            model_id="fal-ai/kling-video/v2.5-turbo/standard/image-to-video",
            provider="fal",
            display_name="Kling 2.5 Turbo Standard I2V",
            description="Fallback budget image-to-video path when first-frame preservation matters more than low smoke-test cost.",
            estimated_cost_per_second_usd=0.07,
            strengths=("budget", "first_frame", "image_to_video"),
            supports=("image_to_video",),
            mode="image_to_video",
            quality_tier="budget",
            adapter_ready=True,
            source_url="local:creative/video_factory/video_adapter.py",
            notes="Existing budget video adapter route; more expensive than Vidu Q2 for smoke tests.",
        ),
        VideoModelSpec(
            model_id="fal-ai/kling-video/v3/standard/image-to-video",
            provider="fal",
            display_name="Kling 3 Standard I2V",
            description="Balanced image-to-video path for stronger prompt adherence and general creative work.",
            estimated_cost_per_second_usd=0.14,
            strengths=("balanced", "prompt_adherence", "cinematic", "image_to_video"),
            supports=("image_to_video",),
            mode="image_to_video",
            quality_tier="standard",
            adapter_ready=True,
            source_url="local:creative/video_factory/video_adapter.py",
            notes="Existing standard video adapter route.",
        ),
        VideoModelSpec(
            model_id="fal-ai/kling-video/v3/pro/image-to-video",
            provider="fal",
            display_name="Kling 3 Pro I2V",
            description="Premium image-to-video path for high-stakes cinematic shots with complex motion.",
            estimated_cost_per_second_usd=0.28,
            strengths=("premium", "cinematic", "complex_motion", "prompt_adherence", "image_to_video"),
            supports=("image_to_video",),
            mode="image_to_video",
            quality_tier="premium",
            adapter_ready=True,
            source_url="local:creative/video_factory/video_adapter.py",
            notes="Existing premium video adapter route.",
        ),
        VideoModelSpec(
            model_id="fal-ai/kling-video/v3/standard/text-to-video",
            provider="fal",
            display_name="Kling 3 Standard T2V",
            description="Text-to-video route for shots without a selected still or reference frame.",
            estimated_cost_per_second_usd=0.14,
            strengths=("text_to_video", "balanced", "prompt_adherence"),
            supports=("text_to_video",),
            mode="text_to_video",
            quality_tier="standard",
            adapter_ready=True,
            source_url="local:creative/video_factory/video_adapter.py",
            notes="Adapter-ready but not used by the current image-first production loop.",
        ),
        VideoModelSpec(
            model_id="runpod/ltx-video-2.3",
            provider="runpod",
            display_name="LTX Video 2.3 via RunPod",
            description="Candidate self-hosted video backbone for longer image-to-video clips, audio-guided motion, and lower marginal generation cost.",
            estimated_cost_per_second_usd=0.03,
            strengths=("cost_control", "long_clip", "image_to_video", "audio_to_video", "multi_shot_ad"),
            supports=("image_to_video", "text_to_video", "audio_to_video", "twenty_second_clip", "video_with_audio"),
            mode="image_to_video",
            quality_tier="standard",
            adapter_ready=False,
            source_url="local:creative/video_factory/runpod_ltx_adapter.py",
            notes="Candidate-only until a RunPod endpoint template is deployed and live cost/latency/quality benchmarks pass.",
        ),
        VideoModelSpec(
            model_id="comfy/ltx-video-2.3",
            provider="comfyui",
            display_name="LTX Video 2.3 via ComfyUI Pod",
            description="Template-backed ComfyUI LTX 2.3 route for image-to-video and audio-capable workflows after a pod URL and API workflow are configured.",
            estimated_cost_per_second_usd=0.025,
            strengths=("open_source", "image_to_video", "audio_to_video", "video_with_audio", "comfyui_template"),
            supports=("image_to_video", "audio_to_video", "video_with_audio", "twenty_second_clip"),
            mode="image_to_video",
            quality_tier="standard",
            adapter_ready=False,
            source_url="local:creative/video_factory/comfy_ltx_adapter.py",
            notes="Adapter implemented; candidate-only until exported API workflow bindings and a live pod smoke test pass.",
        ),
    )


def list_image_model_registry_for_prompt(
    registry: tuple[GenerativeModelSpec, ...] | None = None,
) -> str:
    """Compact model catalog for a bounded LLM router prompt."""
    models = registry or default_image_model_registry()
    rows = [
        "| model_id | provider | cost | adapter | strengths | description |",
        "| --- | --- | ---: | --- | --- | --- |",
    ]
    for model in models:
        rows.append(
            "| "
            + " | ".join(
                (
                    model.model_id,
                    model.provider,
                    f"${model.estimated_cost_usd:.2f}",
                    "ready" if model.adapter_ready else "candidate",
                    ", ".join(model.strengths),
                    model.description.replace("|", "/"),
                )
            )
            + " |"
        )
    return "\n".join(rows)


def list_video_model_registry_for_prompt(
    registry: tuple[VideoModelSpec, ...] | None = None,
) -> str:
    models = registry or default_video_model_registry()
    rows = [
        "| model_id | provider | cost/sec | mode | quality | adapter | strengths | description |",
        "| --- | --- | ---: | --- | --- | --- | --- | --- |",
    ]
    for model in models:
        rows.append(
            "| "
            + " | ".join(
                (
                    model.model_id,
                    model.provider,
                    f"${model.estimated_cost_per_second_usd:.2f}",
                    model.mode,
                    model.quality_tier,
                    "ready" if model.adapter_ready else "candidate",
                    ", ".join(model.strengths),
                    model.description.replace("|", "/"),
                )
            )
            + " |"
        )
    return "\n".join(rows)


def select_image_model_route(
    *,
    brief: CreativeBrief,
    budget_cap_usd: float,
    registry: tuple[GenerativeModelSpec, ...] | None = None,
    require_adapter_ready: bool = False,
) -> ModelRoute:
    models = registry or default_image_model_registry()
    intent = _infer_model_intent(brief=brief, budget_cap_usd=budget_cap_usd)
    candidates = [model for model in models if _model_matches_intent(model, intent)]
    if require_adapter_ready:
        candidates = [model for model in candidates if model.adapter_ready]
    affordable = [model for model in candidates if model.estimated_cost_usd <= budget_cap_usd]
    selected = _lowest_cost_best_match(affordable or candidates, intent=intent)
    warnings: list[str] = []
    fallback = _fallback_adapter_ready_model(models=models, budget_cap_usd=budget_cap_usd)
    if selected is None:
        selected = fallback
        warnings.append("no intent-specific model available; using cheapest adapter-ready fallback")
    elif selected.estimated_cost_usd > budget_cap_usd:
        if require_adapter_ready and fallback and fallback.estimated_cost_usd <= budget_cap_usd:
            warnings.append(
                f"best intent model {selected.model_id} exceeds budget cap ${budget_cap_usd:.2f}; "
                f"using affordable adapter-ready fallback {fallback.model_id}"
            )
            selected = fallback
        else:
            warnings.append(
                f"best model exceeds budget cap ${budget_cap_usd:.2f}; selected as candidate only"
            )
    if selected is None:
        raise ValueError("model registry has no adapter-ready fallback")
    if not selected.adapter_ready:
        warnings.append("selected model is not adapter-ready; do not route live generation yet")

    fallback_model_id = fallback.model_id if fallback and fallback.model_id != selected.model_id else None
    return ModelRoute(
        model_id=selected.model_id,
        provider=selected.provider,
        estimated_cost_usd=selected.estimated_cost_usd,
        reason=_route_reason(intent=intent, model=selected),
        confidence=_confidence_for_intent(intent=intent, model=selected),
        adapter_ready=selected.adapter_ready,
        input_contract=selected.input_contract,
        fallback_model_id=fallback_model_id,
        warnings=tuple(warnings),
    )


def select_video_model_route(
    *,
    brief: CreativeBrief,
    motion_prompt: str,
    duration_s: int,
    budget_cap_usd: float,
    requested_quality: str = "budget",
    mode: str = "image_to_video",
    aspect_ratio: str | None = None,
    registry: tuple[VideoModelSpec, ...] | None = None,
    require_adapter_ready: bool = True,
) -> VideoModelRoute:
    models = registry or default_video_model_registry()
    candidates = [model for model in models if model.mode == mode]
    if require_adapter_ready:
        candidates = [model for model in candidates if model.adapter_ready]
    incompatible = [
        model
        for model in candidates
        if not _video_model_is_compatible(model, duration_s=duration_s, aspect_ratio=aspect_ratio)
    ]
    if incompatible:
        candidates = [
            model
            for model in candidates
            if _video_model_is_compatible(model, duration_s=duration_s, aspect_ratio=aspect_ratio)
        ]
    if not candidates:
        raise ValueError(f"video model registry has no candidates for mode {mode!r}")

    if requested_quality == "budget":
        budget_candidates = [model for model in candidates if model.quality_tier == "budget"]
        if budget_candidates:
            candidates = budget_candidates

    intent = _infer_video_model_intent(
        brief=brief,
        motion_prompt=motion_prompt,
        requested_quality=requested_quality,
    )
    ranked = sorted(candidates, key=lambda model: _video_model_rank(model, intent, requested_quality))
    selected = ranked[0]
    affordable_fallback = _cheapest_affordable_video_model(
        models=tuple(candidates),
        duration_s=duration_s,
        budget_cap_usd=budget_cap_usd,
    )
    warnings: list[str] = []
    if incompatible:
        warnings.append(
            "filtered incompatible video models: "
            + ", ".join(model.model_id for model in incompatible)
        )
    selected_cost = _estimate_video_model_cost(selected, duration_s)
    if selected_cost > budget_cap_usd:
        if affordable_fallback is not None:
            warnings.append(
                f"best video model {selected.model_id} exceeds budget cap ${budget_cap_usd:.2f}; "
                f"using affordable fallback {affordable_fallback.model_id}"
            )
            selected = affordable_fallback
            selected_cost = _estimate_video_model_cost(selected, duration_s)
        else:
            warnings.append(
                f"best video model exceeds budget cap ${budget_cap_usd:.2f}; selected as candidate only"
            )

    fallback = _cheapest_affordable_video_model(
        models=tuple(model for model in candidates if model.model_id != selected.model_id),
        duration_s=duration_s,
        budget_cap_usd=budget_cap_usd,
    )
    fallback_model_id = fallback.model_id if fallback else None
    return VideoModelRoute(
        model_id=selected.model_id,
        provider=selected.provider,
        estimated_cost_usd=selected_cost,
        estimated_cost_per_second_usd=selected.estimated_cost_per_second_usd,
        reason=_video_route_reason(intent=intent, model=selected, requested_quality=requested_quality),
        confidence=_video_confidence_for_intent(intent=intent, model=selected, requested_quality=requested_quality),
        quality_tier=selected.quality_tier,
        mode=selected.mode,
        adapter_ready=selected.adapter_ready,
        fallback_model_id=fallback_model_id,
        warnings=tuple(warnings),
    )


def _infer_model_intent(*, brief: CreativeBrief, budget_cap_usd: float) -> str:
    text = " ".join(
        value
        for value in (
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.competitor_visual_notes,
            brief.copy_for_overlay or "",
            brief.cta_text or "",
        )
        if value
    ).lower()
    if budget_cap_usd <= 0.04:
        return "budget"
    if any(term in text for term in ("face reference", "my face", "selfie", "headshot", "use my face", "same person")):
        return "face_reference"
    if any(term in text for term in ("text", "typography", "poster", "headline", "signage", "logo text", "words")):
        return "typography"
    if any(term in text for term in ("abstract", "surreal", "psychedelic", "illustration", "album art", "cover art")):
        return "abstract"
    return "photoreal_product"


def _infer_video_model_intent(*, brief: CreativeBrief, motion_prompt: str, requested_quality: str) -> str:
    text = " ".join(
        value
        for value in (
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            motion_prompt,
            " ".join(getattr(brief, "mood_keywords", []) or []),
        )
        if value
    ).lower()
    if requested_quality == "premium":
        return "premium"
    if any(term in text for term in ("explode", "explosion", "fire", "flames", "violent", "complex motion", "crowd", "chase")):
        return "complex_motion"
    if requested_quality == "standard":
        return "balanced"
    if any(term in text for term in ("cinematic", "a24", "dolly", "crane", "tracking shot", "film", "high-end")):
        return "cinematic"
    return "budget"


def _model_matches_intent(model: GenerativeModelSpec, intent: str) -> bool:
    if intent == "budget":
        return "budget" in model.strengths
    if intent == "face_reference":
        return "face_reference" in model.strengths or "face_reference" in model.supports
    if intent == "typography":
        return "typography" in model.strengths
    if intent == "abstract":
        return "abstract" in model.strengths
    if intent == "photoreal_product":
        return "photoreal" in model.strengths and "product" in model.strengths
    return False


def _video_model_rank(model: VideoModelSpec, intent: str, requested_quality: str) -> tuple[int, float, str]:
    if intent == "complex_motion" and "premium" in model.strengths:
        return (-1, model.estimated_cost_per_second_usd, model.model_id)
    if requested_quality in {"standard", "premium"} and model.quality_tier == requested_quality:
        return (0, model.estimated_cost_per_second_usd, model.model_id)
    if intent in model.strengths:
        return (0, model.estimated_cost_per_second_usd, model.model_id)
    if intent == "cinematic" and "prompt_adherence" in model.strengths:
        return (1, model.estimated_cost_per_second_usd, model.model_id)
    if model.quality_tier == requested_quality:
        return (2, model.estimated_cost_per_second_usd, model.model_id)
    return (3, model.estimated_cost_per_second_usd, model.model_id)


def _estimate_video_model_cost(model: VideoModelSpec, duration_s: int) -> float:
    return round(model.estimated_cost_per_second_usd * max(1, int(duration_s)), 2)


def _video_model_is_compatible(
    model: VideoModelSpec,
    *,
    duration_s: int,
    aspect_ratio: str | None,
) -> bool:
    duration = max(1, int(duration_s))
    if model.supported_durations_s and duration not in model.supported_durations_s:
        return False
    if model.min_duration_s is not None and duration < model.min_duration_s:
        return False
    if model.max_duration_s is not None and duration > model.max_duration_s:
        return False
    if aspect_ratio and model.supported_aspect_ratios:
        normalized = aspect_ratio.strip()
        if normalized and normalized not in model.supported_aspect_ratios:
            return False
    return True


def _cheapest_affordable_video_model(
    *,
    models: tuple[VideoModelSpec, ...],
    duration_s: int,
    budget_cap_usd: float,
) -> VideoModelSpec | None:
    affordable = [
        model
        for model in models
        if model.adapter_ready and _estimate_video_model_cost(model, duration_s) <= budget_cap_usd
    ]
    return sorted(affordable, key=lambda model: (model.estimated_cost_per_second_usd, model.model_id))[0] if affordable else None


def _lowest_cost_best_match(models: list[GenerativeModelSpec], *, intent: str) -> GenerativeModelSpec | None:
    if not models:
        return None
    return sorted(models, key=lambda model: _image_model_rank(model, intent=intent))[0]


def _image_model_rank(model: GenerativeModelSpec, *, intent: str) -> tuple[int, float, str]:
    if intent == "photoreal_product" and model.model_id == "gpt-image-1.5":
        return (0, model.estimated_cost_usd, model.model_id)
    if intent == "face_reference" and model.model_id == "gpt-image-1.5":
        return (0, model.estimated_cost_usd, model.model_id)
    if intent == "typography" and model.model_id == "gpt-image-1.5":
        return (0, model.estimated_cost_usd, model.model_id)
    return (1 if model.adapter_ready else 2, model.estimated_cost_usd, model.model_id)


def _fallback_adapter_ready_model(
    *,
    models: tuple[GenerativeModelSpec, ...],
    budget_cap_usd: float,
) -> GenerativeModelSpec | None:
    ready = [model for model in models if model.adapter_ready and model.estimated_cost_usd <= budget_cap_usd]
    if not ready:
        ready = [model for model in models if model.adapter_ready]
    return sorted(ready, key=lambda model: (model.estimated_cost_usd, model.model_id))[0] if ready else None


def _route_reason(*, intent: str, model: GenerativeModelSpec) -> str:
    return (
        f"intent '{intent}' matched {model.provider}:{model.model_id} "
        f"via strengths {', '.join(model.strengths)}"
    )


def _video_route_reason(*, intent: str, model: VideoModelSpec, requested_quality: str) -> str:
    return (
        f"intent '{intent}' with requested quality '{requested_quality}' matched "
        f"{model.provider}:{model.model_id} via strengths {', '.join(model.strengths)}"
    )


def _confidence_for_intent(*, intent: str, model: GenerativeModelSpec) -> float:
    if _model_matches_intent(model, intent):
        return 0.86 if model.adapter_ready else 0.74
    return 0.45


def _video_confidence_for_intent(*, intent: str, model: VideoModelSpec, requested_quality: str) -> float:
    if model.quality_tier == requested_quality:
        return 0.88
    if intent in model.strengths:
        return 0.82
    return 0.58
