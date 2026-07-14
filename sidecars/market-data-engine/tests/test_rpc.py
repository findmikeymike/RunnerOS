import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import queue
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from trade_god_market_data.rpc import MarketDataRpcHandler


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "packages" / "trading-testkit" / "fixtures" / "es-demo"
EXPECTED_BATCH = REPO_ROOT / "packages" / "trading-contracts" / "examples" / "market-trade-batch.v1.json"


def request(request_id: int, method: str, params: dict | None = None) -> dict:
    value = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        value["params"] = params
    return value


def replay_params(replay_id: str, cancellation_id: str, *, pace_ms: int = 10, deadline_ms: int = 5_000) -> dict:
    deadline = datetime.now(timezone.utc) + timedelta(milliseconds=deadline_ms)
    return {
        "fixture_id": "es-demo-2026-07-11",
        "trace_id": f"trace-{replay_id}",
        "batch_id": f"batch-{replay_id}",
        "replay_id": replay_id,
        "cancellation_id": cancellation_id,
        "pace_interval_ms": pace_ms,
        "deadline_at": deadline.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


class MarketDataRpcHandlerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.handler = MarketDataRpcHandler(FIXTURE_DIR)

    def test_advertises_replay_only_capabilities_and_no_execution_authority(self) -> None:
        response = self.handler.handle(request(1, "market.health"))

        self.assertEqual(response["result"]["state"], "ready")
        capabilities = response["result"]["capabilities"]
        self.assertTrue(capabilities["fixture_mode"])
        self.assertFalse(capabilities["live_data"])
        self.assertFalse(capabilities["broker_access"])
        self.assertFalse(capabilities["trade_execution"])
        self.assertEqual(capabilities["fixture_ids"], ["es-demo-2026-07-11"])
        self.assertEqual(response["result"]["dependencies"], [{
            "name": "es-demo-2026-07-11",
            "state": "ready",
        }])

    def test_health_degrades_when_the_configured_fixture_is_not_loadable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
            (root / "manifest.json").write_text(json.dumps(manifest))
            response = MarketDataRpcHandler(root).handle(request(99, "market.health"))

        self.assertEqual(response["result"]["state"], "degraded")
        self.assertEqual(response["result"]["dependencies"][0]["state"], "unavailable")

    def test_loads_only_the_owned_fixture_and_emits_the_exact_golden_batch(self) -> None:
        response = self.handler.handle(request(2, "market.load_fixture", {
            "fixture_id": "es-demo-2026-07-11",
            "trace_id": "trace-market-replay-001",
            "batch_id": "batch-es-demo-001",
        }))

        self.assertEqual(response["result"], json.loads(EXPECTED_BATCH.read_text()))
        unavailable = self.handler.handle(request(3, "market.load_fixture", {
            "fixture_id": "../../private",
            "trace_id": "trace-safe",
            "batch_id": "batch-safe",
        }))
        self.assertEqual(unavailable["error"]["data"]["market_error"]["code"], "FIXTURE_NOT_FOUND")

    def test_maps_fixture_quality_failures_to_typed_rpc_errors(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        malformed = b"not-json"
        manifest["events_sha256"] = hashlib.sha256(malformed).hexdigest()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(json.dumps(manifest))
            (root / "events.json").write_bytes(malformed)
            response = MarketDataRpcHandler(root).handle(request(4, "market.load_fixture", {
                "fixture_id": "es-demo-2026-07-11",
                "trace_id": "trace-invalid",
                "batch_id": "batch-invalid",
            }))

        error = response["error"]["data"]["market_error"]
        self.assertEqual(error["code"], "MARKET_DATA_INVALID")
        self.assertEqual(error["quality_report"]["flags"], ["malformed-source-payload"])

    def test_rejects_invalid_requests_and_reused_ids(self) -> None:
        invalid = self.handler.handle({"jsonrpc": "2.0", "id": 5, "method": "market.load_fixture", "params": {}})
        self.assertEqual(invalid["error"]["code"], -32600)

        first = self.handler.handle(request(6, "market.capabilities"))
        repeated = self.handler.handle(request(6, "market.capabilities"))
        conflict = self.handler.handle(request(6, "market.health"))
        self.assertEqual(first, repeated)
        self.assertEqual(conflict["error"]["data"]["market_error"]["code"], "DUPLICATE_REQUEST_ID")

    def test_pulls_a_complete_batch_at_the_declared_pace(self) -> None:
        started = time.monotonic()
        session = self.handler.handle(request(20, "market.replay_batch", replay_params("replay-complete", "cancel-complete")))
        self.assertEqual(session["result"]["state"], "ready")

        steps = [self.handler.handle(request(21 + index, "market.replay_next", {"replay_id": "replay-complete"}))
                 for index in range(5)]

        self.assertEqual([step["result"]["state"] for step in steps], ["event", "event", "event", "event", "completed"])
        completed_batch = steps[-1]["result"]["batch"]
        self.assertEqual(completed_batch["trace_id"], "trace-replay-complete")
        self.assertEqual(completed_batch["batch_id"], "batch-replay-complete")
        self.assertEqual(len(completed_batch["events"]), 4)
        self.assertGreaterEqual(time.monotonic() - started, 0.025)

    def test_cancel_overtakes_a_waiting_replay_without_stopping_the_service(self) -> None:
        self.handler.handle(request(30, "market.replay_batch", replay_params(
            "replay-cancel", "cancel-active-replay", pace_ms=250,
        )))
        first = self.handler.handle(request(31, "market.replay_next", {"replay_id": "replay-cancel"}))
        self.assertEqual(first["result"]["state"], "event")
        with ThreadPoolExecutor(max_workers=2) as executor:
            waiting = executor.submit(self.handler.handle, request(32, "market.replay_next", {"replay_id": "replay-cancel"}))
            time.sleep(0.02)
            canceled = self.handler.handle(request(33, "market.cancel", {"cancellation_id": "cancel-active-replay"}))
            interrupted = waiting.result(timeout=1)

        self.assertEqual(canceled["result"]["state"], "canceled")
        self.assertEqual(interrupted["error"]["data"]["market_error"]["code"], "CANCELED")
        self.assertEqual(interrupted["error"]["data"]["market_error"]["category"], "canceled")
        self.assertEqual(self.handler.handle(request(34, "market.health"))["result"]["state"], "ready")

    def test_deadline_interrupts_pacing_as_a_timeout_not_a_crash(self) -> None:
        self.handler.handle(request(40, "market.replay_batch", replay_params(
            "replay-deadline", "cancel-deadline", pace_ms=500, deadline_ms=50,
        )))
        self.handler.handle(request(41, "market.replay_next", {"replay_id": "replay-deadline"}))
        started = time.monotonic()
        response = self.handler.handle(request(42, "market.replay_next", {"replay_id": "replay-deadline"}))

        self.assertEqual(response["error"]["data"]["market_error"]["code"], "DEADLINE_EXCEEDED")
        self.assertEqual(response["error"]["data"]["market_error"]["category"], "timeout")
        self.assertLess(time.monotonic() - started, 0.3)

    def test_rejects_invalid_deadlines_and_bounds_active_replay_sessions(self) -> None:
        invalid = replay_params("replay-invalid-deadline", "cancel-invalid-deadline")
        invalid["deadline_at"] = "2026-07-13T12:00:00"
        response = self.handler.handle(request(60, "market.replay_batch", invalid))
        self.assertEqual(response["error"]["data"]["market_error"]["code"], "INVALID_REQUEST")
        self.assertEqual(self.handler.handle(request(61, "market.health"))["result"]["state"], "ready")

        bounded = MarketDataRpcHandler(FIXTURE_DIR)
        for index in range(64):
            result = bounded.handle(request(100 + index, "market.replay_batch", replay_params(
                f"replay-capacity-{index}", f"cancel-capacity-{index}",
            )))
            self.assertIn("result", result)
        overflow = bounded.handle(request(200, "market.replay_batch", replay_params(
            "replay-capacity-overflow", "cancel-capacity-overflow",
        )))
        self.assertEqual(overflow["error"]["data"]["market_error"]["code"], "REPLAY_CAPACITY_EXCEEDED")
        bounded.handle(request(201, "market.cancel", {"cancellation_id": "cancel-capacity-0"}))
        admitted = bounded.handle(request(202, "market.replay_batch", replay_params(
            "replay-capacity-replacement", "cancel-capacity-replacement",
        )))
        self.assertIn("result", admitted)

    def test_bounds_the_idempotency_window(self) -> None:
        for request_id in range(1_025):
            response = self.handler.handle(request(request_id, "market.capabilities"))
            self.assertIn("result", response)

        evicted_id_can_be_reused = self.handler.handle(request(0, "market.health"))
        self.assertIn("result", evicted_id_can_be_reused)

    def test_cli_uses_one_json_response_per_line_and_shuts_down_cleanly(self) -> None:
        commands = "NaN\n" + "\n".join(json.dumps(value) for value in (
            request(7, "market.health"),
            request(8, "market.shutdown"),
        )) + "\n"
        completed = subprocess.run(
            [
                str(Path(__file__).resolve().parents[1] / ".venv" / "bin" / "python"),
                "-m",
                "trade_god_market_data.cli",
                "--fixture-root",
                str(FIXTURE_DIR),
            ],
            input=commands,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stderr, "")
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(responses[0]["error"]["code"], -32700)
        self.assertEqual({response["id"] for response in responses}, {None, 7, 8})
        self.assertEqual(next(response for response in responses if response["id"] == 8)["result"]["state"], "stopped")

    def test_cli_processes_cancel_while_replay_next_is_waiting(self) -> None:
        process = subprocess.Popen(
            [
                str(Path(__file__).resolve().parents[1] / ".venv" / "bin" / "python"),
                "-m", "trade_god_market_data.cli", "--fixture-root", str(FIXTURE_DIR),
            ],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.assertIsNotNone(process.stdin)
        self.assertIsNotNone(process.stdout)
        responses: queue.Queue[str] = queue.Queue()
        reader = threading.Thread(target=lambda: [responses.put(line) for line in process.stdout], daemon=True)
        reader.start()

        def send(value: dict) -> None:
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()

        def receive() -> dict:
            return json.loads(responses.get(timeout=3))

        try:
            send(request(50, "market.replay_batch", replay_params("replay-cli", "cancel-cli", pace_ms=500)))
            self.assertEqual(receive()["result"]["state"], "ready")
            send(request(51, "market.replay_next", {"replay_id": "replay-cli"}))
            self.assertEqual(receive()["result"]["state"], "event")
            send(request(52, "market.replay_next", {"replay_id": "replay-cli"}))
            send(request(53, "market.cancel", {"cancellation_id": "cancel-cli"}))
            pair = {response["id"]: response for response in (receive(), receive())}
            self.assertEqual(pair[53]["result"]["state"], "canceled")
            self.assertEqual(pair[52]["error"]["data"]["market_error"]["code"], "CANCELED")
            send(request(54, "market.health"))
            self.assertEqual(receive()["result"]["state"], "ready")
            send(request(55, "market.shutdown"))
            self.assertEqual(receive()["result"]["state"], "stopped")
            process.wait(timeout=3)
            self.assertEqual(process.returncode, 0)
            self.assertEqual(process.stderr.read(), "")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)
            process.stdin.close()
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
