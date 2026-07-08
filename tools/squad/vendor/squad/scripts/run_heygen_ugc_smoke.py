#!/usr/bin/env python3
"""Run a tightly capped HeyGen UGC avatar smoke."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from creative.production.heygen import HeyGenProviderError, HeyGenUgcAvatarAdapter, HeyGenUgcRequest
from scripts.check_provider_budget import load_env_file


DEFAULT_SCRIPT = (
    "I did not expect this to be this useful. "
    "It fixes the annoying part first, then gets out of the way. "
    "If you want the simple version, try it today."
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a capped HeyGen UGC talking-head smoke.")
    parser.add_argument("--script", default=DEFAULT_SCRIPT, help="Short UGC script for the avatar to speak")
    parser.add_argument("--title", default="Squad UGC HeyGen smoke", help="HeyGen dashboard title")
    parser.add_argument("--avatar-id", default=None, help="HeyGen avatar_id. Defaults to SQUAD_HEYGEN_AVATAR_ID")
    parser.add_argument("--voice-id", default=None, help="HeyGen voice_id. Defaults to SQUAD_HEYGEN_VOICE_ID")
    parser.add_argument("--aspect-ratio", default="9:16", choices=("9:16", "16:9"))
    parser.add_argument("--resolution", default="720p", choices=("720p", "1080p"))
    parser.add_argument("--avatar-kind", default="photo_avatar_iv", choices=("photo_avatar_iv", "digital_twin_iv"))
    parser.add_argument("--duration-estimate-s", type=int, default=20)
    parser.add_argument("--max-cost-usd", type=float, default=1.10)
    parser.add_argument("--output", default=".outputs/heygen-ugc-smoke/heygen-ugc-smoke.mp4")
    parser.add_argument("--timeout-sec", type=int, default=900)
    parser.add_argument("--poll-interval-sec", type=float, default=5.0)
    parser.add_argument("--dry-run", action="store_true", help="Print request and estimated cost without provider spend")
    parser.add_argument("--execute", action="store_true", help="Actually call HeyGen. Required for spend.")
    parser.add_argument("--list-avatars", action="store_true", help="List avatar payload summary without generating video")
    return parser


def main(argv: list[str] | None = None) -> int:
    load_env_file(PROJECT_ROOT / ".env.local")
    args = build_parser().parse_args(argv)
    api_key = os.getenv("SQUAD_HEYGEN_API_KEY") or os.getenv("HEYGEN_API_KEY")
    avatar_id = args.avatar_id or os.getenv("SQUAD_HEYGEN_AVATAR_ID")
    voice_id = args.voice_id or os.getenv("SQUAD_HEYGEN_VOICE_ID")
    provider_call_requested = bool(args.execute or args.list_avatars)
    missing = [
        name
        for name, value in (
            ("SQUAD_HEYGEN_API_KEY or HEYGEN_API_KEY", api_key),
            ("SQUAD_HEYGEN_AVATAR_ID or --avatar-id", avatar_id),
            ("SQUAD_HEYGEN_VOICE_ID or --voice-id", voice_id),
        )
        if not value
    ]
    if missing and provider_call_requested:
        print(json.dumps({"ok": False, "missing": missing}, indent=2, sort_keys=True))
        return 2
    if missing:
        api_key = api_key or "dry-run-no-api-key"
        avatar_id = avatar_id or "dry-run-avatar-id"
        voice_id = voice_id or "dry-run-voice-id"

    adapter = HeyGenUgcAvatarAdapter(
        api_key=api_key,
        timeout_sec=args.timeout_sec,
        poll_interval_sec=args.poll_interval_sec,
    )

    if args.list_avatars:
        payload = adapter.list_avatars()
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        avatars = data.get("avatars") or data.get("avatar_list") or []
        print(
            json.dumps(
                {
                    "ok": True,
                    "avatar_count": len(avatars) if isinstance(avatars, list) else None,
                    "payload_keys": sorted(payload.keys()),
                    "data_keys": sorted(data.keys()) if isinstance(data, dict) else [],
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    request = HeyGenUgcRequest(
        avatar_id=avatar_id,
        voice_id=voice_id,
        script=args.script,
        title=args.title,
        aspect_ratio=args.aspect_ratio,
        resolution=args.resolution,
        duration_estimate_s=args.duration_estimate_s,
        avatar_kind=args.avatar_kind,
    )
    estimate = adapter.estimate_cost_usd(request)
    request_summary = {
        "ok": True,
        "execute": bool(args.execute),
        "estimated_cost_usd": estimate,
        "max_cost_usd": args.max_cost_usd,
        "avatar_kind": request.avatar_kind,
        "duration_estimate_s": request.duration_estimate_s,
        "aspect_ratio": request.aspect_ratio,
        "resolution": request.resolution,
        "script_chars": len(request.script),
        "output": str(Path(args.output)),
        "request_payload": adapter.build_payload(request),
    }
    if args.dry_run or not args.execute:
        print(json.dumps({**request_summary, "provider_spend": False}, indent=2, sort_keys=True))
        return 0
    try:
        result = adapter.generate(
            request=request,
            output_path=Path(args.output),
            max_cost_usd=args.max_cost_usd,
            wait=True,
        )
    except HeyGenProviderError as exc:
        print(json.dumps({**request_summary, "ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 1
    print(
        json.dumps(
            {
                **request_summary,
                "provider_spend": True,
                "video_id": result.video_id,
                "status": result.status,
                "asset_path": str(result.asset_path) if result.asset_path else None,
                "thumbnail_url": result.thumbnail_url,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
