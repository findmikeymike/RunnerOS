from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from content.writing.brief_generator import CreativeBrief


ALLOWED_PRODUCTION_ACTIONS = (
    "generate_still",
    "animate_selected_still",
    "retry_with_prompt_adjustment",
    "switch_template",
    "downgrade_scope",
    "ship_for_review",
    "escalate_to_human_review",
)


AllowedProductionAction = Literal[
    "generate_still",
    "animate_selected_still",
    "retry_with_prompt_adjustment",
    "switch_template",
    "downgrade_scope",
    "ship_for_review",
    "escalate_to_human_review",
]


class ProductionFinalStatus(StrEnum):
    RUNNING = "running"
    REVIEW_READY = "review_ready"
    ESCALATED = "escalated"


@dataclass(slots=True)
class CreativeProductionInput:
    brief: CreativeBrief
    budget_cap_usd: float | None = None
    max_attempts: int = 2
    video_quality: str = "budget"
    run_id: str = field(default_factory=lambda: f"creative-production-{uuid4().hex[:12]}")

    @property
    def effective_budget_cap_usd(self) -> float:
        return float(self.budget_cap_usd if self.budget_cap_usd is not None else self.brief.max_cost_usd)


@dataclass(slots=True)
class CandidateStillRecord:
    candidate_id: str
    source_run_id: str
    asset_path: Path | None
    score: float
    verdict: str
    style_family: str
    template_id: str
    prompt_summary: str
    attempt_index: int
    reference_asset_roles: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ContinuityPackItem:
    role: str
    path: Path
    instruction: str
    label: str | None = None
    asset_id: str | None = None
    priority: int = 0


@dataclass(slots=True)
class ContinuityPack:
    primary_role: str
    primary_path: Path | None
    items: tuple[ContinuityPackItem, ...] = ()
    preservation_rules: tuple[str, ...] = ()
    prompt_instructions: str = ""
    warnings: tuple[str, ...] = ()
    source: str = "continuity_pack_v1"


@dataclass(slots=True)
class ImageToVideoHandoff:
    selected_still_path: Path
    selected_still_id: str
    source_run_id: str
    reference_asset_roles: dict[str, Any] = field(default_factory=dict)
    primary_reference_role: str = "unknown"
    preservation_rules: tuple[str, ...] = ()
    motion_context: str = ""
    continuity_pack: ContinuityPack | None = None


@dataclass(slots=True)
class PlatformProfile:
    platform: str
    aspect_ratio: str
    duration_min_s: int
    duration_max_s: int
    safe_area: str
    export_notes: str = ""


@dataclass(slots=True)
class ShotGrammar:
    shot_size: str = "none"
    lens: str = "none"
    lighting_motivation: str = "none"
    cut_from_previous: str = "none"


@dataclass(slots=True)
class ShotDirective:
    purpose: str
    visual_action: str
    framing: str
    continuity_anchor: str
    caption_role: str
    shot_grammar: ShotGrammar | None = None


@dataclass(slots=True)
class SceneBeat:
    beat_index: int
    beat_role: str
    intent: str
    viewer_emotion: str
    visual_goal: str
    audio_goal: str
    caption_goal: str
    duration_s: int
    visual_premise: str = ""
    motion_intent: str = ""
    image_prompt_focus: str = ""
    voiceover_goal: str = ""
    music_sfx_goal: str = ""
    reference_strategy: str = ""
    shot_directive: ShotDirective | None = None


@dataclass(slots=True)
class NarrativeSceneScript:
    beat_index: int
    beat_role: str
    hook_question: str
    narration: str
    visual_prompt: str
    motion_direction: str
    caption_text: str
    retention_note: str
    visual_a_prompt: str = ""
    visual_b_prompt: str = ""
    stock_search_terms: tuple[str, ...] = ()
    retention_reason: str = ""
    scene_duration_s: int = 0
    audio_emphasis: str = ""


@dataclass(slots=True)
class NarrativeScriptPlan:
    topic: str
    title: str
    thesis: str
    curiosity_gap: str
    narration_script: str
    music_mood: str
    pacing_notes: str
    scenes: tuple[NarrativeSceneScript, ...] = ()
    source: str = "deterministic_v1"


@dataclass(slots=True)
class CreativeTreatmentPlan:
    concept: str
    aesthetic_lane: str
    visual_language: str
    pacing: str
    edit_rules: tuple[str, ...] = ()
    scene_directives: tuple[str, ...] = ()
    prompt_directives: tuple[str, ...] = ()
    negative_constraints: tuple[str, ...] = ()
    rationale: str = ""
    source: str = "deterministic_treatment_v1"


@dataclass(slots=True)
class UgcStrategyPlan:
    creator_persona: str
    authenticity_angle: str
    hook_pattern: str
    proof_mechanism: str
    objection_to_answer: str
    setting: str
    shot_archetypes: tuple[str, ...] = ()
    script_rules: tuple[str, ...] = ()
    provider_strategy: str = "cheap_i2v_creator_broll"
    render_modes: tuple[str, ...] = ("avatar_fullscreen", "avatar_pip_overlay")
    preferred_render_mode: str = "avatar_pip_overlay"
    unsupported_requests: tuple[str, ...] = ()
    source: str = "deterministic_ugc_strategy_v1"


@dataclass(slots=True)
class SequenceTreatment:
    palette_or_texture_anchor: str
    rhythmic_intent: str
    tonal_contradiction: str
    signature_camera_or_framing_move: str
    source: str = "openai_responses_sequence_treatment_v1"


@dataclass(slots=True)
class FormatNarrativePlan:
    format_type: str
    production_mode: str
    primary_intent: str
    intent: tuple[str, ...]
    viewer_emotion_start: str
    viewer_emotion_peak: str
    viewer_emotion_end: str
    emotional_arc: str
    audio_mode: str
    caption_strategy: str
    duration_target_s: int
    platform_profile: PlatformProfile
    scene_beats: tuple[SceneBeat, ...] = ()
    base_scene_beats: tuple[SceneBeat, ...] = ()
    script_plan: NarrativeScriptPlan | None = None
    creative_treatment: CreativeTreatmentPlan | None = None
    ugc_strategy: UgcStrategyPlan | None = None
    sequence_treatment: SequenceTreatment | None = None
    rationale: str = ""


@dataclass(slots=True)
class VideoClipRecord:
    clip_id: str
    source_still_id: str | None
    asset_path: Path | None
    duration_s: float | None
    score: float | None
    verdict: str
    prompt_summary: str
    attempt_index: int
    cost_usd: float = 0.0
    model_id: str | None = None
    model_route_reason: str | None = None
    provider_request_id: str | None = None


@dataclass(slots=True)
class UgcPresenterRecord:
    clip_id: str
    asset_path: Path
    provider: str
    provider_request_id: str | None
    script: str
    render_mode: str
    duration_s: float | None = None
    cost_usd: float = 0.0
    model_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CinemaControlPlan:
    camera_move: str
    lens_feel: str
    depth_of_field: str
    lighting_style: str
    motion_intensity: str
    framing: str
    source: str = "deterministic_cinema_controls_v1"


@dataclass(slots=True)
class ShotPlan:
    opening_frame: str
    subject_action: str
    camera_move: str
    environment_motion: str
    ending_frame: str
    pacing: str
    preservation_constraints: str
    negative_constraints: str


@dataclass(slots=True)
class MotionPromptPlan:
    motion_prompt: str
    action_description: str
    camera_direction: str
    visual_ethos: str
    duration_s: int
    negative_prompt: str = ""
    shot_plan: ShotPlan | None = None
    cinema_controls: CinemaControlPlan | None = None
    render_style: str = "auto"  # explicit look direction (auto/photoreal/painterly/illustrated/animated/...)


@dataclass(slots=True)
class PlanReviewRecord:
    verdict: str
    rationale: str
    confidence: float | None = None
    motion_strategy: str | None = None
    dominant_motion_beat: str | None = None
    subject_motion_priority: str | None = None
    revised_subject_action: str | None = None
    revised_camera_move: str | None = None
    revised_environment_motion: str | None = None
    revised_ending_frame: str | None = None


@dataclass(slots=True)
class FinalAssemblyRecord:
    asset_path: Path
    clip_count: int
    duration_s: float | None
    assembly_method: str
    source_clip_ids: tuple[str, ...] = ()
    audio_asset_path: Path | None = None


@dataclass(slots=True)
class UgcRenderModePlan:
    mode: str
    presenter_position: str = "bottom_right"
    presenter_width_ratio: float = 0.28
    margin_ratio: float = 0.035
    background_mode: str = "solid_green"
    chromakey_color: str = "0x00ff00"
    chromakey_similarity: float = 0.22
    chromakey_blend: float = 0.08
    preserve_presenter_audio: bool = True
    source: str = "deterministic_ugc_render_mode_v1"


@dataclass(slots=True)
class CaptionCue:
    index: int
    start_s: float
    end_s: float
    text: str
    beat_role: str
    style: str


@dataclass(slots=True)
class CaptionStyle:
    font: str
    font_size: int
    primary_color: str
    outline_color: str
    outline_width: int
    alignment: int
    margin_v: int
    max_chars_per_line: int
    max_lines: int
    shadow_offset: int = 0
    background_box: bool = False
    background_color: str = "&H80000000"
    lead_in_ms: int = 0
    hold_out_ms: int = 0
    min_duration_s: float = 0.0


@dataclass(slots=True)
class CaptionValidationFinding:
    severity: str
    cue_index: int | None
    message: str


@dataclass(slots=True)
class OutputValidationFinding:
    severity: str
    message: str


@dataclass(slots=True)
class PostPassOutputProbe:
    asset_path: Path
    exists: bool
    probe_error: str | None = None
    size_bytes: int | None = None
    duration_s: float | None = None
    video_stream_count: int = 0
    audio_stream_count: int = 0
    width: int | None = None
    height: int | None = None
    video_codecs: tuple[str, ...] = ()
    audio_codecs: tuple[str, ...] = ()


@dataclass(slots=True)
class PostPassPlan:
    caption_strategy: str
    captions_enabled: bool
    caption_cues: tuple[CaptionCue, ...] = ()
    caption_style: CaptionStyle | None = None
    validation_findings: tuple[CaptionValidationFinding, ...] = ()
    srt_path: Path | None = None
    json_path: Path | None = None
    source_asset_path: Path | None = None
    rendered_asset_path: Path | None = None
    render_status: str = "not_requested"
    normalized_asset_path: Path | None = None
    normalize_status: str = "not_requested"
    final_asset_path: Path | None = None
    output_probe: PostPassOutputProbe | None = None
    output_validation_findings: tuple[OutputValidationFinding, ...] = ()
    burn_in_recommended: bool = False
    loudness_target_lufs: float | None = None
    platform_notes: str = ""


@dataclass(slots=True)
class RenderPlan:
    renderer: str
    polish_level: str
    reason: str
    fallback_renderer: str = "ffmpeg"
    required_capabilities: tuple[str, ...] = ()
    render_status: str = "planned"
    warning: str | None = None


@dataclass(slots=True)
class VisualPolishPlan:
    """Result of the visual polish pass (upscale + optional interpolation).

    Status values:
        disabled              — no polish adapter configured (default)
        skipped_already_target — source already meets/exceeds target dims
        upscaled              — upscaled to target resolution
        upscaled_interpolated — upscaled and frame-interpolated
        failed                — polish attempted but failed; original used
    """

    status: str = "disabled"
    source_asset_path: Path | None = None
    polished_asset_path: Path | None = None
    source_width: int | None = None
    source_height: int | None = None
    target_width: int | None = None
    target_height: int | None = None
    target_fps: int | None = None
    applied_steps: tuple[str, ...] = ()
    error: str | None = None
    notes: str = ""


@dataclass(slots=True)
class MusicTrackQuery:
    mood: tuple[str, ...]
    energy: str
    tempo_bpm_min: int | None = None
    tempo_bpm_max: int | None = None
    genre: tuple[str, ...] = ()
    instrumentation: tuple[str, ...] = ()
    vocal_policy: str = "instrumental_preferred"
    duration_min_s: int | None = None
    duration_max_s: int | None = None
    license_required: str = "cleared_for_commercial_use"
    loopable_preferred: bool = True
    explicit_allowed: bool = False


@dataclass(slots=True)
class MusicTrackRecord:
    track_id: str
    title: str
    artist: str
    asset_path: Path | None
    duration_s: float | None
    mood: tuple[str, ...] = ()
    energy: str = "medium"
    tempo_bpm: int | None = None
    genre: tuple[str, ...] = ()
    instrumentation: tuple[str, ...] = ()
    has_vocals: bool = False
    explicit: bool = False
    loopable: bool = False
    license: str = ""
    source: str = "library"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SfxCuePlan:
    cue_id: str
    beat_index: int
    start_s: float
    end_s: float
    purpose: str
    search_tags: tuple[str, ...]
    intensity: str
    keep_under_voice: bool = True
    asset_path: Path | None = None
    resolution_source: str = "unresolved"


@dataclass(slots=True)
class AudioMixPlan:
    audio_mode: str
    music_role: str
    track_query: MusicTrackQuery | None = None
    selected_music_track: MusicTrackRecord | None = None
    rejected_track_ids: tuple[str, ...] = ()
    sfx_cues: tuple[SfxCuePlan, ...] = ()
    voice_ducking_enabled: bool = False
    music_gain_db: float | None = None
    sfx_gain_db: float | None = None
    loudness_target_lufs: float | None = None
    mix_notes: str = ""
    selection_rationale: str = ""


@dataclass(slots=True)
class AudioAssetRecord:
    asset_path: Path
    provider: str
    model_id: str
    voice_id: str
    mime_type: str
    duration_s: float | None = None
    processed_characters: int | None = None
    cost_usd: float = 0.0
    metadata: dict = field(default_factory=dict)


@dataclass(slots=True)
class VoiceoverPlan:
    enabled: bool
    script: str
    voice_direction: str
    template_id: str | None
    rationale: str


@dataclass(slots=True)
class HumanProductionReviewPacket:
    summary: str
    review_path: Path | None
    approval_payload: dict


@dataclass(slots=True)
class CreativeProductionState:
    run_id: str
    brief_input: CreativeProductionInput
    creative_goal: str
    budget_cap_usd: float
    max_attempts: int
    total_spend_usd: float = 0.0
    format_narrative_plan: FormatNarrativePlan | None = None
    selected_still: CandidateStillRecord | None = None
    selected_still_history: list[CandidateStillRecord] = field(default_factory=list)
    image_to_video_handoff: ImageToVideoHandoff | None = None
    image_to_video_handoff_history: list[ImageToVideoHandoff] = field(default_factory=list)
    motion_plan: MotionPromptPlan | None = None
    motion_plan_history: list[MotionPromptPlan] = field(default_factory=list)
    plan_review: PlanReviewRecord | None = None
    plan_review_history: list[PlanReviewRecord] = field(default_factory=list)
    shotlist_director_error: str | None = None
    sequence_treatment_error: str | None = None
    narrative_script_error: str | None = None
    capability_warning: str | None = None
    faceless_asset_intents: tuple[Any, ...] = ()
    ugc_render_mode_plan: UgcRenderModePlan | None = None
    ugc_presenter_clip: UgcPresenterRecord | None = None
    ugc_base_assembly: FinalAssemblyRecord | None = None
    voiceover_plan: VoiceoverPlan | None = None
    voice_asset: AudioAssetRecord | None = None
    voiceover_error: str | None = None
    audio_mix_plan: AudioMixPlan | None = None
    video_attempt_history: list[VideoClipRecord] = field(default_factory=list)
    video_generation_error: str | None = None
    final_assembly: FinalAssemblyRecord | None = None
    render_plan: RenderPlan | None = None
    visual_polish_plan: VisualPolishPlan | None = None
    post_pass_plan: PostPassPlan | None = None
    output_qa_report: Any | None = None
    final_status: ProductionFinalStatus = ProductionFinalStatus.RUNNING
    human_review_packet: HumanProductionReviewPacket | None = None
    manifest_path: Path | None = None
