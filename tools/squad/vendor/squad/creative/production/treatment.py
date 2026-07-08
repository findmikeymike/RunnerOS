from __future__ import annotations

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CreativeTreatmentPlan


def build_creative_treatment(
    *,
    brief: CreativeBrief,
    format_type: str,
    primary_intent: str,
    emotional_arc: str,
) -> CreativeTreatmentPlan:
    """Build one compact creative taste layer before prompts are generated."""
    product = " ".join(brief.product_description.split()).strip() or "the subject"
    audience = " ".join((brief.key_audience_insight or "").split()).strip()
    competitor = " ".join((brief.competitor_visual_notes or "").split()).strip()
    moods = tuple(mood.lower().strip() for mood in brief.mood_keywords if mood.strip())
    context_bits = tuple(bit for bit in (audience, competitor) if bit)
    context_note = f" Use this context: {'; '.join(context_bits)}." if context_bits else ""

    if format_type == "ugc_scripted_ad":
        return CreativeTreatmentPlan(
            concept=f"Make {product} feel discovered in a real creator moment, not presented like a polished spot.",
            aesthetic_lane="phone-native creator proof",
            visual_language="handheld framing, lived-in room detail, natural skin texture, one tactile product interaction per beat",
            pacing="fast first second, then clean human demonstration beats with no dead air",
            edit_rules=(
                "open on a human action before any product explanation",
                "cut only when the viewer learns something new",
                "keep CTA grounded in the creator's natural gesture",
            ),
            scene_directives=(
                "use one believable hand, face, or phone-camera movement in every scene",
                "make the before-state visibly inconvenient before the product appears",
            ),
            prompt_directives=(
                "real phone footage feel",
                "imperfect lived-in setting",
                "specific human gesture",
            ),
            negative_constraints=(
                "no studio product pedestal",
                "no stock-ad smile",
                "no fake text baked into the scene",
            ),
            rationale=f"UGC needs trust first; {primary_intent} works only if the moment feels observed.{context_note}",
        )

    if format_type == "app_demo_ad":
        return CreativeTreatmentPlan(
            concept=f"Make {product} feel useful through one readable feature proof sequence, not abstract app marketing.",
            aesthetic_lane="clean product proof",
            visual_language="crisp device/browser framing, readable UI hierarchy, restrained motion, real screenshot fidelity, caption-safe negative space",
            pacing="fast problem hook, one focused feature demonstration, concrete proof beat, clean CTA hold",
            edit_rules=(
                "show the app doing one thing instead of montage noise",
                "preserve UI readability before adding motion",
                "use post-render captions for claims instead of generated text inside the screen",
            ),
            scene_directives=(
                "anchor every scene on a real screenshot, device frame, dashboard, or workflow state",
                "make the before-state and after-state visually different enough to understand silently",
            ),
            prompt_directives=(
                "readable app UI",
                "device or browser context",
                "clean product proof hierarchy",
            ),
            negative_constraints=(
                "no fake generated UI labels",
                "no unreadable tiny dashboard",
                "no generic glowing phone ad",
            ),
            rationale=f"App demos need proof and readability first; {primary_intent} only works if the viewer understands the feature.{context_note}",
        )

    if format_type == "no_face_youtube":
        return CreativeTreatmentPlan(
            concept=f"Turn {product} into a visual investigation where each shot reveals a clue.",
            aesthetic_lane="faceless documentary mystery",
            visual_language="evidence-like inserts, quiet negative space, slow parallax, textured locations, objects that imply people without showing a host",
            pacing="curiosity hook, measured reveals, one clear evidence beat, restrained final hold",
            edit_rules=(
                "start with a question-shaped image",
                "advance the explanation through objects and places, not presenter energy",
                "end on a repeatable visual idea",
            ),
            scene_directives=(
                "each scene needs one concrete clue the viewer can name",
                "avoid commercial sales language unless the brief explicitly asks for an ad",
            ),
            prompt_directives=(
                "cinematic documentary B-roll",
                "observable clue",
                "caption-safe negative space",
            ),
            negative_constraints=(
                "no talking head",
                "no generic abstract background",
                "no rendered labels or random letters",
            ),
            rationale=f"Faceless work wins when the story is carried by visible evidence across {emotional_arc}.{context_note}",
        )

    if format_type == "lyric_video":
        return CreativeTreatmentPlan(
            concept=f"Make {product} feel rhythm-led, with the image breathing around the lyric overlay.",
            aesthetic_lane="music-synced visual identity",
            visual_language="clean lyric-safe composition, rhythmic background motion, strong silhouette, restrained color shifts",
            pacing="hold enough for lyrics to read, then move on phrase changes",
            edit_rules=(
                "protect clear caption space before every lyric moment",
                "make motion follow the vocal phrase instead of random camera drift",
                "save the strongest visual surge for the chorus",
            ),
            scene_directives=(
                "treat background motion as musical punctuation",
                "keep the subject hierarchy simple so lyrics stay readable",
            ),
            prompt_directives=(
                "lyric-safe negative space",
                "rhythmic motion cues",
                "music video atmosphere",
            ),
            negative_constraints=(
                "no fake lyric text inside generated visuals",
                "no busy background behind captions",
                "no random typography",
            ),
            rationale=f"Lyric clips fail when visuals compete with words; this keeps the image subordinate to the track.{context_note}",
        )

    if format_type == "narrative_sequence":
        return CreativeTreatmentPlan(
            concept=f"Give {product} a clear mini-story: setup, pressure, turn, payoff.",
            aesthetic_lane=_aesthetic_lane_for_moods(moods),
            visual_language="specific location, readable subject hierarchy, decisive state change, final image that resolves the premise",
            pacing="one strong action per beat with a visible turn before the payoff",
            edit_rules=(
                "make every scene change the situation",
                "avoid repeating the same camera move twice in a row",
                "land the final frame as a clean memory image",
            ),
            scene_directives=(
                "show the cause of the turn, not just the aftermath",
                "make physical motion carry the story",
            ),
            prompt_directives=(
                "story-forward composition",
                "visible state change",
                "memorable payoff frame",
            ),
            negative_constraints=(
                "no static mood montage",
                "no vague cinematic filler",
                "no rendered text unless supplied as overlay",
            ),
            rationale=f"Narrative sequences need causality; the treatment forces each shot to do story work.{context_note}",
        )

    lane = _aesthetic_lane_for_moods(moods)
    return CreativeTreatmentPlan(
        concept=f"Make {product} desirable through one arresting opener, one tactile proof detail, and one clean final action frame.",
        aesthetic_lane=lane,
        visual_language=_visual_language_for_lane(lane),
        pacing="quick hook, controlled product reveal, proof detail, clean CTA hold",
        edit_rules=(
            "open with the strongest product-relevant image",
            "move from desire to proof before asking for action",
            "keep the final frame clean enough for post-render captions",
        ),
        scene_directives=(
            "each shot should show a different reason to care",
            "use material texture, human scale, or environment detail as proof",
        ),
        prompt_directives=(
            "strong subject hierarchy",
            "specific material detail",
            "caption-safe final composition",
        ),
        negative_constraints=(
            "no generic floating product",
            "no random generated text",
            "no empty beauty shot without a reason to care",
        ),
        rationale=f"Product ads need taste plus clarity; this keeps {primary_intent} tied to concrete visual proof.{context_note}",
    )


def _aesthetic_lane_for_moods(moods: tuple[str, ...]) -> str:
    mood_set = set(moods)
    if mood_set & {"premium", "luxury", "sleek", "refined", "sophisticated"}:
        return "premium restraint"
    if mood_set & {"raw", "street", "bold", "fashion", "editorial-street"}:
        return "editorial street culture"
    if mood_set & {"dreamy", "nostalgic", "analog", "warm", "intimate"}:
        return "warm analog atmosphere"
    if mood_set & {"dark", "industrial", "edgy", "brutalist", "cold"}:
        return "hard-edged brutalist"
    if mood_set & {"clean", "professional", "sharp", "polished", "precise"}:
        return "clean editorial utility"
    return "specific modern commercial"


def _visual_language_for_lane(lane: str) -> str:
    return {
        "premium restraint": "controlled camera, sparse set, tactile material closeups, deep contrast, no clutter",
        "editorial street culture": "street-level framing, confident styling, real environment texture, fashion-magazine attitude",
        "warm analog atmosphere": "soft practical light, filmic grain, intimate distance, lived-in details",
        "hard-edged brutalist": "bold geometry, high contrast, industrial texture, direct physical motion",
        "clean editorial utility": "crisp surfaces, readable interfaces or product details, precise lighting, efficient composition",
    }.get(lane, "specific environment, clear subject hierarchy, concrete proof detail, clean caption space")
