import json
import hashlib
import unittest
from pathlib import Path

from nautilus_trader.model import TradeTick
from nautilus_trader.model.enums import AggressorSide

from trade_god_market_data.fixture_adapter import (
    FixtureQualityError,
    build_canonical_batch,
    canonical_json,
    load_trade_ticks,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "packages" / "trading-testkit" / "fixtures" / "es-demo"
CONTRACT_EXAMPLES = REPO_ROOT / "packages" / "trading-contracts" / "examples"


class FixtureAdapterTest(unittest.TestCase):
    def test_converts_project_fixture_to_exact_nautilus_trade_ticks(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        records = json.loads((FIXTURE_DIR / manifest["events_file"]).read_text())

        ticks = load_trade_ticks(manifest, records)

        self.assertEqual(len(ticks), 4)
        self.assertTrue(all(isinstance(tick, TradeTick) for tick in ticks))
        self.assertEqual(str(ticks[0].instrument_id), "ESU6.XCME")
        self.assertEqual([str(tick.price) for tick in ticks], ["5592.00", "5592.25", "5592.25", "5592.00"])
        self.assertEqual([str(tick.size) for tick in ticks], ["5", "12", "7", "4"])
        self.assertEqual(
            [tick.aggressor_side for tick in ticks],
            [AggressorSide.BUYER, AggressorSide.BUYER, AggressorSide.SELLER, AggressorSide.SELLER],
        )
        self.assertEqual([str(tick.trade_id) for tick in ticks], ["1", "2", "3", "4"])
        self.assertEqual(ticks[0].ts_event, 1_783_780_200_000_000_000)
        self.assertEqual(ticks[0].ts_init, ticks[0].ts_event)
        self.assertEqual(
            [ticks[index + 1].ts_event - ticks[index].ts_event for index in range(3)],
            [10_000_000_000, 10_000_000_000, 10_000_000_000],
        )

    def test_emits_the_exact_cross_language_golden_batch_and_checksum(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        source_bytes = (FIXTURE_DIR / manifest["events_file"]).read_bytes()
        expected = json.loads((CONTRACT_EXAMPLES / "market-trade-batch.v1.json").read_text())

        batch = build_canonical_batch(
            manifest,
            trace_id="trace-market-replay-001",
            batch_id="batch-es-demo-001",
            source_bytes=source_bytes,
        )

        self.assertEqual(batch, expected)
        self.assertEqual(batch["events"][0], json.loads(
            (CONTRACT_EXAMPLES / "market-trade-event.v1.json").read_text(),
        ))
        encoded = canonical_json(batch["events"]).encode("utf-8")
        self.assertEqual(hashlib.sha256(encoded).hexdigest(), batch["canonical_events_sha256"])

    def test_emits_a_complete_deterministic_fixture_batch(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        source_bytes = (FIXTURE_DIR / manifest["events_file"]).read_bytes()

        first = build_canonical_batch(
            manifest,
            trace_id="trace-full-fixture",
            batch_id="batch-full-fixture",
            source_bytes=source_bytes,
        )
        second = build_canonical_batch(
            manifest,
            trace_id="trace-full-fixture",
            batch_id="batch-full-fixture",
            source_bytes=source_bytes,
        )

        self.assertEqual(first, second)
        self.assertEqual(first["quality"]["counts"], {
            "received": 4,
            "accepted": 4,
            "rejected": 0,
            "duplicates": 0,
            "out_of_order": 0,
        })
        self.assertEqual(
            [event["event_id"] for event in first["events"]],
            [f"trade:es-demo-2026-07-11:{sequence}" for sequence in range(1, 5)],
        )

    def test_fails_closed_on_source_checksum_mismatch(self) -> None:
        manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        source_bytes = (FIXTURE_DIR / manifest["events_file"]).read_bytes()

        with self.assertRaises(FixtureQualityError) as raised:
            build_canonical_batch(
                manifest,
                trace_id="trace-corrupt-fixture",
                batch_id="batch-corrupt-fixture",
                source_bytes=b"not-json",
            )

        self.assertEqual(raised.exception.report["state"], "invalid")
        self.assertEqual(raised.exception.report["flags"], ["source-checksum-mismatch"])
        self.assertEqual(raised.exception.report["counts"]["accepted"], 0)

    def test_drops_duplicate_records_and_flags_out_of_order_input(self) -> None:
        original_manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text())
        original_records = json.loads((FIXTURE_DIR / original_manifest["events_file"]).read_text())
        records = [original_records[0], original_records[1], original_records[1], {
            **original_records[2],
            "sequence": 3,
            "event_time": "2026-07-11T14:30:05.000Z",
        }]
        source_bytes = canonical_json(records).encode("utf-8")
        manifest = {
            **original_manifest,
            "event_count": len(records),
            "events_sha256": hashlib.sha256(source_bytes).hexdigest(),
        }

        batch = build_canonical_batch(
            manifest,
            trace_id="trace-degraded-fixture",
            batch_id="batch-degraded-fixture",
            source_bytes=source_bytes,
        )

        self.assertEqual(batch["quality"]["state"], "degraded")
        self.assertEqual(batch["quality"]["counts"], {
            "received": 4,
            "accepted": 3,
            "rejected": 1,
            "duplicates": 1,
            "out_of_order": 1,
        })
        self.assertEqual(
            batch["quality"]["flags"],
            ["duplicate-source-record", "out-of-order-event-time"],
        )
        self.assertEqual(len(batch["events"]), 3)
        self.assertEqual(batch["events"][-1]["quality_flags"], ["out-of-order-event-time"])


if __name__ == "__main__":
    unittest.main()
