#!/usr/bin/env python3
"""Optional DBOS-backed shell for creative-production-v1."""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CreativeProductionInput
from creative.production.durable_runner import (
    DurableCreativeDirectorTools,
    DurableDirectorDecisionModel,
    DurableProductionOutputTools,
    audio_mix_step_result_to_payload,
    audio_asset_record_to_payload,
    compose_ugc_picture_in_picture_input_from_payload,
    creative_director_decision_to_payload,
    creative_director_state_from_payload,
    dbos_config_from_env,
    dbos_readiness_from_env,
    durable_workflow_id,
    final_assembly_record_to_payload,
    generate_ugc_presenter_input_from_payload,
    require_dbos_ready,
    image_factory_result_to_payload,
    image_factory_step_input_from_payload,
    post_pass_plan_to_payload,
    production_output_state_from_payload,
    render_step_result_to_payload,
    validate_output_from_payload,
    write_production_manifest_from_payload,
    voiceover_plan_from_payload,
    audio_asset_record_from_payload,
    video_clip_record_to_payload,
    video_clip_record_from_payload,
    video_generation_kwargs_from_payload,
    ugc_presenter_record_to_payload,
)
from scripts.run_creative_production import (
    build_runtime,
    load_brief,
    should_preflight_fal_storage,
    summarize_error,
    summarize_result,
)
from core.config import load_settings
from scripts.run_creative_production import preflight_fal_storage


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run creative-production-v1 through an optional DBOS durable shell.")
    parser.add_argument("--brief-file", required=True, help="Path to a JSON creative brief file")
    parser.add_argument("--max-attempts", type=int, default=2, help="Maximum bounded attempts")
    parser.add_argument("--budget-cap-usd", type=float, default=None, help="Optional production budget override")
    parser.add_argument(
        "--video-quality",
        choices=("budget", "standard", "premium"),
        default="budget",
        help="Video generation quality tier; default is budget for cheap smoke testing",
    )
    parser.add_argument(
        "--image-eval-provider",
        choices=("auto", "openai", "off", "structural"),
        default="auto",
        help="Image scoring mode for still-generation during the run",
    )
    parser.add_argument(
        "--workflow-id",
        default=None,
        help="Optional DBOS workflow ID. Defaults to a deterministic hash of the brief and run options.",
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Check DBOS runner readiness and payload shape without launching DBOS or spending on providers.",
    )
    return parser


def load_local_env_file(path: Path | str = PROJECT_ROOT / ".env.local") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key.startswith("#") or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def build_durable_payload(args: argparse.Namespace, brief: CreativeBrief) -> dict[str, Any]:
    return {
        "brief": brief.to_dict(),
        "brief_file": str(Path(args.brief_file)),
        "max_attempts": args.max_attempts,
        "budget_cap_usd": args.budget_cap_usd,
        "video_quality": args.video_quality,
        "image_eval_provider": args.image_eval_provider,
    }


def durable_preflight_summary(
    payload: dict[str, Any],
    *,
    workflow_id: str,
    environ: dict[str, str] | None = None,
) -> dict[str, Any]:
    readiness = dbos_readiness_from_env(environ)
    blockers = list(readiness.blockers)
    if not readiness.enabled:
        blockers.append("SQUAD_DBOS_ENABLED is not set")
    if not readiness.package_available:
        blockers.append("install the durable extra: python -m pip install -e '.[durable]'")
    if not readiness.database_url_configured and "DBOS_SYSTEM_DATABASE_URL is not configured" not in blockers:
        blockers.append("DBOS_SYSTEM_DATABASE_URL is not configured")
    return {
        "ok": readiness.ready,
        "mode": "dbos_preflight",
        "dbos_workflow_id": workflow_id,
        "brief_file": payload.get("brief_file"),
        "image_eval_provider": payload.get("image_eval_provider"),
        "video_quality": payload.get("video_quality"),
        "budget_cap_usd": payload.get("budget_cap_usd"),
        "readiness": {
            "enabled": readiness.enabled,
            "package_available": readiness.package_available,
            "database_url_configured": readiness.database_url_configured,
            "ready": readiness.ready,
            "blockers": blockers,
        },
    }


def run_durable_payload(payload: dict[str, Any], *, workflow_id: str, environ: dict[str, str] | None = None) -> dict:
    readiness = require_dbos_ready(environ)
    if not readiness.enabled:
        raise RuntimeError("DBOS production runner is disabled; set SQUAD_DBOS_ENABLED=1 to run durable production")
    dbos_module = importlib.import_module("dbos")
    DBOS = dbos_module.DBOS
    SetWorkflowID = dbos_module.SetWorkflowID

    graph = build_runtime(image_eval_provider=payload["image_eval_provider"])
    raw_tools = graph.tools
    director_graph = getattr(raw_tools, "director_graph", None)
    raw_director_tools = getattr(director_graph, "tools", None)
    raw_director_decision_model = getattr(director_graph, "decision_model", None)

    @DBOS.step()
    def run_image_factory_step(step_payload: dict[str, Any]) -> dict:
        kwargs = image_factory_step_input_from_payload(step_payload)
        result = raw_director_tools.run_image_factory(
            kwargs["director_input"],
            kwargs["selection"],
            kwargs["prompt_plan"],
            attempt_index=kwargs["attempt_index"],
        )
        return image_factory_result_to_payload(result)

    @DBOS.step()
    def run_director_decision_step(step_payload: dict[str, Any]) -> dict:
        state = creative_director_state_from_payload(step_payload["state"])
        raw = raw_director_decision_model(
            state=state,
            system_prompt=step_payload.get("system_prompt"),
            user_prompt=step_payload.get("user_prompt"),
        )
        return creative_director_decision_to_payload(raw)

    @DBOS.step()
    def run_video_generation_step(step_payload: dict[str, Any]) -> dict:
        kwargs = video_generation_kwargs_from_payload(step_payload)
        return video_clip_record_to_payload(raw_tools.run_video_generation(**kwargs))

    @DBOS.step()
    def generate_voiceover_step(step_payload: dict[str, Any]) -> dict | None:
        voiceover_plan = voiceover_plan_from_payload(step_payload["voiceover_plan"])
        asset = raw_tools.generate_voiceover(run_id=step_payload["run_id"], voiceover_plan=voiceover_plan)
        return audio_asset_record_to_payload(asset) if asset else None

    @DBOS.step()
    def assemble_final_video_step(step_payload: dict[str, Any]) -> dict:
        clips = [video_clip_record_from_payload(clip) for clip in step_payload.get("clips", ())]
        voice_asset_payload = step_payload.get("voice_asset")
        voice_asset = audio_asset_record_from_payload(voice_asset_payload) if voice_asset_payload else None
        assembly = raw_tools.assemble_final_video(
            run_id=step_payload["run_id"],
            clips=clips,
            voice_asset=voice_asset,
        )
        return final_assembly_record_to_payload(assembly)

    @DBOS.step()
    def generate_ugc_presenter_step(step_payload: dict[str, Any]) -> dict:
        kwargs = generate_ugc_presenter_input_from_payload(step_payload)
        return ugc_presenter_record_to_payload(raw_tools.generate_ugc_presenter(**kwargs))

    @DBOS.step()
    def compose_ugc_picture_in_picture_step(step_payload: dict[str, Any]) -> dict:
        kwargs = compose_ugc_picture_in_picture_input_from_payload(step_payload)
        return final_assembly_record_to_payload(raw_tools.compose_ugc_picture_in_picture(**kwargs))

    @DBOS.step()
    def apply_post_pass_step(step_payload: dict[str, Any]) -> dict:
        state = production_output_state_from_payload(step_payload)
        return post_pass_plan_to_payload(raw_tools.apply_post_pass(state=state))

    @DBOS.step()
    def apply_audio_mix_step(step_payload: dict[str, Any]) -> dict:
        state = production_output_state_from_payload(step_payload)
        mixed = raw_tools.apply_audio_mix(state=state)
        return audio_mix_step_result_to_payload(state=state, final_assembly=mixed)

    @DBOS.step()
    def apply_render_step(step_payload: dict[str, Any]) -> dict:
        state = production_output_state_from_payload(step_payload)
        rendered = raw_tools.apply_render(state=state)
        return render_step_result_to_payload(state=state, final_assembly=rendered)

    @DBOS.step()
    def validate_output_step(step_payload: dict[str, Any]) -> dict | None:
        return validate_output_from_payload(step_payload)

    @DBOS.step()
    def write_manifest_step(step_payload: dict[str, Any]) -> str:
        return str(write_production_manifest_from_payload(step_payload))

    if director_graph is not None and raw_director_tools is not None:
        director_graph.tools = DurableCreativeDirectorTools(raw_director_tools, run_image_factory_step)
        if raw_director_decision_model is not None:
            director_graph.decision_model = DurableDirectorDecisionModel(
                raw_director_decision_model,
                run_director_decision_step,
            )
    graph.tools = DurableProductionOutputTools(
        raw_tools,
        run_video_generation_step,
        generate_voiceover_step,
        assemble_final_video_step,
        validate_output_step=validate_output_step,
        write_manifest_step=write_manifest_step,
        apply_post_pass_step=apply_post_pass_step,
        apply_audio_mix_step=apply_audio_mix_step,
        apply_render_step=apply_render_step,
        generate_ugc_presenter_step=generate_ugc_presenter_step,
        compose_ugc_picture_in_picture_step=compose_ugc_picture_in_picture_step,
    )

    @DBOS.workflow()
    def creative_production_workflow(workflow_payload: dict[str, Any]) -> dict:
        brief = CreativeBrief(**workflow_payload["brief"])
        result = graph.run(
            CreativeProductionInput(
                brief=brief,
                budget_cap_usd=workflow_payload["budget_cap_usd"],
                max_attempts=workflow_payload["max_attempts"],
                video_quality=workflow_payload["video_quality"],
                run_id=workflow_id,
            )
        )
        return summarize_result(result)

    DBOS(config=dbos_config_from_env(environ))
    DBOS.launch()
    with SetWorkflowID(workflow_id):
        return creative_production_workflow(payload)


def preflight_payload(payload: dict[str, Any]) -> None:
    brief = CreativeBrief(**payload["brief"])
    settings = load_settings()
    if should_preflight_fal_storage(
        brief,
        budget_cap_usd=payload["budget_cap_usd"],
        wavespeed_available=bool(settings.wavespeed_api_key),
    ):
        if not settings.fal_api_key:
            raise RuntimeError("SQUAD_FAL_API_KEY is required for video execution")
        preflight_fal_storage(api_key=settings.fal_api_key, timeout_sec=settings.fal_timeout_sec)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    load_local_env_file()
    brief = load_brief(args.brief_file)
    payload = build_durable_payload(args, brief)
    workflow_id = durable_workflow_id(payload, args.workflow_id)
    if args.preflight_only:
        summary = durable_preflight_summary(payload, workflow_id=workflow_id)
        print(json.dumps(summary, indent=2))
        return 0 if summary["ok"] else 1
    try:
        readiness = require_dbos_ready()
        if not readiness.enabled:
            raise RuntimeError("DBOS production runner is disabled; set SQUAD_DBOS_ENABLED=1 to run durable production")
        preflight_payload(payload)
        result = run_durable_payload(payload, workflow_id=workflow_id)
    except Exception as exc:
        print(json.dumps(summarize_error(exc, brief_file=args.brief_file), indent=2))
        return 1
    result["dbos_workflow_id"] = workflow_id
    result["durable_runner"] = "dbos"
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
