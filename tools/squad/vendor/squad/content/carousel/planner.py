from __future__ import annotations

import re

from content.carousel.contracts import CarouselExportSpec, CarouselHook, CarouselPlan, CarouselSlide
from content.carousel.director import CarouselDirectorOptions, refine_carousel_plan
from content.writing.brief_generator import CreativeBrief
from content.writing.script_guidance import (
    contains_avoided_phrase,
    guidance_prefix_line,
    quoted_line,
    script_guidance_from_brief,
)


DEFAULT_DESIGN_RULES = (
    "slide 1 is hook only, not an intro paragraph",
    "one idea per slide",
    "large high-contrast overlay text",
    "3 to 5 short lines maximum per slide",
    "repeat one visual system across every slide",
    "last slide earns a save, comment, or next-step CTA",
)


def build_carousel_plan(
    brief: CreativeBrief,
    *,
    slide_count: int | None = None,
    director_options: CarouselDirectorOptions | None = None,
) -> CarouselPlan:
    topic = _clean_topic(brief)
    platform = (brief.platform or "instagram_feed").lower().strip()
    count = _resolve_slide_count(brief, slide_count)
    format_type = _format_for_brief(brief)
    hooks = _hook_variants(brief=brief, topic=topic, format_type=format_type)
    roles = _roles_for_count(count, format_type=format_type)
    slides = tuple(
        _build_slide(
            brief=brief,
            topic=topic,
            role=role,
            slide_number=index,
            slide_count=count,
            cover_hook=hooks[0],
            format_type=format_type,
        )
        for index, role in enumerate(roles, start=1)
    )
    plan = CarouselPlan(
        topic=topic,
        platform=platform,
        format=format_type,
        slide_count=count,
        cover_hook=hooks[0],
        alternate_hooks=hooks[1:],
        slides=slides,
        export_spec=_export_spec(platform),
        caption=_caption_for_plan(topic=topic, brief=brief, format_type=format_type),
        hashtags=_hashtags_for_brief(brief),
        design_rules=DEFAULT_DESIGN_RULES,
    )
    return refine_carousel_plan(plan, options=director_options)


def _clean_topic(brief: CreativeBrief) -> str:
    raw = " ".join((brief.product_description or brief.campaign_goal or "this idea").split())
    return raw.strip().rstrip(".") or "this idea"


def _resolve_slide_count(brief: CreativeBrief, requested: int | None) -> int:
    if requested is not None:
        return max(3, min(12, requested))
    text = f"{brief.campaign_goal} {brief.aesthetic_notes}".lower()
    match = re.search(r"\b(3|4|5|6|7|8|9|10|11|12)\s*[- ]?(?:slide|slides|page|pages)\b", text)
    if match:
        return max(3, min(12, int(match.group(1))))
    if brief.platform.lower().strip() == "linkedin":
        return 7
    return 6


def _format_for_brief(brief: CreativeBrief) -> str:
    text = f"{brief.product_description} {brief.campaign_goal} {brief.aesthetic_notes} {' '.join(brief.mood_keywords)}".lower()
    if any(term in text for term in ("myth", "mistake", "wrong", "nobody tells", "lie")):
        return "myth_buster"
    if any(term in text for term in ("checklist", "steps", "guide", "how to", "tutorial")):
        return "saveable_guide"
    if any(term in text for term in ("before after", "before/after", "case study", "proof", "results")):
        return "proof_story"
    if any(term in text for term in ("ridiculous", "weird", "wild", "strange", "hot take")):
        return "curiosity_gap"
    return "problem_solution"


def _hook_variants(*, brief: CreativeBrief, topic: str, format_type: str) -> tuple[CarouselHook, ...]:
    audience = _audience_phrase(brief)
    cta = brief.cta_text.strip() if brief.cta_text else "save this"
    guidance = script_guidance_from_brief(brief)
    guided_hook = quoted_line(guidance.hook_direction) or (
        guidance_prefix_line(guidance, fallback="") if guidance.hook_direction else ""
    )
    if not guided_hook and guidance.script_bits:
        guided_hook = guidance.script_bits[0]
    if format_type == "myth_buster":
        hooks = (
            CarouselHook(f"The {topic} advice that keeps failing", "contrarian", "frustration", "Attacks a familiar belief and opens a loop."),
            CarouselHook(f"Most people get {topic} backwards", "myth", "curiosity", "Promises a correction worth swiping for."),
            CarouselHook(f"Stop doing this with {topic}", "warning", "urgency", "Creates immediate self-check tension."),
        )
    elif format_type == "saveable_guide":
        hooks = (
            CarouselHook(f"Steal this {topic} checklist", "saveable", "utility", "Clear utility makes the post save-worthy."),
            CarouselHook(f"Your {topic} plan in 6 slides", "promise", "clarity", "Specific and bounded."),
            CarouselHook(f"{cta.capitalize()} before you build {topic}", "prevention", "loss aversion", "Frames the deck as a mistake-preventer."),
        )
    elif format_type == "proof_story":
        hooks = (
            CarouselHook(f"{topic} looked broken. Then this changed.", "story_gap", "curiosity", "Creates a before/after loop."),
            CarouselHook(f"The quiet proof behind {topic}", "proof", "trust", "Promises evidence instead of hype."),
            CarouselHook(f"Before you judge {topic}, see this", "reframe", "curiosity", "Sets up a perspective shift."),
        )
    elif format_type == "curiosity_gap":
        hooks = (
            CarouselHook(f"The weird part about {topic}", "curiosity", "surprise", "Simple oddity hook."),
            CarouselHook(f"This sounds ridiculous, but {topic} works", "ridiculous", "surprise", "Leans into disbelief."),
            CarouselHook(f"Nobody expects this from {topic}", "unexpected", "curiosity", "Promise of a hidden insight."),
        )
    else:
        hooks = (
            CarouselHook(f"{audience} are stuck because of this", "pain", "recognition", "Names pain before explaining."),
            CarouselHook(f"The real problem with {topic}", "problem", "curiosity", "Direct problem framing."),
            CarouselHook(f"If {topic} feels hard, read this", "empathy", "relief", "Signals help without hype."),
        )
    if guided_hook and not contains_avoided_phrase(guided_hook, guidance.avoid_phrases):
        return (
            CarouselHook(_limit_words(guided_hook, 11), "user_guided", "directed", "Uses supplied hook direction/fragments."),
            *hooks[:2],
        )
    return hooks


def _roles_for_count(count: int, *, format_type: str) -> tuple[str, ...]:
    base = {
        "myth_buster": ("cover", "myth", "why_it_fails", "truth", "example", "fix", "cta"),
        "saveable_guide": ("cover", "promise", "step_1", "step_2", "step_3", "summary", "cta"),
        "proof_story": ("cover", "before", "turn", "proof", "lesson", "takeaway", "cta"),
        "curiosity_gap": ("cover", "odd_detail", "tension", "reveal", "why_it_matters", "takeaway", "cta"),
        "problem_solution": ("cover", "pain", "stakes", "solution", "proof", "takeaway", "cta"),
    }[format_type]
    if count == len(base):
        return base
    if count < len(base):
        keep = ("cover", *base[1 : count - 1], "cta")
        return tuple(keep)
    extras = tuple(f"detail_{i}" for i in range(1, count - len(base) + 1))
    return (*base[:-1], *extras, "cta")


def _build_slide(
    *,
    brief: CreativeBrief,
    topic: str,
    role: str,
    slide_number: int,
    slide_count: int,
    cover_hook: CarouselHook,
    format_type: str,
) -> CarouselSlide:
    if role == "cover":
        headline = _limit_words(cover_hook.text, 11)
        body = _cover_body(brief)
        priority = "cover_hook"
    elif role == "cta":
        headline = _limit_words(brief.cta_text or "Save this before you forget", 9)
        body = _cta_body(format_type)
        priority = "cta"
    else:
        headline = _headline_for_role(role=role, topic=topic)
        body = _body_for_role(role=role, topic=topic, brief=brief)
        priority = "main_point"
    return CarouselSlide(
        slide_number=slide_number,
        role=role,
        headline=headline,
        body=body,
        visual_direction=_visual_direction(role=role, format_type=format_type, slide_number=slide_number, slide_count=slide_count),
        overlay_priority=priority,
        alt_text=f"Slide {slide_number} of {slide_count}: {headline}. {body}",
    )


def _headline_for_role(*, role: str, topic: str) -> str:
    mapping = {
        "pain": "Here is the friction",
        "stakes": "Why it matters now",
        "solution": "The cleaner move",
        "proof": "Make it believable",
        "takeaway": "The part to remember",
        "myth": "The common myth",
        "why_it_fails": "Why that fails",
        "truth": "The sharper truth",
        "example": "A concrete example",
        "fix": "What to do instead",
        "promise": "What this solves",
        "summary": "Keep this checklist",
        "before": "The before state",
        "turn": "The turning point",
        "lesson": "The lesson",
        "odd_detail": "The odd detail",
        "tension": "Why it feels wrong",
        "reveal": "The hidden reason",
        "why_it_matters": "Why this matters",
    }
    if role.startswith("step_"):
        return f"Step {role.split('_')[-1]}"
    if role.startswith("detail_"):
        return f"Detail {role.split('_')[-1]}"
    return mapping.get(role, _limit_words(topic, 7))


def _body_for_role(*, role: str, topic: str, brief: CreativeBrief) -> str:
    audience = _audience_phrase(brief)
    guidance = script_guidance_from_brief(brief)
    if role in {"pain", "proof", "takeaway", "myth", "truth", "example", "before", "turn", "lesson"} and guidance.script_bits:
        index_by_role = {
            "pain": 0,
            "myth": 0,
            "before": 0,
            "proof": min(1, len(guidance.script_bits) - 1),
            "truth": min(1, len(guidance.script_bits) - 1),
            "example": min(1, len(guidance.script_bits) - 1),
            "turn": min(1, len(guidance.script_bits) - 1),
            "takeaway": len(guidance.script_bits) - 1,
            "lesson": len(guidance.script_bits) - 1,
        }
        bit = _guided_script_bit(guidance, index_by_role[role])
        if bit:
            return _limit_words(bit, 16)
    mapping = {
        "pain": f"{audience} feel the symptom, but usually miss the cause.",
        "stakes": "If the first idea is vague, every slide after it gets weaker.",
        "solution": f"Make {topic} specific, visual, and easy to repeat.",
        "proof": "Use one example, number, screenshot, quote, or visual contrast.",
        "takeaway": "The best carousel feels like a tiny argument, not a poster set.",
        "myth": f"The bad advice sounds smart because it makes {topic} feel simple.",
        "why_it_fails": "It fails when the viewer cannot see themselves in the problem.",
        "truth": "The cover earns attention; the middle earns saves.",
        "example": "Show the real before, the specific change, and the result.",
        "fix": "Cut one idea per slide until every page has a job.",
        "promise": "By the last slide, the viewer should know what to do next.",
        "summary": "Hook. Tension. Value. Proof. Takeaway. CTA.",
        "before": "Start where the audience already feels stuck.",
        "turn": "Show the moment the old belief stops working.",
        "lesson": "Make the lesson short enough to screenshot.",
        "odd_detail": "The small strange detail is usually the strongest hook.",
        "tension": "Hold the answer for one slide longer than feels comfortable.",
        "reveal": "Then pay it off with a clean, specific explanation.",
        "why_it_matters": "Curiosity gets the swipe. Usefulness gets the save.",
    }
    if role.startswith("step_"):
        return "Make this step concrete enough that someone could use it today."
    if role.startswith("detail_"):
        return "Add one extra proof point, example, or objection handler."
    return mapping.get(role, f"Connect {topic} to one clear viewer outcome.")


def _visual_direction(*, role: str, format_type: str, slide_number: int, slide_count: int) -> str:
    if role == "cover":
        if format_type in {"curiosity_gap", "myth_buster"}:
            return "rough-note or screenshot-like cover, bold black text, one visual contradiction, intentionally less polished"
        return "bold cover with huge text, high contrast, one emotional image or product/context crop"
    if role == "cta":
        return "clean final slide with strong negative space and one obvious next action"
    if slide_number % 3 == 0:
        return "reset attention with a screenshot, diagram, visual example, or annotated object"
    if slide_number == slide_count - 1:
        return "summary-card feel with the most saveable line isolated"
    return "consistent template, large headline, small supporting body, simple visual proof"


def _export_spec(platform: str) -> CarouselExportSpec:
    if platform == "linkedin":
        return CarouselExportSpec(
            platform=platform,
            aspect_ratio="1:1",
            width_px=1080,
            height_px=1080,
            export_format="pdf",
            notes="LinkedIn organic carousels are uploaded as multi-page documents.",
            preferred_still_model="nano-banana-pro",
        )
    return CarouselExportSpec(
        platform=platform,
        aspect_ratio="9:16",
        width_px=1080,
        height_px=1920,
        export_format="mp4_slideshow",
        notes="TikTok/IG Reels slideshow default; static slide frames stitched locally to MP4.",
        preferred_still_model="nano-banana-pro",
    )


def _caption_for_plan(*, topic: str, brief: CreativeBrief, format_type: str) -> str:
    cta = brief.cta_text or "Save this for later."
    if format_type == "saveable_guide":
        return f"A compact guide to {topic}. {cta}"
    if format_type == "myth_buster":
        return f"The common advice around {topic} misses the point. {cta}"
    if format_type == "proof_story":
        return f"The useful proof behind {topic}, broken into swipes. {cta}"
    return f"The part about {topic} most people miss. {cta}"


def _hashtags_for_brief(brief: CreativeBrief) -> tuple[str, ...]:
    platform = brief.platform.lower().strip()
    if platform == "linkedin":
        return ()
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9]+", f"{brief.product_type} {' '.join(brief.mood_keywords)}")
    tags = []
    for token in tokens:
        normalized = token.lower()
        if normalized not in {"general", "image", "video"} and normalized not in tags:
            tags.append(normalized)
    return tuple(f"#{tag}" for tag in tags[:5])


def _audience_phrase(brief: CreativeBrief) -> str:
    insight = (brief.key_audience_insight or "").strip()
    if insight:
        return _limit_words(insight, 5)
    if brief.product_type == "app":
        return "users"
    if brief.product_type == "merch":
        return "buyers"
    return "people"


def _cta_body(format_type: str) -> str:
    if format_type == "saveable_guide":
        return "Save it, use it, then turn it into the next post."
    if format_type == "proof_story":
        return "Use this as the proof structure for your next campaign."
    return "Save this if it made the idea clearer."


def _cover_body(brief: CreativeBrief) -> str:
    guidance = script_guidance_from_brief(brief)
    if guidance.must_say:
        return _limit_words(guidance.must_say[0], 14)
    if guidance.tone_direction:
        return _limit_words(guidance.tone_direction, 14)
    return "Swipe for the part most people miss."


def _guided_script_bit(guidance, index: int) -> str:
    if not guidance.script_bits:
        return ""
    bit = guidance.script_bits[index]
    if contains_avoided_phrase(bit, guidance.avoid_phrases):
        return ""
    return bit


def _limit_words(text: str, max_words: int) -> str:
    words = text.strip().split()
    if len(words) <= max_words:
        return text.strip()
    return " ".join(words[:max_words])
