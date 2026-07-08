from __future__ import annotations

import json
import subprocess
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, JpegImagePlugin

from content.carousel.contracts import CarouselPlan, CarouselRenderResult, CarouselSlide

_ = JpegImagePlugin


BACKGROUND_BY_ROLE = {
    "cover": (12, 13, 14),
    "cta": (244, 241, 234),
}
DEFAULT_BACKGROUND = (248, 248, 245)
INK = (16, 17, 18)
REVERSE_INK = (248, 248, 245)
ACCENT = (224, 76, 42)
FONT_CANDIDATES = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
)


def render_carousel_plan(
    plan: CarouselPlan,
    output_dir: str | Path,
    *,
    render_video: bool | None = None,
    slide_duration_s: float = 2.4,
    ffmpeg_binary: str = "ffmpeg",
    ffmpeg_runner=subprocess.run,
) -> CarouselRenderResult:
    if plan.export_spec is None:
        raise ValueError("CarouselPlan.export_spec is required before rendering")
    _validate_plan_for_render(plan)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    slide_paths: list[str] = []
    qa_warnings: list[str] = []
    rendered_images: list[Image.Image] = []
    rendered_pages: list[_RenderedSlide] = []
    for slide in plan.slides:
        rendered = _render_slide(plan=plan, slide=slide)
        image = rendered.image
        warnings = rendered.warnings
        qa_warnings.extend(warnings)
        slide_path = output_path / f"slide-{slide.slide_number:02d}.png"
        image.save(slide_path)
        slide_paths.append(str(slide_path))
        rendered_images.append(image.convert("RGB"))
        rendered_pages.append(rendered)

    pdf_path = None
    video_path = None
    if plan.export_spec.export_format == "pdf" and rendered_images:
        pdf_file = output_path / "carousel.pdf"
        _write_vector_pdf(plan=plan, rendered_pages=rendered_pages, pdf_path=pdf_file)
        pdf_path = str(pdf_file)
    should_render_video = render_video if render_video is not None else plan.export_spec.export_format == "mp4_slideshow"
    if should_render_video:
        video_file = output_path / "slideshow.mp4"
        _write_slideshow_video(
            slide_paths=tuple(slide_paths),
            video_path=video_file,
            width=plan.export_spec.width_px,
            height=plan.export_spec.height_px,
            slide_duration_s=slide_duration_s,
            ffmpeg_binary=ffmpeg_binary,
            ffmpeg_runner=ffmpeg_runner,
        )
        video_path = str(video_file)

    manifest = {
        "topic": plan.topic,
        "platform": plan.platform,
        "format": plan.format,
        "source": plan.source,
        "slide_count": plan.slide_count,
        "export_spec": asdict(plan.export_spec),
        "slide_paths": slide_paths,
        "video_path": video_path,
        "video_mode": "static_slide_ffmpeg" if video_path else None,
        "slide_duration_s": slide_duration_s if video_path else None,
        "pdf_path": pdf_path,
        "pdf_mode": "vector_text_pdf" if pdf_path else None,
        "caption": plan.caption,
        "hashtags": list(plan.hashtags),
        "qa_warnings": qa_warnings,
    }
    manifest_path = output_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return CarouselRenderResult(
        plan_source=plan.source,
        output_dir=str(output_path),
        slide_paths=tuple(slide_paths),
        manifest_path=str(manifest_path),
        video_path=video_path,
        pdf_path=pdf_path,
        qa_warnings=tuple(qa_warnings),
    )


def _validate_plan_for_render(plan: CarouselPlan) -> None:
    if not plan.slides:
        raise ValueError("CarouselPlan.slides must contain at least one slide before rendering")
    if len(plan.slides) != plan.slide_count:
        raise ValueError(
            f"CarouselPlan.slide_count={plan.slide_count} does not match slides={len(plan.slides)}"
        )
    seen: set[int] = set()
    for slide in plan.slides:
        if slide.slide_number in seen:
            raise ValueError(f"CarouselPlan contains duplicate slide number {slide.slide_number}")
        seen.add(slide.slide_number)


class _RenderedSlide:
    def __init__(
        self,
        *,
        slide: CarouselSlide,
        image: Image.Image,
        warnings: tuple[str, ...],
        width: int,
        height: int,
        margin: int,
        ink: tuple[int, int, int],
        background: tuple[int, int, int],
        headline_lines: tuple[str, ...],
        body_lines: tuple[str, ...],
    ) -> None:
        self.slide = slide
        self.image = image
        self.warnings = warnings
        self.width = width
        self.height = height
        self.margin = margin
        self.ink = ink
        self.background = background
        self.headline_lines = headline_lines
        self.body_lines = body_lines


def _render_slide(*, plan: CarouselPlan, slide: CarouselSlide) -> _RenderedSlide:
    spec = plan.export_spec
    assert spec is not None
    width, height = spec.width_px, spec.height_px
    background = BACKGROUND_BY_ROLE.get(slide.role, DEFAULT_BACKGROUND)
    ink = REVERSE_INK if slide.role == "cover" else INK
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    margin = int(width * 0.085)
    safe_width = width - (margin * 2)
    eyebrow_font = _font(32)
    headline_font = _font(86 if slide.role == "cover" else 70)
    body_font = _font(42)

    _draw_visual_system(draw, width=width, height=height, slide=slide)
    y = margin if slide.role == "cover" else int(height * 0.13)
    draw.text((margin, y), f"{slide.slide_number:02d} / {plan.slide_count:02d}", fill=ACCENT, font=eyebrow_font)
    y += 70

    headline_lines = _wrap_text(draw, slide.headline, headline_font, safe_width, max_lines=4)
    y = _draw_lines(draw, headline_lines, (margin, y), headline_font, ink, line_gap=10)
    y += 28

    body_lines = _wrap_text(draw, slide.body, body_font, safe_width, max_lines=5)
    y = _draw_lines(draw, body_lines, (margin, y), body_font, ink, line_gap=9)

    warnings = _qa_slide(
        slide=slide,
        headline_lines=headline_lines,
        body_lines=body_lines,
        y_after_body=y,
        safe_bottom=height - margin,
    )
    warnings = (*warnings, *_qa_glyphs(slide=slide, fonts=(eyebrow_font, headline_font, body_font)))
    return _RenderedSlide(
        slide=slide,
        image=image,
        warnings=warnings,
        width=width,
        height=height,
        margin=margin,
        ink=ink,
        background=background,
        headline_lines=headline_lines,
        body_lines=body_lines,
    )


def _draw_visual_system(draw: ImageDraw.ImageDraw, *, width: int, height: int, slide: CarouselSlide) -> None:
    if slide.role == "cover":
        draw.rectangle((0, height - 170, width, height), fill=ACCENT)
        draw.rectangle((width - 250, 0, width, 250), fill=(34, 36, 38))
        return
    if slide.role == "cta":
        draw.rectangle((0, 0, 26, height), fill=ACCENT)
        draw.ellipse((width - 260, height - 260, width - 60, height - 60), outline=ACCENT, width=8)
        return
    draw.rectangle((0, 0, width, 22), fill=ACCENT)
    draw.line((int(width * 0.72), int(height * 0.18), width - 70, int(height * 0.18)), fill=ACCENT, width=10)


def _qa_slide(
    *,
    slide: CarouselSlide,
    headline_lines: tuple[str, ...],
    body_lines: tuple[str, ...],
    y_after_body: int,
    safe_bottom: int,
) -> tuple[str, ...]:
    warnings: list[str] = []
    if y_after_body > safe_bottom:
        warnings.append(f"slide {slide.slide_number}: text may exceed safe margin")
    if len(headline_lines) >= 4:
        warnings.append(f"slide {slide.slide_number}: headline is dense")
    if len(body_lines) >= 5:
        warnings.append(f"slide {slide.slide_number}: body is dense")
    return tuple(warnings)


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    *,
    max_lines: int,
) -> tuple[str, ...]:
    words = _split_oversized_words(draw, text.split(), font, max_width)
    lines: list[str] = []
    current = ""
    truncated = False
    for word in words:
        candidate = f"{current} {word}".strip()
        if _text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) == max_lines - 1:
            truncated = True
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    consumed_words = sum(len(line.split()) for line in lines)
    if truncated or consumed_words < len(words):
        lines[-1] = _append_ellipsis_fitting(draw, lines[-1], font, max_width)
    return tuple(lines)


def _split_oversized_words(
    draw: ImageDraw.ImageDraw,
    words: list[str],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    split_words: list[str] = []
    for word in words:
        if _text_width(draw, word, font) <= max_width:
            split_words.append(word)
            continue
        split_words.extend(_split_word_to_width(draw, word, font, max_width))
    return split_words


def _split_word_to_width(
    draw: ImageDraw.ImageDraw,
    word: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    chunks: list[str] = []
    current = ""
    for char in word:
        candidate = f"{current}{char}"
        if current and _text_width(draw, candidate, font) > max_width:
            chunks.append(current)
            current = char
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _append_ellipsis_fitting(
    draw: ImageDraw.ImageDraw,
    line: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
) -> str:
    clean = line.rstrip(" .")
    while clean and _text_width(draw, f"{clean}...", font) > max_width:
        clean = clean[:-1].rstrip()
    return f"{clean}..." if clean else "..."


def _write_slideshow_video(
    *,
    slide_paths: tuple[str, ...],
    video_path: Path,
    width: int,
    height: int,
    slide_duration_s: float,
    ffmpeg_binary: str,
    ffmpeg_runner,
) -> None:
    if not slide_paths:
        raise ValueError("slideshow video export requires at least one slide")
    if slide_duration_s <= 0:
        raise ValueError("slide_duration_s must be greater than zero")
    concat_path = video_path.with_name("slideshow-concat.txt")
    concat_path.write_text(_ffmpeg_concat_file(slide_paths=slide_paths, slide_duration_s=slide_duration_s), encoding="utf-8")
    video_path.parent.mkdir(parents=True, exist_ok=True)
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
        "format=yuv420p,fps=30"
    )
    command = [
        ffmpeg_binary,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_path),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(video_path),
    ]
    try:
        ffmpeg_runner(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required for slideshow MP4 export") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg slideshow export failed: {stderr[-1000:]}") from exc
    if not video_path.exists() or video_path.stat().st_size <= 0:
        raise RuntimeError("ffmpeg slideshow export did not create a non-empty MP4")


def _ffmpeg_concat_file(*, slide_paths: tuple[str, ...], slide_duration_s: float) -> str:
    lines: list[str] = []
    for slide_path in slide_paths:
        escaped = str(Path(slide_path).resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
        lines.append(f"duration {slide_duration_s:.3f}")
    escaped_last = str(Path(slide_paths[-1]).resolve()).replace("'", "'\\''")
    lines.append(f"file '{escaped_last}'")
    return "\n".join(lines) + "\n"


def _draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: tuple[str, ...],
    xy: tuple[int, int],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
    *,
    line_gap: int,
) -> int:
    x, y = xy
    for line in lines:
        draw.text((x, y), line, fill=fill, font=font)
        bbox = draw.textbbox((x, y), line, font=font)
        y = bbox[3] + line_gap
    return y


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    raise RuntimeError(
        "Carousel renderer requires a scalable TrueType/OpenType font; "
        "Pillow bitmap fallback is too low quality for production slides."
    )


def _qa_glyphs(
    *,
    slide: CarouselSlide,
    fonts: tuple[ImageFont.FreeTypeFont | ImageFont.ImageFont, ...],
) -> tuple[str, ...]:
    text = " ".join((slide.headline, slide.body, slide.alt_text))
    unsupported: set[str] = set()
    for font in fonts:
        unsupported.update(_unsupported_glyphs(font, text))
    if not unsupported:
        return ()
    preview = "".join(sorted(unsupported))[:12]
    return (f"slide {slide.slide_number}: selected font may not support glyphs: {preview}",)


def _unsupported_glyphs(font: ImageFont.FreeTypeFont | ImageFont.ImageFont, text: str) -> set[str]:
    path = getattr(font, "path", None)
    if not path:
        return set(text.strip()) if text.strip() else set()
    cmap = _font_cmap(str(path), int(getattr(font, "index", 0) or 0))
    if cmap is None:
        return set()
    return {char for char in text if not char.isspace() and ord(char) not in cmap}


@lru_cache(maxsize=16)
def _font_cmap(path: str, index: int) -> frozenset[int] | None:
    try:
        from fontTools.ttLib import TTCollection, TTFont
    except Exception:
        return None
    try:
        if path.lower().endswith((".ttc", ".otc")):
            font: Any = TTCollection(path).fonts[index]
        else:
            font = TTFont(path, fontNumber=index)
        cmap: set[int] = set()
        for table in font["cmap"].tables:
            cmap.update(table.cmap.keys())
        return frozenset(cmap)
    except Exception:
        return None


def _write_vector_pdf(*, plan: CarouselPlan, rendered_pages: list[_RenderedSlide], pdf_path: Path) -> None:
    unsupported = sorted({char for page in rendered_pages for char in _pdf_unsupported_text(page)})
    if unsupported:
        preview = "".join(unsupported[:12])
        raise RuntimeError(
            "LinkedIn PDF export requires vector text, but the built-in PDF writer cannot encode "
            f"these glyphs: {preview!r}. Add a Unicode-capable PDF dependency before exporting this deck."
        )
    objects: list[bytes] = []
    page_refs: list[int] = []
    first_dynamic_ref = 5
    for page in rendered_pages:
        content = _pdf_page_content(plan=plan, rendered=page).encode("latin-1")
        content_ref = first_dynamic_ref + len(objects)
        objects.append(b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream")
        page_ref = first_dynamic_ref + len(objects)
        page_refs.append(page_ref)
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page.width} {page.height}] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {content_ref} 0 R >>"
            ).encode("ascii")
        )
    kids = " ".join(f"{ref} 0 R" for ref in page_refs)
    root_objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(page_refs)} >>".encode("ascii"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    ordered = root_objects + objects
    offsets: list[int] = []
    payload = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    for index, obj in enumerate(ordered, start=1):
        offsets.append(len(payload))
        payload.extend(f"{index} 0 obj\n".encode("ascii"))
        payload.extend(obj)
        payload.extend(b"\nendobj\n")
    xref = len(payload)
    payload.extend(f"xref\n0 {len(ordered) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        payload.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    payload.extend(
        (
            f"trailer\n<< /Size {len(ordered) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n"
        ).encode("ascii")
    )
    pdf_path.write_bytes(bytes(payload))


def _pdf_unsupported_text(rendered: _RenderedSlide) -> set[str]:
    text_parts = [
        f"{rendered.slide.slide_number:02d}",
        *rendered.headline_lines,
        *rendered.body_lines,
    ]
    return {char for text in text_parts for char in text if ord(char) > 255}


def _pdf_page_content(*, plan: CarouselPlan, rendered: _RenderedSlide) -> str:
    slide = rendered.slide
    width, height = rendered.width, rendered.height
    margin = rendered.margin
    y = margin if slide.role == "cover" else int(height * 0.13)
    lines = [
        f"{_pdf_color(rendered.background)} rg 0 0 {width} {height} re f",
        *_pdf_visual_system(width=width, height=height, slide=slide),
        _pdf_text(f"{slide.slide_number:02d} / {plan.slide_count:02d}", margin, height - y - 32, 32, ACCENT, bold=False),
    ]
    y += 70
    for line in rendered.headline_lines:
        lines.append(_pdf_text(line, margin, height - y - 70, 70 if slide.role != "cover" else 86, rendered.ink, bold=True))
        y += 82 if slide.role != "cover" else 98
    y += 28
    for line in rendered.body_lines:
        lines.append(_pdf_text(line, margin, height - y - 42, 42, rendered.ink, bold=False))
        y += 51
    return "\n".join(lines)


def _pdf_visual_system(*, width: int, height: int, slide: CarouselSlide) -> list[str]:
    if slide.role == "cover":
        return [
            f"{_pdf_color(ACCENT)} rg 0 0 {width} 170 re f",
            f"{_pdf_color((34, 36, 38))} rg {width - 250} {height - 250} 250 250 re f",
        ]
    if slide.role == "cta":
        return [f"{_pdf_color(ACCENT)} rg 0 0 26 {height} re f"]
    return [
        f"{_pdf_color(ACCENT)} rg 0 {height - 22} {width} 22 re f",
        f"{_pdf_color(ACCENT)} RG 10 w {int(width * 0.72)} {height - int(height * 0.18)} m {width - 70} {height - int(height * 0.18)} l S",
    ]


def _pdf_text(text: str, x: int, y: int, size: int, color: tuple[int, int, int], *, bold: bool) -> str:
    font = "F2" if bold else "F1"
    return f"BT /{font} {size} Tf {_pdf_color(color)} rg {x} {y} Td ({_pdf_escape(text)}) Tj ET"


def _pdf_color(color: tuple[int, int, int]) -> str:
    return " ".join(f"{channel / 255:.4f}" for channel in color)


def _pdf_escape(text: str) -> str:
    return text.encode("latin-1").decode("latin-1").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
