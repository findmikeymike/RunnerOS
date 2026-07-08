from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class CarouselHook:
    text: str
    hook_type: str
    emotional_trigger: str
    rationale: str


@dataclass(frozen=True, slots=True)
class CarouselSlide:
    slide_number: int
    role: str
    headline: str
    body: str
    visual_direction: str
    overlay_priority: str
    alt_text: str


@dataclass(frozen=True, slots=True)
class CarouselExportSpec:
    platform: str
    aspect_ratio: str
    width_px: int
    height_px: int
    export_format: str
    notes: str = ""
    preferred_still_model: str = ""


@dataclass(frozen=True, slots=True)
class CarouselPlan:
    topic: str
    platform: str
    format: str
    slide_count: int
    cover_hook: CarouselHook
    alternate_hooks: tuple[CarouselHook, ...] = ()
    slides: tuple[CarouselSlide, ...] = ()
    export_spec: CarouselExportSpec | None = None
    caption: str = ""
    hashtags: tuple[str, ...] = ()
    design_rules: tuple[str, ...] = field(default_factory=tuple)
    source: str = "deterministic_carousel_v1"


@dataclass(frozen=True, slots=True)
class CarouselRenderResult:
    plan_source: str
    output_dir: str
    slide_paths: tuple[str, ...]
    manifest_path: str
    video_path: str | None = None
    pdf_path: str | None = None
    qa_warnings: tuple[str, ...] = ()
