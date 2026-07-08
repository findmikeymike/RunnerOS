from __future__ import annotations

import re
from dataclasses import dataclass, replace

from content.writing.brief_generator import CreativeBrief
from content.writing.creative_modes import (
    creative_mode_text,
    normalize_cinema_mode,
    render_character_lock,
    render_world_profile,
)

from creative.production.contracts import CandidateStillRecord, CinemaControlPlan, MotionPromptPlan, ShotPlan
from creative.production.capture_realism import capture_realism_enabled, scene_capture_realism


MAX_PROVIDER_MOTION_PROMPT_CHARS = 2400


@dataclass(frozen=True, slots=True)
class _FacelessStoryContext:
    scene_direction: str = ""
    visual_a: str = ""
    visual_b: str = ""
    retention_reason: str = ""
    audio_emphasis: str = ""
    stock_search_terms: str = ""

_MOTION_PRESETS: dict[str, dict[str, str | int]] = {
    "PREMIUM": {
        "camera": "slow dolly-in with a subtle orbit",
        "ethos": "high-end luxury campaign, elegant, sculptural, expensive, restrained",
        "fallback_action": "the product holds still while warm highlights sweep across the surface and the fabric subtly breathes",
        "duration_s": 5,
        "negative": "cheap, chaotic handheld motion, goofy action, clutter, low-rent energy",
    },
    "EDITORIAL": {
        "camera": "slow push-in with measured handheld texture",
        "ethos": "A24-adjacent editorial cinema, cool, human, moody, tactile",
        "fallback_action": "subtle atmospheric movement and a quiet shift in body language as the frame comes alive",
        "duration_s": 5,
        "negative": "cheesy action, superhero energy, glossy commercial cliches, plastic motion",
    },
    "ART_CULTURE": {
        "camera": "measured dolly with confident cinematic drift",
        "ethos": "cool-culture editorial, A24, Frank Ocean, modern indie cinema, emotionally loaded but controlled",
        "fallback_action": "a small but memorable human action unfolds while the environment wakes up around the subject",
        "duration_s": 6,
        "negative": "corny acting, generic ad energy, stiff mannequin motion",
    },
    "ART_CULTURE_FRANK_OCEAN": {
        "camera": "gentle floating drift with intimate close focus",
        "ethos": "Frank Ocean warmth, dreamy analog memory, tender, golden, emotionally charged",
        "fallback_action": "a quiet intimate gesture lands while warm ambient movement and light shifts carry the frame",
        "duration_s": 6,
        "negative": "hard sell energy, noisy action, over-edited hype",
    },
    "ART_CULTURE_KANYE": {
        "camera": "slow monumental push with restrained lateral drift",
        "ethos": "Kanye-era high-design minimalism, architectural, austere, oversized, iconic",
        "fallback_action": "the subject remains composed while the world around them subtly expands into something monumental",
        "duration_s": 6,
        "negative": "busy chaos, playful whimsy, cluttered set dressing",
    },
    "ART_CULTURE_WES_ANDERSON": {
        "camera": "precise locked-off framing with a tiny symmetrical push",
        "ethos": "Wes Anderson symmetry, storybook precision, whimsical but exacting, curated color",
        "fallback_action": "a crisp theatrical reveal happens inside a perfectly composed symmetrical frame",
        "duration_s": 5,
        "negative": "messy blocking, shaky camera, gritty chaos, asymmetrical slop",
    },
    "BRUTALIST": {
        "camera": "slow push-in with hard geometric framing",
        "ethos": "brutalist menace, cold industrial power, severe contrast, disciplined aggression",
        "fallback_action": "a minimal hostile action happens as dust, smoke, or hard light slices through the frame",
        "duration_s": 5,
        "negative": "cute, soft, playful, warm sentimentality, overdecorated motion",
    },
    "UGC": {
        "camera": "natural handheld iphone framing with slight real-world sway",
        "ethos": "authentic UGC, casual, human, believable, unstaged",
        "fallback_action": "the subject does one clear believable action and reacts naturally in the moment",
        "duration_s": 5,
        "negative": "overly polished camera movement, fake cinematic gloss, hyper-stylized motion",
    },
}


def build_motion_prompt_plan(
    *,
    brief: CreativeBrief,
    selected_still: CandidateStillRecord,
    format_hint: str | None = None,
) -> MotionPromptPlan:
    preset = _MOTION_PRESETS.get(selected_still.style_family, _MOTION_PRESETS["EDITORIAL"])
    cinema_controls = build_cinema_control_plan(
        brief=brief,
        style_family=selected_still.style_family,
        format_hint=format_hint,
    )
    action = _extract_action_hint(brief) or str(preset["fallback_action"])
    camera = _camera_move_text(cinema_controls.camera_move) or str(preset["camera"])
    ethos = str(preset["ethos"])
    duration_s = int(preset["duration_s"])
    negative = str(preset["negative"])
    faceless_context = _faceless_story_context(brief) if _is_faceless_youtube_brief(brief) else None
    if format_hint == "spotify_canvas_loop":
        duration_s = 5
        negative = _append_negative_constraint(
            negative,
            "rendered text, captions, subtitles, lower-third text, typography, letters, words, logo, watermark, call-to-action",
        )
    if not _is_faceless_youtube_brief(brief):
        negative = _append_negative_constraint(
            negative,
            "rendered text, captions, subtitles, lower-third text, typography, letters, words, watermark",
        )
    if faceless_context is not None:
        camera = "slow investigative documentary push-in"
        ethos = "faceless documentary B-roll, cinematic, specific, restrained, story-first"
        negative = (
            "product-ad posing, talking head, presenter, commercial hero shot, goofy action, clutter, "
            "rendered text, captions, subtitles, lower-third text, typography, headline, watermark"
        )
        cinema_controls = build_cinema_control_plan(
            brief=brief,
            style_family=selected_still.style_family,
            format_hint="no_face_youtube",
        )
        camera = _camera_move_text(cinema_controls.camera_move) or camera
        action = _faceless_subject_action(action=action, context=faceless_context)
    subject = _motion_subject(brief)
    shot_plan = _build_shot_plan(
        brief=brief,
        subject=subject,
        action=action,
        camera=camera,
        ethos=ethos,
        duration_s=duration_s,
        negative=negative,
        faceless_context=faceless_context,
    )
    mode_context = creative_mode_text(brief)
    mode_context_clause = f" Creative mode context: {mode_context}." if mode_context else ""

    motion_prompt = (
        f"Opening frame: {shot_plan.opening_frame}. "
        f"Camera movement: {shot_plan.camera_move}. "
        f"Subject action: {shot_plan.subject_action}. "
        f"Environment motion: {shot_plan.environment_motion}. "
        f"Ending frame: {shot_plan.ending_frame}. "
        f"Pacing: {shot_plan.pacing}. "
        f"Cinema controls: {_cinema_controls_clause(cinema_controls)}. "
        f"Visual ethos: {ethos}.{mode_context_clause} "
        f"Preserve: {shot_plan.preservation_constraints}. "
        f"Negative constraints: {shot_plan.negative_constraints}."
    )
    render_style = getattr(brief, "render_style", "auto") or "auto"
    if capture_realism_enabled() and "Capture realism:" not in motion_prompt:
        realism = scene_capture_realism(
            cinema_controls=cinema_controls,
            text=f"{_brief_text(brief)} {motion_prompt}",
            render_style=render_style,
        )
        if realism:  # empty when the intent is non-photoreal (painted/illustrated)
            motion_prompt = f"{motion_prompt} {realism}"
    return MotionPromptPlan(
        motion_prompt=motion_prompt,
        action_description=action,
        camera_direction=camera,
        visual_ethos=ethos,
        duration_s=duration_s,
        negative_prompt=negative,
        shot_plan=shot_plan,
        cinema_controls=cinema_controls,
        render_style=render_style,
    )


def compact_motion_prompt_for_provider(
    motion_plan: MotionPromptPlan,
    *,
    max_chars: int = MAX_PROVIDER_MOTION_PROMPT_CHARS,
) -> MotionPromptPlan:
    if motion_plan.shot_plan is None:
        return replace(
            motion_plan,
            motion_prompt=_clip_text(_visual_notes_before_production_labels(motion_plan.motion_prompt), max_chars),
        )

    shot = motion_plan.shot_plan
    compact_prompt = (
        f"Opening frame: {_provider_clause(shot.opening_frame, 220)}. "
        f"Camera movement: {_provider_clause(shot.camera_move, 120)}. "
        f"Subject action: {_provider_clause(shot.subject_action, 420)}. "
        f"Environment motion: {_provider_clause(shot.environment_motion, 260)}. "
        f"Ending frame: {_provider_clause(shot.ending_frame, 180)}. "
        f"Pacing: {_provider_clause(shot.pacing, 140)}. "
        f"Cinema controls: {_cinema_controls_clause(motion_plan.cinema_controls)}. "
        f"Visual ethos: {_provider_clause(motion_plan.visual_ethos, 160)}. "
        f"Preserve: {_provider_preservation_clause(shot.preservation_constraints, 620)}. "
        f"Negative constraints: {_provider_clause(shot.negative_constraints, 220)}."
    )
    realism_suffix = ""
    if capture_realism_enabled() and "Capture realism:" not in compact_prompt:
        realism = scene_capture_realism(
            cinema_controls=motion_plan.cinema_controls,
            text=f"{motion_plan.visual_ethos or ''} {motion_plan.motion_prompt or ''} {compact_prompt}",
            render_style=getattr(motion_plan, "render_style", "auto"),
        )
        if realism:  # empty when the intent is non-photoreal (painted/illustrated)
            realism_suffix = " " + realism
    # Reserve room for the realism clause and clip the BASE — the clause is
    # appended last but is the highest-value content, so it must never be the
    # part that gets severed by the length cap.
    base_budget = max(0, max_chars - len(realism_suffix))
    if len(compact_prompt) > base_budget:
        compact_prompt = _clip_text(compact_prompt, base_budget)
    compact_prompt = f"{compact_prompt}{realism_suffix}"
    return replace(motion_plan, motion_prompt=compact_prompt)


def enrich_motion_prompt_for_video_tier(
    motion_plan: MotionPromptPlan,
    *,
    quality_tier: str,
) -> MotionPromptPlan:
    if quality_tier != "premium":
        return motion_plan
    enrichment = (
        "Premium motion treatment: preserve the source frame while adding refined micro-motion, "
        "controlled parallax, tactile material detail, intentional highlight movement, and an elegant final hold; "
        "avoid cheap spectacle, random camera drift, or generic stock-video energy."
    )
    prompt = motion_plan.motion_prompt.strip()
    if "Premium motion treatment:" in prompt:
        return motion_plan
    return replace(motion_plan, motion_prompt=f"{prompt} {enrichment}".strip())


def build_cinema_control_plan(
    *,
    brief: CreativeBrief,
    style_family: str,
    format_hint: str | None = None,
) -> CinemaControlPlan:
    text = _brief_text(brief)
    format_type = format_hint or _cinema_format_hint(brief, text)
    mood_set = {mood.lower().strip() for mood in brief.mood_keywords if mood.strip()}
    explicit_mode = normalize_cinema_mode(getattr(brief, "cinema_mode", "") or "")

    if explicit_mode:
        return _cinema_control_for_mode(explicit_mode)

    if format_type == "ugc_scripted_ad" or style_family == "UGC":
        return CinemaControlPlan(
            camera_move="handheld_sway",
            lens_feel="phone_wide",
            depth_of_field="natural_deep",
            lighting_style="available_room_light",
            motion_intensity="medium",
            framing="creator_medium_close",
        )
    if format_type == "app_demo_ad":
        return CinemaControlPlan(
            camera_move="controlled_screen_push",
            lens_feel="clean_50mm",
            depth_of_field="deep_readable",
            lighting_style="soft_even_key",
            motion_intensity="low",
            framing="device_ui_readable",
        )
    if format_type == "lyric_video" and style_family == "ART_CULTURE_FRANK_OCEAN":
        return CinemaControlPlan(
            camera_move="gentle_floating_drift",
            lens_feel="dreamy_50mm",
            depth_of_field="medium_shallow",
            lighting_style="atmospheric_color_wash",
            motion_intensity="medium",
            framing="lyric_safe_negative_space",
        )
    if format_type == "lyric_video":
        return CinemaControlPlan(
            camera_move="rhythmic_drift",
            lens_feel="dreamy_50mm",
            depth_of_field="medium_shallow",
            lighting_style="atmospheric_color_wash",
            motion_intensity="medium",
            framing="lyric_safe_negative_space",
        )
    if format_type == "no_face_youtube":
        return CinemaControlPlan(
            camera_move="slow_investigative_push",
            lens_feel="documentary_35mm",
            depth_of_field="medium_documentary",
            lighting_style="motivated_practical_light",
            motion_intensity="low",
            framing="evidence_detail_frame",
        )
    if format_type == "narrative_sequence":
        return CinemaControlPlan(
            camera_move="story_state_push",
            lens_feel="cinematic_50mm",
            depth_of_field="shallow_subject",
            lighting_style="motivated_cinematic_key",
            motion_intensity="medium_high",
            framing="story_subject_frame",
        )
    if _requests_weird_or_absurd_style(text):
        return CinemaControlPlan(
            camera_move="offbeat_snap_push",
            lens_feel="slightly_wide_surreal",
            depth_of_field="medium_sharp",
            lighting_style="stylized_unreal_key",
            motion_intensity="high",
            framing="odd_centered_composition",
        )
    if style_family == "ART_CULTURE_WES_ANDERSON":
        return CinemaControlPlan(
            camera_move="precise_locked_push",
            lens_feel="storybook_35mm",
            depth_of_field="deep_symmetrical",
            lighting_style="clean_whimsical_key",
            motion_intensity="low",
            framing="centered_symmetry",
        )
    if mood_set & {"premium", "luxury", "sleek", "refined", "sophisticated"} or style_family == "PREMIUM":
        return CinemaControlPlan(
            camera_move="slow_dolly_in",
            lens_feel="70mm_compressed",
            depth_of_field="shallow",
            lighting_style="soft_side_key",
            motion_intensity="low",
            framing="tight_product_detail",
        )
    return CinemaControlPlan(
        camera_move="slow_push_in",
        lens_feel="clean_50mm",
        depth_of_field="medium",
        lighting_style="soft_natural_key",
        motion_intensity="medium",
        framing="balanced_subject_frame",
    )


def _cinema_control_for_mode(mode: str) -> CinemaControlPlan:
    if mode == "studio_editorial":
        return CinemaControlPlan(
            camera_move="controlled_editorial_push",
            lens_feel="clean_85mm",
            depth_of_field="shallow_subject",
            lighting_style="soft_studio_key",
            motion_intensity="low",
            framing="editorial_subject_frame",
        )
    if mode == "action":
        return CinemaControlPlan(
            camera_move="reactive_handheld_drive",
            lens_feel="wide_35mm",
            depth_of_field="medium_sharp",
            lighting_style="hard_directional",
            motion_intensity="high",
            framing="kinetic_subject_frame",
        )
    if mode == "performance":
        return CinemaControlPlan(
            camera_move="handheld_orbital",
            lens_feel="cinematic_55mm",
            depth_of_field="medium_shallow",
            lighting_style="stage_light_haze",
            motion_intensity="medium_high",
            framing="performance_stage_frame",
        )
    if mode == "atmospheric":
        return CinemaControlPlan(
            camera_move="slow_atmospheric_push",
            lens_feel="wide_35mm",
            depth_of_field="medium_documentary",
            lighting_style="ambient_environment_light",
            motion_intensity="low",
            framing="environment_plate",
        )
    return CinemaControlPlan(
        camera_move="story_state_push",
        lens_feel="cinematic_50mm",
        depth_of_field="shallow_subject",
        lighting_style="motivated_cinematic_key",
        motion_intensity="medium_high",
        framing="story_subject_frame",
    )


def _cinema_format_hint(brief: CreativeBrief, text: str) -> str:
    if "lyric" in text or "chorus" in text:
        return "lyric_video"
    if "ugc" in text or "hook, problem, solution" in text or "testimonial" in text:
        return "ugc_scripted_ad"
    if _has_any_text_term(
        text,
        (
            "creator explaining",
            "creator on camera",
            "creator talks",
            "talking head",
            "talk to camera",
            "selfie video",
            "presenter explaining",
        ),
    ):
        return "ugc_scripted_ad"
    if _is_faceless_youtube_brief(brief):
        return "no_face_youtube"
    if brief.product_type == "app" or _has_any_text_term(
        text,
        ("app", "mobile", "ios", "android", "dashboard", "screenshot", "saas", "web app"),
    ):
        return "app_demo_ad"
    if _has_any_text_term(text, ("story", "narrative", "multi-scene", "sequence", "episode", "novel", "character")):
        return "narrative_sequence"
    return "multi_shot_ad"


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
            " ".join(getattr(brief, "script_bits", ()) or ()),
            " ".join(getattr(brief, "must_say", ()) or ()),
            " ".join(getattr(brief, "avoid_phrases", ()) or ()),
            getattr(brief, "hook_direction", "") or "",
            getattr(brief, "tone_direction", "") or "",
            creative_mode_text(brief),
            " ".join(brief.mood_keywords or []),
        )
        if part
    ).lower()


def _has_any_text_term(text: str, terms: tuple[str, ...]) -> bool:
    normalized = text.lower()
    for term in terms:
        pattern = r"(?<![a-z0-9])" + re.escape(term.lower()).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
        if re.search(pattern, normalized):
            return True
    return False


def _requests_weird_or_absurd_style(text: str) -> bool:
    terms = ("weird", "absurd", "surreal", "viral", "meme")
    if not _has_any_text_term(text, terms):
        return False
    for term in terms:
        negated = (
            r"(?<![a-z0-9])"
            r"(?:no|not|without|avoid|avoids|avoiding)\s+"
            r"(?:[a-z0-9-]+\s+){0,3}"
            + re.escape(term)
            + r"(?![a-z0-9])"
        )
        if re.search(negated, text):
            return False
    return True


def _cinema_controls_clause(cinema_controls: CinemaControlPlan | None) -> str:
    if cinema_controls is None:
        return "use the shot plan camera and lighting consistently"
    return (
        f"camera_move={cinema_controls.camera_move}; "
        f"lens_feel={cinema_controls.lens_feel}; "
        f"depth_of_field={cinema_controls.depth_of_field}; "
        f"lighting_style={cinema_controls.lighting_style}; "
        f"motion_intensity={cinema_controls.motion_intensity}; "
        f"framing={cinema_controls.framing}"
    )


def _camera_move_text(camera_move: str) -> str:
    return {
        "slow_dolly_in": "slow dolly-in",
        "slow_push_in": "slow push-in",
        "handheld_sway": "natural handheld iphone framing with slight real-world sway",
        "controlled_screen_push": "controlled screen-focused push-in",
        "rhythmic_drift": "gentle rhythmic camera drift",
        "gentle_floating_drift": "gentle floating drift with intimate close focus",
        "slow_investigative_push": "slow investigative documentary push-in",
        "story_state_push": "measured push that reveals a story state change",
        "offbeat_snap_push": "quick offbeat push with odd timing",
        "precise_locked_push": "precise locked-off framing with a tiny symmetrical push",
        "controlled_editorial_push": "controlled studio-editorial push-in",
        "reactive_handheld_drive": "reactive handheld drive with urgent physical momentum",
        "handheld_orbital": "subtle handheld orbit around the performer",
        "slow_atmospheric_push": "slow atmospheric push through the environment",
    }.get(camera_move, "")


def _build_shot_plan(
    *,
    brief: CreativeBrief,
    subject: str,
    action: str,
    camera: str,
    ethos: str,
    duration_s: int,
    negative: str,
    faceless_context: _FacelessStoryContext | None = None,
) -> ShotPlan:
    environment_motion = (
        _faceless_environment_motion(faceless_context)
        if faceless_context is not None
        else None
    ) or _extract_environment_motion(action) or _fallback_environment_motion(brief)
    ending_frame = _build_ending_frame(brief=brief, subject=subject)
    preservation_constraints = (
        "scene geography, composition, lighting, atmosphere, and visual continuity from the source still"
        if _is_faceless_youtube_brief(brief)
        else "identity, product shape, logo/design details, clothing silhouette, composition, and lighting from the source still"
    )
    character_lock = render_character_lock(getattr(brief, "character_lock", {}) or {})
    if character_lock:
        preservation_constraints = f"{preservation_constraints}; locked character continuity: {character_lock}"
    return ShotPlan(
        opening_frame=_build_opening_frame(
            subject=subject,
            faceless_context=faceless_context,
        ),
        subject_action=action,
        camera_move=_simplify_camera_move(camera),
        environment_motion=environment_motion,
        ending_frame=ending_frame,
        pacing=f"one clear motion beat over {duration_s} seconds; smooth, natural, no rushed cuts",
        preservation_constraints=preservation_constraints,
        negative_constraints=negative,
    )


def _append_negative_constraint(existing: str, addition: str) -> str:
    existing = existing.strip()
    return f"{existing}, {addition}" if existing else addition


def _simplify_camera_move(camera: str) -> str:
    parts = [part.strip() for part in camera.replace(" with ", ", ").split(",") if part.strip()]
    if not parts:
        return camera
    # Image-to-video models behave better with one dominant camera intention.
    return parts[0]


def _extract_environment_motion(action: str) -> str | None:
    lower = action.lower()
    environment_keywords = (
        "flames",
        "fire",
        "explodes",
        "erupts",
        "light flickers",
        "lights flicker",
        "smoke",
        "rain",
        "steam",
        "dust",
        "wind",
        "neon",
        "shadow",
    )
    if any(keyword in lower for keyword in environment_keywords):
        return action
    return None


def _fallback_environment_motion(brief: CreativeBrief) -> str:
    world_profile = render_world_profile(getattr(brief, "world_profile", {}) or {})
    if world_profile:
        return f"subtle world motion follows the locked world profile: {world_profile}"
    notes = " ".join(
        _visual_notes_before_production_labels(part)
        for part in (brief.aesthetic_notes, brief.competitor_visual_notes)
        if part and _visual_notes_before_production_labels(part)
    )
    if notes:
        return f"subtle atmospheric movement suggested by the brief: {notes.rstrip('.')}"
    if _is_faceless_youtube_brief(brief):
        return "subtle dust, light flicker, shadow movement, and quiet environmental atmosphere"
    return "subtle light shift, slight fabric movement, and natural background atmosphere"


def _build_opening_frame(*, subject: str, faceless_context: _FacelessStoryContext | None) -> str:
    if faceless_context is None:
        return f"the source still holds for a beat, centered on {subject}"
    direction = faceless_context.scene_direction or faceless_context.visual_a or subject
    variants = _faceless_variant_clause(faceless_context)
    if variants:
        return f"the source still holds as a story-first documentary frame: {direction}; {variants}"
    return f"the source still holds as a story-first documentary frame: {direction}"


def _faceless_subject_action(*, action: str, context: _FacelessStoryContext) -> str:
    variants = _faceless_variant_clause(context)
    direction = context.scene_direction.strip()
    parts = [action]
    if direction:
        parts.append(f"carry the story direction '{direction}'")
    if context.retention_reason:
        parts.append(f"retention reason: {context.retention_reason}")
    if variants:
        parts.append(f"use {variants}")
    return "; ".join(part for part in parts if part)


def _faceless_environment_motion(context: _FacelessStoryContext | None) -> str:
    if context is None:
        return ""
    parts = [
        f"scene direction: {context.scene_direction}" if context.scene_direction else "",
        f"visual A: {context.visual_a}" if context.visual_a else "",
        f"visual B: {context.visual_b}" if context.visual_b else "",
        f"retention reason: {context.retention_reason}" if context.retention_reason else "",
        f"stock search cues: {context.stock_search_terms}" if context.stock_search_terms else "",
    ]
    text = "; ".join(part for part in parts if part)
    if text:
        return f"subtle documentary atmosphere advances the story-first beat; {text}"
    return ""


def _faceless_variant_clause(context: _FacelessStoryContext) -> str:
    if context.visual_a and context.visual_b:
        return f"A/B visual rhythm: A = {context.visual_a}; B = {context.visual_b}"
    if context.visual_a:
        return f"visual A idea: {context.visual_a}"
    if context.visual_b:
        return f"visual B idea: {context.visual_b}"
    return ""


def _build_ending_frame(*, brief: CreativeBrief, subject: str) -> str:
    cta = (brief.cta_text or "").strip()
    overlay = (brief.copy_for_overlay or "").strip()
    if _is_faceless_youtube_brief(brief):
        if cta or overlay:
            return "camera settles into a quiet final documentary frame with clean subtitle-safe lower-third space; no rendered text"
        return f"camera settles into a stable documentary composition that keeps {subject} readable"
    if cta or overlay:
        return "camera settles into a clean hero frame with blank caption-safe space; no rendered text or letters"
    return f"camera settles into a stable final composition that keeps {subject} readable"


def _motion_subject(brief: CreativeBrief) -> str:
    subject = " ".join((brief.product_description or "the scene").split()).strip()
    if not _is_faceless_youtube_brief(brief):
        return subject
    prefixes = (
        "mini documentary about ",
        "no-face youtube explainer about ",
        "no face youtube explainer about ",
        "youtube explainer about ",
        "explainer about ",
        "documentary about ",
    )
    lower = subject.lower()
    for prefix in prefixes:
        if lower.startswith(prefix):
            return _clean_faceless_subject(subject[len(prefix):].strip() or subject)
    return _clean_faceless_subject(subject)


def _clean_faceless_subject(subject: str) -> str:
    clean = subject.strip().rstrip(".?!")
    lower = clean.lower()
    for prefix in ("why ", "how ", "what makes "):
        if lower.startswith(prefix):
            clean = clean[len(prefix):].strip()
            break
    return clean or subject


def _is_faceless_youtube_brief(brief: CreativeBrief) -> bool:
    text = " ".join(
        part
        for part in (
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.platform,
        )
        if part
    ).lower()
    if _requests_on_camera_presenter(text):
        return False
    return "youtube" in brief.platform.lower() and ("no-face" in text or "no face" in text)


def _requests_on_camera_presenter(text: str) -> bool:
    on_camera_terms = ("talking head", "on-camera", "on camera", "presenter", "host on camera")
    if not any(term in text for term in on_camera_terms):
        return False
    negated_terms = (
        "no talking head",
        "without talking head",
        "without a talking head",
        "without showing a talking head",
        "no presenter",
        "without presenter",
        "not a presenter",
        "no host on camera",
        "without host on camera",
        "no on-camera",
        "without on-camera",
        "no on camera",
        "without on camera",
    )
    return not any(term in text for term in negated_terms)


def _faceless_story_context(brief: CreativeBrief) -> _FacelessStoryContext:
    return _FacelessStoryContext(
        scene_direction=_extract_labeled_clause(brief, "Story scene direction:") or "",
        visual_a=_extract_labeled_clause(brief, "Visual A idea:") or "",
        visual_b=_extract_labeled_clause(brief, "Visual B idea:") or "",
        retention_reason=_extract_labeled_clause(brief, "Retention reason:") or "",
        audio_emphasis=_extract_labeled_clause(brief, "Audio emphasis:") or "",
        stock_search_terms=_extract_labeled_clause(brief, "Stock search terms:") or "",
    )


def _extract_action_hint(brief: CreativeBrief) -> str | None:
    labeled_motion_intent = _extract_labeled_clause(brief, "Motion intent:")
    if labeled_motion_intent:
        return labeled_motion_intent.rstrip(".")

    labeled_shot_action = _extract_labeled_clause(brief, "Shot action:")
    if labeled_shot_action:
        return labeled_shot_action.rstrip(".")

    for field in (brief.aesthetic_notes, brief.competitor_visual_notes, brief.campaign_goal):
        text = (field or "").strip()
        if not text:
            continue
        for sentence in _candidate_action_sentences(text):
            lowered = sentence.lower()
            if any(
                keyword in lowered
                for keyword in (
                    "he ",
                    "she ",
                    "they ",
                    "subject ",
                    "creator ",
                    "model ",
                    "person ",
                    "throws",
                    "flicks",
                    "explodes",
                    "reveals",
                    "rotates",
                    "steps",
                    "walks",
                    "lights",
                    "opens",
                    "drops",
                    "turns",
                    "points",
                    "nods",
                    "raises",
                    "adjusts",
                    "demonstrates",
                    "reacts",
                    "holds",
                    "shows",
                )
            ):
                return sentence.rstrip(".")
    return None


def _extract_labeled_clause(brief: CreativeBrief, label: str) -> str | None:
    for field in (brief.aesthetic_notes, brief.competitor_visual_notes, brief.campaign_goal):
        text = (field or "").strip()
        if not text or label not in text:
            continue
        after = text.split(label, 1)[1].strip()
        if not after:
            continue
        for stop in _PRODUCTION_LABELS:
            if stop == label:
                continue
            if stop in after:
                after = after.split(stop, 1)[0].strip()
        return " ".join(after.rstrip(".").split()) or None
    return None


_PRODUCTION_LABELS = (
    "Audio goal:",
    "Caption goal:",
    "Motion intent:",
    "Voiceover goal:",
    "Music/SFX goal:",
    "Reference strategy:",
    "Shot purpose:",
    "Shot action:",
    "Framing:",
    "Continuity anchor:",
    "Caption role:",
    "Visual goal:",
    "Visual premise:",
    "Image focus:",
    "Story scene direction:",
    "Visual A idea:",
    "Visual B idea:",
    "Retention reason:",
    "Audio emphasis:",
    "Stock search terms:",
)


def _visual_notes_before_production_labels(value: str) -> str:
    text = " ".join((value or "").split()).strip()
    if not text:
        return ""
    first_label_index = min(
        (index for label in _PRODUCTION_LABELS if (index := text.find(label)) >= 0),
        default=-1,
    )
    if first_label_index >= 0:
        text = text[:first_label_index].strip()
    return text.rstrip(".")


def _provider_clause(value: str, max_chars: int) -> str:
    return _clip_text(_visual_notes_before_production_labels(value), max_chars)


def _provider_preservation_clause(value: str, max_chars: int) -> str:
    details: list[str] = []
    lowered = value.lower()
    if "face identity" in lowered:
        details.append("face identity")
    if "product shape" in lowered:
        details.append("product shape")
    if not details:
        details.append("subject")
    prefix = (
        "Preserve the provided image exactly as the opening frame: "
        f"same {', '.join(dict.fromkeys(details))}, composition, and lighting. "
        "Add motion only through camera movement, atmosphere, and the requested action. "
    )
    return _clip_text(prefix + _visual_notes_before_production_labels(value), max_chars)


def _candidate_action_sentences(text: str) -> list[str]:
    normalized = " ".join(text.split())
    parts = [part.strip(" ;") for part in normalized.split(".") if part.strip(" ;")]
    return [part for part in parts if len(part) >= 12]


def _clip_text(value: str, max_chars: int) -> str:
    text = " ".join((value or "").split()).strip()
    if len(text) <= max_chars:
        return text
    clipped = text[: max(0, max_chars - 1)].rstrip()
    for marker in (". ", "; ", ", "):
        index = clipped.rfind(marker)
        if index >= max_chars * 0.55:
            clipped = clipped[: index + 1].rstrip()
            break
    return f"{clipped.rstrip('.;,')}..."
