from __future__ import annotations

from content.writing.brief_generator import CreativeBrief
from content.writing.script_guidance import (
    assemble_guided_lines,
    clean_fragment,
    clean_sentence,
    guidance_prefix_line,
    script_guidance_from_brief,
)
from creative.production.contracts import UgcStrategyPlan


def build_ugc_strategy(brief: CreativeBrief) -> UgcStrategyPlan:
    """Build a compact, deterministic UGC strategy before visual prompts."""
    text = _brief_text(brief)
    product = _short_product(brief.product_description)
    creator_persona = _creator_persona(text=text, product=product)
    authenticity_angle = _authenticity_angle(text=text, product=product)
    hook_pattern = _hook_pattern(text=text, product=product)
    proof_mechanism = _proof_mechanism(text=text, product=product)
    objection = _objection_to_answer(text=text, product=product)
    setting = _setting(text=text)
    unsupported = _unsupported_requests(text)
    return UgcStrategyPlan(
        creator_persona=creator_persona,
        authenticity_angle=authenticity_angle,
        hook_pattern=hook_pattern,
        proof_mechanism=proof_mechanism,
        objection_to_answer=objection,
        setting=setting,
        shot_archetypes=(
            f"selfie hook in {setting}; creator starts mid-thought, not posed",
            "messy before-state insert that makes the pain obvious silently",
            f"hands-on proof demo of {product}; one specific action, not generic posing",
            "direct-to-camera CTA gesture with clean caption-safe space",
        ),
        script_rules=(
            "open with a psychological hook: pain, identity, curiosity, or quiet contradiction",
            "cut filler; every spoken sentence must change belief or create tension",
            "one concrete proof moment before any claim",
            "answer the main objection before the CTA",
            "CTA should be direct, not hedged",
            "avoid fake statistics unless supplied by the brief",
        ),
        provider_strategy=(
            "cheap_i2v_creator_broll"
            if not unsupported
            else "requires_presenter_or_lipsync_provider_before_spend"
        ),
        render_modes=("avatar_fullscreen", "avatar_pip_overlay"),
        preferred_render_mode="avatar_pip_overlay",
        unsupported_requests=unsupported,
    )


def build_ugc_presenter_script(*, brief: CreativeBrief, strategy: UgcStrategyPlan | None) -> str:
    """Write user-facing spoken UGC ad copy from the strategy fields."""
    explicit = clean_sentence(brief.voiceover_script or "")
    if explicit:
        return explicit

    product = _short_product(brief.product_description)
    guidance = script_guidance_from_brief(brief)
    cta = _cta_line(brief.cta_text)
    if strategy is None:
        return assemble_guided_lines(
            (
                guidance_prefix_line(guidance, fallback=f"This is the part nobody tells you about {product}"),
                *_script_bit_lines(guidance),
                "The thing that looked small was actually the thing wasting the most energy.",
                f"Then one proof moment made it obvious: {product} removes the drag instead of adding another task.",
                *_must_say_lines(guidance, cta=cta),
                cta,
            ),
            guidance=guidance,
        ) or "This is the part nobody tells you. The proof shows up fast. Do this next: try it today."

    return assemble_guided_lines(
        (
            guidance_prefix_line(guidance, fallback=strategy.hook_pattern),
            *_script_bit_lines(guidance),
            _spoken_authenticity(strategy.authenticity_angle),
            _spoken_proof(strategy.proof_mechanism, product=product),
            _spoken_objection(strategy.objection_to_answer, product=product),
            *_must_say_lines(guidance, cta=cta),
            cta,
        ),
        guidance=guidance,
    ) or "This is the part nobody tells you. The proof shows up fast. Do this next: try it today."


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
            brief.key_audience_insight or "",
            brief.competitor_visual_notes or "",
            " ".join(brief.mood_keywords or ()),
        )
        if part
    ).lower()


def _script_bit_lines(guidance) -> tuple[str, ...]:
    return tuple(guidance.script_bits[:3])


def _must_say_lines(guidance, *, cta: str) -> tuple[str, ...]:
    cta_lower = cta.lower()
    return tuple(item for item in guidance.must_say if item.lower() not in cta_lower)


def _cta_line(cta_text: str | None) -> str:
    cta = " ".join((cta_text or "try it today").strip().rstrip(".").split())
    if not cta:
        cta = "try it today"
    return f"Do this next: {cta[0].lower()}{cta[1:] if len(cta) > 1 else ''}."


def _spoken_authenticity(angle: str) -> str:
    text = angle.lower()
    if "before-state friction" in text or "relief moment" in text:
        return "The weird part is how fast the old friction starts feeling unnecessary."
    if "real work session" in text:
        return "This belongs in the messy real session, not a fake clean desk shot."
    if "story" in text:
        return "It hits like the kind of story you keep mentally reopening later."
    return "It feels discovered, not sold."


def _spoken_proof(proof: str, *, product: str) -> str:
    text = proof.lower()
    if "screen" in text or "workflow" in text:
        return "One screen tells you the whole thing: what changed, what got easier, and why you care."
    if "texture" in text or "fit" in text:
        return "The proof is in the close-up: texture, fit, and movement without trying to look styled."
    if "sonic" in text or "lyric" in text:
        return "There is one moment that hooks your ear before your brain catches up."
    return f"The proof is simple: {product} changes one visible thing right away."


def _spoken_objection(objection: str, *, product: str) -> str:
    text = objection.lower()
    if "simple enough" in text or "one glance" in text:
        return "No tutorial energy. If you need five minutes to understand it, it already lost."
    if "premium" in text:
        return "The premium part is the restraint: details doing the work instead of hype."
    if "story" in text:
        return "You know fast whether you are in, because the premise has a pulse."
    return f"This does not feel like another generic {product} pitch because the proof happens on camera."


def _short_product(product_description: str) -> str:
    words = product_description.strip().rstrip(".").split()
    if len(words) <= 8:
        return " ".join(words) or "the product"
    return " ".join(words[:8])


def _creator_persona(*, text: str, product: str) -> str:
    if any(term in text for term in ("founder", "built this", "my app", "our app")):
        return f"founder-creator casually explaining why {product} exists"
    if any(term in text for term in ("music", "song", "album", "single", "artist")):
        return "artist-creator sharing the thing behind the release"
    if any(term in text for term in ("app", "ios", "android", "saas", "dashboard", "workflow")):
        return "busy creator showing the app solving one real workflow problem"
    if any(term in text for term in ("shirt", "tee", "hoodie", "wear", "fashion")):
        return "style-conscious creator checking fit, texture, and camera-readiness"
    return f"credible niche creator who would actually use {product}"


def _authenticity_angle(*, text: str, product: str) -> str:
    if any(term in text for term in ("late night", "ship", "creator", "film", "edit")):
        return f"{product} belongs in the real work session, not a polished studio setup"
    if any(term in text for term in ("save time", "habit", "planner", "workflow")):
        return "show the before-state friction and the small relief moment after using it"
    if any(term in text for term in ("novel", "book", "story")):
        return "make the creator sound like they found a story they cannot stop thinking about"
    return "make the moment feel discovered during normal use"


def _hook_pattern(*, text: str, product: str) -> str:
    if "founder" in text:
        return f"I built {product} because this problem kept stealing attention from the real work"
    if any(term in text for term in ("app", "workflow", "planner", "habit")):
        return "The scary part is how normal the wasted time started to feel"
    if any(term in text for term in ("shirt", "tee", "hoodie", "wear")):
        return "Most clothes look fine until a camera makes them look try-hard"
    if any(term in text for term in ("music", "song", "single", "artist")):
        return "This is the part of the song that sneaks up on you later"
    if any(term in text for term in ("novel", "book", "story")):
        return "This starts like one kind of story and then quietly turns the knife"
    return f"This is the part nobody tells you about {product}"


def _proof_mechanism(*, text: str, product: str) -> str:
    if any(term in text for term in ("app", "ios", "android", "saas", "dashboard")):
        return "show one real screen/workflow result and the human reaction to it"
    if any(term in text for term in ("shirt", "tee", "hoodie", "wear")):
        return "show texture, fit, and one mirror/selfie movement that proves it works on camera"
    if any(term in text for term in ("music", "song", "single")):
        return "show the creator reacting to the strongest sonic or lyric moment"
    return f"show {product} doing one concrete thing in the creator's hands"


def _objection_to_answer(*, text: str, product: str) -> str:
    if any(term in text for term in ("app", "ios", "android", "saas")):
        return "prove it is simple enough to understand in one glance"
    if any(term in text for term in ("premium", "expensive", "luxury")):
        return "prove the premium claim through detail, not hype"
    if any(term in text for term in ("book", "novel", "story")):
        return "prove why this story is worth starting now"
    return f"prove {product} is not just another generic ad product"


def _setting(text: str) -> str:
    if any(term in text for term in ("app", "workflow", "dashboard", "planner")):
        return "desk setup with phone or laptop in hand"
    if any(term in text for term in ("shirt", "tee", "hoodie", "wear")):
        return "bedroom mirror or late-night studio corner"
    if any(term in text for term in ("music", "song", "artist")):
        return "small studio, car, or bedroom listening setup"
    return "natural lived-in room with available light"


def _unsupported_requests(text: str) -> tuple[str, ...]:
    unsupported: list[str] = []
    if any(
        term in text
        for term in (
            "lip sync",
            "lipsync",
            "lip-sync",
            "speaking on camera",
            "talking on camera",
            "talking head",
            "talking-head",
            "presenter",
            "on-camera",
            "speaking to camera",
            "talking to camera",
            "creator speaking",
            "creator talking",
            "creator speaks",
            "creator talks",
            "creator explaining",
            "creator explains",
            "creator on camera",
            "creator on-camera",
            "selfie creator",
            "selfie-style creator",
        )
    ):
        unsupported.append("lipsync_or_true_talking_head")
    if any(term in text for term in ("ai avatar", "avatar", "clone this creator")):
        unsupported.append("avatar_or_identity_clone")
    return tuple(dict.fromkeys(unsupported))
