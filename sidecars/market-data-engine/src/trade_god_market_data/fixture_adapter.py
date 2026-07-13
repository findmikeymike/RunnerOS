"""Convert project-owned recorded trades into Nautilus domain objects."""

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

from nautilus_trader.model.data import TradeTick
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.identifiers import InstrumentId, TradeId
from nautilus_trader.model.objects import Price, Quantity


_AGGRESSOR_SIDES = {
    "buy": AggressorSide.BUYER,
    "sell": AggressorSide.SELLER,
}


def _utc_nanoseconds(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("event_time must include a UTC offset")

    utc = parsed.astimezone(timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = utc - epoch
    return (
        (delta.days * 86_400 + delta.seconds) * 1_000_000_000
        + delta.microseconds * 1_000
    )


def load_trade_ticks(
    manifest: Mapping[str, Any],
    records: Sequence[Mapping[str, Any]],
) -> tuple[TradeTick, ...]:
    """Return immutable, deterministic Nautilus TradeTicks for a fixture batch."""

    instrument = manifest["instrument"]
    instrument_id = InstrumentId.from_str(
        f"{instrument['symbol']}.{instrument['venue']}",
    )
    ticks: list[TradeTick] = []

    for record in records:
        aggressor = str(record["aggressor"])
        if aggressor not in _AGGRESSOR_SIDES:
            raise ValueError(f"unsupported aggressor side: {aggressor}")

        ts_event = _utc_nanoseconds(str(record["event_time"]))
        sequence = str(record["sequence"])
        ticks.append(
            TradeTick(
                instrument_id=instrument_id,
                price=Price.from_str(str(record["price"])),
                size=Quantity.from_str(str(record["size"])),
                aggressor_side=_AGGRESSOR_SIDES[aggressor],
                trade_id=TradeId(sequence),
                ts_event=ts_event,
                ts_init=ts_event,
            ),
        )

    return tuple(ticks)
