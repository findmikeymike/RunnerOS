#!/usr/bin/env python3
"""No-spend audit for Squad creative lanes.

This script is intentionally local-only. It answers: what would Squad plan,
which prompts would reach models, which provider contracts are shaped, and
which CLI command should an operator run next.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from creative.production.storyboard_board import build_storyboard_board


SCENARIOS: dict[str, CreativeBrief] = {
    "ugc_avatar": CreativeBrief(
        product_description="AI meal planning app",
        campaign_goal="Create a UGC talking head TikTok ad with a creator explaining the app on camera",
        platform="tiktok",
        product_type="app",
        mood_keywords=["ugc", "authentic", "casual"],
        output_type="full_production",
        max_cost_usd=1.0,
        hook_direction="open with a sharp relatable dinner-planning pain",
        script_bits=["I stopped guessing what to cook after work."],
        must_say=["plans the week in one tap"],
        avoid_phrases=["game changer"],
    ),
    "ugc_pip": CreativeBrief(
        product_description="habit tracking mobile app",
        campaign_goal="Create a UGC PIP video: creator in bottom corner over app demo B-roll",
        platform="tiktok",
        product_type="app",
        mood_keywords=["ugc", "real", "casual"],
        output_type="full_production",
        max_cost_usd=1.0,
        aesthetic_notes="avatar_pip_overlay; show app screen as the main visual",
        hook_direction="call out the tiny habit mistake people miss",
    ),
    "app_demo": CreativeBrief(
        product_description="AI meal planning app",
        campaign_goal="Create a 3 scene app demo TikTok showing dashboard chaos becoming a weekly plan",
        platform="tiktok",
        product_type="app",
        mood_keywords=["premium", "clean", "sharp"],
        output_type="full_production",
        max_cost_usd=0.9,
        aesthetic_notes="readable phone UI, bold emotional hook, no filler",
        cta_text="Plan dinner before 5pm",
    ),
    "faceless_youtube": CreativeBrief(
        product_description="mini documentary about why abandoned malls feel haunted",
        campaign_goal="Create a no-face YouTube explainer that informs and entertains across 5 scenes",
        platform="youtube",
        mood_keywords=["educational", "eerie"],
        output_type="full_production",
        max_cost_usd=1.2,
        aesthetic_notes="documentary B-roll, visual clues, restrained mystery",
    ),
    "music_lyric": CreativeBrief(
        product_description="dark synth pop single called Night Signal",
        campaign_goal="Create a lyric-driven vertical music promo with kinetic words and atmospheric city visuals",
        platform="tiktok",
        product_type="music",
        mood_keywords=["dark", "cinematic", "music"],
        output_type="full_production",
        max_cost_usd=0.9,
        aesthetic_notes="audio-first, moody city light, no generic product ad language",
    ),
    "carousel_slideshow": CreativeBrief(
        product_description="AI meal planning app",
        campaign_goal="Create a 6 slide TikTok slideshow carousel people save about dinner planning mistakes",
        platform="tiktok",
        product_type="app",
        mood_keywords=["bold", "clean"],
        output_type="carousel",
        max_cost_usd=0.01,
        hook_direction="make the cover emotionally punchy and save-worthy",
    ),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit Squad creative lanes without provider spend.")
    parser.add_argument("--scenario", action="append", choices=sorted(SCENARIOS), help="Scenario to audit. Repeatable.")
    parser.add_argument("--output", help="Optional JSON report path")
    parser.add_argument("--brief-file", help="Audit one explicit CreativeBrief JSON instead of built-ins")
    parser.add_argument("--name", default="custom", help="Name for --brief-file audit")
    parser.add_argument("--video-quality", default="budget", choices=("budget", "standard", "premium"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.brief_file:
        briefs = {args.name: CreativeBrief(**json.loads(Path(args.brief_file).read_text(encoding="utf-8")))}
    else:
        names = args.scenario or list(SCENARIOS)
        briefs = {name: SCENARIOS[name] for name in names}
    report = {
        "ok": True,
        "mode": "creative_flow_audit",
        "provider_spend_enabled": False,
        "scenario_count": len(briefs),
        "scenarios": [_audit_scenario(name=name, brief=brief, video_quality=args.video_quality) for name, brief in briefs.items()],
    }
    report["ok"] = all(not scenario["findings"] for scenario in report["scenarios"])
    text = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if report["ok"] else 1


def _audit_scenario(*, name: str, brief: CreativeBrief, video_quality: str) -> dict[str, Any]:
    return build_storyboard_board(
        brief=brief,
        name=name,
        run_id=f"audit-{name}",
        video_quality=video_quality,
    )


if __name__ == "__main__":
    raise SystemExit(main())
