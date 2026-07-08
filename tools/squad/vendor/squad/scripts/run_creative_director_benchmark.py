#!/usr/bin/env python3
"""Run a batch benchmark for creative-director-v1."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from creative.director.contracts import CreativeDirectorInput
from creative.director.graph import CreativeDirectorGraph
from scripts.run_creative_director import build_runtime, load_brief, summarize_error, summarize_result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark creative-director-v1 across multiple briefs.")
    parser.add_argument(
        "--brief-file",
        action="append",
        default=[],
        help="Brief file to include. Repeatable.",
    )
    parser.add_argument(
        "--brief-dir",
        help="Directory of brief JSON files to include.",
    )
    parser.add_argument("--max-attempts", type=int, default=2, help="Maximum strategic attempts per brief")
    parser.add_argument("--budget-cap-usd", type=float, default=None, help="Optional budget override per brief")
    parser.add_argument(
        "--image-eval-provider",
        choices=("auto", "openai", "off", "structural"),
        default="auto",
        help="Image scoring mode for benchmark runs",
    )
    parser.add_argument(
        "--output",
        help="Optional output report path. Defaults to .outputs/creative-director-benchmarks/<timestamp>.json",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop on the first brief failure instead of emitting a partial report",
    )
    return parser


def collect_brief_paths(*, brief_files: list[str], brief_dir: str | None) -> list[Path]:
    paths = [Path(path) for path in brief_files]
    if brief_dir:
        paths.extend(sorted(Path(brief_dir).glob("*.json")))
    unique_paths: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique_paths.append(resolved)
    if not unique_paths:
        raise SystemExit("no brief files provided")
    return unique_paths


def default_output_path() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    root = Path(".outputs/creative-director-benchmarks")
    root.mkdir(parents=True, exist_ok=True)
    return root / f"benchmark-{stamp}.json"


def run_benchmark(
    *,
    brief_paths: list[Path],
    max_attempts: int,
    budget_cap_usd: float | None,
    image_eval_provider: str,
    fail_fast: bool = False,
    tools=None,
    decision_model=None,
) -> dict:
    if tools is None or decision_model is None:
        tools, decision_model = build_runtime(image_eval_provider=image_eval_provider)
    graph = CreativeDirectorGraph(tools=tools, decision_model=decision_model)

    runs: list[dict] = []
    for brief_path in brief_paths:
        brief = load_brief(brief_path)
        try:
            result = graph.run(
                CreativeDirectorInput(
                    brief=brief,
                    budget_cap_usd=budget_cap_usd,
                    max_attempts=max_attempts,
                )
            )
            summary = summarize_result(result)
        except Exception as exc:
            if fail_fast:
                raise
            summary = summarize_error(exc, brief_file=brief_path)
        summary["brief_file"] = str(brief_path)
        summary["style_family_suggestion"] = brief.style_family_suggestion
        summary["platform"] = brief.platform
        runs.append(summary)

    total = len(runs)
    successful_runs = [run for run in runs if not run.get("error")]
    failed_runs = [run for run in runs if run.get("error")]
    review_ready = sum(1 for run in successful_runs if run["final_status"] == "review_ready")
    escalated = sum(1 for run in successful_runs if run["final_status"] == "escalated")
    average_best_score = round(
        sum(float(run.get("best_candidate_score") or 0.0) for run in successful_runs) / len(successful_runs),
        3,
    ) if successful_runs else 0.0
    average_spend = round(
        sum(float(run.get("total_spend_usd") or 0.0) for run in successful_runs) / len(successful_runs),
        6,
    ) if successful_runs else 0.0
    return {
        "run_count": total,
        "successful_run_count": len(successful_runs),
        "failed_run_count": len(failed_runs),
        "review_ready_count": review_ready,
        "escalated_count": escalated,
        "average_best_score": average_best_score,
        "average_spend_usd": average_spend,
        "max_attempts": max_attempts,
        "budget_cap_usd": budget_cap_usd,
        "image_eval_provider": image_eval_provider,
        "fail_fast": fail_fast,
        "runs": runs,
    }


def main(argv: list[str] | None = None, *, tools=None, decision_model=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    brief_paths = collect_brief_paths(brief_files=args.brief_file, brief_dir=args.brief_dir)
    report = run_benchmark(
        brief_paths=brief_paths,
        max_attempts=args.max_attempts,
        budget_cap_usd=args.budget_cap_usd,
        image_eval_provider=args.image_eval_provider,
        fail_fast=args.fail_fast,
        tools=tools,
        decision_model=decision_model,
    )
    output_path = Path(args.output) if args.output else default_output_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output_path": str(output_path), **report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
