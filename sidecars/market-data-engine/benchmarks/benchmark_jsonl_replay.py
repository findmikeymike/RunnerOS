#!/usr/bin/env python3
"""Benchmark the real Trade God JSONL replay process with synthetic fixtures."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tempfile
import time
from typing import Any

from trade_god_market_data.transport_policy import (
    JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND,
    JSONL_REPLAY_SAFE_COMPLETION_BYTES,
    JSONL_SUPERVISOR_MAX_LINE_BYTES,
)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        raise ValueError("percentile requires at least one value")
    ordered = sorted(values)
    rank = max(0, math.ceil(fraction * len(ordered)) - 1)
    return ordered[rank]


def fixture_records(event_count: int) -> list[dict[str, Any]]:
    started = datetime(2026, 7, 11, 14, 30, tzinfo=timezone.utc)
    records: list[dict[str, Any]] = []
    for index in range(event_count):
        event_time = started + timedelta(microseconds=index)
        records.append({
            "event_time": event_time.isoformat(timespec="microseconds").replace("+00:00", "Z"),
            "sequence": index + 1,
            "price": f"{5592 + (index % 8) * 0.25:.2f}",
            "size": str(index % 12 + 1),
            "aggressor": "buy" if index % 2 == 0 else "sell",
        })
    return records


def write_fixture(root: Path, event_count: int) -> None:
    records = fixture_records(event_count)
    events_bytes = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (root / "events.json").write_bytes(events_bytes)
    manifest = {
        "fixture_id": f"jsonl-benchmark-{event_count}",
        "kind": "synthetic-trades",
        "source": "Trade God generated benchmark fixture",
        "redistribution": "project-owned",
        "transformations": ["generated for local benchmark"],
        "events_file": "events.json",
        "events_sha256": hashlib.sha256(events_bytes).hexdigest(),
        "event_count": event_count,
        "instrument": {
            "id": "CME:ESU6",
            "symbol": "ESU6",
            "venue": "XCME",
            "asset_class": "future",
            "currency": "USD",
            "tick_size": "0.25",
            "multiplier": "50",
        },
        "session": {
            "exchange_timezone": "America/Chicago",
            "session_id": "2026-07-11-synthetic",
        },
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


class RpcProcess:
    def __init__(self, python: Path, sidecar_root: Path, fixture_root: Path, mode: str) -> None:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        self._next_id = 0
        command = [str(python), "-m", "trade_god_market_data.cli"] if mode == "enforce" else [
            str(python), str(Path(__file__).with_name("observation_sidecar.py")),
        ]
        self._process = subprocess.Popen(
            [*command, "--fixture-root", str(fixture_root)],
            cwd=sidecar_root,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )

    def request(self, method: str, params: dict[str, Any]) -> tuple[dict[str, Any], float, int]:
        self._next_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": f"benchmark-{self._next_id}",
            "method": method,
            "params": params,
        }
        payload = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        started = time.perf_counter()
        assert self._process.stdin is not None
        assert self._process.stdout is not None
        self._process.stdin.write(payload)
        self._process.stdin.flush()
        line = self._process.stdout.readline()
        elapsed_ms = (time.perf_counter() - started) * 1_000
        if not line:
            assert self._process.stderr is not None
            stderr = self._process.stderr.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"market-data sidecar exited without a response: {stderr}")
        response = json.loads(line)
        if "error" in response:
            raise RpcResponseError(response["error"], elapsed_ms, len(line.rstrip(b"\n")))
        return response["result"], elapsed_ms, len(line.rstrip(b"\n"))

    def close(self) -> None:
        if self._process.poll() is None:
            try:
                self.request("market.shutdown", {})
            except (BrokenPipeError, RpcResponseError):
                self._process.kill()
        self._process.wait(timeout=5)


class RpcResponseError(RuntimeError):
    def __init__(self, error: dict[str, Any], elapsed_ms: float, line_bytes: int) -> None:
        super().__init__(json.dumps(error, sort_keys=True))
        self.error = error
        self.elapsed_ms = elapsed_ms
        self.line_bytes = line_bytes


def benchmark_count(
    python: Path,
    sidecar_root: Path,
    event_count: int,
    pace_ms: int,
    mode: str,
    trial: int,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="trade-god-jsonl-benchmark-") as temporary:
        fixture_root = Path(temporary)
        write_fixture(fixture_root, event_count)
        rpc = RpcProcess(python, sidecar_root, fixture_root, mode)
        try:
            suffix = f"{event_count}-{time.time_ns()}"
            deadline = datetime.now(timezone.utc) + timedelta(seconds=max(30, event_count * pace_ms / 1_000 * 4))
            try:
                _, start_ms, start_line_bytes = rpc.request("market.replay_batch", {
                    "fixture_id": f"jsonl-benchmark-{event_count}",
                    "trace_id": f"benchmark-trace-{suffix}",
                    "batch_id": f"benchmark-batch-{suffix}",
                    "replay_id": f"benchmark-replay-{suffix}",
                    "cancellation_id": f"benchmark-cancel-{suffix}",
                    "pace_interval_ms": pace_ms,
                    "deadline_at": deadline.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                })
            except RpcResponseError as error:
                market_error = error.error.get("data", {}).get("market_error", {})
                return {
                    "event_count": event_count,
                    "trial": trial,
                    "pace_interval_ms": pace_ms,
                    "state": "rejected",
                    "session_start_ms": round(error.elapsed_ms, 3),
                    "response_line_bytes": error.line_bytes,
                    "error_code": market_error.get("code", "UNKNOWN"),
                    "error_category": market_error.get("category", "unknown"),
                }
            event_latencies: list[float] = []
            event_line_bytes: list[int] = []
            replay_started = time.perf_counter()
            completion_ms = 0.0
            completion_line_bytes = 0
            while True:
                step, latency_ms, line_bytes = rpc.request(
                    "market.replay_next",
                    {"replay_id": f"benchmark-replay-{suffix}"},
                )
                if step["state"] == "completed":
                    completion_ms = latency_ms
                    completion_line_bytes = line_bytes
                    break
                event_latencies.append(latency_ms)
                event_line_bytes.append(line_bytes)
            replay_seconds = time.perf_counter() - replay_started
        finally:
            rpc.close()

    return {
        "event_count": event_count,
        "trial": trial,
        "pace_interval_ms": pace_ms,
        "state": "completed",
        "target_events_per_second": round(1_000 / pace_ms, 3),
        "achieved_events_per_second": round(event_count / replay_seconds, 3),
        "session_start_ms": round(start_ms, 3),
        "event_response_ms": {
            "mean": round(statistics.fmean(event_latencies), 3),
            "p50": round(percentile(event_latencies, 0.50), 3),
            "p95": round(percentile(event_latencies, 0.95), 3),
            "p99": round(percentile(event_latencies, 0.99), 3),
            "max": round(max(event_latencies), 3),
        },
        "line_bytes": {
            "session_start": start_line_bytes,
            "event_mean": round(statistics.fmean(event_line_bytes), 1),
            "event_max": max(event_line_bytes),
            "completion": completion_line_bytes,
        },
        "policy_fit": {
            "target_rate_within_protocol_limit": 1_000 / pace_ms <= JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND,
            "completion_within_safe_payload": completion_line_bytes <= JSONL_REPLAY_SAFE_COMPLETION_BYTES,
            "completion_within_supervisor_limit": completion_line_bytes <= JSONL_SUPERVISOR_MAX_LINE_BYTES,
        },
        "completion_response_ms": round(completion_ms, 3),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts", default="100,750,800,1000,10000", help="Comma-separated event counts")
    parser.add_argument("--pace-ms", type=int, default=1)
    parser.add_argument("--mode", choices=("enforce", "observe"), default="enforce")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--assert-policy", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sidecar_root = Path(__file__).resolve().parents[1]
    python = sidecar_root / ".venv" / "bin" / "python"
    counts = [int(value) for value in args.counts.split(",")]
    if not python.is_file():
        raise SystemExit(f"missing benchmark runtime: {python}")
    if any(count <= 0 or count > 10_000 for count in counts):
        raise SystemExit("counts must be between 1 and 10,000")
    if not 1 <= args.pace_ms <= 60_000:
        raise SystemExit("pace-ms must be between 1 and 60,000")
    if not 1 <= args.repeats <= 10:
        raise SystemExit("repeats must be between 1 and 10")
    if args.assert_policy and args.mode != "enforce":
        raise SystemExit("assert-policy requires --mode enforce")

    relevant_files = [
        Path(__file__),
        Path(__file__).with_name("observation_sidecar.py"),
        sidecar_root / "src" / "trade_god_market_data" / "rpc.py",
        sidecar_root / "src" / "trade_god_market_data" / "transport_policy.py",
    ]
    implementation_digest = hashlib.sha256()
    for path in relevant_files:
        implementation_digest.update(path.read_bytes())

    result = {
        "benchmark_schema_version": "market-jsonl-replay-benchmark@1",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "mode": args.mode,
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "python": sys.version.split()[0],
        "implementation_sha256": implementation_digest.hexdigest(),
        "repeats": args.repeats,
        "policy": {
            "supervisor_max_line_bytes": JSONL_SUPERVISOR_MAX_LINE_BYTES,
            "safe_batch_payload_bytes": JSONL_REPLAY_SAFE_COMPLETION_BYTES,
            "protocol_max_target_events_per_second": JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND,
            "dedicated_streaming_required_when": [
                "live_or_unbounded",
                "target_events_per_second_above_1000",
                "completion_response_above_750000_bytes",
            ],
        },
        "runs": [
            benchmark_count(python, sidecar_root, count, args.pace_ms, args.mode, trial)
            for count in counts
            for trial in range(1, args.repeats + 1)
        ],
    }
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    sys.stdout.write(encoded)

    if args.assert_policy:
        admitted = [run for run in result["runs"] if run["event_count"] == 750]
        overflow = [run for run in result["runs"] if run["event_count"] == 800]
        if len(admitted) != args.repeats or len(overflow) != args.repeats \
                or not all(run.get("state") == "completed" and all(run["policy_fit"].values()) for run in admitted) \
                or not all(run.get("state") == "rejected"
                           and run.get("error_code") == "STREAMING_TRANSPORT_REQUIRED" for run in overflow):
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
