#!/usr/bin/env python3
"""No-spend carousel smoke: brief -> plan -> local slide exports."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"
if sys.version_info < (3, 11) and VENV_PYTHON.exists():
    import os

    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), *sys.argv])

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.carousel import CarouselDirectorOptions, build_carousel_plan, render_carousel_plan
from content.writing.brief_generator import CreativeBrief, build_brief


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a no-provider carousel smoke export.")
    parser.add_argument("--brief-file", help="Optional JSON CreativeBrief payload")
    parser.add_argument("--output-dir", default=".outputs/carousel-smoke/latest", help="Directory for slides and manifest")
    parser.add_argument("--slides", type=int, default=None, help="Optional slide count override")
    parser.add_argument(
        "--redo",
        action="append",
        default=[],
        help="Director redo control: stronger_hook, fewer_words, more_premium, more_absurd, more_emotional",
    )
    return parser


def load_brief(path: str | Path | None) -> CreativeBrief:
    if path:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return CreativeBrief(**payload)
    return build_brief(
        product_description="AI meal planning app for busy families",
        campaign_goal="Create a 6 slide Instagram carousel people will save before grocery shopping",
        platform="instagram_feed",
        mood_keywords=["bold", "clean", "premium"],
        cta_text="Save this before your next grocery run",
        max_cost_usd=0.01,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    brief = load_brief(args.brief_file)
    plan = build_carousel_plan(
        brief,
        slide_count=args.slides,
        director_options=CarouselDirectorOptions(controls=tuple(args.redo)),
    )
    result = render_carousel_plan(plan, args.output_dir)
    print(json.dumps(asdict(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
