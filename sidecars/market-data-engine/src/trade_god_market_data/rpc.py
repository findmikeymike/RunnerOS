"""Small replay-only JSON-RPC boundary for the market-data adapter."""

from collections import OrderedDict
from collections.abc import Mapping
import hashlib
import json
from pathlib import Path
import re
import threading
from typing import Any

from .fixture_adapter import FixtureQualityError, build_canonical_batch, canonical_json
from .paced_replay import PacedReplayRegistry, ReplayLifecycleError
from .transport_policy import (
    JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND,
    JSONL_REPLAY_SAFE_COMPLETION_BYTES,
    JSONL_SUPERVISOR_MAX_LINE_BYTES,
    MAX_RPC_STRING_ID_LENGTH,
    load_requires_dedicated_streaming,
    requires_dedicated_streaming,
)


RPC_PROTOCOL_VERSION = "market-data-rpc@1"
BATCH_SCHEMA_VERSION = "market-trade-batch@1"
COMMANDS = (
    "market.health",
    "market.capabilities",
    "market.load_fixture",
    "market.replay_batch",
    "market.replay_next",
    "market.cancel",
    "market.shutdown",
)
MAX_HANDLED_RESPONSES = 1_024
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$")


def _valid_id(value: Any) -> bool:
    return value is None or (
        isinstance(value, int) and not isinstance(value, bool)
    ) or (
        isinstance(value, str) and len(value) <= MAX_RPC_STRING_ID_LENGTH
    )


class MarketDataRpcHandler:
    """Serve one supervisor-configured fixture without accepting caller paths."""

    def __init__(self, fixture_root: Path) -> None:
        self._fixture_root = fixture_root.resolve()
        self._state = "ready"
        self._handled: OrderedDict[str, tuple[str, dict[str, Any]]] = OrderedDict()
        self._inflight: dict[str, str] = {}
        self._request_lock = threading.RLock()
        self._replays = PacedReplayRegistry()

    @property
    def state(self) -> str:
        return self._state

    def _fixture_id(self) -> str | None:
        try:
            manifest = json.loads((self._fixture_root / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        fixture_id = manifest.get("fixture_id") if isinstance(manifest, Mapping) else None
        return fixture_id if isinstance(fixture_id, str) and fixture_id else None

    def _fixture_dependency(self) -> dict[str, str]:
        name = self._fixture_id() or "configured-fixture"
        state = "unavailable"
        try:
            manifest = json.loads((self._fixture_root / "manifest.json").read_text(encoding="utf-8"))
            if not isinstance(manifest, Mapping) or manifest.get("events_file") != "events.json":
                raise ValueError("unsupported fixture manifest")
            expected_sha256 = manifest.get("events_sha256")
            if not isinstance(expected_sha256, str):
                raise ValueError("missing fixture checksum")
            actual_sha256 = hashlib.sha256((self._fixture_root / "events.json").read_bytes()).hexdigest()
            if actual_sha256 != expected_sha256:
                raise ValueError("fixture checksum mismatch")
            state = "ready"
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
            pass
        return {"name": name, "state": state}

    def _capabilities(self) -> dict[str, Any]:
        fixture_id = self._fixture_id()
        return {
            "commands": list(COMMANDS),
            "fixture_mode": True,
            "fixture_ids": [fixture_id] if fixture_id else [],
            "live_data": False,
            "broker_access": False,
            "trade_execution": False,
            "transport_policy": {
                "mode": "bounded-jsonl-control",
                "supervisor_max_line_bytes": JSONL_SUPERVISOR_MAX_LINE_BYTES,
                "safe_completion_bytes": JSONL_REPLAY_SAFE_COMPLETION_BYTES,
                "protocol_max_target_events_per_second": JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND,
                "dedicated_streaming_required_for_live": True,
            },
        }

    @staticmethod
    def _success(request_id: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _failure(
        request_id: Any,
        rpc_code: int,
        code: str,
        category: str,
        message: str,
        *,
        quality_report: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        market_error: dict[str, Any] = {
            "code": code,
            "category": category,
            "message": message,
            "retryable": False,
        }
        if quality_report is not None:
            market_error["quality_report"] = quality_report
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": rpc_code,
                "message": message,
                "data": {"market_error": market_error},
            },
        }

    def _load_fixture(self, request_id: Any, params: Any) -> dict[str, Any]:
        if not isinstance(params, Mapping) or set(params) != {"fixture_id", "trace_id", "batch_id"}:
            return self._failure(
                request_id, -32600, "INVALID_REQUEST", "validation",
                "fixture_id, trace_id, and batch_id are required.",
            )
        if not all(
            isinstance(params[key], str) and 0 < len(params[key]) <= 200
            for key in ("fixture_id", "trace_id", "batch_id")
        ):
            return self._failure(
                request_id, -32600, "INVALID_REQUEST", "validation",
                "Fixture request identifiers must be non-empty bounded strings.",
            )

        fixture_id = self._fixture_id()
        if fixture_id is None:
            return self._failure(
                request_id, -32000, "FIXTURE_UNAVAILABLE", "internal",
                "The configured market-data fixture is unavailable.",
            )
        if params["fixture_id"] != fixture_id:
            return self._failure(
                request_id, -32000, "FIXTURE_NOT_FOUND", "validation",
                "Requested market-data fixture is unavailable.",
            )

        try:
            manifest_value = json.loads(
                (self._fixture_root / "manifest.json").read_text(encoding="utf-8"),
            )
            if not isinstance(manifest_value, Mapping) or manifest_value.get("events_file") != "events.json":
                raise ValueError("unsupported fixture manifest")
            source_bytes = (self._fixture_root / "events.json").read_bytes()
            batch = build_canonical_batch(
                manifest_value,
                trace_id=params["trace_id"],
                batch_id=params["batch_id"],
                source_bytes=source_bytes,
            )
        except FixtureQualityError as error:
            return self._failure(
                request_id, -32000, "MARKET_DATA_INVALID", "data-quality",
                str(error), quality_report=error.report,
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError):
            return self._failure(
                request_id, -32000, "FIXTURE_UNAVAILABLE", "internal",
                "The configured market-data fixture could not be loaded.",
            )

        if load_requires_dedicated_streaming(batch):
            return self._failure(
                request_id, -32000, "STREAMING_TRANSPORT_REQUIRED", "transport",
                "Fixture result exceeds the measured bounded JSONL transport policy.",
            )

        return self._success(request_id, batch)

    @staticmethod
    def _valid_identifier(value: Any) -> bool:
        return isinstance(value, str) and IDENTIFIER_PATTERN.fullmatch(value) is not None

    def _start_replay(self, request_id: Any, params: Any) -> dict[str, Any]:
        required = {
            "fixture_id", "trace_id", "batch_id", "replay_id", "cancellation_id",
            "pace_interval_ms", "deadline_at",
        }
        if not isinstance(params, Mapping) or set(params) != required:
            return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Paced replay request is invalid.")
        if not all(self._valid_identifier(params[key]) for key in (
            "fixture_id", "trace_id", "batch_id", "replay_id", "cancellation_id",
        )) or not isinstance(params["pace_interval_ms"], int) or isinstance(params["pace_interval_ms"], bool) \
                or not 1 <= params["pace_interval_ms"] <= 60_000 \
                or not isinstance(params["deadline_at"], str):
            return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Paced replay fields are invalid.")
        loaded = self._load_fixture(request_id, {
            "fixture_id": params["fixture_id"], "trace_id": params["trace_id"], "batch_id": params["batch_id"],
        })
        if "error" in loaded:
            return loaded
        if requires_dedicated_streaming(loaded["result"], params["pace_interval_ms"]):
            return self._failure(
                request_id, -32000, "STREAMING_TRANSPORT_REQUIRED", "transport",
                "Replay exceeds the measured bounded JSONL transport policy.",
            )
        try:
            result = self._replays.start(
                replay_id=params["replay_id"], cancellation_id=params["cancellation_id"],
                batch=loaded["result"], pace_interval_ms=params["pace_interval_ms"],
                deadline_at=params["deadline_at"],
            )
        except (ReplayLifecycleError, TypeError, ValueError) as error:
            if isinstance(error, ReplayLifecycleError):
                return self._failure(request_id, -32000, error.code, error.category, str(error))
            return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Replay deadline is invalid.")
        return self._success(request_id, result)

    def _next_replay(self, request_id: Any, params: Any) -> dict[str, Any]:
        if not isinstance(params, Mapping) or set(params) != {"replay_id"} or not self._valid_identifier(params["replay_id"]):
            return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "replay_id is required.")
        try:
            return self._success(request_id, self._replays.next(params["replay_id"]))
        except ReplayLifecycleError as error:
            return self._failure(request_id, -32000, error.code, error.category, str(error))

    def _cancel_replay(self, request_id: Any, params: Any) -> dict[str, Any]:
        if not isinstance(params, Mapping) or set(params) != {"cancellation_id"} \
                or not self._valid_identifier(params["cancellation_id"]):
            return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "cancellation_id is required.")
        try:
            return self._success(request_id, self._replays.cancel(params["cancellation_id"]))
        except ReplayLifecycleError as error:
            return self._failure(request_id, -32000, error.code, error.category, str(error))

    def _execute(self, request: Mapping[str, Any]) -> dict[str, Any]:
        request_id = request["id"]
        method = request["method"]
        params = request.get("params")

        if method == "market.health":
            if params not in (None, {}):
                return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Health takes no parameters.")
            dependency = self._fixture_dependency()
            health_state = self._state if self._state == "stopped" else (
                "ready" if dependency["state"] == "ready" else "degraded"
            )
            return self._success(request_id, {
                "service": "trade-god-market-data-engine",
                "version": "0.1.0",
                "state": health_state,
                "protocol_version": RPC_PROTOCOL_VERSION,
                "artifact_versions": [BATCH_SCHEMA_VERSION],
                "capabilities": self._capabilities(),
                "dependencies": [dependency],
            })

        if method == "market.capabilities":
            if params not in (None, {}):
                return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Capabilities takes no parameters.")
            return self._success(request_id, {
                "protocol_version": RPC_PROTOCOL_VERSION,
                "artifact_versions": [BATCH_SCHEMA_VERSION],
                **self._capabilities(),
            })

        if method == "market.load_fixture":
            if self._state != "ready":
                return self._failure(request_id, -32000, "SERVICE_STOPPED", "lifecycle", "Market-data service is stopped.")
            return self._load_fixture(request_id, params)

        if method == "market.replay_batch":
            if self._state != "ready":
                return self._failure(request_id, -32000, "SERVICE_STOPPED", "lifecycle", "Market-data service is stopped.")
            return self._start_replay(request_id, params)

        if method == "market.replay_next":
            if self._state != "ready":
                return self._failure(request_id, -32000, "SERVICE_STOPPED", "lifecycle", "Market-data service is stopped.")
            return self._next_replay(request_id, params)

        if method == "market.cancel":
            if self._state != "ready":
                return self._failure(request_id, -32000, "SERVICE_STOPPED", "lifecycle", "Market-data service is stopped.")
            return self._cancel_replay(request_id, params)

        if method == "market.shutdown":
            if params not in (None, {}):
                return self._failure(request_id, -32600, "INVALID_REQUEST", "validation", "Shutdown takes no parameters.")
            self._state = "stopped"
            self._replays.stop()
            return self._success(request_id, {"state": self._state})

        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}

    def handle(self, request: Any) -> dict[str, Any]:
        if (
            not isinstance(request, Mapping)
            or request.get("jsonrpc") != "2.0"
            or "id" not in request
            or not _valid_id(request.get("id"))
            or not isinstance(request.get("method"), str)
        ):
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}

        request_id = request["id"]
        key = f"{type(request_id).__name__}:{request_id}"
        digest = canonical_json(request)
        with self._request_lock:
            prior = self._handled.get(key)
            if prior is not None:
                self._handled.move_to_end(key)
                if prior[0] == digest:
                    return prior[1]
                return self._failure(
                    request_id, -32600, "DUPLICATE_REQUEST_ID", "validation",
                    "Request id was reused with different content.",
                )
            inflight_digest = self._inflight.get(key)
            if inflight_digest is not None:
                return self._failure(
                    request_id, -32600, "REQUEST_IN_PROGRESS" if inflight_digest == digest else "DUPLICATE_REQUEST_ID",
                    "lifecycle" if inflight_digest == digest else "validation",
                    "Request id is already in progress." if inflight_digest == digest else "Request id was reused with different content.",
                )
            self._inflight[key] = digest

        try:
            response = self._execute(request)
        finally:
            with self._request_lock:
                self._inflight.pop(key, None)
        with self._request_lock:
            self._handled[key] = (digest, response)
            self._handled.move_to_end(key)
            if len(self._handled) > MAX_HANDLED_RESPONSES:
                self._handled.popitem(last=False)
        return response
