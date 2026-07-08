"""Carousel/slideshow planning domain for social slide-based content."""

from content.carousel.contracts import (
    CarouselExportSpec,
    CarouselHook,
    CarouselPlan,
    CarouselRenderResult,
    CarouselSlide,
)
from content.carousel.director import CarouselDirectorOptions, refine_carousel_plan
from content.carousel.planner import build_carousel_plan

__all__ = [
    "CarouselExportSpec",
    "CarouselHook",
    "CarouselPlan",
    "CarouselRenderResult",
    "CarouselSlide",
    "CarouselDirectorOptions",
    "build_carousel_plan",
    "refine_carousel_plan",
    "render_carousel_plan",
]


def __getattr__(name: str):
    if name == "render_carousel_plan":
        from content.carousel.renderer import render_carousel_plan

        return render_carousel_plan
    raise AttributeError(name)
