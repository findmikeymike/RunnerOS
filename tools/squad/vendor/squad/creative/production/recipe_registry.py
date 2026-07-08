"""Named creative production recipes.

Recipes are the bridge between a human goal ("promote my song") and Squad's
lower-level image/video/carousel/provider machinery.
"""

from __future__ import annotations

from dataclasses import dataclass

from content.writing.brief_generator import CreativeBrief


@dataclass(frozen=True, slots=True)
class CreativeRecipe:
    recipe_id: str
    label: str
    primary_use: str
    native_route: str
    output_type: str
    format_type_hint: str
    preferred_platforms: tuple[str, ...]
    trigger_terms: tuple[str, ...]
    reference_roles: tuple[str, ...]
    aesthetic_controls: tuple[str, ...]
    recommended_first_step: str
    muapi_candidate_terms: tuple[str, ...] = ()
    notes: str = ""


@dataclass(frozen=True, slots=True)
class RecipeRecommendation:
    recipe: CreativeRecipe
    score: int
    reasons: tuple[str, ...]


def recipe_recommendation_to_payload(recommendation: RecipeRecommendation) -> dict[str, object]:
    recipe = recommendation.recipe
    route, route_reason = _recommend_execution_route(recommendation)
    return {
        "recipe_id": recipe.recipe_id,
        "label": recipe.label,
        "score": recommendation.score,
        "native_route": recipe.native_route,
        "recommended_route": route,
        "route_reason": route_reason,
        "output_type": recipe.output_type,
        "format_type_hint": recipe.format_type_hint,
        "recommended_first_step": recipe.recommended_first_step,
        "reference_roles": list(recipe.reference_roles),
        "aesthetic_controls": list(recipe.aesthetic_controls),
        "muapi_candidate_terms": list(recipe.muapi_candidate_terms),
        "reasons": list(recommendation.reasons),
    }


def _recommend_execution_route(recommendation: RecipeRecommendation) -> tuple[str, str]:
    recipe = recommendation.recipe
    if recommendation.score <= 0:
        return "manual_review", "low confidence recipe match"
    if recipe.output_type == "carousel" or recipe.native_route == "carousel":
        return "carousel", "carousel lane stays out of video production"
    if recipe.output_type in {"image", "variants"} or recipe.native_route == "native_image":
        return "native_image", "image-only scope fits Squad native image production"
    if recipe.native_route == "muapi_or_native_video":
        return "muapi_workflow", "external workflow candidate likely faster or broader for this lane"
    if recipe.native_route == "native_video":
        return "native_video", "Squad native video lane is the best first path"
    return "manual_review", f"unknown native route: {recipe.native_route}"


def default_recipe_registry() -> tuple[CreativeRecipe, ...]:
    return (
        CreativeRecipe(
            recipe_id="music-promo-clip",
            label="Music Promo Clip",
            primary_use="Short video for a song, chorus, lyric moment, artist world, or release push.",
            native_route="native_video",
            output_type="full_production",
            format_type_hint="lyric_video",
            preferred_platforms=("tiktok", "instagram_story", "instagram_reel", "youtube"),
            trigger_terms=("music", "song", "single", "album", "lyric", "chorus", "track", "artist", "spotify"),
            reference_roles=("cover_art", "artist_photo", "style_reference", "audio_track"),
            aesthetic_controls=("lighting_style", "camera_move", "motion_intensity", "lyric_caption_style", "pacing"),
            recommended_first_step="Build a music-led visual treatment, then generate image-first scenes before motion.",
            muapi_candidate_terms=("lyric", "music", "character story", "kinetic"),
            notes="Best native fit when audio/lyrics and brand world matter more than a generic template.",
        ),
        CreativeRecipe(
            recipe_id="app-demo-ad",
            label="App Demo Ad",
            primary_use="Mobile or web app promo that needs screenshots, feature proof, and a clear CTA.",
            native_route="native_video",
            output_type="full_production",
            format_type_hint="multi_shot_ad",
            preferred_platforms=("tiktok", "instagram_story", "linkedin", "youtube"),
            trigger_terms=("app", "mobile", "ios", "android", "web app", "saas", "dashboard", "feature", "demo"),
            reference_roles=("app_screenshot", "logo", "product_reference", "style_reference"),
            aesthetic_controls=("framing", "device_context", "caption_density", "camera_move", "proof_sequence"),
            recommended_first_step="Create a tight feature-proof sequence from screenshots before animating.",
            muapi_candidate_terms=("product video", "showcase", "ugc ads", "app"),
            notes="Needs readable UI and strong proof hierarchy; avoid random cinematic motion that hides the product.",
        ),
        CreativeRecipe(
            recipe_id="ugc-product-ad",
            label="UGC Product Ad",
            primary_use="Creator-style ad with hook, problem, solution, proof, and CTA.",
            native_route="muapi_or_native_video",
            output_type="full_production",
            format_type_hint="ugc_scripted_ad",
            preferred_platforms=("tiktok", "instagram_story", "instagram_reel"),
            trigger_terms=("ugc", "testimonial", "creator", "influencer", "hook", "problem", "solution", "product ad"),
            reference_roles=("product_reference", "creator_reference", "style_reference", "voice_script"),
            aesthetic_controls=("authenticity_level", "handheld_motion", "room_context", "caption_style", "voice_tone"),
            recommended_first_step="Try MuAPI/Open Gen style workflow first if a creator/presenter asset is needed.",
            muapi_candidate_terms=("ugc ads workflow", "product video ad maker", "influencer content"),
            notes="Native Squad currently escalates unsupported talking-head/lipsync; MuAPI may be faster here.",
        ),
        CreativeRecipe(
            recipe_id="novel-teaser",
            label="Novel / Story Teaser",
            primary_use="Book, novel, worldbuilding, or character-driven teaser video.",
            native_route="native_video",
            output_type="full_production",
            format_type_hint="narrative_sequence",
            preferred_platforms=("tiktok", "instagram_reel", "youtube"),
            trigger_terms=("novel", "book", "story", "character", "chapter", "world", "trailer", "teaser", "scene"),
            reference_roles=("cover_art", "character_reference", "style_reference", "scene_reference"),
            aesthetic_controls=("cinematic_lighting", "lens_feel", "camera_move", "emotional_arc", "pacing"),
            recommended_first_step="Plan a three-to-five beat narrative sequence with one strong visual hook.",
            muapi_candidate_terms=("character story video", "indie anime", "story video"),
            notes="Good place for Squad's creative treatment layer to beat generic templates.",
        ),
        CreativeRecipe(
            recipe_id="product-showcase",
            label="Product Showcase",
            primary_use="Premium product/ad/product-page visuals and short product motion.",
            native_route="muapi_or_native_video",
            output_type="full_production",
            format_type_hint="multi_shot_ad",
            preferred_platforms=("instagram_feed", "instagram_story", "website", "linkedin"),
            trigger_terms=(
                "product",
                "shop",
                "drop",
                "merch",
                "showcase",
                "mockup",
                "ecommerce",
                "e-commerce",
                "shirt",
                "tee",
                "apparel",
                "clothing",
            ),
            reference_roles=("product_reference", "logo", "style_reference", "scene_reference"),
            aesthetic_controls=("material_detail", "lighting_style", "camera_move", "background_style", "premium_level"),
            recommended_first_step="Generate premium stills, then animate only the strongest still.",
            muapi_candidate_terms=("product photoshoot", "product showcase", "product 360", "mockup"),
            notes="MuAPI has many product recipes; port only repeated winners.",
        ),
        CreativeRecipe(
            recipe_id="carousel-argument",
            label="Carousel Argument",
            primary_use="Swipeable educational, launch, or thought-leadership carousel.",
            native_route="carousel",
            output_type="carousel",
            format_type_hint="carousel",
            preferred_platforms=("instagram_feed", "linkedin"),
            trigger_terms=("carousel", "swipe", "slides", "linkedin document", "thread", "tips"),
            reference_roles=("brand_style", "logo", "proof_points"),
            aesthetic_controls=("hook_strength", "word_density", "visual_hierarchy", "cta_style", "premium_level"),
            recommended_first_step="Use the local carousel planner/renderer; do not route into video spend.",
            muapi_candidate_terms=(),
            notes="Keep this lane separate and cheap.",
        ),
        CreativeRecipe(
            recipe_id="weird-viral-format",
            label="Weird Viral Format",
            primary_use="Surreal, meme-adjacent, or novelty social video patterns.",
            native_route="muapi_or_native_video",
            output_type="full_production",
            format_type_hint="narrative_sequence",
            preferred_platforms=("tiktok", "instagram_reel", "youtube"),
            trigger_terms=("viral", "weird", "absurd", "meme", "talking baby", "monkey", "surreal", "strange"),
            reference_roles=("style_reference", "character_reference", "prompt_reference"),
            aesthetic_controls=("absurdity_level", "motion_intensity", "pacing", "caption_style", "shareability"),
            recommended_first_step="Use MuAPI templates for trend-shaped novelty, then save winners as Squad recipes.",
            muapi_candidate_terms=("talking baby", "monkey", "selfie", "kinetic recall"),
            notes="This is where external workflow breadth is most valuable.",
        ),
    )


def get_recipe(recipe_id: str) -> CreativeRecipe:
    for recipe in default_recipe_registry():
        if recipe.recipe_id == recipe_id:
            return recipe
    raise ValueError(f"Unknown creative recipe: {recipe_id}")


def recommend_recipes(brief: CreativeBrief, *, limit: int = 3) -> tuple[RecipeRecommendation, ...]:
    scored = [_score_recipe(recipe, brief) for recipe in default_recipe_registry()]
    scored = [item for item in scored if item.score > 0]
    scored.sort(key=lambda item: (item.score, item.recipe.recipe_id), reverse=True)
    return tuple(scored[: max(limit, 0)])


def recommend_recipe(brief: CreativeBrief) -> RecipeRecommendation:
    recommendations = recommend_recipes(brief, limit=1)
    if recommendations:
        return recommendations[0]
    fallback = get_recipe("product-showcase" if brief.output_type == "full_production" else "carousel-argument" if brief.output_type == "carousel" else "app-demo-ad")
    return RecipeRecommendation(recipe=fallback, score=0, reasons=("fallback",))


def _score_recipe(recipe: CreativeRecipe, brief: CreativeBrief) -> RecipeRecommendation:
    text = _brief_text(brief)
    platform = brief.platform.strip().lower()
    reasons: list[str] = []
    score = 0

    if recipe.output_type == brief.output_type:
        score += 4
        reasons.append(f"output_type:{brief.output_type}")
    elif recipe.output_type == "full_production" and brief.output_type in {"video", "full_production"}:
        score += 2
        reasons.append("video-compatible")

    if platform in recipe.preferred_platforms:
        score += 2
        reasons.append(f"platform:{platform}")

    matched_terms = tuple(term for term in recipe.trigger_terms if term in text)
    if matched_terms:
        score += min(9, len(matched_terms) * 3)
        reasons.append("terms:" + ",".join(matched_terms[:4]))

    if any(role_hint in text for role_hint in ("reference", "screenshot", "logo", "cover", "face", "product image")):
        score += 1
        reasons.append("reference-aware")

    return RecipeRecommendation(recipe=recipe, score=score, reasons=tuple(reasons))


def _brief_text(brief: CreativeBrief) -> str:
    return " ".join(
        part
        for part in (
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.copy_for_overlay or "",
            brief.voiceover_script or "",
            brief.cta_text or "",
            " ".join(brief.mood_keywords or ()),
        )
        if part
    ).lower()
