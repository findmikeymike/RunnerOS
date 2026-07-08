#!/usr/bin/env python3
"""Record human review notes and prepare a controlled creative-production redo."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.show_creative_production_run import load_manifest, resolve_manifest_path


REUSE_CHOICES = ("voiceover", "music", "captions", "clips", "brief", "selected-still")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Record human creative review notes for a production run.")
    parser.add_argument("--run-id", help="Production run id")
    parser.add_argument("--manifest", help="Path to manifest.json")
    parser.add_argument("--latest", action="store_true", help="Use the newest creative-production manifest")
    parser.add_argument("--output-root", default=".outputs/creative-production")
    parser.add_argument("--verdict", choices=("approved", "redo"), required=True)
    parser.add_argument("--notes", required=True, help="Human review notes, e.g. 'music too low, redo scene 3'")
    parser.add_argument(
        "--reuse",
        action="append",
        choices=REUSE_CHOICES,
        default=[],
        help="Asset/control to reuse. Repeatable. Choices: " + ", ".join(REUSE_CHOICES),
    )
    parser.add_argument("--new-run-id", help="Optional run id for the prepared redo plan")
    return parser


def build_review_record(*, verdict: str, notes: str, reuse: list[str], source_run_id: str, new_run_id: str | None) -> dict:
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_run_id": source_run_id,
        "verdict": verdict,
        "notes": notes,
        "reuse": sorted(set(reuse)),
        "new_run_id": new_run_id,
    }


def record_review(*, manifest_path: Path, review: dict) -> dict:
    payload = load_manifest(manifest_path)
    reviews = list(payload.get("operator_reviews") or [])
    reviews.append(review)
    payload["operator_reviews"] = reviews
    payload["latest_operator_review"] = review
    manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    review_path = manifest_path.with_name("operator-review.json")
    review_path.write_text(json.dumps(review, indent=2, sort_keys=True), encoding="utf-8")
    plan_path = None
    if review["verdict"] == "redo":
        plan_path = write_rerun_plan(manifest_path=manifest_path, manifest=payload, review=review)
    return {
        "manifest_path": str(manifest_path),
        "review_path": str(review_path),
        "rerun_plan_path": str(plan_path) if plan_path else None,
        "review": review,
    }


def write_rerun_plan(*, manifest_path: Path, manifest: dict, review: dict) -> Path:
    source_run_id = str(manifest.get("run_id") or review["source_run_id"])
    new_run_id = review.get("new_run_id") or f"{source_run_id}-redo"
    run_dir = manifest_path.parent
    plan_path = run_dir / "operator-rerun-plan.json"
    final_assembly = manifest.get("final_assembly") or {}
    post_pass = manifest.get("post_pass_plan") or {}
    voice_asset = manifest.get("voice_asset") or {}
    audio_mix_plan = manifest.get("audio_mix_plan") or {}
    selected_music = audio_mix_plan.get("selected_music_track") or {}
    plan = {
        "created_at": review["created_at"],
        "source_run_id": source_run_id,
        "new_run_id": new_run_id,
        "human_notes": review["notes"],
        "reuse": review["reuse"],
        "source_manifest_path": str(manifest_path),
        "source_brief_path": str(run_dir / "brief.json"),
        "source_final_video": final_assembly.get("asset_path") or post_pass.get("final_asset_path"),
        "source_voiceover": voice_asset.get("asset_path") or final_assembly.get("audio_asset_path"),
        "source_music": selected_music.get("asset_path"),
        "source_captions_srt": post_pass.get("srt_path"),
        "source_captions_json": post_pass.get("json_path"),
        "source_clip_paths": [clip.get("asset_path") for clip in manifest.get("video_attempt_history") or []],
        "suggested_commands": suggested_commands(
            new_run_id=new_run_id,
            source_run_id=source_run_id,
            manifest_path=manifest_path,
            notes=str(review["notes"]),
            reuse=review["reuse"],
        ),
    }
    plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    return plan_path


def suggested_commands(
    *,
    new_run_id: str,
    source_run_id: str,
    manifest_path: Path,
    notes: str,
    reuse: list[str],
) -> list[str]:
    commands = [
        f".venv/bin/python scripts/show_creative_production_run.py --run-id {source_run_id}",
    ]
    if "music" in reuse and set(reuse) <= {"music", "captions", "voiceover", "brief", "selected-still", "clips"}:
        commands.append("# For music-only fixes: remix from existing video/voice/music, then run free QA; no provider spend needed.")
    commands.append(
        ".venv/bin/python scripts/prepare_creative_redo_brief.py "
        f"--manifest {shlex.quote(str(manifest_path))} "
        f"--new-run-id {shlex.quote(new_run_id)} "
        f"--notes {shlex.quote(notes)} "
        "--video-quality budget --budget-cap-usd 1.00"
    )
    commands.append(
        ".venv/bin/python scripts/run_creative_production.py "
        f"--brief-file {shlex.quote(str(Path('.outputs/creative-production') / new_run_id / 'brief.json'))} "
        "--video-quality budget --budget-cap-usd 1.00 --preflight-only"
    )
    commands.append(
        "# After preflight is clean, rerun the previous command without --preflight-only if provider spend is intended."
    )
    return commands


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
    review = build_review_record(
        verdict=args.verdict,
        notes=args.notes,
        reuse=args.reuse,
        source_run_id=str(manifest.get("run_id") or manifest_path.parent.name),
        new_run_id=args.new_run_id,
    )
    result = record_review(manifest_path=manifest_path, review=review)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
