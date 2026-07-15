import json
import unittest
from pathlib import Path

from trade_god_market_data.transport_policy import (
    JSONL_REPLAY_SAFE_COMPLETION_BYTES,
    JSONL_SUPERVISOR_MAX_LINE_BYTES,
    estimated_completion_response_bytes,
    estimated_load_response_bytes,
    load_requires_dedicated_streaming,
    requires_dedicated_streaming,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLE_BATCH = REPO_ROOT / "packages" / "trading-contracts" / "examples" / "market-trade-batch.v1.json"


class TransportPolicyTest(unittest.TestCase):
    def test_safe_limit_preserves_headroom_below_the_supervisor_frame_limit(self) -> None:
        self.assertLess(JSONL_REPLAY_SAFE_COMPLETION_BYTES, JSONL_SUPERVISOR_MAX_LINE_BYTES)

    def test_accepts_the_canonical_fixture_at_the_fastest_jsonl_pace(self) -> None:
        batch = json.loads(EXAMPLE_BATCH.read_text())

        self.assertFalse(requires_dedicated_streaming(batch, 1))
        self.assertLess(estimated_completion_response_bytes(batch), JSONL_REPLAY_SAFE_COMPLETION_BYTES)

    def test_requires_streaming_before_the_completion_frame_loses_headroom(self) -> None:
        batch = json.loads(EXAMPLE_BATCH.read_text())
        batch["events"][0]["extensions"]["benchmark.padding"] = "x" * 750_000

        self.assertTrue(requires_dedicated_streaming(batch, 1))

    def test_applies_the_same_safe_frame_policy_to_direct_fixture_loads(self) -> None:
        batch = json.loads(EXAMPLE_BATCH.read_text())
        batch["events"][0]["extensions"]["benchmark.padding"] = "x" * 750_000

        self.assertTrue(load_requires_dedicated_streaming(batch))
        self.assertGreater(estimated_load_response_bytes(batch), JSONL_REPLAY_SAFE_COMPLETION_BYTES)


if __name__ == "__main__":
    unittest.main()
