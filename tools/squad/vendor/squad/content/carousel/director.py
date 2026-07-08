from __future__ import annotations

from dataclasses import dataclass, replace

from content.carousel.contracts import CarouselHook, CarouselPlan, CarouselSlide


SUPPORTED_REDO_CONTROLS = (
    "stronger_hook",
    "fewer_words",
    "more_premium",
    "more_absurd",
    "more_emotional",
)


@dataclass(frozen=True, slots=True)
class CarouselDirectorOptions:
    controls: tuple[str, ...] = ()


def refine_carousel_plan(
    plan: CarouselPlan,
    *,
    options: CarouselDirectorOptions | None = None,
    controls: tuple[str, ...] = (),
) -> CarouselPlan:
    active = _normalize_controls(options.controls if options else controls)
    if not active:
        return plan

    cover_hook = _refine_hook(plan.cover_hook, active_controls=active)
    alternate_hooks = tuple(_refine_hook(hook, active_controls=active) for hook in plan.alternate_hooks)
    slides = tuple(
        _refine_slide(slide, active_controls=active, cover_hook=cover_hook)
        for slide in plan.slides
    )
    design_rules = _merge_rules(plan.design_rules, _rules_for_controls(active))
    return replace(
        plan,
        cover_hook=cover_hook,
        alternate_hooks=alternate_hooks,
        slides=slides,
        design_rules=design_rules,
        source=f"{plan.source}+carousel_director_v1",
    )


def _normalize_controls(controls: tuple[str, ...]) -> tuple[str, ...]:
    seen: list[str] = []
    for control in controls:
        normalized = control.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized in SUPPORTED_REDO_CONTROLS and normalized not in seen:
            seen.append(normalized)
    return tuple(seen)


def _refine_hook(hook: CarouselHook, *, active_controls: tuple[str, ...]) -> CarouselHook:
    text = hook.text
    emotional_trigger = hook.emotional_trigger
    hook_type = hook.hook_type

    if "stronger_hook" in active_controls:
        text = _stronger_hook(text)
        hook_type = "sharpened"
    if "more_absurd" in active_controls:
        text = _absurd_hook(text)
        hook_type = "absurdity_gap"
        emotional_trigger = "surprise"
    if "more_emotional" in active_controls:
        text = _emotional_hook(text)
        emotional_trigger = "recognition"
    if "fewer_words" in active_controls:
        text = _limit_words(text, 8)

    return replace(
        hook,
        text=text,
        hook_type=hook_type,
        emotional_trigger=emotional_trigger,
        rationale=f"{hook.rationale} Refined by carousel director controls: {', '.join(active_controls)}.",
    )


def _refine_slide(
    slide: CarouselSlide,
    *,
    active_controls: tuple[str, ...],
    cover_hook: CarouselHook,
) -> CarouselSlide:
    headline = slide.headline
    body = slide.body
    visual_direction = slide.visual_direction

    if slide.role == "cover":
        headline = cover_hook.text
        body = "The useful part is on the next swipe."
    elif "fewer_words" in active_controls:
        headline = _limit_words(headline, 5)
        body = _limit_words(body, 11)

    if "more_premium" in active_controls:
        visual_direction = (
            "premium editorial system, restrained palette, generous negative space, "
            "strong hierarchy, clean product/context crop"
        )
    elif "more_absurd" in active_controls and slide.role == "cover":
        visual_direction = "high-contrast visual contradiction, screenshot energy, one impossible-feeling prop or claim"
    elif "more_emotional" in active_controls:
        visual_direction = f"{visual_direction}; make the human tension immediately visible"

    if "more_emotional" in active_controls and slide.role not in {"cover", "cta"}:
        body = _make_emotional(body)
    if "more_premium" in active_controls and slide.role == "cta":
        body = "Keep the next move simple, deliberate, and worth saving."

    return replace(
        slide,
        headline=headline,
        body=body,
        visual_direction=visual_direction,
        alt_text=f"Slide {slide.slide_number}: {headline}. {body}",
    )


def _rules_for_controls(controls: tuple[str, ...]) -> tuple[str, ...]:
    rules: list[str] = []
    if "fewer_words" in controls:
        rules.append("director pass: cut body copy before shrinking text")
    if "more_premium" in controls:
        rules.append("director pass: premium means restraint, not decoration")
    if "stronger_hook" in controls:
        rules.append("director pass: cover must create a clear open loop")
    if "more_emotional" in controls:
        rules.append("director pass: each slide should name a felt problem or payoff")
    if "more_absurd" in controls:
        rules.append("director pass: absurdity must still pay off with useful value")
    return tuple(rules)


def _merge_rules(existing: tuple[str, ...], extra: tuple[str, ...]) -> tuple[str, ...]:
    merged = list(existing)
    for rule in extra:
        if rule not in merged:
            merged.append(rule)
    return tuple(merged)


def _stronger_hook(text: str) -> str:
    clean = text.strip().rstrip(".")
    lowered = clean.lower()
    if lowered.startswith("the ") and " advice that keeps failing" in lowered:
        subject = clean[4:].split(" advice that keeps failing", 1)[0]
        return f"Why {_short_subject(subject)} keeps failing"
    if clean.lower().startswith(("why ", "how ", "the ")):
        return clean
    return f"Why {clean} keeps failing"


def _absurd_hook(text: str) -> str:
    clean = text.strip().rstrip(".")
    return f"This sounds absurd: {clean}"


def _emotional_hook(text: str) -> str:
    clean = text.strip().rstrip(".")
    return f"If {clean} feels personal, read this"


def _make_emotional(text: str) -> str:
    clean = text.strip().rstrip(".")
    if clean.lower().startswith(("you ", "your ")):
        return clean + "."
    return f"You feel it when {clean[0].lower() + clean[1:] if clean else 'the idea gets fuzzy'}."


def _limit_words(text: str, max_words: int) -> str:
    words = text.strip().split()
    if len(words) <= max_words:
        return text.strip()
    return " ".join(words[:max_words])


def _short_subject(text: str) -> str:
    words = text.split()
    remove = {"app", "tool", "system", "platform", "for", "busy", "families", "people", "users"}
    kept = [word for word in words if word.lower().strip(".,") not in remove]
    if len(kept) >= 2:
        return " ".join(kept[:4])
    return " ".join(words[:4])
