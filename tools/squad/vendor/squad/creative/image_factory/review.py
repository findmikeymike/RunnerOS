"""Human-review packet helpers for Sprint 1 image-factory runs."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from creative.image_factory.contracts import ImageFactoryResult


@dataclass(frozen=True, slots=True)
class ImageFactoryReviewPacket:
    run_id: str
    review_path: Path
    summary: str
    selected_asset_path: Path | None
    selected_asset_id: str | None
    approval_payload: dict


def build_review_packet(result: ImageFactoryResult) -> ImageFactoryReviewPacket:
    review_path = result.manifest_path.with_name("review.md")
    selected_asset = None
    if result.decision and result.decision.selected_asset_id:
        for variant in result.variants:
            if variant.variant_id == result.decision.selected_asset_id:
                selected_asset = variant
                break
        if selected_asset is None:
            raise ValueError(
                f"decision selected_asset_id does not match any variant: {result.decision.selected_asset_id}"
            )
    summary = _summary_line(result)
    review_path.write_text(_render_markdown(result, selected_asset), encoding="utf-8")
    return ImageFactoryReviewPacket(
        run_id=result.run_id,
        review_path=review_path,
        summary=summary,
        selected_asset_path=selected_asset.local_path if selected_asset else None,
        selected_asset_id=selected_asset.variant_id if selected_asset else None,
        approval_payload={
            "run_id": result.run_id,
            "manifest_path": str(result.manifest_path),
            "review_path": str(review_path),
            "decision": {
                "verdict": result.decision.verdict if result.decision else "unscored",
                "reason": result.decision.reason if result.decision else "no decision available",
                "attempt_index": result.decision.attempt_index if result.decision else None,
            },
            "selected_asset_id": selected_asset.variant_id if selected_asset else None,
            "selected_asset_path": str(selected_asset.local_path) if selected_asset else None,
            "variant_paths": [str(variant.local_path) for variant in result.variants],
            "attempts_run": result.attempts_run,
            "warnings": list(result.warnings),
        },
    )


def _summary_line(result: ImageFactoryResult) -> str:
    verdict = result.decision.verdict if result.decision else "unscored"
    attempts = result.attempts_run
    return f"Review creative run {result.run_id}: verdict={verdict}, attempts={attempts}"


def _render_markdown(result: ImageFactoryResult, selected_asset) -> str:
    lines = [
        f"# Image Factory Review",
        "",
        f"- Run: `{result.run_id}`",
        f"- Status: `{result.status}`",
        f"- Attempts run: `{result.attempts_run}`",
        f"- Total cost: `${result.total_cost_usd:.2f}`",
        f"- Manifest: `{result.manifest_path}`",
    ]
    if result.decision:
        lines.extend(
            [
                f"- Verdict: `{result.decision.verdict}`",
                f"- Reason: {result.decision.reason}",
                f"- Decision attempt: `{result.decision.attempt_index}`",
            ]
        )
    if selected_asset is not None:
        lines.extend(
            [
                f"- Selected asset: `{selected_asset.variant_id}`",
                f"- Selected path: `{selected_asset.local_path}`",
            ]
        )
    if result.warnings:
        lines.extend(["", "## Warnings"])
        lines.extend([f"- {warning}" for warning in result.warnings])
    if result.evaluations:
        lines.extend(["", "## Evaluations"])
        for evaluation in result.evaluations:
            lines.extend(
                [
                    f"### `{evaluation.asset_id}`",
                    f"- Attempt: `{evaluation.attempt_index}`",
                    f"- Verdict: `{evaluation.verdict}`",
                    f"- Score: `{evaluation.weighted_average:.2f}`",
                    f"- Top issue: {evaluation.top_issue}",
                    f"- Regeneration hint: {evaluation.regeneration_hint}",
                ]
            )
    if result.variants:
        lines.extend(["", "## Variants"])
        for variant in result.variants:
            lines.extend(
                [
                    f"### `{variant.variant_id}`",
                    f"- Attempt: `{variant.attempt_index}`",
                    f"- Path: `{variant.local_path}`",
                    f"- Remote: `{variant.remote_url}`",
                ]
            )
    lines.extend(
        [
            "",
            "## Human Decision",
            "- Approve the selected asset for downstream use, or request another manual regenerate pass.",
            "- If nothing is acceptable, reject and use the regeneration hints as the next prompt adjustment.",
        ]
    )
    return "\n".join(lines) + "\n"
