"""Measured policy for the bounded JSONL replay control transport."""

from __future__ import annotations

import json
from typing import Any


JSONL_SUPERVISOR_MAX_LINE_BYTES = 1_000_000
JSONL_REPLAY_SAFE_COMPLETION_BYTES = 750_000
JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND = 1_000
MAX_RPC_STRING_ID_LENGTH = 200


def estimated_completion_response_bytes(batch: dict[str, Any]) -> int:
    """Upper-bound a completed replay line using the largest accepted RPC id."""

    result = {
        "replay_step_schema_version": "market-replay-step@1",
        "replay_id": "x" * 160,
        "trace_id": str(batch["trace_id"]),
        "batch_id": str(batch["batch_id"]),
        "state": "completed",
        "emitted_count": len(batch["events"]),
        "remaining_count": 0,
        "completed_at": "2026-07-14T18:17:15.000Z",
        "batch": batch,
    }
    response = {"jsonrpc": "2.0", "id": "x" * MAX_RPC_STRING_ID_LENGTH, "result": result}
    return len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def estimated_load_response_bytes(batch: dict[str, Any]) -> int:
    response = {"jsonrpc": "2.0", "id": "x" * MAX_RPC_STRING_ID_LENGTH, "result": batch}
    return len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def load_requires_dedicated_streaming(batch: dict[str, Any]) -> bool:
    return estimated_load_response_bytes(batch) > JSONL_REPLAY_SAFE_COMPLETION_BYTES


def requires_dedicated_streaming(batch: dict[str, Any], pace_interval_ms: int) -> bool:
    target_events_per_second = 1_000 / pace_interval_ms
    return (
        target_events_per_second > JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND
        or estimated_completion_response_bytes(batch) > JSONL_REPLAY_SAFE_COMPLETION_BYTES
    )
