#!/usr/bin/env python3
"""Run a no-provider carousel production export."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"
if sys.version_info < (3, 11) and VENV_PYTHON.exists():
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), *sys.argv])

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.carousel import CarouselDirectorOptions, build_carousel_plan, render_carousel_plan
from content.writing.brief_generator import CreativeBrief, build_brief


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a local carousel production export with no provider spend.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--brief-file", help="JSON CreativeBrief payload")
    source.add_argument("--brief-text", help="Plain-language carousel request")
    parser.add_argument("--product", default="social content idea", help="Product/service/topic when using --brief-text")
    parser.add_argument("--platform", default="instagram_feed", help="Target platform")
    parser.add_argument("--cta", default="", help="Optional CTA text")
    parser.add_argument("--mood", action="append", default=[], help="Mood keyword; repeatable")
    parser.add_argument("--audience", default="", help="Optional audience insight")
    parser.add_argument("--slides", type=int, default=None, help="Optional slide count override")
    parser.add_argument("--slide-duration-s", type=float, default=2.4, help="Seconds each static slide stays on screen in MP4 export")
    parser.add_argument("--static-only", action="store_true", help="Write PNG/PDF artifacts but skip local MP4 slideshow export")
    parser.add_argument("--run-id", default=None, help="Stable run id for reproducible output paths")
    parser.add_argument("--output-root", default=".outputs/carousel-production", help="Base directory for run folders")
    parser.add_argument(
        "--redo",
        action="append",
        default=[],
        help="Director redo control: stronger_hook, fewer_words, more_premium, more_absurd, more_emotional",
    )
    return parser


def load_brief(args: argparse.Namespace) -> CreativeBrief:
    if args.brief_file:
        payload = json.loads(Path(args.brief_file).read_text(encoding="utf-8"))
        return _as_carousel_brief(CreativeBrief(**payload))
    return build_brief(
        product_description=args.product,
        campaign_goal=args.brief_text,
        platform=args.platform,
        mood_keywords=list(args.mood),
        cta_text=args.cta or None,
        max_cost_usd=0.01,
        output_type="carousel",
        key_audience_insight=args.audience,
    )


def run_carousel_production(
    *,
    brief: CreativeBrief,
    output_root: str | Path = ".outputs/carousel-production",
    run_id: str | None = None,
    slide_count: int | None = None,
    redo_controls: tuple[str, ...] = (),
    export_video: bool = True,
    slide_duration_s: float = 2.4,
    ffmpeg_runner=None,
) -> dict:
    resolved_run_id = run_id or _new_run_id()
    run_dir = Path(output_root) / resolved_run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    carousel_brief = _as_carousel_brief(brief)
    idempotency_key = _idempotency_key(
        brief=carousel_brief,
        slide_count=slide_count,
        redo_controls=redo_controls,
        export_video=export_video,
        slide_duration_s=slide_duration_s,
    )
    state_path = run_dir / "run-state.json"
    existing = _existing_completed_payload(state_path=state_path, idempotency_key=idempotency_key)
    if existing is not None:
        return existing
    _write_run_state(
        state_path=state_path,
        run_id=resolved_run_id,
        idempotency_key=idempotency_key,
        final_status="running",
        steps={
            "brief_loaded": "completed",
            "plan_written": "pending",
            "rendered": "pending",
            "video_exported": "pending" if export_video else "skipped",
            "manifest_written": "pending",
            "summary_written": "pending",
        },
    )

    current_step = "plan_written"
    try:
        plan = build_carousel_plan(
            carousel_brief,
            slide_count=slide_count,
            director_options=CarouselDirectorOptions(controls=redo_controls),
        )
        plan_path = run_dir / "plan.json"
        plan_path.write_text(json.dumps(asdict(plan), indent=2), encoding="utf-8")
        _mark_step(state_path, "plan_written", "completed")

        current_step = "rendered"
        render_kwargs = {
            "render_video": export_video,
            "slide_duration_s": slide_duration_s,
        }
        if ffmpeg_runner is not None:
            render_kwargs["ffmpeg_runner"] = ffmpeg_runner
        result = render_carousel_plan(plan, run_dir, **render_kwargs)
        _mark_step(state_path, "rendered", "completed")
        if export_video:
            _mark_step(state_path, "video_exported", "completed")

        current_step = "manifest_written"
        manifest_path = Path(result.manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update(
            {
                "run_id": resolved_run_id,
                "brief": carousel_brief.to_dict(),
                "idempotency_key": idempotency_key,
                "plan_path": str(plan_path),
                "manifest_path": str(manifest_path),
                "operator_summary_path": str(run_dir / "operator-summary.md"),
                "run_state_path": str(state_path),
                "total_spend_usd": 0.0,
                "provider_spend_enabled": False,
                "production_lane": "social_slideshow",
                "video_required": export_video,
                "redo_controls": list(redo_controls),
            }
        )
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
        _mark_step(state_path, "manifest_written", "completed")

        current_step = "summary_written"
        summary_path = run_dir / "operator-summary.md"
        summary_path.write_text(_format_operator_summary(manifest), encoding="utf-8")
        _mark_step(state_path, "summary_written", "completed", final_status="completed")
    except Exception as exc:
        _mark_step(
            state_path,
            current_step,
            "failed",
            final_status="failed",
            error_type=exc.__class__.__name__,
            error_message=str(exc),
        )
        raise

    return {
        "ok": True,
        "run_id": resolved_run_id,
        "production_lane": "social_slideshow",
        "total_spend_usd": 0.0,
        "output_dir": str(run_dir),
        "idempotency_key": idempotency_key,
        "slide_paths": result.slide_paths,
        "video_path": result.video_path,
        "manifest_path": str(manifest_path),
        "plan_path": str(plan_path),
        "operator_summary_path": str(summary_path),
        "run_state_path": str(state_path),
        "pdf_path": result.pdf_path,
        "qa_warnings": result.qa_warnings,
    }


def _as_carousel_brief(brief: CreativeBrief) -> CreativeBrief:
    if brief.output_type == "carousel" and brief.max_cost_usd <= 0.01:
        return brief
    return replace(brief, output_type="carousel", max_cost_usd=min(float(brief.max_cost_usd or 0.01), 0.01))


def _new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    return f"carousel-{stamp}-{uuid4().hex[:8]}"


def _idempotency_key(
    *,
    brief: CreativeBrief,
    slide_count: int | None,
    redo_controls: tuple[str, ...],
    export_video: bool = True,
    slide_duration_s: float = 2.4,
) -> str:
    payload = {
        "brief": brief.to_dict(),
        "slide_count": slide_count,
        "redo_controls": list(redo_controls),
        "export_video": export_video,
        "slide_duration_s": slide_duration_s,
        "runner": "carousel_production_v1",
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _existing_completed_payload(*, state_path: Path, idempotency_key: str) -> dict | None:
    if not state_path.exists():
        return None
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("idempotency_key") != idempotency_key:
        raise ValueError("run_id already exists with a different carousel idempotency key")
    if state.get("final_status") != "completed":
        return None
    manifest_path = Path(state.get("manifest_path") or state_path.with_name("manifest.json"))
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not _completed_manifest_artifacts_exist(manifest):
        return None
    return _payload_from_manifest(manifest)


def _completed_manifest_artifacts_exist(manifest: dict) -> bool:
    slide_paths = manifest.get("slide_paths") or ()
    try:
        slide_count = int(manifest.get("slide_count") or 0)
    except (TypeError, ValueError):
        return False
    if not slide_paths or len(slide_paths) != slide_count:
        return False
    required_paths = [
        manifest.get("plan_path"),
        manifest.get("operator_summary_path"),
        *slide_paths,
    ]
    pdf_path = manifest.get("pdf_path")
    export_format = ((manifest.get("export_spec") or {}).get("export_format") or "").lower()
    video_path = manifest.get("video_path")
    if export_format == "mp4_slideshow" and manifest.get("video_required", True):
        if not video_path or manifest.get("video_mode") != "static_slide_ffmpeg":
            return False
        required_paths.append(video_path)
    elif video_path:
        required_paths.append(video_path)
    if export_format == "pdf":
        if not pdf_path or manifest.get("pdf_mode") != "vector_text_pdf":
            return False
        required_paths.append(pdf_path)
    elif pdf_path:
        required_paths.append(pdf_path)
    return all(_non_empty_file(path) for path in required_paths)


def _non_empty_file(path: object) -> bool:
    if not isinstance(path, str) or not path:
        return False
    resolved = Path(path)
    return resolved.is_file() and resolved.stat().st_size > 0


def _payload_from_manifest(manifest: dict) -> dict:
    return {
        "ok": True,
        "reused_existing_run": True,
        "run_id": manifest.get("run_id"),
        "production_lane": manifest.get("production_lane"),
        "total_spend_usd": float(manifest.get("total_spend_usd", 0.0)),
        "output_dir": str(Path(manifest.get("manifest_path", ".")).parent),
        "idempotency_key": manifest.get("idempotency_key"),
        "slide_paths": tuple(manifest.get("slide_paths") or ()),
        "video_path": manifest.get("video_path"),
        "manifest_path": manifest.get("manifest_path"),
        "plan_path": manifest.get("plan_path"),
        "operator_summary_path": manifest.get("operator_summary_path"),
        "run_state_path": manifest.get("run_state_path"),
        "pdf_path": manifest.get("pdf_path"),
        "qa_warnings": tuple(manifest.get("qa_warnings") or ()),
    }


def _write_run_state(
    *,
    state_path: Path,
    run_id: str,
    idempotency_key: str,
    final_status: str,
    steps: dict[str, str],
) -> None:
    now = _utc_now()
    payload = {
        "run_id": run_id,
        "idempotency_key": idempotency_key,
        "final_status": final_status,
        "created_at": now,
        "updated_at": now,
        "manifest_path": str(state_path.with_name("manifest.json")),
        "steps": {name: {"status": status, "updated_at": now if status in {"completed", "skipped"} else None} for name, status in steps.items()},
    }
    state_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _mark_step(
    state_path: Path,
    step_name: str,
    status: str,
    *,
    final_status: str | None = None,
    error_type: str | None = None,
    error_message: str | None = None,
) -> None:
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    now = _utc_now()
    payload["updated_at"] = now
    if final_status is not None:
        payload["final_status"] = final_status
    payload.setdefault("steps", {}).setdefault(step_name, {})
    payload["steps"][step_name].update({"status": status, "updated_at": now})
    if error_type or error_message:
        payload["error"] = {
            "step": step_name,
            "type": error_type,
            "message": error_message,
            "recorded_at": now,
        }
    state_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_operator_summary(manifest: dict) -> str:
    slide_paths = manifest.get("slide_paths") or []
    qa_warnings = manifest.get("qa_warnings") or []
    lines = [
        "# Carousel Production Run",
        "",
        f"- Run ID: `{manifest.get('run_id')}`",
        f"- Lane: `{manifest.get('production_lane')}`",
        f"- Platform: `{manifest.get('platform')}`",
        f"- Format: `{manifest.get('format')}`",
        f"- Slides: `{len(slide_paths)}`",
        f"- Video: `{manifest.get('video_path')}`",
        f"- Spend: `${float(manifest.get('total_spend_usd', 0.0)):.2f}`",
        f"- Provider spend enabled: `{manifest.get('provider_spend_enabled')}`",
        f"- Idempotency key: `{manifest.get('idempotency_key')}`",
        f"- Manifest: `{manifest.get('manifest_path')}`",
        f"- Plan: `{manifest.get('plan_path')}`",
        f"- Run state: `{manifest.get('run_state_path')}`",
        f"- PDF: `{manifest.get('pdf_path')}`",
        "",
        "## Slides",
    ]
    for index, slide_path in enumerate(slide_paths, start=1):
        lines.append(f"- {index}: `{slide_path}`")
    if qa_warnings:
        lines.extend(["", "## QA Warnings"])
        lines.extend(f"- {warning}" for warning in qa_warnings)
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    brief = load_brief(args)
    payload = run_carousel_production(
        brief=brief,
        output_root=args.output_root,
        run_id=args.run_id,
        slide_count=args.slides,
        redo_controls=tuple(args.redo),
        export_video=not args.static_only,
        slide_duration_s=args.slide_duration_s,
    )
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
