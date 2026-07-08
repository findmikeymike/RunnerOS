"""LLM-powered copy scorer — evaluates content against brand voice and quality criteria.

This replaces heuristic-only scoring with a two-layer approach:
1. Fast heuristic check (BrandVoicePack.check) — catches banned words, anti-tone, length
2. LLM semantic evaluation — scores brand fit, clarity, hook strength, CTA quality

Usage:
    from content.scoring.copy_scorer import CopyScorer, CopyScore
    from content.voice.brand_voice import DEFAULT_VOICE

    scorer = CopyScorer(voice=DEFAULT_VOICE)

    # Quick heuristic check (no LLM call)
    violations = scorer.quick_check(draft, platform="tiktok")

    # Full LLM-powered evaluation
    score = await scorer.score(draft, platform="tiktok", brief="Product launch post")

    # Check if it passes
    if score.verdict == "ship":
        ...
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from content.voice.brand_voice import BrandVoicePack, VoiceViolation


# ---------------------------------------------------------------------------
# Score types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CopyScore:
    """Result of a full copy evaluation."""

    # Dimension scores (0.0 to 1.0)
    brand_voice_fit: float
    clarity: float
    hook_strength: float
    cta_quality: float
    platform_fit: float

    # Computed
    weighted_average: float

    # Qualitative
    top_issue: str
    revision_hint: str

    # Decision
    verdict: str  # "ship", "revise", "rewrite"

    # Heuristic layer
    heuristic_violations: list[VoiceViolation] = field(default_factory=list)

    # Raw LLM output (for debugging)
    raw_llm_response: str = ""

    @property
    def passed(self) -> bool:
        return self.verdict == "ship"

    def to_dict(self) -> dict[str, Any]:
        return {
            "brand_voice_fit": self.brand_voice_fit,
            "clarity": self.clarity,
            "hook_strength": self.hook_strength,
            "cta_quality": self.cta_quality,
            "platform_fit": self.platform_fit,
            "weighted_average": self.weighted_average,
            "top_issue": self.top_issue,
            "revision_hint": self.revision_hint,
            "verdict": self.verdict,
            "heuristic_violations": [str(v) for v in self.heuristic_violations],
        }


# Weights — brand voice is king
WEIGHTS = {
    "brand_voice_fit": 0.30,
    "clarity": 0.25,
    "hook_strength": 0.20,
    "cta_quality": 0.15,
    "platform_fit": 0.10,
}

SHIP_THRESHOLD = 0.70  # >= 0.70 weighted average to ship (maps to ~3.5/5)
REVISE_THRESHOLD = 0.50  # >= 0.50 but < 0.70 = revise


# ---------------------------------------------------------------------------
# Scorer prompt
# ---------------------------------------------------------------------------

SCORER_PROMPT_TEMPLATE = """You are a copy quality scorer for a marketing production system. Score this draft honestly.

## Brand Voice
{voice_block}

## Platform
{platform}

## Brief/Context
{brief}

## Draft to Score
---
{draft}
---

## Score each dimension 0.0 to 1.0:

1. **Brand Voice Fit** (weight: 0.30): Does this sound like the brand? Check tone, vocabulary, sentence style. Compare against the good and bad examples.

2. **Clarity** (weight: 0.25): Can someone understand the message in one read? Any ambiguity or confusion?

3. **Hook Strength** (weight: 0.20): Would the first sentence stop a scroll / make someone open the email / keep reading? Is it immediate?

4. **CTA Quality** (weight: 0.15): Is the call to action clear, specific, and motivated? (Score 0.5 if no CTA is needed for this content type.)

5. **Platform Fit** (weight: 0.10): Is length, format, and tone appropriate for {platform}?

## Calibrated reference examples (use these as anchors — your score MUST be consistent with these):

EXAMPLE 1 — Score: 0.82 (ship)
Platform: instagram_feed | Brief: merch launch for streetwear brand
Draft: "Built for the ones who move different. Heavyweight 280gsm. Cut oversized. Ships Friday. Link in bio."
Why 0.82: Strong hook, clear brand voice (confident, terse), specific product details, solid CTA. Loses points on clarity (no product name) and hook could be more visually arresting.

EXAMPLE 2 — Score: 0.55 (revise)
Platform: twitter | Brief: app launch for productivity tool
Draft: "Introducing our amazing new app that helps you get more done! We're so excited to share this with the world. Check it out today!"
Why 0.55: Generic hook ("introducing our amazing"), try-hard excitement ("so excited"), vague value prop, no specificity. Clarity is okay but everything else is bland.

EXAMPLE 3 — Score: 0.35 (rewrite)
Platform: tiktok | Brief: music single pre-save campaign
Draft: "We are thrilled to announce that our latest single is now available for pre-save on all major streaming platforms. Don't miss out on this incredible opportunity to be among the first to listen!"
Why 0.35: Corporate tone on a TikTok brief. "Thrilled to announce" is press release language. "Don't miss out" is salesy. Way too long for TikTok. Zero personality. Complete style mismatch.

EXAMPLE 4 — Score: 0.72 (ship, barely)
Platform: email | Brief: app feature update
Draft: "Your focus mode just got sharper. We rebuilt notifications from scratch — only the ones that matter get through now. Update is live."
Why 0.72: Good voice (clean, direct), clear value prop, decent hook. Loses points: no CTA (should have "Update now" or link), hook is good but not great. Passes because voice and clarity are strong.

EXAMPLE 5 — Score: 0.28 (rewrite)
Platform: instagram_feed | Brief: merch drop for streetwear brand
Draft: "Leveraging cutting-edge textile technology, our innovative apparel solution delivers unparalleled comfort synergized with bold aesthetic expression. Shop the collection to empower your personal brand journey."
Why 0.28: Corporate buzzword disaster. "Leveraging," "synergized," "empower," "journey" — all banned-tier words. Zero brand personality. No human would talk like this. Rewrite from scratch.

## Scoring calibration:
- 0.9-1.0 = Exceptional. Could be a case study example.
- 0.7-0.89 = Good. Ship it.
- 0.5-0.69 = Okay but needs revision. Specific issues.
- 0.3-0.49 = Significant problems. Needs rewrite.
- 0.0-0.29 = Off-brand or fundamentally broken.

Most marketing copy scores 0.5-0.65. Don't inflate.

Respond ONLY with this JSON:
{{
  "brand_voice_fit": <0.0-1.0>,
  "clarity": <0.0-1.0>,
  "hook_strength": <0.0-1.0>,
  "cta_quality": <0.0-1.0>,
  "platform_fit": <0.0-1.0>,
  "top_issue": "<single biggest problem, or 'none'>",
  "revision_hint": "<specific fix, or 'none'>"
}}"""


# ---------------------------------------------------------------------------
# Scorer class
# ---------------------------------------------------------------------------

class CopyScorer:
    """Two-layer copy quality scorer: heuristics + LLM.

    The scorer is deliberately simple in its dependencies. It takes an
    `llm_call` callable so the graph layer can inject whatever LLM client
    it uses (LangChain, direct API, etc).
    """

    def __init__(
        self,
        voice: BrandVoicePack,
        llm_call: Any | None = None,
    ) -> None:
        """
        Args:
            voice: The brand voice pack to score against.
            llm_call: Async callable that takes (system_prompt: str, user_message: str)
                      and returns the LLM's text response. If None, only heuristic
                      scoring is available.
        """
        self.voice = voice
        self._llm_call = llm_call

    def quick_check(self, draft: str, *, platform: str | None = None) -> list[VoiceViolation]:
        """Fast heuristic check — no LLM call. Returns list of violations.

        Use this for real-time feedback while drafting.
        """
        return self.voice.check(draft, platform=platform)

    async def score(
        self,
        draft: str,
        *,
        platform: str = "general",
        brief: str = "",
    ) -> CopyScore:
        """Full LLM-powered evaluation. Returns CopyScore with verdict.

        Falls back to heuristic-only scoring if no llm_call was provided.
        """
        # Layer 1: Heuristic check
        violations = self.quick_check(draft, platform=platform)
        hard_violations = [v for v in violations if v.severity == "hard"]

        # If hard violations exist, fail fast without LLM call
        if hard_violations:
            return CopyScore(
                brand_voice_fit=0.2,
                clarity=0.5,
                hook_strength=0.5,
                cta_quality=0.5,
                platform_fit=0.5,
                weighted_average=0.34,
                top_issue=str(hard_violations[0]),
                revision_hint=f"Fix {len(hard_violations)} brand voice violation(s) first: {hard_violations[0].detail}",
                verdict="revise",
                heuristic_violations=violations,
            )

        # Layer 2: LLM evaluation
        if self._llm_call is None:
            return self._heuristic_only_score(draft, violations, platform)

        voice_block = self.voice.to_prompt_block(platform)
        prompt = SCORER_PROMPT_TEMPLATE.format(
            voice_block=voice_block,
            platform=platform,
            brief=brief or "(no specific brief provided)",
            draft=draft,
        )

        try:
            raw_response = await self._llm_call(
                "You are a marketing copy quality scorer. Respond only with JSON.",
                prompt,
            )
            return self._parse_llm_response(raw_response, violations)
        except Exception:
            # LLM failed — fall back to heuristic-only
            return self._heuristic_only_score(draft, violations, platform)

    def _parse_llm_response(
        self, raw: str, violations: list[VoiceViolation]
    ) -> CopyScore:
        """Parse the LLM's JSON response into a CopyScore."""
        # Extract JSON from response (handle markdown code blocks)
        json_str = raw.strip()
        if json_str.startswith("```"):
            json_str = json_str.split("```")[1]
            if json_str.startswith("json"):
                json_str = json_str[4:]
        json_str = json_str.strip()

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            return self._heuristic_only_score("", violations, "general")

        def _clamp(v: Any) -> float:
            try:
                return max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                return 0.5

        scores = {
            "brand_voice_fit": _clamp(data.get("brand_voice_fit", 0.5)),
            "clarity": _clamp(data.get("clarity", 0.5)),
            "hook_strength": _clamp(data.get("hook_strength", 0.5)),
            "cta_quality": _clamp(data.get("cta_quality", 0.5)),
            "platform_fit": _clamp(data.get("platform_fit", 0.5)),
        }

        weighted = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)

        if weighted >= SHIP_THRESHOLD:
            verdict = "ship"
        elif weighted >= REVISE_THRESHOLD:
            verdict = "revise"
        else:
            verdict = "rewrite"

        return CopyScore(
            **scores,
            weighted_average=round(weighted, 3),
            top_issue=str(data.get("top_issue", "none")),
            revision_hint=str(data.get("revision_hint", "none")),
            verdict=verdict,
            heuristic_violations=violations,
            raw_llm_response=raw,
        )

    def _heuristic_only_score(
        self,
        draft: str,
        violations: list[VoiceViolation],
        platform: str | None,
    ) -> CopyScore:
        """Fallback scoring when LLM is unavailable. Conservative estimates."""
        hard_count = sum(1 for v in violations if v.severity == "hard")
        soft_count = sum(1 for v in violations if v.severity == "soft")

        # Start at 0.65 (just below ship threshold) and deduct
        base = 0.65
        brand_fit = max(0.1, base - (hard_count * 0.2) - (soft_count * 0.05))

        # Basic length check for clarity
        word_count = len(draft.split())
        if word_count == 0:
            clarity = 0.0
        elif word_count < 5:
            clarity = 0.3
        elif word_count > 500:
            clarity = 0.4
        else:
            clarity = 0.6

        weighted = (
            brand_fit * WEIGHTS["brand_voice_fit"]
            + clarity * WEIGHTS["clarity"]
            + 0.5 * WEIGHTS["hook_strength"]  # can't assess without LLM
            + 0.5 * WEIGHTS["cta_quality"]
            + 0.5 * WEIGHTS["platform_fit"]
        )

        verdict = "ship" if weighted >= SHIP_THRESHOLD else "revise" if weighted >= REVISE_THRESHOLD else "rewrite"

        return CopyScore(
            brand_voice_fit=brand_fit,
            clarity=clarity,
            hook_strength=0.5,
            cta_quality=0.5,
            platform_fit=0.5,
            weighted_average=round(weighted, 3),
            top_issue=str(violations[0]) if violations else "none (heuristic-only scoring — LLM unavailable)",
            revision_hint="Run with LLM scoring for actionable feedback" if not violations else violations[0].detail,
            verdict=verdict,
            heuristic_violations=violations,
        )
