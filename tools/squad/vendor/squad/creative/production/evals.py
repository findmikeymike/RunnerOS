from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CandidateStillRecord, MotionPromptPlan, VoiceoverPlan
from creative.production.prompt import build_motion_prompt_plan
from creative.production.voice import build_voiceover_plan


@dataclass(frozen=True, slots=True)
class ProductionEvalScenario:
    scenario_id: str
    brief: CreativeBrief
    style_family: str
    expected_terms: tuple[str, ...] = ()
    forbidden_terms: tuple[str, ...] = ()
    expects_voiceover: bool = False
    expects_cta_space: bool = False


@dataclass(frozen=True, slots=True)
class ProductionEvalResult:
    scenario_id: str
    score: float
    passed: bool
    findings: tuple[str, ...]
    motion_plan: MotionPromptPlan
    voiceover_plan: VoiceoverPlan


@dataclass(frozen=True, slots=True)
class ProductionEvalSuiteResult:
    score: float
    passed: bool
    results: tuple[ProductionEvalResult, ...]

    @property
    def failing_scenarios(self) -> tuple[ProductionEvalResult, ...]:
        return tuple(result for result in self.results if not result.passed)


def default_production_eval_scenarios() -> tuple[ProductionEvalScenario, ...]:
    return (
        ProductionEvalScenario(
            scenario_id="premium-product-drop-with-vo",
            brief=CreativeBrief(
                product_description="black heavyweight graphic tee on a motel balcony",
                campaign_goal="Create one short TikTok product reel with voiceover narration",
                platform="tiktok",
                mood_keywords=["premium", "cool"],
                output_type="full_production",
                voiceover_script="Built heavy. Made for late nights.",
                cta_text="Shop now",
                aesthetic_notes="The camera slowly pushes in as orange motel light flickers behind the shirt.",
            ),
            style_family="PREMIUM",
            expected_terms=("slow", "orange motel light", "blank caption-safe space", "identity", "logo"),
            expects_voiceover=True,
            expects_cta_space=True,
        ),
        ProductionEvalScenario(
            scenario_id="a24-story-action",
            brief=CreativeBrief(
                product_description="guy smoking outside a desert motel in a faded band tee",
                campaign_goal="create a moody teaser that feels like an a24 frame coming alive",
                platform="tiktok",
                mood_keywords=["cool", "artistic"],
                output_type="full_production",
                aesthetic_notes=(
                    "He flicks the cigarette away, then the motel detonates into violent orange flames behind him."
                ),
            ),
            style_family="ART_CULTURE",
            expected_terms=("flicks the cigarette", "violent orange flames", "a24", "one clear motion beat"),
            forbidden_terms=("voiceover", "talking head"),
            expects_voiceover=False,
        ),
        ProductionEvalScenario(
            scenario_id="lyric-video-no-vo",
            brief=CreativeBrief(
                product_description="dreamy single cover with a lonely car under neon rain",
                campaign_goal="Create a lyric video clip for the hook",
                platform="tiktok",
                mood_keywords=["dreamy", "nostalgic"],
                output_type="full_production",
                copy_for_overlay="I still see your headlights",
                aesthetic_notes="Neon rain slides down the windshield while lyrics appear in the empty sky.",
            ),
            style_family="ART_CULTURE_FRANK_OCEAN",
            expected_terms=("neon rain", "blank caption-safe space", "gentle floating drift"),
            expects_voiceover=False,
            expects_cta_space=True,
        ),
        ProductionEvalScenario(
            scenario_id="ugc-founder-ad",
            brief=CreativeBrief(
                product_description="mobile habit tracker app",
                campaign_goal="Create a UGC testimonial where the founder talks to camera",
                platform="tiktok",
                mood_keywords=["ugc", "authentic"],
                output_type="full_production",
                cta_text="Try it free",
                aesthetic_notes="Founder holds the phone, opens the app, and talks naturally to camera.",
            ),
            style_family="UGC",
            expected_terms=("natural handheld", "opens the app", "blank caption-safe space"),
            expects_voiceover=True,
            expects_cta_space=True,
        ),
        ProductionEvalScenario(
            scenario_id="wes-anderson-symmetry",
            brief=CreativeBrief(
                product_description="cream hoodie with red embroidered logo",
                campaign_goal="announce a whimsical capsule",
                platform="instagram_feed",
                mood_keywords=["quirky", "symmetrical", "retro"],
                output_type="full_production",
                aesthetic_notes="The subject steps aside and reveals a perfectly framed motel sign.",
            ),
            style_family="ART_CULTURE_WES_ANDERSON",
            expected_terms=("symmetry", "precise", "reveals a perfectly framed motel sign"),
            forbidden_terms=("shaky", "chaotic"),
            expects_voiceover=False,
        ),
    )


def evaluate_default_production_plans(*, pass_threshold: float = 0.8) -> ProductionEvalSuiteResult:
    return evaluate_production_plans(
        scenarios=default_production_eval_scenarios(),
        pass_threshold=pass_threshold,
    )


def evaluate_production_plans(
    *,
    scenarios: tuple[ProductionEvalScenario, ...],
    pass_threshold: float = 0.8,
) -> ProductionEvalSuiteResult:
    results = tuple(_evaluate_scenario(scenario, pass_threshold=pass_threshold) for scenario in scenarios)
    suite_score = round(sum(result.score for result in results) / len(results), 6) if results else 0.0
    return ProductionEvalSuiteResult(
        score=suite_score,
        passed=bool(results) and all(result.passed for result in results),
        results=results,
    )


def _evaluate_scenario(scenario: ProductionEvalScenario, *, pass_threshold: float) -> ProductionEvalResult:
    still = _still_for_scenario(scenario)
    motion_plan = build_motion_prompt_plan(brief=scenario.brief, selected_still=still)
    voiceover_plan = build_voiceover_plan(brief=scenario.brief, selected_still=still)
    findings: list[str] = []
    checks = [
        _check_shot_plan_present(motion_plan, findings),
        _check_expected_terms(scenario, motion_plan, findings),
        _check_forbidden_terms(scenario, motion_plan, findings),
        _check_voiceover_expectation(scenario, voiceover_plan, findings),
        _check_cta_space(scenario, motion_plan, findings),
        _check_preservation_constraints(motion_plan, findings),
        _check_single_camera_intention(motion_plan, findings),
    ]
    score = round(sum(1 for item in checks if item) / len(checks), 6)
    return ProductionEvalResult(
        scenario_id=scenario.scenario_id,
        score=score,
        passed=score >= pass_threshold and not findings,
        findings=tuple(findings),
        motion_plan=motion_plan,
        voiceover_plan=voiceover_plan,
    )


def _still_for_scenario(scenario: ProductionEvalScenario) -> CandidateStillRecord:
    return CandidateStillRecord(
        candidate_id=f"{scenario.scenario_id}-still",
        source_run_id="offline-eval",
        asset_path=Path("/tmp/offline-eval-still.png"),
        score=4.0,
        verdict="ship",
        style_family=scenario.style_family,
        template_id="offline-eval-template",
        prompt_summary="offline eval still",
        attempt_index=1,
    )


def _plan_text(motion_plan: MotionPromptPlan) -> str:
    shot = motion_plan.shot_plan
    parts = [motion_plan.motion_prompt, motion_plan.action_description, motion_plan.camera_direction]
    if shot:
        parts.extend(
            [
                shot.opening_frame,
                shot.subject_action,
                shot.camera_move,
                shot.environment_motion,
                shot.ending_frame,
                shot.pacing,
                shot.preservation_constraints,
                shot.negative_constraints,
            ]
        )
    return " ".join(parts).lower()


def _check_shot_plan_present(motion_plan: MotionPromptPlan, findings: list[str]) -> bool:
    if motion_plan.shot_plan is None:
        findings.append("missing typed shot plan")
        return False
    return True


def _check_expected_terms(
    scenario: ProductionEvalScenario,
    motion_plan: MotionPromptPlan,
    findings: list[str],
) -> bool:
    text = _plan_text(motion_plan)
    missing = [term for term in scenario.expected_terms if term.lower() not in text]
    if missing:
        findings.append(f"missing expected terms: {', '.join(missing)}")
        return False
    return True


def _check_forbidden_terms(
    scenario: ProductionEvalScenario,
    motion_plan: MotionPromptPlan,
    findings: list[str],
) -> bool:
    text = _positive_plan_text(motion_plan)
    present = [term for term in scenario.forbidden_terms if term.lower() in text]
    if present:
        findings.append(f"contained forbidden terms: {', '.join(present)}")
        return False
    return True


def _positive_plan_text(motion_plan: MotionPromptPlan) -> str:
    shot = motion_plan.shot_plan
    parts = [motion_plan.action_description, motion_plan.camera_direction, motion_plan.visual_ethos]
    if shot:
        parts.extend(
            [
                shot.opening_frame,
                shot.subject_action,
                shot.camera_move,
                shot.environment_motion,
                shot.ending_frame,
                shot.pacing,
                shot.preservation_constraints,
            ]
        )
    return " ".join(parts).lower()


def _check_voiceover_expectation(
    scenario: ProductionEvalScenario,
    voiceover_plan: VoiceoverPlan,
    findings: list[str],
) -> bool:
    if voiceover_plan.enabled != scenario.expects_voiceover:
        findings.append(
            f"voiceover expected {scenario.expects_voiceover}, got {voiceover_plan.enabled}: {voiceover_plan.rationale}"
        )
        return False
    return True


def _check_cta_space(
    scenario: ProductionEvalScenario,
    motion_plan: MotionPromptPlan,
    findings: list[str],
) -> bool:
    if not scenario.expects_cta_space:
        return True
    shot = motion_plan.shot_plan
    if shot is None or "caption-safe space" not in shot.ending_frame.lower():
        findings.append("expected ending frame to reserve CTA/overlay space")
        return False
    return True


def _check_preservation_constraints(motion_plan: MotionPromptPlan, findings: list[str]) -> bool:
    shot = motion_plan.shot_plan
    if shot is None:
        return False
    constraints = shot.preservation_constraints.lower()
    required = ("identity", "logo", "composition")
    missing = [term for term in required if term not in constraints]
    if missing:
        findings.append(f"preservation constraints missing: {', '.join(missing)}")
        return False
    return True


def _check_single_camera_intention(motion_plan: MotionPromptPlan, findings: list[str]) -> bool:
    shot = motion_plan.shot_plan
    if shot is None:
        return False
    camera = shot.camera_move.lower()
    movement_count = sum(
        1
        for term in ("dolly", "push", "orbit", "pan", "tilt", "tracking", "handheld", "locked-off", "drift")
        if term in camera
    )
    if movement_count > 2:
        findings.append(f"camera move is too overloaded: {shot.camera_move}")
        return False
    return True
