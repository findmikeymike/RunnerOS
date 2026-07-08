#!/usr/bin/env python3
"""Scout MuAPI template/published workflows without executing paid runs."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import sys

from creative.muapi_workflows import MuAPIWorkflowClient, workflow_shape_to_payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scout MuAPI workflow marketplace/catalog.")
    parser.add_argument("--output", default=".outputs/muapi-workflow-scout/catalog.json", help="Output JSON path")
    parser.add_argument("--limit", type=int, default=30, help="Number of top workflow shapes to enrich")
    parser.add_argument("--include-published", action="store_true", help="Include public user-published workflows")
    parser.add_argument("--api-key-env", default="MUAPI_API_KEY", help="Environment variable containing MuAPI API key")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    api_key = os.getenv(args.api_key_env, "").strip()
    if not api_key:
        raise SystemExit(f"{args.api_key_env} is required")

    client = MuAPIWorkflowClient(api_key=api_key)
    summaries = client.list_template_workflows()
    if args.include_published:
        summaries.extend(client.list_published_workflows())

    ranked = sorted(summaries, key=_workflow_rank, reverse=True)
    shapes = [workflow_shape_to_payload(client.describe_workflow(summary)) for summary in ranked[: max(args.limit, 0)]]

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "template_count": len([item for item in summaries if item.source == "template"]),
        "published_count": len([item for item in summaries if item.source == "published"]),
        "category_counts": dict(Counter(item.category for item in summaries)),
        "workflows": shapes,
    }
    output.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(f"wrote {output}")
    for item in shapes[:10]:
        print(f"- {item['name']} | {item['category']} | nodes={item['node_count']} | inputs={','.join(item['required_inputs'])}")
    return 0


def _workflow_rank(summary) -> tuple[int, str]:
    name = summary.name.lower()
    category = summary.category.lower()
    score = 0
    if summary.source == "template":
        score += 4
    if category in {"e-commerce", "social media", "fashion", "featured", "home decor"}:
        score += 2
    if any(term in name for term in ("ugc", "ad", "product", "video", "fashion", "story", "logo", "interior", "app")):
        score += 2
    if "untitled" in name or "testing" in name or "fail" in name:
        score -= 4
    return score, summary.updated_at or ""


if __name__ == "__main__":
    sys.exit(main())
