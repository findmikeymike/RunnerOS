#!/usr/bin/env python3
"""Inspect a stored creative-production run."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show a stored creative-production run summary.")
    parser.add_argument("--run-id", help="Production run id, e.g. creative-production-abc123")
    parser.add_argument("--manifest", help="Path to a creative-production manifest.json")
    parser.add_argument("--latest", action="store_true", help="Show the newest creative-production manifest")
    parser.add_argument(
        "--output-root",
        default=".outputs/creative-production",
        help="Base directory for creative-production manifests when using --run-id or --latest",
    )
    return parser


def resolve_manifest_path(
    *,
    run_id: str | None,
    manifest: str | None,
    output_root: str | Path,
    latest: bool = False,
) -> Path:
    selected = sum(1 for value in (run_id, manifest, latest) if bool(value))
    if selected != 1:
        raise SystemExit("pass exactly one of --run-id, --manifest, or --latest")
    if manifest:
        manifest_path = Path(manifest)
    elif latest:
        manifest_path = _latest_manifest_path(output_root=output_root)
    else:
        manifest_path = Path(output_root) / str(run_id) / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"manifest not found: {manifest_path}")
    return manifest_path


def _latest_manifest_path(*, output_root: str | Path) -> Path:
    manifests = sorted(Path(output_root).glob("*/manifest.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not manifests:
        raise SystemExit(f"no manifests found under {output_root}")
    return manifests[0]


def load_manifest(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def format_summary(payload: dict, *, manifest_path: Path) -> str:
    run_dir = manifest_path.parent
    still = payload.get("selected_still") or {}
    motion_plan = payload.get("motion_plan") or {}
    cinema_controls = motion_plan.get("cinema_controls") or {}
    shot_plan = motion_plan.get("shot_plan") or {}
    plan_review = payload.get("plan_review") or {}
    voiceover_plan = payload.get("voiceover_plan") or {}
    voice_asset = payload.get("voice_asset") or {}
    review = payload.get("human_review_packet") or {}
    final_assembly = payload.get("final_assembly") or {}
    post_pass = payload.get("post_pass_plan") or {}
    smoke_summary = payload.get("smoke_summary") or {}
    free_qa = payload.get("free_output_qa") or {}
    output_qa = payload.get("output_qa_report") or {}
    operator_review = payload.get("latest_operator_review") or {}
    recommended_recipe = payload.get("recommended_recipe") or {}
    final_asset_path = final_assembly.get("asset_path") or post_pass.get("final_asset_path") or smoke_summary.get("final_asset_path")
    contact_sheet = _first_existing(run_dir / "contact-sheet.jpg", run_dir / "contact-sheet.png")
    lines = [
        "# Creative Production Run",
        "",
        f"- Run ID: `{payload.get('run_id')}`",
        f"- Final status: `{payload.get('final_status')}`",
        f"- Goal: {payload.get('creative_goal')}",
        f"- Spend: `${float(payload.get('total_spend_usd', 0.0)):.2f}` / `${float(payload.get('budget_cap_usd', 0.0)):.2f}`",
        f"- Streams OK: `{smoke_summary.get('streams_ok', 'unknown')}`",
        f"- Free QA: `{free_qa.get('passed', 'not_recorded')}`",
        f"- Output QA findings: `{len(output_qa.get('findings') or [])}`",
        f"- Video: `{final_asset_path}`",
        f"- Contact sheet: `{contact_sheet}`",
        f"- Manifest: `{manifest_path}`",
    ]
    if review.get("review_path"):
        lines.append(f"- Review packet: `{review.get('review_path')}`")
    models = _video_models(payload)
    if models:
        lines.append(f"- Models: `{', '.join(models)}`")
    if operator_review:
        lines.extend(
            [
                f"- Last human verdict: `{operator_review.get('verdict')}`",
                f"- Last human notes: {operator_review.get('notes')}",
            ]
        )
    lines.append("")
    if free_qa:
        audio = free_qa.get("audio") or {}
        visual = free_qa.get("visual_integrity") or {}
        visual_text = free_qa.get("visual_text") or {}
        lines.extend(
            [
                "## QA",
                f"- Free QA passed: `{free_qa.get('passed')}`",
                f"- Findings: `{len(free_qa.get('findings') or [])}`",
                f"- Audio hum detected: `{(audio.get('tone') or {}).get('detected', 'unknown')}`",
                f"- Visual frames checked: `{visual.get('frame_count', 'unknown')}`",
                f"- OCR frames checked: `{len(visual_text.get('frames') or [])}`",
                f"- Unexpected OCR tokens: `{len(visual_text.get('unexpected_tokens') or {})}`",
                "",
            ]
        )
    elif output_qa:
        lines.extend(["## QA", f"- Output QA findings: `{len(output_qa.get('findings') or [])}`", ""])
    if recommended_recipe:
        lines.extend(
            [
                "## Recommended Recipe",
                f"- Recipe: `{recommended_recipe.get('label')}` (`{recommended_recipe.get('recipe_id')}`)",
                f"- Recommended route: `{recommended_recipe.get('recommended_route')}`",
                f"- Route: `{recommended_recipe.get('native_route')}`",
                f"- Format hint: `{recommended_recipe.get('format_type_hint')}`",
                f"- First step: {recommended_recipe.get('recommended_first_step')}",
                "",
            ]
        )
    lines.extend(
        [
            "## Selected Still",
            f"- Candidate: `{still.get('candidate_id')}`",
            f"- Score: `{still.get('score')}`",
            f"- Verdict: `{still.get('verdict')}`",
            f"- Style family: `{still.get('style_family')}`",
            f"- Template: `{still.get('template_id')}`",
            f"- Asset path: `{still.get('asset_path')}`",
            "",
            "## Motion Plan",
            f"- Camera: {motion_plan.get('camera_direction')}",
            f"- Action: {motion_plan.get('action_description')}",
            f"- Ethos: {motion_plan.get('visual_ethos')}",
            f"- Duration: `{motion_plan.get('duration_s')}`",
            f"- Prompt: {motion_plan.get('motion_prompt')}",
        ]
    )
    if cinema_controls:
        lines.extend(
            [
                "",
                "## Cinema Controls",
                f"- Camera move: `{cinema_controls.get('camera_move')}`",
                f"- Lens feel: `{cinema_controls.get('lens_feel')}`",
                f"- Depth of field: `{cinema_controls.get('depth_of_field')}`",
                f"- Lighting: `{cinema_controls.get('lighting_style')}`",
                f"- Motion intensity: `{cinema_controls.get('motion_intensity')}`",
                f"- Framing: `{cinema_controls.get('framing')}`",
            ]
        )
    if shot_plan:
        lines.extend(
            [
                "",
                "## Shot Plan",
                f"- Opening frame: {shot_plan.get('opening_frame')}",
                f"- Camera move: {shot_plan.get('camera_move')}",
                f"- Subject action: {shot_plan.get('subject_action')}",
                f"- Environment motion: {shot_plan.get('environment_motion')}",
                f"- Ending frame: {shot_plan.get('ending_frame')}",
                f"- Pacing: {shot_plan.get('pacing')}",
                f"- Preserve: {shot_plan.get('preservation_constraints')}",
                f"- Avoid: {shot_plan.get('negative_constraints')}",
            ]
        )
    if plan_review:
        lines.extend(
            [
                "",
                "## Plan Review",
                f"- Verdict: `{plan_review.get('verdict')}`",
                f"- Confidence: `{plan_review.get('confidence')}`",
                f"- Rationale: {plan_review.get('rationale')}",
            ]
        )
    if voiceover_plan:
        lines.extend(
            [
                "",
                "## Voiceover Plan",
                f"- Enabled: `{voiceover_plan.get('enabled')}`",
                f"- Template: `{voiceover_plan.get('template_id')}`",
                f"- Direction: {voiceover_plan.get('voice_direction')}",
                f"- Rationale: {voiceover_plan.get('rationale')}",
                f"- Script: {voiceover_plan.get('script')}",
            ]
        )
    if voice_asset:
        lines.extend(
            [
                "",
                "## Voice Asset",
                f"- Provider: `{voice_asset.get('provider')}`",
                f"- Model: `{voice_asset.get('model_id')}`",
                f"- Voice: `{voice_asset.get('voice_id')}`",
                f"- MIME type: `{voice_asset.get('mime_type')}`",
                f"- Asset path: `{voice_asset.get('asset_path')}`",
            ]
        )
    clips = payload.get("video_attempt_history") or []
    if clips:
        lines.extend(["", "## Video Attempts"])
        for clip in clips:
            lines.extend(
                [
                    f"### `{clip.get('clip_id')}`",
                    f"- Source still: `{clip.get('source_still_id')}`",
                    f"- Duration: `{clip.get('duration_s')}`",
                    f"- Model: `{clip.get('model_id')}`",
                    f"- Cost: `${float(clip.get('cost_usd') or 0.0):.4f}`",
                    f"- Provider request: `{clip.get('provider_request_id')}`",
                    f"- Verdict: `{clip.get('verdict')}`",
                    f"- Asset path: `{clip.get('asset_path')}`",
                ]
            )
    if final_assembly:
        lines.extend(
            [
                "",
                "## Final Assembly",
                f"- Asset path: `{final_assembly.get('asset_path')}`",
                f"- Clip count: `{final_assembly.get('clip_count')}`",
                f"- Duration: `{final_assembly.get('duration_s')}`",
                f"- Method: `{final_assembly.get('assembly_method')}`",
                f"- Audio asset path: `{final_assembly.get('audio_asset_path')}`",
            ]
        )
    if review:
        lines.extend(
            [
                "",
                "## Review",
                f"- Review path: `{review.get('review_path')}`",
                f"- Summary: {review.get('summary')}",
            ]
        )
    return "\n".join(lines) + "\n"


def _first_existing(*paths: Path) -> str | None:
    for path in paths:
        if path.exists():
            return str(path)
    return None


def _video_models(payload: dict) -> list[str]:
    models: list[str] = []
    for clip in payload.get("video_attempt_history") or []:
        model = clip.get("model_id")
        if model and model not in models:
            models.append(model)
    for model in (payload.get("smoke_summary") or {}).get("video_model_ids") or []:
        if model and model not in models:
            models.append(model)
    return models


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    manifest_path = resolve_manifest_path(
        run_id=args.run_id,
        manifest=args.manifest,
        latest=args.latest,
        output_root=args.output_root,
    )
    payload = load_manifest(manifest_path)
    print(format_summary(payload, manifest_path=manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
