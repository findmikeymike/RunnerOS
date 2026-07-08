#!/usr/bin/env python3
"""CLI entrypoint for the Sprint 1 image factory."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import load_settings
from content.writing.creative_modes import normalize_render_style
from creative.image_factory.contracts import ImageFactoryRequest
from creative.image_factory.fal_client import FalImageClient, HttpFalTransport
from creative.image_factory.prompting import build_image_plan
from workflows.image_factory_workflow import ImageFactoryWorkflow


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate Sprint 1 image-factory variants.")
    parser.add_argument("--product", required=True, help="Path to the product image")
    parser.add_argument("--scene", required=True, help="Scene brief for generation")
    parser.add_argument("--product-subject", required=True, help="Human-readable product description")
    parser.add_argument("--template", default="product_on_scene", help="Prompt template id")
    parser.add_argument("--style", action="append", default=[], help="Additional style tag (repeatable)")
    parser.add_argument("--variant-count", type=int, default=3, help="Number of variants")
    parser.add_argument("--quality-tier", default="balanced", help="draft, balanced, or premium")
    parser.add_argument("--background-mode", default="auto", help="keep, remove, or auto")
    parser.add_argument(
        "--render-style",
        default="auto",
        help="Look direction: auto, photoreal, painterly, illustrated, animated, stylized, or aliases like anime/oil painting",
    )
    parser.add_argument("--negative-prompt", default=None, help="Additional negative prompt")
    parser.add_argument("--budget-cap-usd", type=float, default=0.50, help="Hard cost cap")
    parser.add_argument("--reference", action="append", default=[], help="Additional reference image path")
    parser.add_argument("--preflight-only", action="store_true", help="Validate and estimate locally without provider spend")
    parser.add_argument("--execute", action="store_true", help="Allow paid provider calls after preflight")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    render_style = normalize_render_style(args.render_style)
    if not render_style:
        return _print_result({"ok": False, "error": f"Unknown --render-style value: {args.render_style}"}, code=2)
    request = ImageFactoryRequest(
        product_image_path=Path(args.product),
        scene_brief=args.scene,
        template_id=args.template,
        style_tags=tuple(args.style),
        variant_count=args.variant_count,
        quality_tier=args.quality_tier,
        background_mode=args.background_mode,
        reference_image_paths=tuple(Path(path) for path in args.reference),
        negative_prompt=args.negative_prompt,
        budget_cap_usd=args.budget_cap_usd,
        metadata={"product_subject": args.product_subject, "render_style": render_style},
    )
    if args.preflight_only:
        return _run_preflight(request=request, product_subject=args.product_subject)
    if not args.execute:
        return _print_result(
            {
                "ok": False,
                "error": "image factory can spend provider credits; run --preflight-only first, then pass --execute to generate",
            },
            code=2,
        )
    settings = load_settings()
    if not settings.fal_api_key:
        return _print_result({"ok": False, "error": "SQUAD_FAL_API_KEY is required for image generation"}, code=2)
    transport = HttpFalTransport(
        api_key=settings.fal_api_key,
        base_url=settings.fal_api_base_url,
        timeout_sec=settings.fal_timeout_sec,
    )
    client = FalImageClient(transport=transport)
    workflow = ImageFactoryWorkflow.from_settings(client, settings)
    result = workflow.run(
        request=request,
        product_subject=args.product_subject,
    )
    return _print_result(
        {
            "ok": True,
            "run_id": result.run_id,
            "status": result.status,
            "total_cost_usd": result.total_cost_usd,
            "manifest_path": str(result.manifest_path),
            "review_packet_path": str(result.review_packet_path) if result.review_packet_path else None,
            "approval_request_id": result.approval_request_id,
            "variant_paths": [str(item.local_path) for item in result.variants],
            "warnings": list(result.warnings),
        }
    )


def _run_preflight(*, request: ImageFactoryRequest, product_subject: str) -> int:
    settings = load_settings()
    plan = build_image_plan(request=request, product_subject=product_subject)
    blockers: list[str] = []
    if not request.product_image_path.exists():
        blockers.append(f"product image not found: {request.product_image_path}")
    for reference_path in request.reference_image_paths:
        if not reference_path.exists():
            blockers.append(f"reference image not found: {reference_path}")
    if not settings.fal_api_key:
        blockers.append("SQUAD_FAL_API_KEY is not configured")
    return _print_result(
        {
            "ok": not blockers,
            "mode": "image_factory_preflight",
            "estimated_cost_usd": plan.estimated_cost_usd,
            "budget_cap_usd": request.budget_cap_usd,
            "variant_count": request.variant_count,
            "quality_tier": request.quality_tier,
            "background_mode": request.background_mode,
            "render_style": request.metadata.get("render_style"),
            "blockers": blockers,
            "execute_command_hint": "rerun the same command with --execute after blockers are clear",
        },
        code=0 if not blockers else 2,
    )


def _print_result(payload: dict[str, object], *, code: int = 0) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
