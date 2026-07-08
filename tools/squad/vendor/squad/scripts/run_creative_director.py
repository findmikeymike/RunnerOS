#!/usr/bin/env python3
"""CLI entrypoint for creative-director-v1."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import load_settings
from creative.director.contracts import CreativeDirectorInput
from creative.director.decision_model import OpenAIResponsesDirectorDecisionModel
from creative.director.graph import CreativeDirectorGraph
from creative.director.tools import CreativeDirectorTools
from creative.image_factory.fal_client import FalImageClient, HttpFalTransport
from creative.image_factory.openai_client import HttpOpenAIImageTransport, OpenAIImageClient
from creative.image_factory.provider_router import ImageProviderRoutingClient
from workflows.image_factory_workflow import ImageFactoryWorkflow
from content.writing.brief_generator import CreativeBrief


def _collect_error_messages(exc: BaseException) -> list[str]:
    messages: list[str] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message = str(current).strip()
        if message:
            messages.append(message)
        current = current.__cause__ or current.__context__
    return messages


def _extract_manifest_path(messages: list[str]) -> str | None:
    marker = "manifest written to "
    for message in messages:
        if marker in message:
            return message.split(marker, 1)[1].strip()
    return None


def summarize_error(exc: BaseException, *, brief_file: str | Path) -> dict:
    messages = _collect_error_messages(exc)
    joined = "\n".join(messages).lower()
    manifest_path = _extract_manifest_path(messages)

    provider = None
    error_code = "runtime_failure"
    retryable = False
    follow_up = "inspect the stored manifest and upstream provider state before retrying"
    message = messages[0] if messages else repr(exc)

    if "billing_hard_limit_reached" in joined or "billing hard limit" in joined:
        provider = "openai"
        error_code = "openai_billing_limit"
        follow_up = "raise the OpenAI billing limit or route image generation to a funded provider, then rerun"

    if "fal.ai" in joined or "fal " in joined or "rest.fal.ai" in joined:
        provider = "fal"
        error_code = "fal_provider_failure"
        follow_up = "refresh SQUAD_FAL_API_KEY and rerun the affected brief or baseline"
        if "403 forbidden" in joined:
            error_code = "fal_auth_failure"
            follow_up = "refresh SQUAD_FAL_API_KEY or account access, then rerun the affected brief or baseline"
        elif "429" in joined or "rate limit" in joined:
            error_code = "fal_rate_limit"
            retryable = True
            follow_up = "wait for provider limits to clear, then rerun the affected brief or baseline"
        elif "timeout" in joined:
            error_code = "fal_timeout"
            retryable = True
            follow_up = "retry after the transient upstream timeout clears"

    return {
        "error": True,
        "error_code": error_code,
        "provider": provider,
        "message": message,
        "manifest_path": manifest_path,
        "brief_file": str(brief_file),
        "retryable": retryable,
        "follow_up": follow_up,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run creative-director-v1 from a brief file.")
    parser.add_argument("--brief-file", required=True, help="Path to a JSON creative brief file")
    parser.add_argument("--max-attempts", type=int, default=3, help="Maximum strategic attempts")
    parser.add_argument("--budget-cap-usd", type=float, default=None, help="Optional director budget override")
    parser.add_argument(
        "--image-eval-provider",
        choices=("auto", "openai", "off", "structural"),
        default="auto",
        help="Image scoring mode for this operator run",
    )
    return parser


def load_brief(path: str | Path) -> CreativeBrief:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return CreativeBrief(**payload)


def _apply_runner_runtime_defaults(settings, image_eval_provider: str):
    provider = image_eval_provider.strip().lower()
    effective_provider = settings.image_eval_provider

    if provider == "auto":
        if settings.openai_api_key and settings.image_eval_provider.strip().lower() in {"", "off", "none"}:
            effective_provider = "openai"
    else:
        effective_provider = provider

    return replace(settings, image_eval_provider=effective_provider)


def build_runtime(*, image_eval_provider: str = "auto"):
    settings = _apply_runner_runtime_defaults(load_settings(), image_eval_provider)
    if not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY or SQUAD_OPENAI_API_KEY is required for director decisions")

    fal_client = None
    if settings.fal_api_key:
        transport = HttpFalTransport(
            api_key=settings.fal_api_key,
            base_url=settings.fal_api_base_url,
            timeout_sec=settings.fal_timeout_sec,
        )
        fal_client = FalImageClient(transport=transport)
    openai_client = OpenAIImageClient(
        transport=HttpOpenAIImageTransport(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout_sec=settings.fal_timeout_sec,
        )
    )
    image_client = ImageProviderRoutingClient(fal_client=fal_client, openai_client=openai_client)
    workflow = ImageFactoryWorkflow.from_settings(image_client, settings)
    tools = CreativeDirectorTools(workflow=workflow)
    decision_model = OpenAIResponsesDirectorDecisionModel(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )
    return tools, decision_model


def summarize_result(result) -> dict:
    return {
        "run_id": result.run_id,
        "final_status": str(result.final_status),
        "director_manifest_path": str(result.director_manifest_path) if result.director_manifest_path else None,
        "attempt_count": result.attempt_count,
        "total_spend_usd": result.total_spend_usd,
        "latest_action": result.latest_decision.action if result.latest_decision else None,
        "latest_rationale": result.latest_decision.rationale if result.latest_decision else None,
        "best_candidate_id": result.best_candidate.candidate_id if result.best_candidate else None,
        "best_candidate_score": result.best_candidate.score if result.best_candidate else None,
        "has_review_packet": bool(result.human_review_packet),
        "review_path": str(result.human_review_packet.review_path) if result.human_review_packet and result.human_review_packet.review_path else None,
        "approval_payload": result.human_review_packet.approval_payload if result.human_review_packet else None,
    }


def main(argv: list[str] | None = None, *, tools=None, decision_model=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    brief = load_brief(args.brief_file)
    if tools is None or decision_model is None:
        tools, decision_model = build_runtime(image_eval_provider=args.image_eval_provider)

    graph = CreativeDirectorGraph(tools=tools, decision_model=decision_model)
    try:
        result = graph.run(
            CreativeDirectorInput(
                brief=brief,
                budget_cap_usd=args.budget_cap_usd,
                max_attempts=args.max_attempts,
            )
        )
    except Exception as exc:
        print(json.dumps(summarize_error(exc, brief_file=args.brief_file), indent=2))
        return 1
    print(json.dumps(summarize_result(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
