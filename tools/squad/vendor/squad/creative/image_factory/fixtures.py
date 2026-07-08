"""Canonical image-only fixture briefs for Sprint 1 hardening."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ImageFixtureBrief:
    id: str
    name: str
    product_type: str
    product_description: str
    campaign_goal: str
    platform: str
    style_family: str
    mood_keywords: tuple[str, ...]
    expected_template: str
    expected_aspect_ratio: str
    max_cost_usd: float
    must_include: tuple[str, ...] = field(default_factory=tuple)
    must_not_include: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.id.strip():
            raise ValueError("fixture id must not be empty")
        if not self.name.strip():
            raise ValueError("fixture name must not be empty")
        if not self.product_type.strip():
            raise ValueError("product_type must not be empty")
        if not self.product_description.strip():
            raise ValueError("product_description must not be empty")
        if not self.campaign_goal.strip():
            raise ValueError("campaign_goal must not be empty")
        if not self.platform.strip():
            raise ValueError("platform must not be empty")
        if not self.style_family.strip():
            raise ValueError("style_family must not be empty")
        if not self.expected_template.strip():
            raise ValueError("expected_template must not be empty")
        if not self.expected_aspect_ratio.strip():
            raise ValueError("expected_aspect_ratio must not be empty")
        if float(self.max_cost_usd) <= 0.0:
            raise ValueError("max_cost_usd must be positive")
        if not self.mood_keywords:
            raise ValueError("mood_keywords must not be empty")


IMAGE_FIXTURE_BRIEFS: dict[str, ImageFixtureBrief] = {
    "BRIEF-001": ImageFixtureBrief(
        id="BRIEF-001",
        name="App Launch IG Post",
        product_type="app",
        product_description=(
            "Mobile productivity app with clean dark UI, teal accent color, "
            "shows a task dashboard with 3 completed tasks"
        ),
        campaign_goal="Drive app store downloads from Instagram",
        platform="instagram_feed",
        style_family="EDITORIAL",
        mood_keywords=("clean", "professional", "sharp"),
        expected_template="app_in_hand",
        expected_aspect_ratio="1:1",
        must_include=("phone/device visible", "app UI readable", "1:1 square format"),
        must_not_include=("hands with wrong finger count", "garbled text on screen"),
        max_cost_usd=0.10,
    ),
    "BRIEF-002": ImageFixtureBrief(
        id="BRIEF-002",
        name="Merch Drop Product Shot",
        product_type="merch",
        product_description="Black oversized tshirt with white abstract geometric logo on front",
        campaign_goal="Generate hype for limited merch drop with a static hero visual",
        platform="instagram_feed",
        style_family="BRUTALIST",
        mood_keywords=("dark", "edgy", "minimal"),
        expected_template="product_on_scene",
        expected_aspect_ratio="1:1",
        must_include=("tshirt design visible", "clear focal point", "high contrast mood"),
        must_not_include=("colorful/warm tones", "friendly/playful energy"),
        max_cost_usd=0.12,
    ),
    "BRIEF-003": ImageFixtureBrief(
        id="BRIEF-003",
        name="Single Release Album Art",
        product_type="music",
        product_description="Indie electronic single called Midnight Frequency, moody and synth-heavy",
        campaign_goal="Build anticipation for single release with platform-ready cover art",
        platform="spotify",
        style_family="PSYCHEDELIC",
        mood_keywords=("trippy", "colorful", "cosmic"),
        expected_template="social_thumb",
        expected_aspect_ratio="1:1",
        must_include=("1:1 square", "psychedelic color palette", "clear thumbnail impact"),
        must_not_include=("text/words in image", "realistic photography look"),
        max_cost_usd=0.15,
    ),
    "BRIEF-004": ImageFixtureBrief(
        id="BRIEF-004",
        name="Feature Showcase Hero",
        product_type="app",
        product_description=(
            "AI writing assistant app showing a real-time suggestion feature "
            "with purple highlight on suggested text"
        ),
        campaign_goal="Highlight a new feature for the website landing page",
        platform="website",
        style_family="PREMIUM",
        mood_keywords=("luxury", "sleek", "premium"),
        expected_template="hero_banner",
        expected_aspect_ratio="16:9",
        must_include=("16:9 landscape", "phone/device with app", "premium lighting"),
        must_not_include=("cluttered background", "multiple devices competing for attention"),
        max_cost_usd=0.10,
    ),
}
