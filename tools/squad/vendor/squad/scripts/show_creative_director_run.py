#!/usr/bin/env python3
"""Inspect a stored creative-director run."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show a stored creative-director run summary.")
    parser.add_argument("--run-id", help="Director run id, e.g. creative-director-abc123")
    parser.add_argument("--manifest", help="Path to a creative-director manifest.json")
    parser.add_argument("--baseline", help="Path to a creative-director benchmark/baseline JSON report")
    parser.add_argument(
        "--latest-baseline",
        action="store_true",
        help="Show .outputs/creative-director-benchmarks/latest-baseline.json",
    )
    parser.add_argument(
        "--output-root",
        default=".outputs/creative-director",
        help="Base directory for creative-director manifests when using --run-id",
    )
    parser.add_argument(
        "--baseline-root",
        default=".outputs/creative-director-benchmarks",
        help="Base directory for creative-director benchmark reports",
    )
    return parser


def resolve_manifest_path(*, run_id: str | None, manifest: str | None, output_root: str | Path) -> Path:
    if bool(run_id) == bool(manifest):
        raise SystemExit("pass exactly one of --run-id or --manifest")
    if manifest:
        manifest_path = Path(manifest)
    else:
        manifest_path = Path(output_root) / str(run_id) / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"manifest not found: {manifest_path}")
    return manifest_path


def resolve_baseline_path(
    *,
    baseline: str | None,
    latest_baseline: bool,
    baseline_root: str | Path,
) -> Path:
    if bool(baseline) == bool(latest_baseline):
        raise SystemExit("pass exactly one of --baseline or --latest-baseline")
    if baseline:
        baseline_path = Path(baseline)
    else:
        baseline_path = Path(baseline_root) / "latest-baseline.json"
    if not baseline_path.exists():
        raise SystemExit(f"baseline not found: {baseline_path}")
    return baseline_path


def load_manifest(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_report(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def format_summary(payload: dict, *, manifest_path: Path) -> str:
    best = payload.get("best_candidate") or {}
    latest_decision = payload.get("latest_decision") or {}
    current_direction = payload.get("current_direction") or {}
    human_review_packet = payload.get("human_review_packet") or {}
    lines = [
        "# Creative Director Run",
        "",
        f"- Run ID: `{payload.get('run_id')}`",
        f"- Final status: `{payload.get('final_status')}`",
        f"- Attempts: `{payload.get('attempt_count')}` / `{payload.get('max_attempts')}`",
        f"- Spend: `${float(payload.get('total_spend_usd', 0.0)):.2f}` / `${float(payload.get('budget_cap_usd', 0.0)):.2f}`",
        f"- Manifest: `{manifest_path}`",
        "",
        "## Direction",
        f"- Style family: `{current_direction.get('style_family')}`",
        f"- Template: `{current_direction.get('template_id')}`",
        f"- Quality tier: `{current_direction.get('quality_tier')}`",
        f"- Model: `{current_direction.get('model_id')}`",
        "",
        "## Decision",
        f"- Action: `{latest_decision.get('action')}`",
        f"- Rationale: {latest_decision.get('rationale')}",
        "",
        "## Best Candidate",
        f"- Candidate: `{best.get('candidate_id')}`",
        f"- Score: `{best.get('score')}`",
        f"- Verdict: `{best.get('verdict')}`",
        f"- Asset path: `{best.get('asset_path')}`",
    ]
    if payload.get("attempt_history"):
        lines.extend(["", "## Attempt History"])
        for attempt in payload["attempt_history"]:
            lines.extend(
                [
                    f"### Attempt `{attempt['attempt_index']}`",
                    f"- Direction: `{attempt['style_family']}` / `{attempt['template_id']}` / `{attempt['quality_tier']}`",
                    f"- Result run: `{attempt['result_run_id']}`",
                    f"- Variant: `{attempt['selected_variant_id']}`",
                    f"- Score: `{attempt['score_summary']}`",
                    f"- Verdict: `{attempt['decision_verdict']}`",
                    f"- Cost: `${float(attempt['cost_usd']):.2f}`",
                ]
            )
    if human_review_packet:
        lines.extend(
            [
                "",
                "## Review",
                f"- Review path: `{human_review_packet.get('review_path')}`",
                f"- Summary: {human_review_packet.get('summary')}",
            ]
        )
    return "\n".join(lines) + "\n"


def format_baseline_summary(report: dict, *, baseline_path: Path) -> str:
    lines = [
        "# Creative Director Baseline",
        "",
        f"- Report: `{baseline_path}`",
        f"- Generated: `{report.get('generated_at')}`",
        f"- Type: `{report.get('baseline_type', 'direct_batch')}`",
        f"- Runs: `{report.get('run_count')}`",
        f"- Review ready: `{report.get('review_ready_count')}`",
        f"- Escalated: `{report.get('escalated_count')}`",
        f"- Average best score: `{report.get('average_best_score')}`",
        f"- Average spend usd: `{report.get('average_spend_usd')}`",
    ]
    if report.get("note"):
        lines.extend(["", "## Notes", f"- {report['note']}"])
    if report.get("blocked_rerun_error"):
        lines.append(f"- Blocked rerun error: {report['blocked_rerun_error']}")
    runs = report.get("runs") or []
    if runs:
        lines.extend(["", "## Runs"])
        for run in runs:
            lines.extend(
                [
                    f"### `{run.get('run_id')}`",
                    f"- Brief: `{run.get('brief_file')}`",
                    f"- Status: `{run.get('final_status')}`",
                    f"- Style: `{run.get('style_family_suggestion')}`",
                    f"- Attempts: `{run.get('attempt_count')}`",
                    f"- Score: `{run.get('best_candidate_score')}`",
                    f"- Spend: `${float(run.get('total_spend_usd', 0.0)):.2f}`",
                    f"- Review path: `{run.get('review_path')}`",
                ]
            )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    mode_count = sum(bool(value) for value in (args.run_id, args.manifest, args.baseline, args.latest_baseline))
    if mode_count != 1:
        raise SystemExit("pass exactly one of --run-id, --manifest, --baseline, or --latest-baseline")
    if args.baseline or args.latest_baseline:
        baseline_path = resolve_baseline_path(
            baseline=args.baseline,
            latest_baseline=args.latest_baseline,
            baseline_root=args.baseline_root,
        )
        report = load_report(baseline_path)
        print(format_baseline_summary(report, baseline_path=baseline_path))
        return 0

    manifest_path = resolve_manifest_path(run_id=args.run_id, manifest=args.manifest, output_root=args.output_root)
    payload = load_manifest(manifest_path)
    print(format_summary(payload, manifest_path=manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
