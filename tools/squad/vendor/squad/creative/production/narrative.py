from __future__ import annotations

from dataclasses import replace
import re

from content.writing.brief_generator import CreativeBrief
from content.writing.creative_modes import creative_mode_text
from creative.production.contracts import (
    CreativeTreatmentPlan,
    FormatNarrativePlan,
    NarrativeSceneScript,
    NarrativeScriptPlan,
    PlatformProfile,
    SceneBeat,
    ShotDirective,
    UgcStrategyPlan,
)
from creative.production.treatment import build_creative_treatment
from creative.production.ugc import build_ugc_strategy


FORMAT_TYPES = (
    "multi_shot_ad",
    "app_demo_ad",
    "ugc_scripted_ad",
    "lyric_video",
    "spotify_canvas_loop",
    "no_face_youtube",
    "narrative_sequence",
)

PRODUCTION_MODES = ("image_first", "audio_first", "sequence_first")


def build_format_narrative_plan(brief: CreativeBrief) -> FormatNarrativePlan:
    text = _brief_text(brief)
    platform_profile = _platform_profile(brief.platform)
    format_type = _infer_format_type(brief, text)
    production_mode = _production_mode_for_format(format_type)
    intent = _infer_intent(brief, text)
    primary_intent = _primary_intent_for_format(format_type=format_type, intent=intent)
    emotion_start, emotion_peak, emotion_end = _emotion_arc_parts(
        primary_intent=primary_intent,
        text=text,
        mood_keywords=tuple(brief.mood_keywords or ()),
    )
    audio_mode = _infer_audio_mode(brief, text, format_type)
    caption_strategy = _caption_strategy_for_format(format_type, primary_intent, brief)
    duration_target_s = _duration_target_s(format_type=format_type, platform_profile=platform_profile)
    emotional_arc = f"{emotion_start} -> {emotion_peak} -> {emotion_end}"
    creative_treatment = build_creative_treatment(
        brief=brief,
        format_type=format_type,
        primary_intent=primary_intent,
        emotional_arc=emotional_arc,
    )
    ugc_strategy = build_ugc_strategy(brief) if format_type == "ugc_scripted_ad" else None
    base_scene_beats = _scene_beats(
        brief=brief,
        format_type=format_type,
        intent=primary_intent,
        emotion_start=emotion_start,
        emotion_peak=emotion_peak,
        emotion_end=emotion_end,
        duration_target_s=duration_target_s,
        audio_mode=audio_mode,
        caption_strategy=caption_strategy,
    )
    scene_beats = _apply_creative_treatment(scene_beats=base_scene_beats, treatment=creative_treatment)
    if ugc_strategy is not None:
        scene_beats = _apply_ugc_strategy(scene_beats=scene_beats, strategy=ugc_strategy)
    scene_beats = _apply_shot_directives(
        scene_beats=scene_beats,
        format_type=format_type,
        caption_strategy=caption_strategy,
    )
    script_plan = (
        _build_faceless_script_plan(
            brief=brief,
            scene_beats=scene_beats,
            duration_target_s=duration_target_s,
        )
        if format_type == "no_face_youtube"
        else None
    )
    return FormatNarrativePlan(
        format_type=format_type,
        production_mode=production_mode,
        primary_intent=primary_intent,
        intent=intent,
        viewer_emotion_start=emotion_start,
        viewer_emotion_peak=emotion_peak,
        viewer_emotion_end=emotion_end,
        emotional_arc=emotional_arc,
        audio_mode=audio_mode,
        caption_strategy=caption_strategy,
        duration_target_s=duration_target_s,
        platform_profile=platform_profile,
        scene_beats=scene_beats,
        base_scene_beats=base_scene_beats,
        script_plan=script_plan,
        creative_treatment=creative_treatment,
        ugc_strategy=ugc_strategy,
        rationale=(
            f"{format_type} with {production_mode} mode, {primary_intent} intent, "
            f"{audio_mode} audio, {caption_strategy} captions"
        ),
    )


def _apply_creative_treatment(
    *,
    scene_beats: tuple[SceneBeat, ...],
    treatment: CreativeTreatmentPlan,
) -> tuple[SceneBeat, ...]:
    return tuple(
        replace(
            beat,
            visual_goal=_append_phrase(beat.visual_goal, treatment.concept),
            visual_premise=_append_phrase(beat.visual_premise, _directive_for_index(treatment.scene_directives, beat.beat_index)),
            motion_intent=_append_phrase(beat.motion_intent, treatment.pacing),
            image_prompt_focus=_append_phrase(
                beat.image_prompt_focus,
                "; ".join((*treatment.prompt_directives, *treatment.negative_constraints)),
            ),
            music_sfx_goal=_append_phrase(beat.music_sfx_goal, _directive_for_index(treatment.edit_rules, beat.beat_index)),
        )
        for beat in scene_beats
    )


def _append_phrase(base: str, addition: str) -> str:
    clean_base = " ".join((base or "").split()).strip()
    clean_addition = " ".join((addition or "").split()).strip()
    if not clean_addition:
        return clean_base
    if not clean_base:
        return clean_addition
    return f"{clean_base}. Treatment: {clean_addition}"


def _apply_ugc_strategy(
    *,
    scene_beats: tuple[SceneBeat, ...],
    strategy: UgcStrategyPlan,
) -> tuple[SceneBeat, ...]:
    archetypes = tuple(strategy.shot_archetypes or ())
    script_rules = "; ".join(strategy.script_rules or ())
    result: list[SceneBeat] = []
    for beat in scene_beats:
        archetype = _directive_for_index(archetypes, beat.beat_index)
        result.append(
            replace(
                beat,
                visual_premise=_append_phrase(beat.visual_premise, archetype),
                motion_intent=_append_phrase(beat.motion_intent, strategy.hook_pattern if beat.beat_role == "hook" else strategy.proof_mechanism),
                image_prompt_focus=_append_phrase(
                    beat.image_prompt_focus,
                    (
                        f"UGC persona: {strategy.creator_persona}; "
                        f"setting: {strategy.setting}; "
                        f"authenticity angle: {strategy.authenticity_angle}; "
                        f"proof: {strategy.proof_mechanism}; "
                        f"objection: {strategy.objection_to_answer}"
                    ),
                ),
                voiceover_goal=_append_phrase(beat.voiceover_goal, script_rules),
                reference_strategy=_append_phrase(beat.reference_strategy, strategy.provider_strategy),
            )
        )
    return tuple(result)


def _directive_for_index(directives: tuple[str, ...], beat_index: int) -> str:
    if not directives:
        return ""
    return directives[(beat_index - 1) % len(directives)]


def _apply_shot_directives(
    *,
    scene_beats: tuple[SceneBeat, ...],
    format_type: str,
    caption_strategy: str,
) -> tuple[SceneBeat, ...]:
    return tuple(
        replace(
            beat,
            shot_directive=_shot_directive_for_beat(
                beat=beat,
                format_type=format_type,
                caption_strategy=caption_strategy,
            ),
        )
        for beat in scene_beats
    )


def _shot_directive_for_beat(
    *,
    beat: SceneBeat,
    format_type: str,
    caption_strategy: str,
) -> ShotDirective:
    return ShotDirective(
        purpose=_clip_words(beat.visual_goal, 18),
        visual_action=_clip_words(beat.motion_intent, 28),
        framing=_framing_for_beat(format_type=format_type, role=beat.beat_role),
        continuity_anchor=_continuity_anchor_for_beat(beat),
        caption_role=_caption_role_for_beat(caption_strategy=caption_strategy, role=beat.beat_role),
    )


def _framing_for_beat(*, format_type: str, role: str) -> str:
    if format_type == "ugc_scripted_ad":
        return {
            "hook": "creator medium-close, phone-native vertical frame",
            "problem": "messy real-life context with creator/product visible",
            "solution": "creator/product demo frame with clear hand or screen action",
            "cta": "stable creator/product frame with caption-safe space",
        }.get(role, "believable creator frame with natural negative space")
    if format_type == "app_demo_ad":
        return {
            "hook": "device or browser visible in the first read",
            "feature": "tight readable UI frame",
            "proof": "before-after or outcome frame with readable hierarchy",
            "cta": "clean product frame with caption-safe space",
        }.get(role, "screen-led frame with readable UI")
    if format_type == "no_face_youtube":
        return {
            "hook": "story-first evidence frame with one visual mystery",
            "context": "wide documentary establishing frame",
            "explanation": "clear visual metaphor or mechanism frame",
            "proof": "evidence closeup or archival-feeling detail",
            "takeaway": "quiet final documentary frame with subtitle-safe space",
        }.get(role, "faceless documentary B-roll frame")
    if format_type == "lyric_video":
        return "music-led frame with clean lyric/caption-safe negative space"
    if role == "hook":
        return "strong opening frame with immediate subject hierarchy"
    if role in {"proof", "detail"}:
        return "specific proof/detail frame, close enough to feel real"
    if role in {"cta", "payoff", "tag"}:
        return "stable final frame with clean caption-safe space"
    return "balanced subject frame with one clear focal point"


def _continuity_anchor_for_beat(beat: SceneBeat) -> str:
    reference = beat.reference_strategy.strip()
    if reference and reference != "no external reference required":
        return _clip_words(reference, 22)
    premise = beat.visual_premise.strip()
    return _clip_words(premise, 22) if premise else "keep subject, style, and lighting consistent across adjacent beats"


def _caption_role_for_beat(*, caption_strategy: str, role: str) -> str:
    if caption_strategy == "minimal":
        return "no required caption; keep frame readable"
    if role in {"hook", "intro"}:
        return "support a short hook caption without blocking the subject"
    if role in {"cta", "tag", "takeaway"}:
        return "reserve clean space for the final caption or CTA"
    if caption_strategy == "kinetic_lyrics":
        return "reserve lyric-safe space and avoid rendered text"
    if caption_strategy == "spoken_caption_highlights":
        return "support spoken-caption highlights with safe center/lower-third space"
    return "support a brief mid-beat caption with safe center/lower-third space"


def _clip_words(value: str, max_words: int) -> str:
    words = " ".join((value or "").split()).strip().split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(" ,;:.") + "."


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


def _infer_format_type(brief: CreativeBrief, text: str) -> str:
    if _is_spotify_canvas_request(brief, text):
        return "spotify_canvas_loop"
    if "lyric" in text or "chorus" in text:
        return "lyric_video"
    if _has_ugc_presenter_intent(text):
        return "ugc_scripted_ad"
    if "ugc" in text or "hook, problem, solution" in text or "testimonial" in text:
        return "ugc_scripted_ad"
    if "no-face" in text or "no face" in text or ("youtube" in brief.platform.lower() and "explainer" in text):
        return "no_face_youtube"
    if brief.product_type == "app" or any(term in text for term in ("app", "mobile", "ios", "android", "dashboard", "screenshot", "saas", "web app")):
        return "app_demo_ad"
    if any(term in text for term in ("story", "narrative", "multi-scene", "sequence", "episode")):
        return "narrative_sequence"
    return "multi_shot_ad"


def _is_spotify_canvas_request(brief: CreativeBrief, text: str) -> bool:
    platform = brief.platform.strip().lower().replace("-", "_")
    if platform in {"spotify_canvas", "canvas"}:
        return True
    return "spotify canvas" in text or "canvas loop" in text


def _has_ugc_presenter_intent(text: str) -> bool:
    presenter_terms = (
        "talking head",
        "talking-head",
        "selfie creator",
        "selfie-style creator",
        "creator explaining",
        "creator explains",
        "creator speaking",
        "creator speaks",
        "creator talking",
        "creator talks",
        "creator on camera",
        "creator on-camera",
        "creator speaking to camera",
        "creator talking to camera",
        "creator speaks to camera",
        "creator talks to camera",
        "on-camera creator",
        "on camera creator",
    )
    return any(term in text for term in presenter_terms)


def _production_mode_for_format(format_type: str) -> str:
    if format_type == "lyric_video":
        return "audio_first"
    if format_type == "spotify_canvas_loop":
        return "visual_loop"
    if format_type in {"multi_shot_ad", "app_demo_ad", "ugc_scripted_ad", "no_face_youtube", "narrative_sequence"}:
        return "sequence_first"
    return "image_first"


def _infer_intent(brief: CreativeBrief, text: str) -> tuple[str, ...]:
    intents: list[str] = []
    if any(term in text for term in ("sell", "shop", "buy", "cta", "drop", "launch", "conversion")) or brief.cta_text:
        intents.append("sell")
    if any(term in text for term in ("inform", "explain", "explainer", "teach", "educate", "why", "how to")):
        intents.append("inform")
    if any(term in text for term in ("entertain", "funny", "lyric", "music", "story", "cinematic", "share")):
        intents.append("entertain")
    if any(term in text for term in ("trust", "testimonial", "founder", "authentic", "ugc")):
        intents.append("build_trust")
    if any(term in text for term in ("hype", "drop", "launch", "announce", "new")):
        intents.append("create_hype")
    if not intents:
        intents.append("sell" if brief.output_type == "full_production" else "announce")
    return tuple(dict.fromkeys(intents))


def _primary_intent(intent: tuple[str, ...]) -> str:
    for preferred in ("sell", "inform", "entertain", "build_trust", "create_hype", "announce"):
        if preferred in intent:
            return preferred
    return intent[0]


def _primary_intent_for_format(*, format_type: str, intent: tuple[str, ...]) -> str:
    if format_type == "no_face_youtube" and "inform" in intent:
        return "inform"
    if format_type == "lyric_video" and "entertain" in intent:
        return "entertain"
    return _primary_intent(intent)


def _emotion_arc_parts(*, primary_intent: str, text: str, mood_keywords: tuple[str, ...]) -> tuple[str, str, str]:
    if primary_intent == "inform":
        return "curiosity", "clarity", "trust"
    if primary_intent == "entertain":
        return "curiosity", "delight", "share"
    if primary_intent == "build_trust":
        return "recognition", "relief", "confidence"
    if "hype" in text or "drop" in text or "launch" in text:
        return "curiosity", "desire", "urgency"
    if any(mood in {"calm", "premium", "luxury", "sleek"} for mood in mood_keywords):
        return "curiosity", "aspiration", "desire"
    return "curiosity", "desire", "action"


def _infer_audio_mode(brief: CreativeBrief, text: str, format_type: str) -> str:
    if format_type == "spotify_canvas_loop":
        return "none"
    if format_type == "lyric_video":
        return "music_led"
    if brief.voiceover_script or any(term in text for term in ("voiceover", "narration", "explainer", "ugc")):
        return "narration_led"
    if any(term in text for term in ("music", "beat", "song", "track")):
        return "music_led"
    return "none" if brief.output_type == "image" else "narration_led"


def _caption_strategy_for_format(format_type: str, primary_intent: str, brief: CreativeBrief) -> str:
    if format_type == "spotify_canvas_loop":
        return "none"
    if format_type == "lyric_video":
        return "kinetic_lyrics"
    if format_type in {"ugc_scripted_ad", "no_face_youtube"}:
        return "spoken_caption_highlights"
    if brief.copy_for_overlay or brief.cta_text or primary_intent == "sell":
        return "hook_caption_cta"
    return "minimal"


def _platform_profile(platform: str) -> PlatformProfile:
    normalized = platform.strip().lower()
    if normalized in {"spotify_canvas", "canvas"}:
        return PlatformProfile(
            platform=normalized,
            aspect_ratio="9:16",
            duration_min_s=3,
            duration_max_s=8,
            safe_area="full-frame visual only; no captions, CTA, logos, or rendered text",
            export_notes="Spotify Canvas: silent 3-8 second seamless vertical loop",
        )
    if normalized in {"tiktok", "instagram_story", "reels", "instagram_reel"}:
        return PlatformProfile(
            platform=normalized,
            aspect_ratio="9:16",
            duration_min_s=5,
            duration_max_s=60,
            safe_area="keep captions centered away from top/bottom UI chrome",
        )
    if normalized in {"youtube", "website", "linkedin", "x", "twitter"}:
        return PlatformProfile(
            platform=normalized,
            aspect_ratio="16:9",
            duration_min_s=8,
            duration_max_s=180,
            safe_area="standard title-safe center region",
        )
    return PlatformProfile(
        platform=normalized or "unknown",
        aspect_ratio="1:1",
        duration_min_s=5,
        duration_max_s=30,
        safe_area="center-weighted composition",
    )


def _duration_target_s(*, format_type: str, platform_profile: PlatformProfile) -> int:
    target_by_format = {
        "multi_shot_ad": 20,
        "ugc_scripted_ad": 20,
        "lyric_video": 15,
        "spotify_canvas_loop": 5,
        "no_face_youtube": 45,
        "narrative_sequence": 24,
    }
    target = target_by_format.get(format_type, 8)
    return min(max(target, platform_profile.duration_min_s), platform_profile.duration_max_s)


def _scene_beats(
    *,
    brief: CreativeBrief,
    format_type: str,
    intent: str,
    emotion_start: str,
    emotion_peak: str,
    emotion_end: str,
    duration_target_s: int,
    audio_mode: str,
    caption_strategy: str,
) -> tuple[SceneBeat, ...]:
    if format_type == "multi_shot_ad":
        roles = ("hook", "value", "proof", "cta")
        emotions = (emotion_start, "desire", emotion_peak, emotion_end)
    elif format_type == "app_demo_ad":
        roles = ("hook", "feature", "proof", "cta")
        emotions = (emotion_start, "clarity", emotion_peak, emotion_end)
    elif format_type == "ugc_scripted_ad":
        roles = ("hook", "problem", "solution", "cta")
        emotions = (emotion_start, "tension", emotion_peak, emotion_end)
    elif format_type == "lyric_video":
        roles = ("intro", "lyric_build", "chorus", "tag")
        emotions = (emotion_start, "anticipation", emotion_peak, emotion_end)
    elif format_type == "spotify_canvas_loop":
        roles = ("loop",)
        emotions = (emotion_peak,)
    elif format_type == "no_face_youtube":
        roles = ("hook", "context", "explanation", "proof", "takeaway")
        emotions = (emotion_start, "understanding", emotion_peak, "trust", emotion_end)
    else:
        roles = ("setup", "development", "turn", "payoff")
        emotions = (emotion_start, "tension", emotion_peak, emotion_end)
    requested_count = _requested_scene_count(brief)
    if requested_count is not None and requested_count != len(roles):
        roles = _roles_for_count(format_type=format_type, requested_count=requested_count)
        emotions = _emotions_for_count(
            requested_count=requested_count,
            emotion_start=emotion_start,
            emotion_peak=emotion_peak,
            emotion_end=emotion_end,
        )
    duration_each = max(1, round(duration_target_s / len(roles)))
    return tuple(
        SceneBeat(
            beat_index=index,
            beat_role=role,
            intent=intent,
            viewer_emotion=emotions[index - 1],
            visual_goal=_visual_goal_for_role(role),
            audio_goal=_audio_goal_for_mode(audio_mode, role),
            caption_goal=_caption_goal_for_strategy(caption_strategy, role),
            duration_s=duration_each,
            visual_premise=_visual_premise_for_role(brief=brief, role=role, format_type=format_type),
            motion_intent=_motion_intent_for_role(brief=brief, role=role, format_type=format_type),
            image_prompt_focus=_image_prompt_focus_for_role(brief=brief, role=role, format_type=format_type),
            voiceover_goal=_voiceover_goal_for_role(brief=brief, role=role, audio_mode=audio_mode),
            music_sfx_goal=_music_sfx_goal_for_role(role=role, audio_mode=audio_mode, format_type=format_type),
            reference_strategy=_reference_strategy_for_role(brief=brief, role=role, format_type=format_type),
        )
        for index, role in enumerate(roles, start=1)
    )


def _requested_scene_count(brief: CreativeBrief) -> int | None:
    text = _brief_text(brief)
    aliases = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
    }
    match = re.search(
        r"\b(1|2|3|4|5|6|one|two|three|four|five|six)\s*[- ]?"
        r"(?:shot|shots|clip|clips|scene|scenes|beat|beats)\b",
        text,
    )
    if not match:
        return None
    raw = match.group(1).lower()
    value = aliases.get(raw, int(raw) if raw.isdigit() else 0)
    return max(1, min(6, value)) if value else None


def _roles_for_count(*, format_type: str, requested_count: int) -> tuple[str, ...]:
    if format_type == "spotify_canvas_loop":
        return ("loop",)
    if requested_count == 1:
        return ("hook",)
    if requested_count == 2:
        return ("hook", "cta")
    if requested_count == 3:
        if format_type == "app_demo_ad":
            return ("hook", "feature", "cta")
        if format_type == "ugc_scripted_ad":
            return ("hook", "solution", "cta")
        if format_type == "lyric_video":
            return ("intro", "chorus", "tag")
        if format_type == "no_face_youtube":
            return ("hook", "explanation", "takeaway")
        return ("hook", "value", "cta")
    if requested_count == 5:
        if format_type == "no_face_youtube":
            return ("hook", "context", "explanation", "proof", "takeaway")
        if format_type == "app_demo_ad":
            return ("hook", "problem", "feature", "proof", "cta")
        return ("hook", "value", "proof", "desire", "cta")
    if requested_count >= 6:
        if format_type == "no_face_youtube":
            return ("hook", "context", "detail", "explanation", "proof", "takeaway")
        if format_type == "app_demo_ad":
            return ("hook", "problem", "feature", "detail", "proof", "cta")
        return ("hook", "value", "detail", "proof", "desire", "cta")
    return ("hook", "value", "proof", "cta")


def _emotions_for_count(
    *,
    requested_count: int,
    emotion_start: str,
    emotion_peak: str,
    emotion_end: str,
) -> tuple[str, ...]:
    if requested_count == 1:
        return (emotion_peak,)
    if requested_count == 2:
        return (emotion_start, emotion_end)
    if requested_count == 3:
        return (emotion_start, emotion_peak, emotion_end)
    if requested_count == 5:
        if emotion_peak == "clarity":
            return (emotion_start, "context", "understanding", "evidence", emotion_end)
        return (emotion_start, "desire", emotion_peak, "urgency", emotion_end)
    if requested_count >= 6:
        if emotion_peak == "clarity":
            return (emotion_start, "context", "curiosity", "understanding", "evidence", emotion_end)
        return (emotion_start, "curiosity", "desire", emotion_peak, "urgency", emotion_end)
    return (emotion_start, "desire", emotion_peak, emotion_end)


def _visual_goal_for_role(role: str) -> str:
    return {
        "hook": "create immediate visual curiosity",
        "feature": "make the core app feature immediately understandable",
        "problem": "make the pain or gap legible",
        "solution": "show the product or idea resolving the tension",
        "cta": "land on a clear action frame",
        "value": "make the product promise visually obvious",
        "proof": "show why the claim feels believable or desirable",
        "desire": "make the product feel wanted and scarce",
        "detail": "make one specific product detail impossible to miss",
        "context": "make the setting and stakes clear",
        "explanation": "make the hidden idea visually understandable",
        "takeaway": "leave the viewer with one memorable idea",
        "hero": "make one strong memorable hero image move",
        "chorus": "peak visual energy synchronized to the lyric",
    }.get(role, f"serve the {role} beat clearly")


def _visual_premise_for_role(*, brief: CreativeBrief, role: str, format_type: str) -> str:
    product = brief.product_description.strip()
    overlay = (brief.copy_for_overlay or brief.cta_text or "").strip()
    if format_type == "spotify_canvas_loop":
        return (
            f"create one emotionally specific seamless visual loop for {product}; "
            "vertical 9:16, silent, no rendered text, no subtitles, no CTA, no logo"
        )
    if format_type == "no_face_youtube":
        topic = _narrative_topic(brief)
        return {
            "hook": f"open on an intriguing cinematic image that makes viewers wonder about {topic}",
            "context": f"show the real-world setting, artifact, or visual clue behind {topic}",
            "explanation": f"visualize the hidden mechanism or pattern behind {topic}",
            "proof": f"show a concrete example, archival-feeling detail, or symbolic evidence for {topic}",
            "takeaway": f"end on a quiet memorable image that leaves the viewer with the main idea about {topic}",
            "detail": f"show one specific visual detail that makes {topic} feel real",
        }.get(role, f"support the documentary beat about {topic}")
    if format_type == "lyric_video":
        return {
            "intro": f"establish the world of {product} as the music begins",
            "lyric_build": f"build visual tension around {product} with readable lyric space",
            "chorus": f"hit the strongest visual identity moment for {product}",
            "tag": f"end on a clean memorable frame for {product}",
        }.get(role, f"support the {role} lyric beat for {product}")
    if format_type == "ugc_scripted_ad":
        return {
            "hook": f"show a believable creator moment involving {product}",
            "problem": f"make the pain point visible before {product} resolves it",
            "solution": f"show {product} as the practical fix",
            "cta": f"land on a direct action frame for {product}",
        }.get(role, f"make the {role} beat feel human and specific")
    if format_type == "app_demo_ad":
        return {
            "hook": f"open with {product} shown in a real device or browser context solving one obvious pain",
            "feature": f"show the clearest UI moment or workflow inside {product}",
            "proof": f"show a before-and-after, saved-time, cleaner-dashboard, or outcome proof moment for {product}",
            "cta": f"land on a clean app/product frame for {product} with blank caption-safe space; no rendered text or fake UI labels",
        }.get(role, f"make the {role} beat prove the app clearly")
    if role == "hook":
        return f"open with the most arresting frame of {product}"
    if role == "value":
        return f"show the clearest benefit or desirability of {product}"
    if role == "proof":
        return f"make {product} feel real, premium, and worth believing"
    if role == "cta":
        suffix = " with blank caption-safe space; no rendered text or letters" if overlay else ""
        return f"finish on a clean hero frame of {product}{suffix}"
    return f"stage {product} so the {role} beat is instantly readable"


def _motion_intent_for_role(*, brief: CreativeBrief, role: str, format_type: str) -> str:
    explicit = _explicit_motion_request(brief)
    if explicit and role in {"hook", "setup", "chorus", "turn", "payoff", "loop"}:
        return explicit
    product = brief.product_description.strip()
    if format_type == "spotify_canvas_loop":
        return (
            "one restrained camera drift, flicker, or atmospheric movement that can reset seamlessly; "
            "avoid ad pacing, title cards, lower thirds, captions, and call-to-action endings"
        )
    if format_type == "no_face_youtube":
        return {
            "hook": "slow investigative push-in as one visual clue is revealed; no presenter and no ad-style posing",
            "context": "gentle parallax across the setting while environmental details shift naturally",
            "explanation": "clean visual reveal that connects two ideas without showing a talking head",
            "proof": "camera tracks across evidence-like details, notes, objects, signs, or archival textures",
            "takeaway": "motion settles into a quiet final hold with subtle atmosphere",
            "detail": "tight documentary insert shot with one small environmental movement",
        }.get(role, "cinematic documentary B-roll motion that advances the story")
    if format_type == "ugc_scripted_ad":
        return {
            "hook": "the creator reacts immediately, raises the product or phone into frame, and makes eye contact",
            "problem": "the creator shows the frustrating before-state with one natural gesture",
            "solution": "the creator demonstrates the fix with a clear hand movement or screen/product reveal",
            "cta": "the creator points or nods toward the call-to-action while the camera settles",
        }.get(role, "one believable creator action, no overacting")
    if format_type == "app_demo_ad":
        return {
            "hook": "quick device or browser reveal that makes the problem obvious in the first second",
            "feature": "controlled screen-focused move through one readable app interaction, no random camera drift",
            "proof": "clean transition from messy before-state to organized result, preserving UI readability",
            "cta": "motion settles into a stable product frame with room for post-render CTA captions",
        }.get(role, "simple screen-led movement that preserves readability")
    if format_type == "lyric_video":
        return {
            "intro": "slow atmospheric camera drift as the first lyric space appears",
            "lyric_build": "background movement grows in rhythm with the vocal phrase",
            "chorus": "one strong visual surge timed to the chorus hit",
            "tag": "motion decays into a clean final hold",
        }.get(role, "music-synced atmospheric motion")
    return {
        "hook": f"the subject or {product} snaps into attention with a clear physical movement, not just a slow zoom",
        "value": "camera reveals texture, fit, feature, or benefit through one controlled move",
        "proof": "the subject or scene gains realism through natural hand, fabric, light, or environment motion",
        "cta": "camera resolves into a stable hero frame with a small final product emphasis",
        "setup": "camera establishes the scene and subject with controlled anticipation",
        "development": "the subject performs one concrete action that advances the story",
        "turn": "the scene changes state through a decisive visual event",
        "payoff": "the motion lands on a memorable final image",
    }.get(role, "one clear physical action appropriate to the scene")


def _image_prompt_focus_for_role(*, brief: CreativeBrief, role: str, format_type: str) -> str:
    product = brief.product_description.strip()
    if format_type == "spotify_canvas_loop":
        return (
            f"Spotify Canvas visual for {product}; vertical 9:16, cinematic silent loop, "
            "no typography, no lyric text, no CTA, no logo, final frame should naturally match first frame"
        )
    if format_type == "no_face_youtube":
        topic = _narrative_topic(brief)
        return {
            "hook": f"cinematic documentary B-roll hook for {topic}; one striking visual mystery, no commercial object pose",
            "context": f"wide establishing B-roll that explains the place, era, or situation behind {topic}",
            "explanation": f"clear symbolic visual metaphor for the hidden mechanism behind {topic}",
            "proof": f"evidence-like closeups, archival texture, objects, signage, notes, or environmental details about {topic}",
            "takeaway": f"quiet final documentary frame with clean caption-safe negative space for post-render subtitles about {topic}; no rendered text",
            "detail": f"precise insert shot of one meaningful clue connected to {topic}",
        }.get(role, f"faceless documentary B-roll for the {role} beat about {topic}")
    if format_type == "app_demo_ad":
        return {
            "hook": f"realistic device/browser context for {product}; readable screen hierarchy; no fake generated UI text",
            "feature": f"close, readable UI proof of one workflow in {product}; preserve screenshot fidelity and clean edges",
            "proof": f"visual before-and-after or outcome proof for {product}; simple labels must be added only in post",
            "cta": f"clean final app frame with caption-safe negative space; no rendered text or random letters",
        }.get(role, f"readable app demo frame for the {role} beat")
    if role == "hook":
        return f"high-impact opening composition for {product}; immediate curiosity"
    if role in {"value", "solution", "explanation"}:
        return f"make the main benefit of {product} visually legible"
    if role in {"proof", "context"}:
        return f"ground {product} in a believable environment with premium detail"
    if role in {"cta", "takeaway", "tag"}:
        return f"clean final frame, readable negative space, strong brand/product silhouette"
    if format_type == "lyric_video":
        return "leave clean caption-safe space for post-render lyric overlay; no rendered text"
    return f"compose {product} for the {role} beat with clear subject hierarchy"


def _voiceover_goal_for_role(*, brief: CreativeBrief, role: str, audio_mode: str) -> str:
    if audio_mode != "narration_led":
        return "no voiceover line required for this beat"
    if brief.voiceover_script:
        return f"carry the part of the provided script that matches the {role} beat"
    return {
        "hook": "one short hook line that creates curiosity",
        "feature": "name the feature in one plain sentence",
        "problem": "name the pain clearly in plain language",
        "solution": "state the fix or product promise",
        "value": "say the main benefit without overexplaining",
        "proof": "add one credibility or desire-building line",
        "cta": "direct the viewer to act",
        "takeaway": "summarize the useful idea",
    }.get(role, f"support the {role} beat in one concise line")


def _music_sfx_goal_for_role(*, role: str, audio_mode: str, format_type: str) -> str:
    if format_type == "spotify_canvas_loop":
        return "no audio track; Spotify supplies song audio outside the Canvas visual"
    if audio_mode == "music_led":
        return f"time the {role} visual change to the music phrase"
    if role in {"hook", "turn", "chorus"}:
        return "use a subtle impact, riser, or beat accent only if it supports the visual event"
    if format_type == "ugc_scripted_ad":
        return "keep bed music low under speech; no distracting effects"
    return "subtle bed music or room tone; avoid overpowering the visual"


def _reference_strategy_for_role(*, brief: CreativeBrief, role: str, format_type: str) -> str:
    if format_type == "no_face_youtube":
        if brief.reference_assets or brief.reference_image_paths:
            return "reuse scene/style references only as visual continuity anchors; do not treat them as products or characters"
        return "no external reference required"
    if brief.reference_assets or brief.reference_image_paths:
        if role in {"hook", "value", "proof", "solution"}:
            return "reuse product/face/style references for continuity in this scene"
        return "reuse key references only if they support continuity; avoid clutter"
    return "no external reference required"


def _build_faceless_script_plan(
    *,
    brief: CreativeBrief,
    scene_beats: tuple[SceneBeat, ...],
    duration_target_s: int,
) -> NarrativeScriptPlan:
    topic = _narrative_topic(brief)
    hook_angle = _faceless_hook_angle(topic)
    thesis = _faceless_thesis(topic)
    scenes = tuple(
        _faceless_scene_script(
            topic=topic,
            thesis=thesis,
            beat=beat,
        )
        for beat in scene_beats
    )
    narration_script = " ".join(scene.narration for scene in scenes)
    return NarrativeScriptPlan(
        topic=topic,
        title=_faceless_title(topic),
        thesis=thesis,
        curiosity_gap=hook_angle,
        narration_script=narration_script,
        music_mood=_faceless_music_mood(brief),
        pacing_notes=(
            f"Open with a curiosity gap in the first 3 seconds, then move through "
            f"{len(scene_beats)} clear evidence beats over about {duration_target_s} seconds."
        ),
        scenes=scenes,
        source="deterministic_faceless_v1",
    )


def _faceless_scene_script(*, topic: str, thesis: str, beat: SceneBeat) -> NarrativeSceneScript:
    role = beat.beat_role
    templates = {
        "hook": (
            f"What makes {topic} feel stranger than it should?",
            f"{topic} feels strange for one reason most people miss: {thesis}.",
            f"faceless cinematic opening image for {topic}; one unsettling clue, strong negative space, no presenter",
            "slow investigative push toward the visual clue as atmosphere quietly shifts",
            _caption_fragment(f"Why does {topic} feel this strange?"),
            "Start with a question, not an answer.",
        ),
        "context": (
            f"What was {topic} originally built to make people feel?",
            f"To understand it, look at what the space was designed to do before everything changed.",
            f"wide documentary B-roll establishing the world around {topic}; place, era, texture, and stakes",
            "gentle parallax across the environment while small details reveal the original purpose",
            "Look at what it was built for.",
            "Give the viewer orientation without draining mystery.",
        ),
        "detail": (
            f"What single detail gives {topic} away?",
            f"One small detail usually tells the whole story before the facts do.",
            f"precise insert shot of one meaningful visual clue connected to {topic}",
            "tight documentary insert with subtle light, dust, shadow, or object movement",
            "One detail tells the story.",
            "Use one concrete clue to keep the story specific.",
        ),
        "explanation": (
            f"What is the hidden mechanism behind {topic}?",
            f"The hidden pattern is simple: the place still points toward a behavior that is no longer happening.",
            f"symbolic faceless visual metaphor explaining the hidden pattern behind {topic}",
            "clean visual reveal connecting two ideas without a talking head",
            "The pattern is hiding in plain sight.",
            "Pay off the opening question with a clear mechanism.",
        ),
        "proof": (
            f"What proves this is not just a feeling?",
            f"You can see the proof in the objects left behind, because they still act like people are about to return.",
            f"evidence-like closeups, archival texture, objects, signs, notes, or environmental details about {topic}",
            "camera tracks across evidence-like details in a calm investigative rhythm",
            "The proof is in what got left behind.",
            "Make the claim feel observable, not abstract.",
        ),
        "takeaway": (
            f"What should the viewer remember about {topic}?",
            f"That is what makes {topic} linger: not a ghost story, but a place still performing its old purpose.",
            f"quiet final documentary frame about {topic}; memorable image, clean subtitle-safe negative space",
            "motion settles into a quiet final hold with subtle atmosphere",
            "It is not empty. It is unfinished.",
            "End with a clean idea the viewer can repeat.",
        ),
    }
    hook_question, narration, visual_prompt, motion_direction, caption_text, retention_note = templates.get(
        role,
        (
            f"What does this reveal about {topic}?",
            f"This part matters because it turns {topic} from a vague feeling into something you can actually see.",
            f"faceless documentary B-roll for the {role} beat about {topic}",
            "controlled documentary camera movement that advances the explanation",
            _caption_fragment(topic),
            "Keep the beat visual and specific.",
        ),
    )
    return NarrativeSceneScript(
        beat_index=beat.beat_index,
        beat_role=role,
        hook_question=hook_question,
        narration=narration,
        visual_prompt=visual_prompt,
        motion_direction=motion_direction,
        caption_text=caption_text,
        retention_note=retention_note,
    )


def _faceless_title(topic: str) -> str:
    clean = topic.strip().rstrip(".")
    return f"Why {clean} feels stranger than it should"


def _faceless_hook_angle(topic: str) -> str:
    return f"Make the viewer wonder what hidden pattern explains {topic} before giving the answer."


def _faceless_thesis(topic: str) -> str:
    lower = topic.lower()
    if "abandoned mall" in lower or "abandoned malls" in lower:
        return "it was designed for crowds, noise, and constant motion, so silence feels unnatural"
    if "internet" in lower or "algorithm" in lower:
        return "the system rewards behavior before most people notice they are repeating it"
    if "city" in lower or "street" in lower or "neighborhood" in lower:
        return "the built environment quietly teaches people where to move, wait, and look"
    if "history" in lower or "ancient" in lower:
        return "the strange part is not the event itself, but the reason people kept repeating it"
    return "there is a hidden pattern underneath the obvious story"


def _faceless_music_mood(brief: CreativeBrief) -> str:
    moods = {mood.lower().strip() for mood in brief.mood_keywords}
    if {"eerie", "haunted", "dark", "mysterious"} & moods:
        return "low, eerie, restrained documentary bed with light tension"
    if {"educational", "clean", "professional"} & moods:
        return "clean investigative documentary bed, low under narration"
    return "subtle cinematic documentary bed, low under narration"


def _caption_fragment(text: str, *, max_words: int = 7) -> str:
    words = text.strip().rstrip(".?!").split()
    return " ".join(words[:max_words]) if words else text


def _narrative_topic(brief: CreativeBrief) -> str:
    topic = " ".join((brief.product_description or brief.campaign_goal or "the story").split()).strip()
    prefixes = (
        "no-face youtube explainer about ",
        "no face youtube explainer about ",
        "youtube explainer about ",
        "mini documentary about ",
        "explainer about ",
        "documentary about ",
    )
    lower = topic.lower()
    for prefix in prefixes:
        if lower.startswith(prefix):
            return _clean_narrative_topic(topic[len(prefix):].strip() or topic)
    return _clean_narrative_topic(topic)


def _clean_narrative_topic(topic: str) -> str:
    clean = " ".join(topic.strip().rstrip(".?!").split())
    lower = clean.lower()
    for prefix in ("why ", "how ", "what makes "):
        if lower.startswith(prefix):
            clean = clean[len(prefix):].strip()
            break
    return clean or topic


def _audio_goal_for_mode(audio_mode: str, role: str) -> str:
    if audio_mode == "music_led":
        return f"sync {role} visuals to music phrasing"
    if audio_mode == "narration_led":
        return f"support the spoken {role} beat"
    return "no required audio beat"


def _caption_goal_for_strategy(caption_strategy: str, role: str) -> str:
    if caption_strategy == "none":
        return "no captions or text overlays"
    if caption_strategy == "kinetic_lyrics":
        return "time lyric text to the music"
    if caption_strategy == "spoken_caption_highlights":
        return f"caption the key spoken {role} phrase"
    if caption_strategy == "hook_caption_cta":
        return "use concise hook or CTA text only"
    return "minimal or no caption"


def _explicit_motion_request(brief: CreativeBrief) -> str | None:
    text = " ".join(
        part.strip()
        for part in (brief.aesthetic_notes, brief.competitor_visual_notes, brief.campaign_goal)
        if part and part.strip()
    )
    lower = text.lower()
    if any(
        keyword in lower
        for keyword in (
            "clap",
            "throws",
            "flicks",
            "explodes",
            "erupts",
            "walks",
            "turns",
            "shakes",
            "nods",
            "dances",
            "reveals",
            "opens",
            "drops",
        )
    ):
        return text.rstrip(".")
    return None
