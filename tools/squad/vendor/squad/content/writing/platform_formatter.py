"""Platform-specific copy formatting and validation.

Takes raw copy from the Content Agent's writing process and formats it
for a specific platform, enforcing length limits, structure rules,
and platform conventions.

Usage:
    from content.writing.platform_formatter import format_for_platform, PlatformContent

    result = format_for_platform(
        headline="Less noise. More signal.",
        body="Your tools should work as hard as you do.",
        cta="Link in bio",
        platform="tiktok",
    )
    print(result.formatted_text)
    print(result.warnings)  # any length/format issues
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Platform specs
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PlatformSpec:
    """Rules and limits for a specific platform."""

    name: str
    max_chars: int  # hard limit
    visible_chars: int  # chars visible before truncation/"more"
    aspect_ratios: tuple[str, ...]  # supported image/video ratios
    hashtag_limit: int  # 0 = no hashtags
    emoji_ok: bool
    cta_required: bool
    thread_capable: bool  # can split into multiple posts
    video_max_seconds: int
    notes: str = ""


def _spec_from_dict(data: dict[str, Any]) -> PlatformSpec:
    """Build a PlatformSpec from a YAML-loaded dict."""
    return PlatformSpec(
        name=data["name"],
        max_chars=int(data["max_chars"]),
        visible_chars=int(data["visible_chars"]),
        aspect_ratios=tuple(data.get("aspect_ratios") or []),
        hashtag_limit=int(data.get("hashtag_limit", 0)),
        emoji_ok=bool(data.get("emoji_ok", False)),
        cta_required=bool(data.get("cta_required", False)),
        thread_capable=bool(data.get("thread_capable", False)),
        video_max_seconds=int(data.get("video_max_seconds", 0)),
        notes=str(data.get("notes", "")),
    )


def _load_platform_specs() -> dict[str, PlatformSpec]:
    """Load platform specs from YAML config, falling back to hardcoded defaults.

    The YAML file is the source of truth for platform specs. Edit
    content/config/platforms.yaml to add new platforms or change limits.
    """
    yaml_path = Path(__file__).parent.parent / "config" / "platforms.yaml"

    if yaml_path.exists():
        try:
            import yaml
            with open(yaml_path) as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                return {k.lower(): _spec_from_dict(v) for k, v in raw.items()}
        except Exception:
            pass  # Fall through to hardcoded defaults

    # Hardcoded fallback — keeps the system running even without PyYAML/YAML file
    return _hardcoded_specs()


def _hardcoded_specs() -> dict[str, PlatformSpec]:
    """Hardcoded platform specs as fallback when YAML is unavailable."""
    return {
        "tiktok": PlatformSpec("TikTok", 2200, 150, ("9:16",), 5, True, True, False, 600,
            "Hook in first 2 words. Captions auto-generated. First-person voice."),
        "instagram_feed": PlatformSpec("Instagram Feed", 2200, 125, ("1:1", "4:5", "16:9"), 10, True, False, False, 90,
            "Caption is secondary to image. Front-load hook before 'more' cutoff."),
        "instagram_story": PlatformSpec("Instagram Story", 500, 500, ("9:16",), 3, True, False, False, 60,
            "3-5 words per text overlay. Swipe-up or link sticker for CTA."),
        "twitter": PlatformSpec("X / Twitter", 280, 280, ("16:9", "1:1"), 0, False, False, True, 140,
            "No hashtags in main tweet. Every character earns its place."),
        "x": PlatformSpec("X / Twitter", 280, 280, ("16:9", "1:1"), 0, False, False, True, 140,
            "No hashtags in main tweet. Every character earns its place."),
        "linkedin": PlatformSpec("LinkedIn", 3000, 210, ("1:1", "16:9", "9:16"), 5, False, False, False, 600,
            "Personal story angle. First line is the hook. 1300 chars sweet spot."),
        "website": PlatformSpec("Website", 10000, 10000, ("16:9", "1:1"), 0, False, True, False, 0,
            "Headline 6-10 words. Subhead 15-25 words. One idea per section."),
        "email": PlatformSpec("Email", 5000, 90, (), 0, False, True, False, 0,
            "Subject: 40 chars. 3 short paragraphs max. One CTA per email."),
        "spotify": PlatformSpec("Spotify", 1500, 200, ("1:1",), 0, False, False, False, 0,
            "Evocative, not descriptive. Sentence fragments. Mood over information."),
        "app_store": PlatformSpec("App Store", 4000, 170, ("9:16",), 0, False, False, False, 30,
            "Benefits first, features second. First line is the value prop."),
    }


# Load once at module import — YAML is the source of truth
PLATFORM_SPECS: dict[str, PlatformSpec] = _load_platform_specs()


# ---------------------------------------------------------------------------
# Formatted output
# ---------------------------------------------------------------------------

@dataclass
class PlatformContent:
    """Copy formatted for a specific platform."""

    platform: str
    formatted_text: str  # the final text, ready to post
    char_count: int
    within_limit: bool
    visible_preview: str  # what shows before truncation

    # Metadata
    headline: str = ""
    body: str = ""
    cta: str = ""
    hashtags: list[str] = field(default_factory=list)

    # Validation
    warnings: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, str | int | bool | list[str]]:
        return {
            "platform": self.platform,
            "formatted_text": self.formatted_text,
            "char_count": self.char_count,
            "within_limit": self.within_limit,
            "visible_preview": self.visible_preview,
            "warnings": self.warnings,
            "suggestions": self.suggestions,
        }


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------

def _count_hashtags(text: str) -> int:
    return len(re.findall(r"#\w+", text))


def _strip_excessive_emoji(text: str, max_emoji: int = 3) -> str:
    """Cap emoji usage. Marketing copy should be words, not pictograms."""
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "]+",
        flags=re.UNICODE,
    )
    matches = list(emoji_pattern.finditer(text))
    if len(matches) <= max_emoji:
        return text
    # Remove emoji beyond the limit
    for match in matches[max_emoji:]:
        text = text.replace(match.group(), "", 1)
    return text.strip()


def format_for_platform(
    *,
    headline: str = "",
    body: str = "",
    cta: str = "",
    hashtags: list[str] | None = None,
    platform: str,
) -> PlatformContent:
    """Format copy for a specific platform. Returns warnings for any issues.

    This function does NOT rewrite copy — it formats, validates, and warns.
    The Content Agent handles rewrites.
    """
    spec = PLATFORM_SPECS.get(platform.lower())
    if spec is None:
        # Unknown platform — return with warning, don't crash
        full_text = "\n\n".join(part for part in [headline, body, cta] if part.strip())
        return PlatformContent(
            platform=platform,
            formatted_text=full_text,
            char_count=len(full_text),
            within_limit=True,
            visible_preview=full_text[:200],
            headline=headline,
            body=body,
            cta=cta,
            warnings=[f"Unknown platform '{platform}' — no formatting rules applied"],
        )

    tags = hashtags or []
    warnings: list[str] = []
    suggestions: list[str] = []

    # --- Platform-specific assembly ---
    if platform.lower() in ("twitter", "x"):
        # Twitter: single block, no structure, maximum compression
        parts = [p for p in [headline, body, cta] if p.strip()]
        full_text = " ".join(parts)
        if tags:
            warnings.append("Hashtags in main tweet look spammy per our style guide. Removing.")
            tags = []

    elif platform.lower() == "email":
        # Email: subject line + body + CTA
        full_text = body.strip()
        if cta:
            full_text += f"\n\n{cta}"
        if headline and len(headline) > 60:
            warnings.append(f"Email subject line is {len(headline)} chars (target: <40). Tighten it.")
        if body.count("\n\n") > 4:
            suggestions.append("Email has many paragraphs. Consider condensing to 3 max.")

    elif platform.lower() in ("tiktok", "instagram_feed", "instagram_story"):
        # Social: hook-first, hashtags at end
        parts = [p for p in [body, cta] if p.strip()]
        full_text = "\n\n".join(parts)
        if tags:
            tag_str = " ".join(f"#{t.lstrip('#')}" for t in tags[: spec.hashtag_limit])
            full_text += f"\n\n{tag_str}"
            if len(tags) > spec.hashtag_limit:
                warnings.append(
                    f"Trimmed hashtags to {spec.hashtag_limit} (platform limit). "
                    f"Dropped: {', '.join(tags[spec.hashtag_limit:])}"
                )

    elif platform.lower() == "website":
        # Website: structured — headline, subhead/body, CTA
        parts = []
        if headline:
            parts.append(headline)
        if body:
            parts.append(body)
        if cta:
            parts.append(cta)
        full_text = "\n\n".join(parts)

        # Website-specific validation
        headline_words = len(headline.split()) if headline else 0
        if headline and (headline_words < 3 or headline_words > 12):
            suggestions.append(f"Headline is {headline_words} words (sweet spot: 6-10).")

    elif platform.lower() == "linkedin":
        # LinkedIn: hook line, then body, then CTA
        parts = [p for p in [headline, body, cta] if p.strip()]
        full_text = "\n\n".join(parts)
        if tags:
            tag_str = " ".join(f"#{t.lstrip('#')}" for t in tags[: spec.hashtag_limit])
            full_text += f"\n\n{tag_str}"

        # LinkedIn sweet spot
        if len(full_text) > 1500:
            suggestions.append("LinkedIn posts perform best under 1300 chars. Consider trimming.")

    else:
        # Default assembly
        parts = [p for p in [headline, body, cta] if p.strip()]
        full_text = "\n\n".join(parts)
        if tags:
            tag_str = " ".join(f"#{t.lstrip('#')}" for t in tags[: spec.hashtag_limit])
            full_text += f"\n\n{tag_str}"

    # --- Emoji check ---
    if not spec.emoji_ok:
        emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"
            "\U0001F300-\U0001F5FF"
            "\U0001F680-\U0001F6FF"
            "\U0001F1E0-\U0001F1FF"
            "]+",
            flags=re.UNICODE,
        )
        if emoji_pattern.search(full_text):
            suggestions.append(f"Emoji not recommended for {spec.name}. Consider removing.")

    # --- Length check ---
    char_count = len(full_text)
    within_limit = char_count <= spec.max_chars

    if not within_limit:
        warnings.append(
            f"Text is {char_count} chars, exceeds {spec.name} limit of {spec.max_chars}. "
            f"Must cut {char_count - spec.max_chars} chars."
        )

    # --- CTA check ---
    if spec.cta_required and not cta.strip():
        warnings.append(f"{spec.name} content should have a clear CTA.")

    # --- Visible preview ---
    visible_preview = full_text[: spec.visible_chars]
    if len(full_text) > spec.visible_chars:
        visible_preview += "..."

    # --- Hook check (social platforms) ---
    social_platforms = {"tiktok", "instagram_feed", "instagram_story"}
    if platform.lower() in social_platforms:
        first_line = full_text.split("\n")[0].strip()
        if len(first_line) > spec.visible_chars:
            warnings.append(
                f"First line ({len(first_line)} chars) exceeds visible preview "
                f"({spec.visible_chars} chars). Hook gets cut off."
            )

    return PlatformContent(
        platform=platform,
        formatted_text=full_text,
        char_count=char_count,
        within_limit=within_limit,
        visible_preview=visible_preview,
        headline=headline,
        body=body,
        cta=cta,
        hashtags=tags,
        warnings=warnings,
        suggestions=suggestions,
    )


def get_platform_spec(platform: str) -> PlatformSpec | None:
    """Get the spec for a platform. Returns None if unknown."""
    return PLATFORM_SPECS.get(platform.lower())


def supported_platforms() -> list[str]:
    """Return list of all supported platform names."""
    return sorted(set(PLATFORM_SPECS.keys()) - {"x"})  # dedupe x/twitter
