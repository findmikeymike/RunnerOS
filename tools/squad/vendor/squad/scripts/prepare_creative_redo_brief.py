#!/usr/bin/env python3
"""Prepare a new creative-production brief from an existing run and redo notes."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from dataclasses import asdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from scripts.show_creative_production_run import load_manifest, resolve_manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a redo brief from a previous creative-production run.")
    parser.add_argument("--run-id", help="Source production run id")
    parser.add_argument("--manifest", help="Path to source manifest.json")
    parser.add_argument("--latest", action="store_true", help="Use newest creative-production manifest")
    parser.add_argument("--output-root", default=".outputs/creative-production")
    parser.add_argument("--new-run-id", required=True, help="New run id that will receive the prepared brief")
    parser.add_argument("--notes", default="", help="Redo notes. If omitted, uses latest redo review notes from the manifest.")
    parser.add_argument("--hook-direction", default="", help="Optional replacement/additional hook direction")
    parser.add_argument("--script-bit", action="append", default=[], help="Optional script fragment/proof line. Repeatable.")
    parser.add_argument("--must-say", action="append", default=[], help="Optional required phrase. Repeatable.")
    parser.add_argument("--avoid-phrase", action="append", default=[], help="Optional phrase to avoid. Repeatable.")
    parser.add_argument("--tone-direction", default="", help="Optional replacement/additional tone direction")
    parser.add_argument("--aesthetic-note", action="append", default=[], help="Optional visual/pacing note. Repeatable.")
    parser.add_argument("--video-quality", choices=("budget", "standard", "premium"), default="budget")
    parser.add_argument("--budget-cap-usd", type=float, default=None)
    parser.add_argument("--asset-root", action="append", default=[], help="Optional asset root to include in suggested rerun command")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing redo brief")
    return parser


def prepare_redo_brief(
    *,
    manifest_path: Path,
    manifest: dict,
    new_run_id: str,
    notes: str = "",
    hook_direction: str = "",
    script_bits: list[str] | tuple[str, ...] = (),
    must_say: list[str] | tuple[str, ...] = (),
    avoid_phrases: list[str] | tuple[str, ...] = (),
    tone_direction: str = "",
    aesthetic_notes: list[str] | tuple[str, ...] = (),
    output_root: Path | str = ".outputs/creative-production",
    video_quality: str = "budget",
    budget_cap_usd: float | None = None,
    asset_roots: list[str] | tuple[str, ...] = (),
    force: bool = False,
) -> dict:
    source_run_dir = manifest_path.parent
    source_brief_path = source_run_dir / "brief.json"
    if not source_brief_path.exists():
        raise SystemExit(f"source brief not found: {source_brief_path}")
    source_brief = CreativeBrief(**json.loads(source_brief_path.read_text(encoding="utf-8")))
    redo_notes = _resolve_redo_notes(manifest=manifest, notes=notes)
    output_dir = Path(output_root) / new_run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    brief_path = output_dir / "brief.json"
    if brief_path.exists() and not force:
        raise SystemExit(f"redo brief already exists: {brief_path}; pass --force to overwrite")

    payload = asdict(source_brief)
    payload["aesthetic_notes"] = _join_notes(
        source_brief.aesthetic_notes,
        *(f"Redo direction: {redo_notes}",),
        *aesthetic_notes,
    )
    if hook_direction:
        payload["hook_direction"] = _join_notes(source_brief.hook_direction, hook_direction)
    elif redo_notes and not source_brief.hook_direction and "hook" in redo_notes.lower():
        payload["hook_direction"] = redo_notes
    if tone_direction:
        payload["tone_direction"] = _join_notes(source_brief.tone_direction, tone_direction)
    payload["script_bits"] = _append_unique(source_brief.script_bits, script_bits)
    payload["must_say"] = _append_unique(source_brief.must_say, must_say)
    payload["avoid_phrases"] = _append_unique(source_brief.avoid_phrases, avoid_phrases)
    if budget_cap_usd is not None:
        payload["max_cost_usd"] = budget_cap_usd

    updated = CreativeBrief(**payload)
    errors = updated.validate()
    if errors:
        raise SystemExit("prepared redo brief is invalid: " + "; ".join(errors))
    brief_path.write_text(json.dumps(asdict(updated), indent=2, sort_keys=True), encoding="utf-8")

    rerun_command = [
        ".venv/bin/python",
        "scripts/run_creative_production.py",
        "--brief-file",
        str(brief_path),
        "--video-quality",
        video_quality,
    ]
    if budget_cap_usd is not None:
        rerun_command.extend(["--budget-cap-usd", f"{budget_cap_usd:.2f}"])
    for asset_root in asset_roots:
        rerun_command.extend(["--asset-root", asset_root])
    result = {
        "source_run_id": str(manifest.get("run_id") or source_run_dir.name),
        "new_run_id": new_run_id,
        "source_manifest_path": str(manifest_path),
        "source_brief_path": str(source_brief_path),
        "redo_notes": redo_notes,
        "brief_path": str(brief_path),
        "rerun_command": _shell_join(rerun_command),
    }
    (output_dir / "redo-brief-source.json").write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    return result


def _resolve_redo_notes(*, manifest: dict, notes: str) -> str:
    cleaned = _clean(notes)
    if cleaned:
        return cleaned
    latest = manifest.get("latest_operator_review") or {}
    if latest.get("verdict") == "redo":
        cleaned = _clean(str(latest.get("notes") or ""))
    if not cleaned:
        raise SystemExit("pass --notes or record a latest redo review on the source manifest")
    return cleaned


def _join_notes(*parts: str) -> str:
    return "\n".join(_clean(part) for part in parts if _clean(part))


def _append_unique(existing: list[str] | tuple[str, ...], additions: list[str] | tuple[str, ...]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for item in (*existing, *additions):
        cleaned = _clean(item)
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            values.append(cleaned)
    return values


def _clean(text: str) -> str:
    return " ".join(str(text or "").strip().split())


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
    result = prepare_redo_brief(
        manifest_path=manifest_path,
        manifest=load_manifest(manifest_path),
        new_run_id=args.new_run_id,
        notes=args.notes,
        hook_direction=args.hook_direction,
        script_bits=args.script_bit,
        must_say=args.must_say,
        avoid_phrases=args.avoid_phrase,
        tone_direction=args.tone_direction,
        aesthetic_notes=args.aesthetic_note,
        output_root=args.output_root,
        video_quality=args.video_quality,
        budget_cap_usd=args.budget_cap_usd,
        asset_roots=args.asset_root,
        force=args.force,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
