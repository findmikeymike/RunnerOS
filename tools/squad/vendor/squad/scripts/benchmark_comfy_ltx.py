#!/usr/bin/env python3
"""Run a targeted ComfyUI/LTX smoke benchmark against an existing pod."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from creative.video_factory.comfy_ltx_adapter import (
    ComfyLTXVideoAdapter,
    HttpComfyTransport,
    load_comfy_workflow_pack,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark a ComfyUI-hosted LTX video workflow.")
    parser.add_argument("--base-url", default=os.getenv("COMFY_LTX_BASE_URL", ""), help="ComfyUI base URL.")
    parser.add_argument("--token", default=os.getenv("COMFY_LTX_TOKEN", ""), help="ComfyUI token query value.")
    parser.add_argument(
        "--workflow-path",
        default=os.getenv("COMFY_LTX_WORKFLOW_PATH", ""),
        help="Path to exported ComfyUI API workflow JSON.",
    )
    parser.add_argument(
        "--bindings-path",
        default=os.getenv("COMFY_LTX_BINDINGS_PATH", ""),
        help="Path to Squad workflow bindings JSON.",
    )
    parser.add_argument("--input-image", required=True, help="Local first-frame image to upload to ComfyUI.")
    parser.add_argument("--prompt", required=True, help="Literal chronological motion prompt.")
    parser.add_argument("--duration-s", type=int, default=5)
    parser.add_argument("--aspect-ratio", default="16:9")
    parser.add_argument("--negative-prompt", default="warped hands, distorted face, unreadable text, jitter")
    parser.add_argument("--audio-prompt", default=None)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--budget-cap-usd", type=float, default=1.0)
    parser.add_argument("--cost-per-second-usd", type=float, default=0.025)
    parser.add_argument("--output-dir", default=".outputs/comfy-ltx")
    parser.add_argument("--timeout-sec", type=int, default=900)
    parser.add_argument("--poll-interval-s", type=float, default=2.0)
    parser.add_argument("--skip-health-check", action="store_true")
    return parser


async def run(args: argparse.Namespace) -> dict:
    if not args.base_url.strip():
        raise SystemExit("missing --base-url or COMFY_LTX_BASE_URL")
    if not args.workflow_path.strip():
        raise SystemExit("missing --workflow-path or COMFY_LTX_WORKFLOW_PATH")
    if not args.bindings_path.strip():
        raise SystemExit("missing --bindings-path or COMFY_LTX_BINDINGS_PATH")
    input_image = Path(args.input_image)
    if not input_image.exists():
        raise SystemExit(f"input image does not exist: {input_image}")

    pack = load_comfy_workflow_pack(
        workflow_path=Path(args.workflow_path),
        bindings_path=Path(args.bindings_path),
    )
    transport = HttpComfyTransport(
        base_url=args.base_url,
        token=args.token,
        timeout_sec=args.timeout_sec,
        poll_interval_s=args.poll_interval_s,
    )
    stats = None if args.skip_health_check else transport.get_system_stats()
    adapter = ComfyLTXVideoAdapter(
        base_url=args.base_url,
        token=args.token,
        workflow_template=pack.workflow_template,
        bindings=pack.bindings,
        transport=transport,
        cost_per_second_usd=args.cost_per_second_usd,
    )
    asset = await adapter.image_to_video(
        input_image=input_image,
        prompt=args.prompt,
        duration_s=args.duration_s,
        aspect_ratio=args.aspect_ratio,
        negative_prompt=args.negative_prompt,
        seed=args.seed,
        audio_prompt=args.audio_prompt,
        budget_cap_usd=args.budget_cap_usd,
        output_dir=Path(args.output_dir),
    )
    return {
        "asset_path": str(asset.file_path),
        "duration_s": asset.duration_s,
        "width": asset.width,
        "height": asset.height,
        "cost_usd": asset.cost.cost_usd,
        "provider_request_id": asset.cost.provider_request_id,
        "comfyui_version": (stats or {}).get("system", {}).get("comfyui_version"),
        "metadata": asset.metadata,
    }


def main() -> int:
    args = build_parser().parse_args()
    result = asyncio.run(run(args))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
