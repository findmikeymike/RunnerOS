import json
import unittest
from pathlib import Path

from nautilus_trader.model import TradeTick
from nautilus_trader.model.enums import AggressorSide

from trade_god_market_data.fixture_adapter import load_trade_ticks


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "packages" / "trading-testkit" / "fixtures" / "es-demo"


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


if __name__ == "__main__":
    unittest.main()
