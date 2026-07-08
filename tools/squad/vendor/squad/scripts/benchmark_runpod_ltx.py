#!/usr/bin/env python3
"""Run a targeted RunPod/LTX smoke benchmark against an existing endpoint."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from creative.video_factory.runpod_ltx_adapter import (
    HttpRunPodLTXTransport,
    RunPodLTXVideoAdapter,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark a RunPod-hosted LTX video endpoint.")
    parser.add_argument("--prompt", required=True, help="Literal chronological motion prompt for the video.")
    parser.add_argument("--input-image-url", required=True, help="Public or presigned URL for the first-frame image.")
    parser.add_argument(
        "--input-image-local",
        default=".outputs/runpod-ltx/input-placeholder.png",
        help="Local bookkeeping path stored in metadata; live worker uses --input-image-url.",
    )
    parser.add_argument("--duration-s", type=int, default=5, help="Clip duration for this smoke run.")
    parser.add_argument("--aspect-ratio", default="16:9")
    parser.add_argument("--negative-prompt", default="warped hands, distorted faces, unreadable text, jitter")
    parser.add_argument("--audio-prompt", default=None)
    parser.add_argument("--budget-cap-usd", type=float, default=2.0)
    parser.add_argument("--cost-per-second-usd", type=float, default=0.03)
    parser.add_argument("--output-dir", default=".outputs/runpod-ltx")
    return parser


async def run(args: argparse.Namespace) -> dict:
    api_key = os.getenv("RUNPOD_API_KEY", "").strip()
    endpoint_id = os.getenv("RUNPOD_LTX_ENDPOINT_ID", "").strip()
    if not api_key or not endpoint_id:
        raise SystemExit("missing RUNPOD_API_KEY or RUNPOD_LTX_ENDPOINT_ID")

    transport = HttpRunPodLTXTransport(api_key=api_key, endpoint_id=endpoint_id)
    adapter = RunPodLTXVideoAdapter(
        runpod_api_key=api_key,
        endpoint_id=endpoint_id,
        transport=transport,
        cost_per_second_usd=args.cost_per_second_usd,
    )
    asset = await adapter.image_to_video(
        input_image=Path(args.input_image_local),
        input_image_url=args.input_image_url,
        prompt=args.prompt,
        duration_s=args.duration_s,
        aspect_ratio=args.aspect_ratio,
        negative_prompt=args.negative_prompt,
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
        "metadata": asset.metadata,
    }


def main() -> int:
    args = build_parser().parse_args()
    result = asyncio.run(run(args))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
