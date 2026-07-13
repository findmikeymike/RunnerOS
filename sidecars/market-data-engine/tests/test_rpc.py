import hashlib
import json
import subprocess
import tempfile
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
        self.assertEqual([response["id"] for response in responses], [None, 7, 8])
        self.assertEqual(responses[2]["result"]["state"], "stopped")


if __name__ == "__main__":
    unittest.main()
