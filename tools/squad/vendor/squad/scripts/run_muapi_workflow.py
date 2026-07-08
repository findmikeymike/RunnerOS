#!/usr/bin/env python3
"""Run a MuAPI workflow from Squad, with dry-run as the default."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from creative.muapi_workflows import (
    MuAPIWorkflowClient,
    artifact_candidate_to_payload,
    discover_artifact_urls,
    download_artifacts,
    redact_payload_urls,
    validate_workflow_inputs,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate or execute a MuAPI workflow by ID.")
    parser.add_argument("--workflow-id", required=True)
    parser.add_argument("--inputs-json", required=True, help="JSON object of MuAPI workflow inputs")
    parser.add_argument("--output-dir", default=".outputs/muapi-workflow-runs")
    parser.add_argument("--api-key-env", default="MUAPI_API_KEY")
    parser.add_argument("--execute", action="store_true", help="Actually execute the hosted workflow. May spend provider credits.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    api_key = os.getenv(args.api_key_env, "").strip()
    if not api_key:
        raise SystemExit(f"{args.api_key_env} is required")
    inputs = _load_inputs(args.inputs_json)
    client = MuAPIWorkflowClient(api_key=api_key)
    schema = client.get_workflow_inputs(args.workflow_id)
    missing = validate_workflow_inputs(schema=schema, inputs=inputs)
    if missing:
        raise SystemExit(f"missing required workflow inputs: {', '.join(missing)}")

    run_id = f"muapi-{uuid4().hex[:12]}"
    run_dir = Path(args.output_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "run_id": run_id,
        "workflow_id": args.workflow_id,
        "executed": bool(args.execute),
        "inputs": inputs,
        "schema": schema,
        "result": None,
        "artifact_candidates": [],
        "artifacts": [],
    }
    if args.execute:
        result = client.execute_workflow(args.workflow_id, inputs=inputs)
        artifact_candidates = discover_artifact_urls(result)
        manifest["result"] = redact_payload_urls(result)
        manifest["artifact_candidates"] = [artifact_candidate_to_payload(candidate) for candidate in artifact_candidates]
        manifest["artifacts"] = download_artifacts(artifact_candidates, run_dir / "artifacts")
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    print(
        json.dumps(
            {
                "manifest_path": str(manifest_path),
                "executed": bool(args.execute),
                "artifact_count": len(manifest["artifacts"]),
            },
            indent=2,
        )
    )
    return 0


def _load_inputs(value: str) -> dict:
    path = Path(value)
    raw = path.read_text(encoding="utf-8") if path.exists() else value
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise SystemExit("--inputs-json must be a JSON object or path to one")
    return payload


if __name__ == "__main__":
    sys.exit(main())
