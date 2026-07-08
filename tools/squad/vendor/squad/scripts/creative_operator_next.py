#!/usr/bin/env python3
"""Print the next operator actions for a stored creative-production run."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.show_creative_production_run import load_manifest, resolve_manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show the next useful operator commands for a Squad production run.")
    parser.add_argument("--run-id", help="Production run id")
    parser.add_argument("--manifest", help="Path to a creative-production manifest.json")
    parser.add_argument("--latest", action="store_true", help="Use newest creative-production manifest")
    parser.add_argument("--output-root", default=".outputs/creative-production")
    parser.add_argument("--redo-notes", default="", help="Optional redo notes to include in the suggested review command")
    parser.add_argument(
        "--reuse",
        action="append",
        default=[],
        choices=("voiceover", "music", "captions", "clips", "brief", "selected-still"),
        help="Asset/control to reuse in a redo plan. Repeatable.",
    )
    parser.add_argument("--new-run-id", default="", help="Optional redo run id for suggested commands")
    return parser


def build_operator_packet(
    *,
    manifest_path: Path,
    manifest: dict,
    redo_notes: str = "",
    reuse: list[str] | tuple[str, ...] = (),
    new_run_id: str = "",
) -> dict:
    run_dir = manifest_path.parent
    run_id = str(manifest.get("run_id") or run_dir.name)
    final_assembly = manifest.get("final_assembly") or {}
    post_pass = manifest.get("post_pass_plan") or {}
    smoke_summary = manifest.get("smoke_summary") or {}
    final_asset_path = final_assembly.get("asset_path") or post_pass.get("final_asset_path") or smoke_summary.get("final_asset_path")
    contact_sheet = _first_existing(run_dir / "contact-sheet.jpg", run_dir / "contact-sheet.png")
    review_path = (manifest.get("human_review_packet") or {}).get("review_path")
    source_brief = run_dir / "brief.json"
    redo_run_id = new_run_id or f"{run_id}-redo"
    reuse_values = sorted(set(reuse))
    redo_review_command = [
        ".venv/bin/python",
        "scripts/record_creative_production_review.py",
        "--run-id",
        run_id,
        "--verdict",
        "redo",
        "--notes",
        redo_notes or "describe what to change after reviewing the output",
        "--new-run-id",
        redo_run_id,
    ]
    for item in reuse_values:
        redo_review_command.extend(["--reuse", item])
    prepare_redo_command = [
        ".venv/bin/python",
        "scripts/prepare_creative_redo_brief.py",
        "--run-id",
        run_id,
        "--new-run-id",
        redo_run_id,
        "--notes",
        redo_notes or "describe what to change after reviewing the output",
        "--video-quality",
        "budget",
    ]
    return {
        "run_id": run_id,
        "final_status": manifest.get("final_status"),
        "manifest_path": str(manifest_path),
        "brief_path": str(source_brief) if source_brief.exists() else None,
        "final_asset_path": final_asset_path,
        "contact_sheet": contact_sheet,
        "review_path": review_path,
        "spend_usd": float(manifest.get("total_spend_usd") or 0.0),
        "commands": {
            "inspect": _shell_join(
                [
                    ".venv/bin/python",
                    "scripts/show_creative_production_run.py",
                    "--run-id",
                    run_id,
                ]
            ),
            "approve": _shell_join(
                [
                    ".venv/bin/python",
                    "scripts/record_creative_production_review.py",
                    "--run-id",
                    run_id,
                    "--verdict",
                    "approved",
                    "--notes",
                    "approved after human or agent review",
                ]
            ),
            "record_redo": _shell_join(redo_review_command),
            "prepare_redo_brief": _shell_join(prepare_redo_command),
            "rerun_from_brief": (
                _shell_join(
                    [
                        ".venv/bin/python",
                        "scripts/run_creative_production.py",
                        "--brief-file",
                        str(source_brief),
                        "--video-quality",
                        "budget",
                    ]
                )
                if source_brief.exists()
                else None
            ),
        },
        "operator_loop": (
            "inspect final_asset_path/contact_sheet, decide approve vs redo, record notes, edit brief if needed, rerun with explicit budget/quality"
        ),
    }


def _first_existing(*paths: Path) -> str | None:
    for path in paths:
        if path.exists():
            return str(path)
    return None


def _shell_join(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    manifest_path = resolve_manifest_path(
        run_id=args.run_id,
        manifest=args.manifest,
        latest=args.latest,
        output_root=args.output_root,
    )
    manifest = load_manifest(manifest_path)
    packet = build_operator_packet(
        manifest_path=manifest_path,
        manifest=manifest,
        redo_notes=args.redo_notes,
        reuse=args.reuse,
        new_run_id=args.new_run_id,
    )
    print(json.dumps(packet, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
