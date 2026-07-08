"""
Structured Prompt Template Registry — Machine-Readable Format

This file is the implementation-ready version of the prompt template library.
The Creative Director agent imports these dataclasses and uses them directly.

Usage:
    from prompt_templates.TEMPLATES_STRUCTURED import IMAGE_TEMPLATES, VIDEO_TEMPLATES
    template = IMAGE_TEMPLATES["IMG-PP-001"]
    filled = template.fill(product_description="Black graphic tshirt with abstract logo", ...)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class StyleFamily(str, Enum):
    BRUTALIST = "BRUTALIST"
    ART_CULTURE = "ART_CULTURE"
    ART_CULTURE_KANYE = "ART_CULTURE_KANYE"
    ART_CULTURE_FRANK_OCEAN = "ART_CULTURE_FRANK_OCEAN"
    ART_CULTURE_FADER = "ART_CULTURE_FADER"
    ART_CULTURE_WES_ANDERSON = "ART_CULTURE_WES_ANDERSON"
    PSYCHEDELIC = "PSYCHEDELIC"
    EDITORIAL = "EDITORIAL"
    PREMIUM = "PREMIUM"
    UGC = "UGC"


class TemplateCategory(str, Enum):
    PRODUCT_PLACEMENT = "product_placement"
    HERO_BANNER = "hero_banner"
    SOCIAL_MEDIA = "social_media"
    MERCH = "merch"
    APP = "app"
    MUSIC = "music"
    ABSTRACT = "abstract"
    VIDEO_I2V = "video_i2v"
    VIDEO_T2V = "video_t2v"
    VOICEOVER = "voiceover"
    AUDIO_MIX = "audio_mix"
    CAPTION = "caption"


class ModelID(str, Enum):
    FLUX_2_PRO = "fal-ai/flux-pro/v1.1-ultra"
    FLUX_2_DEV = "fal-ai/flux/dev"
    FLUX_SCHNELL = "fal-ai/flux/schnell"
    GPT_IMAGE_15 = "gpt-image-1.5"  # OpenAI — used when text/UI precision needed
    IDEOGRAM_3 = "ideogram-3.0"  # Best text rendering
    KLING_25_TURBO = "fal-ai/kling-video/v2.5/turbo"
    KLING_3_STANDARD = "fal-ai/kling-video/v3/standard"
    VEO_31 = "veo-3.1"  # Google — complex motion
    ELEVENLABS = "elevenlabs"  # Via MCP


class AspectRatio(str, Enum):
    SQUARE = "1:1"
    LANDSCAPE = "16:9"
    PORTRAIT = "9:16"
    VARIES = "varies"


class MotionIntensity(str, Enum):
    LOW = "low"
    LOW_MEDIUM = "low-medium"
    MEDIUM = "medium"
    HIGH = "high"


class EnergyLevel(str, Enum):
    LOW = "low"
    LOW_MEDIUM = "low-medium"
    MEDIUM = "medium"
    HIGH = "high"
    VARIES = "varies"


# ---------------------------------------------------------------------------
# Style family modifier sets (imported from 00_STYLE_SYSTEM.md)
# ---------------------------------------------------------------------------

STYLE_MODIFIERS: dict[StyleFamily, str] = {
    StyleFamily.BRUTALIST: (
        "brutalist architecture, harsh directional lighting, deep shadows, "
        "monochrome palette, high contrast, industrial textures, concrete, "
        "steel, matte black, sans-serif typography, negative space, "
        "grainy film texture, desaturated, cold tones, clinical precision"
    ),
    StyleFamily.ART_CULTURE_KANYE: (
        "muted earth tones, oversized proportions, desert landscape, "
        "architectural minimalism, neutral palette, raw materials, "
        "fashion photography, editorial lighting, stark composition, "
        "deliberate imperfection, museum-quality framing"
    ),
    StyleFamily.ART_CULTURE_FRANK_OCEAN: (
        "analog film grain, golden hour warmth, nostalgic color palette, "
        "soft focus, intimate framing, quiet luxury, muted pastels, "
        "vintage texture, contemplative mood, natural light, "
        "Kodak Portra 400 look, shallow depth of field"
    ),
    StyleFamily.ART_CULTURE_FADER: (
        "high-fashion meets street, flash photography, raw energy, "
        "editorial crop, bold eye contact, urban environment, "
        "mixed media texture, print magazine quality, "
        "candid yet composed, cultural moment captured"
    ),
    StyleFamily.ART_CULTURE_WES_ANDERSON: (
        "perfect symmetry, pastel color palette, centered composition, "
        "retro typography, whimsical precision, vintage set design, "
        "flat lighting, deadpan framing, miniature quality, "
        "meticulous production design, complementary color pairs"
    ),
    StyleFamily.PSYCHEDELIC: (
        "psychedelic color swirls, iridescent gradients, kaleidoscopic patterns, "
        "retro-futurist aesthetic, chrome reflections, liquid color, "
        "70s color palette, analog synthesizer visuals, "
        "warped perspective, double exposure, prismatic light, "
        "neon accents, holographic sheen, melting forms, "
        "cosmic backdrop, sunset gradients, aurora colors"
    ),
    StyleFamily.EDITORIAL: (
        "studio lighting, clean background, editorial photography, "
        "sharp focus, precise composition, modern minimalism, "
        "controlled color palette, professional grade, magazine quality, "
        "dramatic lighting, soft shadows, product hero shot, "
        "negative space, grid-aligned, thoughtful typography placement"
    ),
    StyleFamily.PREMIUM: (
        "premium product photography, soft studio lighting, "
        "warm neutral tones, brushed metal, frosted glass, "
        "minimal composition, luxury materials, "
        "subtle gradient backgrounds, ambient occlusion, "
        "3D render quality, floating product, "
        "clean reflections, depth of field, warm highlights, cool shadows"
    ),
    StyleFamily.UGC: (
        "iPhone photography, natural lighting, casual composition, "
        "authentic moment, real person, unposed, "
        "slight motion blur, selfie angle, front-facing camera, "
        "ring light reflection in eyes, bedroom/kitchen/car setting, "
        "handheld camera feel, vertical framing (9:16), "
        "real skin texture, imperfect lighting, genuine expression"
    ),
}

# Convenience alias — ART_CULTURE resolves to FADER as default
STYLE_MODIFIERS[StyleFamily.ART_CULTURE] = STYLE_MODIFIERS[StyleFamily.ART_CULTURE_FADER]

STYLE_NEGATIVES: dict[StyleFamily, str] = {
    StyleFamily.BRUTALIST: "colorful, warm, friendly, soft, rounded, cute, playful, saturated, organic shapes, nature, flowers, smiling",
    StyleFamily.ART_CULTURE: "generic stock photo, corporate, sterile, clipart quality, over-processed, HDR look, lens flare, generic background",
    StyleFamily.ART_CULTURE_KANYE: "generic stock photo, corporate, sterile, clipart quality, over-processed, HDR look, lens flare, generic background",
    StyleFamily.ART_CULTURE_FRANK_OCEAN: "generic stock photo, corporate, sterile, clipart quality, over-processed, HDR look, lens flare, generic background",
    StyleFamily.ART_CULTURE_FADER: "generic stock photo, corporate, sterile, clipart quality, over-processed, HDR look, lens flare, generic background",
    StyleFamily.ART_CULTURE_WES_ANDERSON: "generic stock photo, corporate, sterile, clipart quality, over-processed, HDR look, lens flare, generic background",
    StyleFamily.PSYCHEDELIC: "boring, static, flat, corporate, minimal, monochrome, standard photography, realistic lighting, mundane",
    StyleFamily.EDITORIAL: "cluttered, busy, amateur, low resolution, noisy, over-saturated, chaotic, unintentional blur, messy composition",
    StyleFamily.PREMIUM: "cheap, plastic, flat lighting, cluttered, busy background, stock photo, generic, low-end, discount feel",
    StyleFamily.UGC: "studio lighting, perfect composition, professional model, airbrushed skin, stock photo, corporate, staged, symmetrical, over-produced, magazine quality",
}


# ---------------------------------------------------------------------------
# Core dataclasses
# ---------------------------------------------------------------------------

@dataclass
class PromptTemplate:
    """A single image generation prompt template."""
    id: str
    name: str
    category: TemplateCategory
    use_case: str
    style_families: list[StyleFamily]
    model: ModelID
    alt_models: list[ModelID] = field(default_factory=list)
    ref_image_slots: int = 0  # how many reference images this template expects
    aspect_ratio: AspectRatio = AspectRatio.SQUARE
    prompt_template: str = ""  # string with {placeholders}
    required_vars: list[str] = field(default_factory=list)
    optional_vars: list[str] = field(default_factory=list)
    negative_prompt: str = ""
    examples: list[str] = field(default_factory=list)

    def fill(self, style: StyleFamily, **kwargs: str) -> dict:
        """Fill template with variables and style modifiers. Returns ready-to-send payload."""
        style_mods = STYLE_MODIFIERS.get(style, "")
        style_neg = STYLE_NEGATIVES.get(style, "")
        kwargs["style_family_modifiers"] = style_mods

        prompt = self.prompt_template
        for key, value in kwargs.items():
            prompt = prompt.replace(f"{{{key}}}", value)

        negative = f"{self.negative_prompt}, {style_neg}".strip(", ")

        return {
            "template_id": self.id,
            "prompt": prompt,
            "negative_prompt": negative,
            "model": self.model.value,
            "aspect_ratio": self.aspect_ratio.value,
            "style_family": style.value,
            "ref_image_slots": self.ref_image_slots,
            "unfilled_vars": [v for v in self.required_vars if f"{{{v}}}" in prompt],
        }


@dataclass
class VideoTemplate:
    """A video generation prompt template."""
    id: str
    name: str
    category: TemplateCategory
    use_case: str
    style_families: list[StyleFamily]
    model: ModelID
    alt_models: list[ModelID] = field(default_factory=list)
    motion_intensity: MotionIntensity = MotionIntensity.LOW
    camera: str = ""
    duration_range: tuple[int, int] = (4, 8)  # seconds
    prompt_template: str = ""
    required_vars: list[str] = field(default_factory=list)
    optional_vars: list[str] = field(default_factory=list)
    requires_input_image: bool = False
    examples: list[str] = field(default_factory=list)

    def fill(self, **kwargs: str) -> dict:
        prompt = self.prompt_template
        for key, value in kwargs.items():
            prompt = prompt.replace(f"{{{key}}}", value)
        return {
            "template_id": self.id,
            "prompt": prompt,
            "model": self.model.value,
            "motion_intensity": self.motion_intensity.value,
            "requires_input_image": self.requires_input_image,
            "duration_range": self.duration_range,
            "unfilled_vars": [v for v in self.required_vars if f"{{{v}}}" in prompt],
        }


@dataclass
class VoiceoverTemplate:
    """A voiceover script template."""
    id: str
    name: str
    use_case: str
    energy: EnergyLevel
    voice_direction: str
    script_template: str
    required_vars: list[str] = field(default_factory=list)
    examples: list[dict] = field(default_factory=list)


@dataclass
class AudioMixSpec:
    """Audio mixing specification."""
    id: str
    name: str
    voice_volume_db: float = 0.0
    music_volume_db: Optional[float] = -15.0
    music_duck: bool = True
    duck_amount_db: float = -6.0
    fade_in_s: float = 1.5
    fade_out_s: float = 2.0
    voice_delay_s: float = 1.5
    note: str = ""


@dataclass
class CaptionStyle:
    """Caption/subtitle style spec."""
    id: str
    name: str
    font: str
    size: str
    color: str
    position: str
    animation: str
    case: str
    background: str = ""
    highlight_color: str = ""


# ---------------------------------------------------------------------------
# IMAGE TEMPLATES (18)
# ---------------------------------------------------------------------------

IMAGE_TEMPLATES: dict[str, PromptTemplate] = {

    # --- Product Placement ---
    "IMG-PP-001": PromptTemplate(
        id="IMG-PP-001",
        name="Product on Icon",
        category=TemplateCategory.PRODUCT_PLACEMENT,
        use_case="Product on/with a famous figure archetype in a scene",
        style_families=list(StyleFamily),
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "{product_description} {worn_by_or_held_by} {figure_description} "
            "standing in {scene_description}. "
            "{style_family_modifiers}. "
            "Shot on {camera_description}. {additional_mood}."
        ),
        required_vars=["product_description", "worn_by_or_held_by", "figure_description", "scene_description"],
        optional_vars=["camera_description", "additional_mood"],
        negative_prompt="blurry, low quality, distorted, watermark, extra fingers, deformed",
        examples=[
            "Black graphic tshirt with abstract logo worn by a tall figure in a desert landscape, muted earth tones, oversized proportions, architectural minimalism, editorial lighting. Shot on Hasselblad medium format. Quiet power.",
            "Mobile app displayed on iPhone 16 Pro held by a woman on a rooftop at golden hour, analog film grain, nostalgic color palette, soft focus, intimate framing. Shot on Kodak Portra 400. Contemplative mood.",
        ],
    ),

    "IMG-PP-002": PromptTemplate(
        id="IMG-PP-002",
        name="Product in Environment",
        category=TemplateCategory.PRODUCT_PLACEMENT,
        use_case="Product naturally existing in a designed environment",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM, StyleFamily.ART_CULTURE],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "{product_description} placed in {environment_description}. "
            "{lighting_description}. {material_textures}. "
            "{style_family_modifiers}. "
            "Negative space emphasized. Product is the focal point."
        ),
        required_vars=["product_description", "environment_description"],
        optional_vars=["lighting_description", "material_textures"],
        negative_prompt="cluttered, cheap looking, plastic, stock photo, generic",
    ),

    "IMG-PP-003": PromptTemplate(
        id="IMG-PP-003",
        name="Product in Action",
        category=TemplateCategory.PRODUCT_PLACEMENT,
        use_case="Someone actively using/wearing/interacting with the product",
        style_families=[StyleFamily.UGC, StyleFamily.ART_CULTURE, StyleFamily.EDITORIAL],
        model=ModelID.FLUX_2_DEV,
        ref_image_slots=1,
        prompt_template=(
            "{person_description} {action_with_product} in {setting}. "
            "{emotion_and_energy}. {style_family_modifiers}. "
            "{camera_angle_and_quality}."
        ),
        required_vars=["person_description", "action_with_product", "setting"],
        optional_vars=["emotion_and_energy", "camera_angle_and_quality"],
        negative_prompt="posed, stiff, stock photo, generic background, fake smile",
    ),

    "IMG-PP-004": PromptTemplate(
        id="IMG-PP-004",
        name="Product Flat Lay",
        category=TemplateCategory.PRODUCT_PLACEMENT,
        use_case="Product arranged with complementary objects",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM, StyleFamily.ART_CULTURE_WES_ANDERSON],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "Overhead flat lay arrangement: {product_description} centered, "
            "surrounded by {complementary_objects}. "
            "{surface_material}. {lighting}. {style_family_modifiers}. "
            "{color_coordination_notes}."
        ),
        required_vars=["product_description", "complementary_objects"],
        optional_vars=["surface_material", "lighting", "color_coordination_notes"],
        negative_prompt="messy, cluttered, cheap surface, uncoordinated colors",
    ),

    # --- Hero / Banner ---
    "IMG-HE-001": PromptTemplate(
        id="IMG-HE-001",
        name="App/Marketing Hero",
        category=TemplateCategory.HERO_BANNER,
        use_case="Hero image for app store, website, or ad",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM],
        model=ModelID.FLUX_2_PRO,
        alt_models=[ModelID.GPT_IMAGE_15],
        ref_image_slots=1,
        aspect_ratio=AspectRatio.LANDSCAPE,
        prompt_template=(
            "Marketing hero image: {product_description} displayed prominently "
            "against {background_style}. {device_if_app}. "
            "{style_family_modifiers}. Magazine advertisement quality. "
            "Bold, clean, immediate impact. {color_scheme}."
        ),
        required_vars=["product_description", "background_style"],
        optional_vars=["device_if_app", "color_scheme"],
        negative_prompt="busy background, cluttered, low resolution, cheap",
    ),

    "IMG-HE-002": PromptTemplate(
        id="IMG-HE-002",
        name="Cinematic Wide Hero",
        category=TemplateCategory.HERO_BANNER,
        use_case="Website hero, YouTube thumbnail, X header",
        style_families=[StyleFamily.BRUTALIST, StyleFamily.ART_CULTURE, StyleFamily.PSYCHEDELIC],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        aspect_ratio=AspectRatio.LANDSCAPE,
        prompt_template=(
            "Cinematic wide shot (16:9): {scene_description} with {product_integration}. "
            "{dramatic_lighting}. {atmospheric_elements}. "
            "{style_family_modifiers}. Film still quality. Anamorphic lens feel."
        ),
        required_vars=["scene_description", "product_integration"],
        optional_vars=["dramatic_lighting", "atmospheric_elements"],
        negative_prompt="flat, boring, daytime, evenly lit, standard composition",
    ),

    "IMG-HE-003": PromptTemplate(
        id="IMG-HE-003",
        name="Split / Before-After",
        category=TemplateCategory.HERO_BANNER,
        use_case="Transformation, comparison, feature showcase",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM],
        model=ModelID.GPT_IMAGE_15,
        ref_image_slots=2,
        aspect_ratio=AspectRatio.LANDSCAPE,
        prompt_template=(
            "Split composition image: left side shows {before_state}, "
            "right side shows {after_state}. "
            "Clean dividing line. {style_family_modifiers}. "
            "Both sides same {consistent_element} for visual continuity."
        ),
        required_vars=["before_state", "after_state"],
        optional_vars=["consistent_element"],
        negative_prompt="uneven split, inconsistent lighting between sides, messy border",
    ),

    # --- Social Media ---
    "IMG-SO-001": PromptTemplate(
        id="IMG-SO-001",
        name="Instagram Square",
        category=TemplateCategory.SOCIAL_MEDIA,
        use_case="Instagram feed post (1:1)",
        style_families=list(StyleFamily),
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        aspect_ratio=AspectRatio.SQUARE,
        prompt_template=(
            "Square format (1:1): {subject_description}. "
            "{style_family_modifiers}. "
            "Instagram-optimized: strong visual hook, "
            "works at thumbnail size, {color_pop_element}. "
            "{mood_and_energy}."
        ),
        required_vars=["subject_description"],
        optional_vars=["color_pop_element", "mood_and_energy"],
        negative_prompt="text heavy, too much detail that gets lost at small size, dull",
    ),

    "IMG-SO-002": PromptTemplate(
        id="IMG-SO-002",
        name="Vertical Story/Reel",
        category=TemplateCategory.SOCIAL_MEDIA,
        use_case="Instagram Story, TikTok, Reel cover (9:16)",
        style_families=[StyleFamily.UGC, StyleFamily.ART_CULTURE, StyleFamily.PSYCHEDELIC],
        model=ModelID.FLUX_2_DEV,
        ref_image_slots=1,
        aspect_ratio=AspectRatio.PORTRAIT,
        prompt_template=(
            "Vertical format (9:16): {subject_description}. "
            "{style_family_modifiers}. "
            "Full bleed, no margins. Space for text overlay in {text_zone}. "
            "{energy_level}: {energy_description}."
        ),
        required_vars=["subject_description"],
        optional_vars=["text_zone", "energy_level", "energy_description"],
        negative_prompt="horizontal composition, empty corners, too much negative space for vertical",
    ),

    "IMG-SO-003": PromptTemplate(
        id="IMG-SO-003",
        name="X/Twitter Card",
        category=TemplateCategory.SOCIAL_MEDIA,
        use_case="Tweet image, link preview (16:9)",
        style_families=list(StyleFamily),
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        aspect_ratio=AspectRatio.LANDSCAPE,
        prompt_template=(
            "Compact 16:9 image: {subject_description}. "
            "{style_family_modifiers}. "
            "Immediately readable at small size. "
            "{one_clear_focal_point}. Bold contrast. "
            "Works against both light and dark Twitter backgrounds."
        ),
        required_vars=["subject_description"],
        optional_vars=["one_clear_focal_point"],
        negative_prompt="subtle, low contrast, too much detail, hard to read at thumbnail size",
    ),

    # --- Merch ---
    "IMG-MR-001": PromptTemplate(
        id="IMG-MR-001",
        name="T-Shirt On Person",
        category=TemplateCategory.MERCH,
        use_case="E-commerce, social merch promo",
        style_families=[StyleFamily.ART_CULTURE, StyleFamily.EDITORIAL, StyleFamily.UGC],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "{person_description} wearing {tshirt_description} in {setting}. "
            "{pose_description}. {style_family_modifiers}. "
            "Tshirt design clearly visible. Natural fabric draping. "
            "{camera_and_lighting}."
        ),
        required_vars=["person_description", "tshirt_description", "setting"],
        optional_vars=["pose_description", "camera_and_lighting"],
        negative_prompt="stiff pose, mannequin, flat tshirt, distorted design, floating fabric",
    ),

    "IMG-MR-002": PromptTemplate(
        id="IMG-MR-002",
        name="T-Shirt Flat/Folded",
        category=TemplateCategory.MERCH,
        use_case="Product listing, clean showcase",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM, StyleFamily.BRUTALIST],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "{tshirt_description} {flat_or_folded} on {surface}. "
            "{complementary_props}. {style_family_modifiers}. "
            "Design details crisp and legible. {lighting_direction}."
        ),
        required_vars=["tshirt_description", "flat_or_folded", "surface"],
        optional_vars=["complementary_props", "lighting_direction"],
        negative_prompt="wrinkled, cheap fabric look, blurry design, generic white background",
    ),

    "IMG-MR-003": PromptTemplate(
        id="IMG-MR-003",
        name="Merch Collection",
        category=TemplateCategory.MERCH,
        use_case="Collection launch, lookbook",
        style_families=[StyleFamily.ART_CULTURE_WES_ANDERSON, StyleFamily.EDITORIAL],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=3,
        prompt_template=(
            "Collection display: {items_description} arranged {arrangement_style} "
            "in {environment}. {style_family_modifiers}. "
            "Every item distinct yet cohesive. {color_story}."
        ),
        required_vars=["items_description", "arrangement_style", "environment"],
        optional_vars=["color_story"],
        negative_prompt="messy, cramped, uncoordinated, random placement",
    ),

    # --- App ---
    "IMG-AP-001": PromptTemplate(
        id="IMG-AP-001",
        name="App in Hand",
        category=TemplateCategory.APP,
        use_case="App marketing, social proof",
        style_families=[StyleFamily.UGC, StyleFamily.PREMIUM, StyleFamily.EDITORIAL],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        prompt_template=(
            "{person_description} holding {phone_model} displaying {app_screen_description} "
            "in {setting}. {expression_and_emotion}. "
            "Screen clearly visible and readable. {style_family_modifiers}. "
            "{lighting_and_camera}."
        ),
        required_vars=["app_screen_description", "setting"],
        optional_vars=["person_description", "phone_model", "expression_and_emotion", "lighting_and_camera"],
        negative_prompt="blurry screen, unreadable UI, extra fingers, distorted phone shape",
    ),

    "IMG-AP-002": PromptTemplate(
        id="IMG-AP-002",
        name="App Feature Showcase",
        category=TemplateCategory.APP,
        use_case="Feature announcement, app store screenshots",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM],
        model=ModelID.GPT_IMAGE_15,
        ref_image_slots=1,
        prompt_template=(
            "App feature showcase: {phone_model} showing {feature_screen} "
            "with {visual_callout_description}. "
            "{background_style}. {style_family_modifiers}. "
            "UI elements sharp and legible. {supporting_visual_elements}."
        ),
        required_vars=["feature_screen"],
        optional_vars=["phone_model", "visual_callout_description", "background_style", "supporting_visual_elements"],
        negative_prompt="blurry UI, unreadable text, distorted interface, cheap mockup feel",
    ),

    # --- Music ---
    "IMG-MU-001": PromptTemplate(
        id="IMG-MU-001",
        name="Album/Single Art",
        category=TemplateCategory.MUSIC,
        use_case="Album cover, single artwork, playlist cover",
        style_families=[StyleFamily.BRUTALIST, StyleFamily.ART_CULTURE, StyleFamily.PSYCHEDELIC],
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=1,
        aspect_ratio=AspectRatio.SQUARE,
        prompt_template=(
            "Album artwork (1:1 square): {visual_concept}. "
            "{mood_and_emotion}. {style_family_modifiers}. "
            "{color_palette_specific}. "
            "Iconic, immediate recognition. Works at 300x300px and 3000x3000px."
        ),
        required_vars=["visual_concept"],
        optional_vars=["mood_and_emotion", "color_palette_specific"],
        negative_prompt="generic, stock photo, clip art, 3D render, cheesy, over-designed",
    ),

    "IMG-MU-002": PromptTemplate(
        id="IMG-MU-002",
        name="Artist Promo Shot",
        category=TemplateCategory.MUSIC,
        use_case="Spotify profile, press kit, social promo",
        style_families=[StyleFamily.ART_CULTURE, StyleFamily.EDITORIAL, StyleFamily.BRUTALIST],
        model=ModelID.FLUX_2_PRO,
        alt_models=[ModelID.FLUX_2_DEV],
        ref_image_slots=1,
        prompt_template=(
            "Artist promotional photo: {artist_description} in {setting}. "
            "{pose_and_energy}. {style_family_modifiers}. "
            "{camera_specs}. Press kit quality. "
            "Conveys {genre_and_mood} without text."
        ),
        required_vars=["artist_description", "setting"],
        optional_vars=["pose_and_energy", "camera_specs", "genre_and_mood"],
        negative_prompt="amateur, bad lighting, generic background, yearbook photo",
    ),

    "IMG-MU-003": PromptTemplate(
        id="IMG-MU-003",
        name="Tour/Event Poster",
        category=TemplateCategory.MUSIC,
        use_case="Show announcement, event promo",
        style_families=[StyleFamily.PSYCHEDELIC, StyleFamily.BRUTALIST, StyleFamily.ART_CULTURE],
        model=ModelID.IDEOGRAM_3,
        alt_models=[ModelID.FLUX_2_PRO],
        ref_image_slots=0,
        aspect_ratio=AspectRatio.PORTRAIT,
        prompt_template=(
            "Concert/event poster design: {visual_concept} for {event_description}. "
            "{style_family_modifiers}. "
            "Space for event details in {text_zone}. "
            "{era_reference}: {decade_or_movement_influence}. "
            "Collectable design quality."
        ),
        required_vars=["visual_concept", "event_description"],
        optional_vars=["text_zone", "era_reference", "decade_or_movement_influence"],
        negative_prompt="corporate event, PowerPoint, clip art, generic template",
    ),

    # --- Abstract ---
    "IMG-AB-001": PromptTemplate(
        id="IMG-AB-001",
        name="Texture/Pattern Background",
        category=TemplateCategory.ABSTRACT,
        use_case="Story backgrounds, website textures, content backgrounds",
        style_families=list(StyleFamily),
        model=ModelID.FLUX_SCHNELL,
        ref_image_slots=0,
        prompt_template=(
            "Abstract {texture_type} pattern: {description}. "
            "{style_family_modifiers}. {color_palette}. "
            "Seamless, tileable. Works as background with text overlay."
        ),
        required_vars=["texture_type", "description"],
        optional_vars=["color_palette"],
        negative_prompt="busy, chaotic, overwhelming, distracting from foreground content",
    ),

    "IMG-AB-002": PromptTemplate(
        id="IMG-AB-002",
        name="Mood/Concept Visual",
        category=TemplateCategory.ABSTRACT,
        use_case="Campaign mood boards, visual identity exploration",
        style_families=list(StyleFamily),
        model=ModelID.FLUX_2_PRO,
        ref_image_slots=0,
        prompt_template=(
            "Conceptual mood image: {emotion_or_concept} visualized as {metaphor}. "
            "{style_family_modifiers}. "
            "No text, no product. Pure feeling. {color_story}."
        ),
        required_vars=["emotion_or_concept", "metaphor"],
        optional_vars=["color_story"],
        negative_prompt="literal, obvious, cliché, stock photo, generic metaphor",
    ),
}


# ---------------------------------------------------------------------------
# VIDEO TEMPLATES (7)
# ---------------------------------------------------------------------------

VIDEO_TEMPLATES: dict[str, VideoTemplate] = {

    # --- Image-to-Video ---
    "VID-I2V-001": VideoTemplate(
        id="VID-I2V-001",
        name="Slow Reveal",
        category=TemplateCategory.VIDEO_I2V,
        use_case="Hero product reveal, dramatic intro",
        style_families=[StyleFamily.BRUTALIST, StyleFamily.EDITORIAL, StyleFamily.PREMIUM],
        model=ModelID.KLING_25_TURBO,
        alt_models=[ModelID.KLING_3_STANDARD],
        motion_intensity=MotionIntensity.LOW,
        camera="push-in, slow zoom",
        duration_range=(5, 8),
        requires_input_image=True,
        prompt_template=(
            "Slow camera push-in toward {subject}. Subtle atmospheric movement: "
            "{atmospheric_detail}. {lighting_shift}. "
            "Cinematic, controlled, deliberate. {duration}."
        ),
        required_vars=["subject"],
        optional_vars=["atmospheric_detail", "lighting_shift", "duration"],
    ),

    "VID-I2V-002": VideoTemplate(
        id="VID-I2V-002",
        name="Living Moment",
        category=TemplateCategory.VIDEO_I2V,
        use_case="Lifestyle shot, social content, product-in-use",
        style_families=[StyleFamily.UGC, StyleFamily.ART_CULTURE_FRANK_OCEAN, StyleFamily.PREMIUM],
        model=ModelID.KLING_3_STANDARD,
        motion_intensity=MotionIntensity.LOW_MEDIUM,
        camera="static or very gentle drift",
        duration_range=(4, 6),
        requires_input_image=True,
        prompt_template=(
            "Gentle natural movement: {person_action}. "
            "{environmental_motion}. {natural_life_details}. "
            "Feels like a captured moment, not generated. {duration}."
        ),
        required_vars=["person_action"],
        optional_vars=["environmental_motion", "natural_life_details", "duration"],
    ),

    "VID-I2V-003": VideoTemplate(
        id="VID-I2V-003",
        name="Energy Burst",
        category=TemplateCategory.VIDEO_I2V,
        use_case="Hype content, music promo, merch drop",
        style_families=[StyleFamily.PSYCHEDELIC, StyleFamily.ART_CULTURE, StyleFamily.BRUTALIST],
        model=ModelID.KLING_3_STANDARD,
        alt_models=[ModelID.VEO_31],
        motion_intensity=MotionIntensity.HIGH,
        camera="dynamic — rotation, zoom, or shake",
        duration_range=(5, 8),
        requires_input_image=True,
        prompt_template=(
            "Dynamic energy: {explosion_of_action}. "
            "{visual_effects}. {camera_movement}. "
            "Fast cuts feel. High intensity. {duration}."
        ),
        required_vars=["explosion_of_action"],
        optional_vars=["visual_effects", "camera_movement", "duration"],
    ),

    "VID-I2V-004": VideoTemplate(
        id="VID-I2V-004",
        name="Product Transform",
        category=TemplateCategory.VIDEO_I2V,
        use_case="Before/after, feature reveal, upgrade announcement",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM, StyleFamily.PSYCHEDELIC],
        model=ModelID.KLING_3_STANDARD,
        motion_intensity=MotionIntensity.MEDIUM,
        camera="static (focus on the transform)",
        duration_range=(5, 7),
        requires_input_image=True,
        prompt_template=(
            "Transformation sequence: {start_state} smoothly morphs into {end_state}. "
            "{transition_style}. {lighting_evolution}. "
            "Satisfying, seamless, share-worthy. {duration}."
        ),
        required_vars=["start_state", "end_state"],
        optional_vars=["transition_style", "lighting_evolution", "duration"],
    ),

    # --- Text-to-Video ---
    "VID-T2V-001": VideoTemplate(
        id="VID-T2V-001",
        name="UGC Testimonial Scene",
        category=TemplateCategory.VIDEO_T2V,
        use_case="TikTok/Reel ad, testimonial",
        style_families=[StyleFamily.UGC],
        model=ModelID.KLING_3_STANDARD,
        motion_intensity=MotionIntensity.MEDIUM,
        camera="static selfie angle",
        duration_range=(6, 10),
        requires_input_image=False,
        prompt_template=(
            "UGC-style selfie video: {person_description} in {casual_setting}, "
            "{speaking_to_camera_action}. {genuine_emotion}. "
            "iPhone front camera quality, natural lighting, vertical 9:16. "
            "Ring light catchlight in eyes. {duration}."
        ),
        required_vars=["person_description", "casual_setting"],
        optional_vars=["speaking_to_camera_action", "genuine_emotion", "duration"],
    ),

    "VID-T2V-002": VideoTemplate(
        id="VID-T2V-002",
        name="Cinematic B-Roll",
        category=TemplateCategory.VIDEO_T2V,
        use_case="Ad filler, website background, mood content",
        style_families=[StyleFamily.EDITORIAL, StyleFamily.PREMIUM, StyleFamily.BRUTALIST],
        model=ModelID.VEO_31,
        alt_models=[ModelID.KLING_25_TURBO],
        motion_intensity=MotionIntensity.LOW,
        camera="slow drift, tracking, or aerial",
        duration_range=(6, 10),
        requires_input_image=False,
        prompt_template=(
            "Cinematic b-roll: {scene_description}. "
            "{camera_movement}. {lighting_and_atmosphere}. "
            "No people required. {mood}. Widescreen 16:9. {duration}."
        ),
        required_vars=["scene_description"],
        optional_vars=["camera_movement", "lighting_and_atmosphere", "mood", "duration"],
    ),

    "VID-T2V-003": VideoTemplate(
        id="VID-T2V-003",
        name="Abstract/Mood Loop",
        category=TemplateCategory.VIDEO_T2V,
        use_case="Website background, social post, visualizer",
        style_families=[StyleFamily.PSYCHEDELIC, StyleFamily.BRUTALIST, StyleFamily.ART_CULTURE],
        model=ModelID.KLING_25_TURBO,
        motion_intensity=MotionIntensity.LOW,
        camera="static",
        duration_range=(4, 6),
        requires_input_image=False,
        prompt_template=(
            "Abstract loop: {visual_description}. "
            "Continuous, hypnotic motion. {color_palette}. "
            "Perfect loop potential. {duration}."
        ),
        required_vars=["visual_description"],
        optional_vars=["color_palette", "duration"],
    ),
}


# ---------------------------------------------------------------------------
# VOICEOVER TEMPLATES (4)
# ---------------------------------------------------------------------------

VOICEOVER_TEMPLATES: dict[str, VoiceoverTemplate] = {

    "VO-001": VoiceoverTemplate(
        id="VO-001",
        name="Product Hype",
        use_case="Reel/TikTok VO, 15-30s",
        energy=EnergyLevel.HIGH,
        voice_direction=(
            "Speak like you're telling your best friend about something cool you found. "
            "Not selling. Sharing. Pace: fast but clear. Energy: genuine excitement, not hype-beast."
        ),
        script_template=(
            "[Hook — 3 seconds, stop the scroll]\n{hook_line}\n\n"
            "[Value — 5-8 seconds]\n{what_it_does_and_why_you_care}\n\n"
            "[Proof — 3-5 seconds]\n{social_proof_or_result}\n\n"
            "[CTA — 3 seconds]\n{call_to_action}"
        ),
        required_vars=["hook_line", "what_it_does_and_why_you_care", "call_to_action"],
        examples=[{
            "hook": "Okay but why did nobody tell me about this",
            "value": "This app literally does {thing} in like two taps — I used to spend an hour on this",
            "proof": "I've been using it for three weeks and honestly I'm mad I didn't find it sooner",
            "cta": "Link in bio, don't sleep on it",
        }],
    ),

    "VO-002": VoiceoverTemplate(
        id="VO-002",
        name="Cinematic Narrator",
        use_case="Brand video, longer ad, website hero video",
        energy=EnergyLevel.LOW_MEDIUM,
        voice_direction=(
            "Measured, deliberate pace. Let the pauses breathe. "
            "Not whisper — confident quiet. Think 'late night radio host who also reads philosophy.' "
            "No rush. Every word lands."
        ),
        script_template=(
            "[Opening — set the world, 5-8 seconds]\n{atmospheric_opening_line}\n\n"
            "[Tension — the problem or desire, 5-8 seconds]\n{tension_line}\n\n"
            "[Resolution — the product enters, 5-8 seconds]\n{product_introduction}\n\n"
            "[Closing — brand moment, 3-5 seconds]\n{brand_tagline_or_feeling}"
        ),
        required_vars=["atmospheric_opening_line", "tension_line", "product_introduction"],
        examples=[{
            "opening": "There's a moment. Right before you hit publish. When everything feels possible.",
            "tension": "But the tools weren't built for people like us.",
            "resolution": "Until now. {Product} doesn't just work. It feels like it was made for you.",
            "closing": "{Brand}. Made different.",
        }],
    ),

    "VO-003": VoiceoverTemplate(
        id="VO-003",
        name="Streetwear/Culture Drop",
        use_case="Merch announcement, collection drop",
        energy=EnergyLevel.LOW,
        voice_direction=(
            "Minimum words, maximum cool. Like you're letting people in on a secret "
            "you don't care if they miss. Pace: slow. Energy: unbothered confidence."
        ),
        script_template=(
            "[Drop announcement — 3-5 seconds]\n{drop_headline}\n\n"
            "[Details — 5 seconds, keep it sparse]\n{what_when_where}\n\n"
            "[Closing — 3 seconds]\n{urgency_or_attitude}"
        ),
        required_vars=["drop_headline", "what_when_where"],
        examples=[{
            "headline": "New collection. {Name}.",
            "details": "{Date}. Limited run. {Number} pieces.",
            "closing": "If you know, you know.",
        }],
    ),

    "VO-004": VoiceoverTemplate(
        id="VO-004",
        name="Music Release Teaser",
        use_case="Single/album announcement, listening party promo",
        energy=EnergyLevel.VARIES,
        voice_direction=(
            "Voice should feel like it's part of the music, not talking over it. "
            "Whisper-to-speak dynamic. Intimate. Like a voice memo that was never meant to be public."
        ),
        script_template=(
            "[Atmospheric intro — 3-5 seconds, voice emerges from music]\n"
            "{cryptic_or_poetic_opening}\n\n"
            "[Reveal — 3 seconds]\n{track_or_album_name}. {release_date_or_action}."
        ),
        required_vars=["cryptic_or_poetic_opening", "track_or_album_name", "release_date_or_action"],
        examples=[
            {"opening": "You weren't supposed to hear this yet.", "reveal": "'{Track Name}.' Everywhere Friday."},
            {"opening": "Three years. Fourteen tracks. One frequency.", "reveal": "'{Album Name}.' {Date}."},
        ],
    ),
}


# ---------------------------------------------------------------------------
# AUDIO MIX SPECS (3)
# ---------------------------------------------------------------------------

AUDIO_MIX_SPECS: dict[str, AudioMixSpec] = {

    "AUD-MIX-001": AudioMixSpec(
        id="AUD-MIX-001",
        name="Voice Over Music",
        voice_volume_db=0.0,
        music_volume_db=-15.0,
        music_duck=True,
        duck_amount_db=-6.0,
        fade_in_s=1.5,
        fade_out_s=2.0,
        voice_delay_s=1.5,
        note="Standard narrated content — voice is the star",
    ),

    "AUD-MIX-002": AudioMixSpec(
        id="AUD-MIX-002",
        name="Music-Forward",
        voice_volume_db=-3.0,
        music_volume_db=-6.0,
        music_duck=False,
        duck_amount_db=0.0,
        fade_in_s=0.5,
        fade_out_s=0.5,
        voice_delay_s=0.0,
        note="Voice is part of the texture, not the star",
    ),

    "AUD-MIX-003": AudioMixSpec(
        id="AUD-MIX-003",
        name="UGC Raw",
        voice_volume_db=0.0,
        music_volume_db=None,  # type: ignore  — no background music
        music_duck=False,
        duck_amount_db=0.0,
        fade_in_s=0.0,
        fade_out_s=0.0,
        voice_delay_s=0.0,
        note="Should sound like a voice memo or screen recording — light compression, preserve natural dynamics",
    ),
}


# ---------------------------------------------------------------------------
# CAPTION STYLES (3)
# ---------------------------------------------------------------------------

CAPTION_STYLES: dict[str, CaptionStyle] = {

    "CAP-001": CaptionStyle(
        id="CAP-001",
        name="Bold Impact",
        font="Montserrat Black",
        size="large (fills ~40% of width)",
        color="white with black outline",
        position="center of frame",
        animation="word-by-word pop-in",
        case="ALL CAPS for emphasis words, sentence case otherwise",
        highlight_color="accent color on key words",
    ),

    "CAP-002": CaptionStyle(
        id="CAP-002",
        name="Minimal Clean",
        font="Helvetica Neue Light",
        size="small-medium (subtle)",
        color="white, 85% opacity",
        position="lower third",
        animation="fade in/out by phrase",
        case="sentence case",
        background="semi-transparent dark bar",
    ),

    "CAP-003": CaptionStyle(
        id="CAP-003",
        name="Brutalist Type",
        font="Monument Extended",
        size="medium",
        color="white on black bar or raw on footage",
        position="varies (can be anywhere — part of the design)",
        animation="hard cut by phrase (no smooth transitions)",
        case="ALL CAPS always",
    ),
}


# ---------------------------------------------------------------------------
# LOOKUP HELPERS (for Creative Director agent)
# ---------------------------------------------------------------------------

def templates_for_product(product_type: str) -> list[str]:
    """Return template IDs appropriate for a product type."""
    mapping = {
        "app": ["IMG-AP-001", "IMG-AP-002", "IMG-HE-001", "IMG-PP-001", "IMG-PP-002"],
        "merch": ["IMG-MR-001", "IMG-MR-002", "IMG-MR-003", "IMG-PP-001", "IMG-PP-002", "IMG-PP-003", "IMG-PP-004"],
        "music": ["IMG-MU-001", "IMG-MU-002", "IMG-MU-003", "IMG-HE-002"],
        "general": ["IMG-PP-001", "IMG-PP-002", "IMG-PP-003", "IMG-HE-001", "IMG-HE-002", "IMG-SO-001", "IMG-SO-002", "IMG-SO-003"],
    }
    return mapping.get(product_type, mapping["general"])


def templates_for_platform(platform: str) -> list[str]:
    """Return template IDs appropriate for a platform."""
    mapping = {
        "tiktok": ["IMG-SO-002", "VID-I2V-002", "VID-I2V-003", "VID-T2V-001"],
        "instagram_feed": ["IMG-SO-001"],
        "instagram_story": ["IMG-SO-002", "VID-I2V-002"],
        "twitter": ["IMG-SO-003", "IMG-HE-002"],
        "website": ["IMG-HE-001", "IMG-HE-002", "VID-T2V-002", "VID-T2V-003"],
        "app_store": ["IMG-AP-001", "IMG-AP-002"],
        "spotify": ["IMG-MU-001"],
        "youtube": ["IMG-HE-002", "VID-T2V-002"],
    }
    return mapping.get(platform, [])


ENERGY_TO_STYLE: dict[str, StyleFamily] = {
    "dark": StyleFamily.BRUTALIST,
    "edgy": StyleFamily.BRUTALIST,
    "minimal": StyleFamily.BRUTALIST,
    "cool": StyleFamily.ART_CULTURE,
    "cultural": StyleFamily.ART_CULTURE,
    "dreamy": StyleFamily.ART_CULTURE_FRANK_OCEAN,
    "vintage": StyleFamily.ART_CULTURE_WES_ANDERSON,
    "trippy": StyleFamily.PSYCHEDELIC,
    "wild": StyleFamily.PSYCHEDELIC,
    "colorful": StyleFamily.PSYCHEDELIC,
    "clean": StyleFamily.EDITORIAL,
    "professional": StyleFamily.EDITORIAL,
    "sharp": StyleFamily.EDITORIAL,
    "luxury": StyleFamily.PREMIUM,
    "premium": StyleFamily.PREMIUM,
    "sleek": StyleFamily.PREMIUM,
    "authentic": StyleFamily.UGC,
    "raw": StyleFamily.UGC,
    "real": StyleFamily.UGC,
    "casual": StyleFamily.UGC,
}


# Adjacent pairs that can be blended
BLENDABLE_PAIRS: set[frozenset[StyleFamily]] = {
    frozenset({StyleFamily.BRUTALIST, StyleFamily.ART_CULTURE}),
    frozenset({StyleFamily.ART_CULTURE, StyleFamily.PSYCHEDELIC}),
    frozenset({StyleFamily.PSYCHEDELIC, StyleFamily.EDITORIAL}),
    frozenset({StyleFamily.EDITORIAL, StyleFamily.PREMIUM}),
    frozenset({StyleFamily.PREMIUM, StyleFamily.UGC}),
}


def can_blend(a: StyleFamily, b: StyleFamily) -> bool:
    """Check if two style families can be blended (must be adjacent on the spectrum)."""
    # Normalize sub-styles to parent
    parent = {
        StyleFamily.ART_CULTURE_KANYE: StyleFamily.ART_CULTURE,
        StyleFamily.ART_CULTURE_FRANK_OCEAN: StyleFamily.ART_CULTURE,
        StyleFamily.ART_CULTURE_FADER: StyleFamily.ART_CULTURE,
        StyleFamily.ART_CULTURE_WES_ANDERSON: StyleFamily.ART_CULTURE,
    }
    a_norm = parent.get(a, a)
    b_norm = parent.get(b, b)
    if a_norm == b_norm:
        return True
    return frozenset({a_norm, b_norm}) in BLENDABLE_PAIRS
