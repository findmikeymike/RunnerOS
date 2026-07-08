from __future__ import annotations

import re

from content.writing.brief_generator import CreativeBrief
from content.writing.script_guidance import (
    assemble_guided_lines,
    guidance_prefix_line,
    script_guidance_from_brief,
)

from creative.production.contracts import CandidateStillRecord, VoiceoverPlan


_VOICE_BY_STYLE: dict[str, tuple[str, str, str]] = {
    "PREMIUM": (
        "VO-002",
        "Measured, deliberate pace. Let the pauses breathe. Confident quiet, premium, not salesy.",
        "premium work benefits from cinematic narration when a script exists or the brief asks for a reel",
    ),
    "EDITORIAL": (
        "VO-002",
        "Measured, deliberate pace. Cool editorial narration, calm authority, every word lands.",
        "editorial work can carry sparse cinematic narration",
    ),
    "ART_CULTURE": (
        "VO-002",
        "Warm, intimate, culturally fluent. A late-night-radio feel, not an announcer.",
        "culture-led work needs narration that feels embedded in the scene",
    ),
    "ART_CULTURE_FRANK_OCEAN": (
        "VO-002",
        "Soft, intimate, nostalgic. Voice should feel like a private note, not an ad read.",
        "Frank Ocean-style work should keep voice intimate and low-pressure",
    ),
    "ART_CULTURE_KANYE": (
        "VO-003",
        "Sparse, iconic, low-energy confidence. Minimum words, maximum weight.",
        "high-design streetwear work needs sparse drop language",
    ),
    "ART_CULTURE_WES_ANDERSON": (
        "VO-002",
        "Dry, precise, storybook narration. Calm, symmetrical, slightly whimsical.",
        "Wes-style work benefits from precise narrated setup",
    ),
    "BRUTALIST": (
        "VO-003",
        "Minimum words, maximum cool. Slow, low, unbothered confidence.",
        "brutalist work should only use sparse drop narration",
    ),
    "UGC": (
        "VO-001",
        "Energetic, conversational, real-person delivery. Sharing, not selling.",
        "UGC needs voice that feels like a person talking to camera",
    ),
    "PSYCHEDELIC": (
        "VO-002",
        "Intimate, voice-as-texture delivery. Spoken like part of the music, not over it.",
        "psychedelic narration should be used only when the brief asks for it",
    ),
}


def build_voiceover_plan(
    *,
    brief: CreativeBrief,
    selected_still: CandidateStillRecord,
    target_duration_s: int | float | None = None,
) -> VoiceoverPlan:
    template_id, voice_direction, rationale = _VOICE_BY_STYLE.get(
        selected_still.style_family,
        _VOICE_BY_STYLE["EDITORIAL"],
    )

    explicit_script = (brief.voiceover_script or "").strip()
    guidance = script_guidance_from_brief(brief)
    if guidance.tone_direction:
        voice_direction = f"{voice_direction} Performance note: {guidance.tone_direction}."
    if explicit_script:
        script = _fit_script_to_duration(
            script=explicit_script,
            brief=brief,
            style_family=selected_still.style_family,
            target_duration_s=target_duration_s,
        )
        return VoiceoverPlan(
            enabled=True,
            script=script,
            voice_direction=voice_direction or _VOICE_BY_STYLE["EDITORIAL"][1],
            template_id=template_id or "VO-002",
            rationale=(
                "brief supplied an explicit voiceover script"
                if script == explicit_script
                else "brief supplied a short voiceover script; expanded to fit the planned runtime"
            ),
        )

    if _is_lyric_or_music_only_request(brief):
        return VoiceoverPlan(
            enabled=False,
            script="",
            voice_direction="",
            template_id=None,
            rationale="brief requests lyric/music-led video, not voiceover narration",
        )

    if not _brief_requests_voice(brief):
        return VoiceoverPlan(
            enabled=False,
            script="",
            voice_direction="",
            template_id=None,
            rationale="brief did not request voiceover, narration, talking head, or spoken audio",
        )

    return VoiceoverPlan(
        enabled=True,
        script=_fit_script_to_duration(
            script=_default_script(brief=brief, style_family=selected_still.style_family),
            brief=brief,
            style_family=selected_still.style_family,
            target_duration_s=target_duration_s,
        ),
        voice_direction=voice_direction,
        template_id=template_id,
        rationale=rationale,
    )


def _brief_requests_voice(brief: CreativeBrief) -> bool:
    text = " ".join(
        value
        for value in (
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.competitor_visual_notes,
            brief.key_audience_insight,
        )
        if value
    ).lower()
    guidance = script_guidance_from_brief(brief)
    return guidance.has_any or any(
        keyword in text
        for keyword in (
            "voiceover",
            "voice over",
            "narration",
            "narrated",
            "spoken",
            "talking head",
            "talk to camera",
            "testimonial",
            "read",
            "tts",
        )
    )


def _is_lyric_or_music_only_request(brief: CreativeBrief) -> bool:
    text = " ".join(
        value
        for value in (
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.competitor_visual_notes,
        )
        if value
    ).lower()
    return ("lyric" in text or "lyrics" in text) and not _brief_requests_voice(brief)


def _default_script(*, brief: CreativeBrief, style_family: str) -> str:
    product = brief.product_description.strip().rstrip(".")
    cta = (brief.cta_text or "").strip().rstrip(".")
    category = _brief_voice_category(brief)
    if category == "app":
        closing = cta or "Try it today"
        return _guided_script(
            brief=brief,
            fallback_hook="Here is the part that actually saves time",
            parts=(product, "One clear screen, one next step", closing),
        )
    if category == "story":
        closing = cta or "Start the story today"
        return _guided_script(
            brief=brief,
            fallback_hook="It starts with one question you want answered",
            parts=(product, "Step into the world and see what happens next", closing),
        )
    if category == "music":
        closing = cta or "Listen now"
        return _guided_script(
            brief=brief,
            fallback_hook="This is the moment the track opens up",
            parts=(product, "Let it hit once, then run it back", closing),
        )
    if style_family in {"BRUTALIST", "ART_CULTURE_KANYE"} and category == "merch":
        closing = cta or "Limited run. If you know, you know."
        return _guided_script(brief=brief, fallback_hook="New drop", parts=(product, "Limited run", closing))
    if style_family == "UGC" and category == "merch":
        closing = cta or "Check it before it sells out."
        return _guided_script(brief=brief, fallback_hook="Okay, this is actually good", parts=(product, closing))
    if style_family == "ART_CULTURE_WES_ANDERSON":
        closing = cta or "Available now"
        return _guided_script(brief=brief, fallback_hook="A small object", parts=("A precise moment", product, closing))
    if category == "merch":
        closing = cta or "Made to stay in rotation."
        return _guided_script(
            brief=brief,
            fallback_hook="There is a moment when the right piece changes the whole frame",
            parts=(product, closing),
        )
    closing = cta or "See it for yourself"
    return _guided_script(
        brief=brief,
        fallback_hook="The idea is simple",
        parts=(product, "Show the moment clearly, make the value obvious, and keep moving", closing),
    )


def _guided_script(*, brief: CreativeBrief, fallback_hook: str, parts: tuple[str, ...]) -> str:
    guidance = script_guidance_from_brief(brief)
    guided = assemble_guided_lines(
        (
            guidance_prefix_line(guidance, fallback=fallback_hook),
            *guidance.script_bits[:3],
            *parts,
            *guidance.must_say,
        ),
        guidance=guidance,
    )
    return guided or assemble_guided_lines((fallback_hook, *parts), guidance=guidance)


def _fit_script_to_duration(
    *,
    script: str,
    brief: CreativeBrief,
    style_family: str,
    target_duration_s: int | float | None,
) -> str:
    if not target_duration_s or target_duration_s < 15:
        return script
    target_words = _target_voice_words(target_duration_s)
    if len(script.split()) >= target_words * 0.75:
        return script

    lines = [script.strip().rstrip(".")]
    product = _short_product_phrase(brief.product_description)
    cta = (brief.cta_text or "").strip().rstrip(".")
    category = _brief_voice_category(brief)
    if style_family == "UGC" and category == "merch":
        candidates = (
            f"I wanted something that looked good fast, but still felt real enough to wear every day",
            f"It is made for creators who film, edit, and ship late at night",
            "The point is simple: better texture, cleaner fit, less overthinking",
            cta or "Check it before it sells out",
        )
    elif category == "app":
        candidates = (
            f"{product} is built for the moment when the workflow starts to feel messy",
            "You see what matters first, make the next move faster, and stop digging through noise",
            "The whole point is less friction, clearer decisions, and a screen that explains itself",
            cta or "Try it today",
        )
    elif category == "story":
        candidates = (
            f"{product} is built around a world that pulls you in before it explains itself",
            "The tension is immediate, the characters have something to lose, and the next page matters",
            "It should feel intimate, cinematic, and hard to put down",
            cta or "Start the story today",
        )
    elif category == "music":
        candidates = (
            f"{product} is made for the part of the night when the room changes",
            "The sound should feel close, emotional, and replayable without over-explaining it",
            "Let the visuals support the feeling, then leave space for the track to land",
            cta or "Listen now",
        )
    elif category == "merch":
        candidates = (
            f"{product} is built for the hours when everything looks better under streetlight",
            "Heavyweight structure, clean shape, and enough movement to carry the night",
            "It is quiet from a distance, but the details hold up when the camera gets close",
            "This is the piece you throw on when the plan is loose but the look still has to land",
            cta or "Get it before the drop disappears",
        )
    else:
        candidates = (
            f"{product} needs a clear first moment, not a generic ad read",
            "Show the problem, make the value easy to understand, and keep the language human",
            "The viewer should know why it matters before the final frame",
            cta or "See it for yourself",
        )
    for candidate in candidates:
        clean = candidate.strip().rstrip(".")
        if clean:
            lines.append(clean)
        if len(" ".join(lines).split()) >= target_words:
            break
    return ". ".join(lines).strip() + "."


def _target_voice_words(target_duration_s: int | float) -> int:
    duration = max(20.0, min(float(target_duration_s), 45.0))
    return int(duration * 2.15)


def _short_product_phrase(product_description: str) -> str:
    words = product_description.strip().rstrip(".").split()
    if len(words) <= 10:
        return " ".join(words) or "the product"
    return " ".join(words[:10])


def _brief_voice_category(brief: CreativeBrief) -> str:
    text = " ".join(
        value
        for value in (
            brief.product_type,
            brief.product_description,
            brief.campaign_goal,
            brief.aesthetic_notes,
            brief.key_audience_insight,
            brief.competitor_visual_notes,
        )
        if value
    ).lower()
    if any(_has_voice_category_term(text, term) for term in ("app", "saas", "dashboard", "workflow", "mobile", "ios", "android", "web app")):
        return "app"
    if any(_has_voice_category_term(text, term) for term in ("novel", "book", "story", "chapter", "character", "fiction")):
        return "story"
    if any(_has_voice_category_term(text, term) for term in ("song", "single", "album", "track", "music", "artist", "lyrics")):
        return "music"
    if any(_has_voice_category_term(text, term) for term in ("tee", "shirt", "hoodie", "drop", "merch", "apparel", "garment", "jacket")):
        return "merch"
    return "general"


def _has_voice_category_term(text: str, term: str) -> bool:
    pattern = r"(?<![a-z0-9])" + re.escape(term).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
    return re.search(pattern, text) is not None
