#!/usr/bin/env python3
"""Recommend a Squad creative recipe for a brief."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief, build_brief
from creative.production.recipe_registry import recipe_recommendation_to_payload, recommend_recipes


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Recommend Squad creative production recipes.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--brief-file", help="JSON CreativeBrief payload")
    source.add_argument("--brief-text", help="Plain-language creative request")
    parser.add_argument("--product", default="creative project", help="Product/service/artwork topic with --brief-text")
    parser.add_argument("--platform", default="tiktok", help="Target platform with --brief-text")
    parser.add_argument("--output-type", default="full_production", help="CreativeBrief output type with --brief-text")
    parser.add_argument("--mood", action="append", default=[], help="Mood keyword; repeatable")
    parser.add_argument("--limit", type=int, default=3)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    brief = _load_brief(args)
    recommendations = recommend_recipes(brief, limit=args.limit)
    payload = {
        "recommendations": [recipe_recommendation_to_payload(item) for item in recommendations]
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def _load_brief(args: argparse.Namespace) -> CreativeBrief:
    if args.brief_file:
        payload = json.loads(Path(args.brief_file).read_text(encoding="utf-8"))
        return CreativeBrief(**payload)
    return build_brief(
        product_description=args.product,
        campaign_goal=args.brief_text,
        platform=args.platform,
        mood_keywords=list(args.mood or ()),
        output_type=args.output_type,
    )


if __name__ == "__main__":
    sys.exit(main())
