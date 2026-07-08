#!/usr/bin/env python3
"""Build a no-spend storyboard/plan board for a Squad creative brief."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from creative.production.storyboard_board import build_storyboard_board, write_storyboard_board


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a local no-spend storyboard board from a CreativeBrief JSON.")
    parser.add_argument("--brief-file", required=True, help="Path to CreativeBrief JSON")
    parser.add_argument("--output-dir", required=True, help="Directory for storyboard-board.json/html")
    parser.add_argument("--run-id", default=None, help="Optional stable run/storyboard id")
    parser.add_argument("--name", default=None, help="Optional display name; defaults to brief filename stem")
    parser.add_argument("--asset-root", action="append", default=[], help="Optional local asset/reference root. Repeatable.")
    parser.add_argument("--video-quality", default="budget", choices=("budget", "standard", "premium"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    brief_path = Path(args.brief_file)
    output_dir = Path(args.output_dir)
    try:
        brief = CreativeBrief(**json.loads(brief_path.read_text(encoding="utf-8")))
        board = build_storyboard_board(
            brief=brief,
            name=args.name or brief_path.stem,
            run_id=args.run_id,
            brief_file=brief_path,
            video_quality=args.video_quality,
            asset_roots=tuple(Path(path) for path in args.asset_root),
        )
        result = write_storyboard_board(board, output_dir)
    except Exception as exc:
        result = {
            "ok": False,
            "mode": "storyboard_plan_board",
            "error": str(exc),
            "provider_spend_enabled": False,
        }
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

