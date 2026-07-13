"""Convert project-owned recorded trades into Nautilus domain objects."""

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Any

from nautilus_trader.model.data import TradeTick
from nautilus_trader.model.enums import AggressorSide
from nautilus_trader.model.identifiers import InstrumentId, TradeId
from nautilus_trader.model.objects import Price, Quantity


_AGGRESSOR_SIDES = {
    "buy": AggressorSide.BUYER,
    "sell": AggressorSide.SELLER,
}

_CANONICAL_AGGRESSOR_SIDES = {
    AggressorSide.BUYER: "buyer",
    AggressorSide.SELLER: "seller",
    AggressorSide.NO_AGGRESSOR: "unknown",
}


def canonical_json(value: Any) -> str:
    """Encode the shared canonical JSON subset used by Trade God checksums."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class FixtureQualityError(ValueError):
    """A fixture cannot produce a usable canonical batch."""

    def __init__(self, message: str, report: dict[str, Any]) -> None:
        super().__init__(message)
        self.report = report


def _empty_events_sha256() -> str:
    return hashlib.sha256(canonical_json([]).encode("utf-8")).hexdigest()


def _invalid_report(
    *,
    batch_id: str,
    trace_id: str,
    received: int,
    source_sha256: str,
    flag: str,
    message: str,
) -> dict[str, Any]:
    return {
        "quality_report_schema_version": "market-quality-report@1",
        "batch_id": batch_id,
        "trace_id": trace_id,
        "state": "invalid",
        "counts": {
            "received": received,
            "accepted": 0,
            "rejected": received,
            "duplicates": 0,
            "out_of_order": 0,
        },
        "flags": [flag],
        "issues": [{
            "code": flag,
            "severity": "error",
            "message": message,
        }],
        "source_sha256": source_sha256,
        "canonical_events_sha256": _empty_events_sha256(),
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


def _fixed_point(value: str) -> dict[str, str | int]:
    decimal = Decimal(value)
    precision = max(0, -decimal.as_tuple().exponent)
    raw = int(decimal * (10**precision))
    return {"value": value, "raw": str(raw), "precision": precision}


def _instrument_tick_size(instrument: Any) -> Decimal | None:
    if not isinstance(instrument, Mapping):
        return None
    required = {"id", "symbol", "venue", "asset_class", "currency", "tick_size", "multiplier"}
    if not required.issubset(instrument):
        return None
    if instrument["asset_class"] not in {"future", "equity", "option", "forex", "crypto"}:
        return None
    currency = instrument["currency"]
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isupper():
        return None
    if not all(isinstance(instrument[key], str) and instrument[key] for key in ("id", "symbol", "venue")):
        return None
    if not isinstance(instrument["tick_size"], str) or not isinstance(instrument["multiplier"], str):
        return None
    try:
        tick_size = Decimal(instrument["tick_size"])
        multiplier = Decimal(instrument["multiplier"])
    except InvalidOperation:
        return None
    if not tick_size.is_finite() or not multiplier.is_finite() or tick_size <= 0 or multiplier <= 0:
        return None
    return tick_size


def build_canonical_batch(
    manifest: Mapping[str, Any],
    *,
    trace_id: str,
    batch_id: str,
    source_bytes: bytes,
) -> dict[str, Any]:
    """Convert a fixture batch through Nautilus and emit Trade God wire data."""

    instrument = manifest["instrument"]
    fixture_id = str(manifest["fixture_id"])
    fixture_sha256 = str(manifest["events_sha256"])
    actual_source_sha256 = hashlib.sha256(source_bytes).hexdigest()

    if actual_source_sha256 != fixture_sha256:
        report = _invalid_report(
            batch_id=batch_id,
            trace_id=trace_id,
            received=int(manifest.get("event_count", 0)),
            source_sha256=actual_source_sha256,
            flag="source-checksum-mismatch",
            message="Source bytes do not match the fixture manifest checksum.",
        )
        raise FixtureQualityError("Fixture checksum mismatch", report)

    try:
        records = json.loads(source_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError):
        report = _invalid_report(
            batch_id=batch_id,
            trace_id=trace_id,
            received=int(manifest.get("event_count", 0)),
            source_sha256=actual_source_sha256,
            flag="malformed-source-payload",
            message="Checksum-verified source bytes are not valid JSON.",
        )
        raise FixtureQualityError("Malformed fixture payload", report) from None
    if not isinstance(records, list):
        report = _invalid_report(
            batch_id=batch_id,
            trace_id=trace_id,
            received=int(manifest.get("event_count", 0)),
            source_sha256=actual_source_sha256,
            flag="malformed-source-payload",
            message="Fixture events payload must be a JSON array.",
        )
        raise FixtureQualityError("Malformed fixture payload", report)

    if len(records) != int(manifest["event_count"]):
        report = _invalid_report(
            batch_id=batch_id,
            trace_id=trace_id,
            received=len(records),
            source_sha256=actual_source_sha256,
            flag="source-event-count-mismatch",
            message="Source record count does not match the fixture manifest.",
        )
        raise FixtureQualityError("Fixture event count mismatch", report)

    tick_size = _instrument_tick_size(instrument)
    if tick_size is None:
        report = _invalid_report(
            batch_id=batch_id,
            trace_id=trace_id,
            received=len(records),
            source_sha256=actual_source_sha256,
            flag="invalid-instrument-metadata",
            message="Instrument metadata is missing, unsupported, or non-positive.",
        )
        raise FixtureQualityError("Invalid instrument metadata", report)

    accepted: list[tuple[Mapping[str, Any], list[str]]] = []
    seen_record_ids: set[str] = set()
    issues: list[dict[str, Any]] = []
    duplicate_count = 0
    out_of_order_count = 0
    previous_event_time: int | None = None

    for index, record in enumerate(records):
        fallback_record_id = f"{fixture_id}:index-{index}"
        if not isinstance(record, Mapping):
            issues.append({
                "code": "malformed-source-record",
                "severity": "error",
                "message": "Source record must be a JSON object.",
                "record_id": fallback_record_id,
            })
            continue

        sequence_value = record.get("sequence")
        if isinstance(sequence_value, bool) or not isinstance(sequence_value, (int, str)):
            issues.append({
                "code": "malformed-source-record",
                "severity": "error",
                "message": "Source record requires an integer sequence.",
                "record_id": fallback_record_id,
            })
            continue
        sequence = str(sequence_value)
        if not sequence.isdigit() or int(sequence) <= 0:
            issues.append({
                "code": "malformed-source-record",
                "severity": "error",
                "message": "Source record sequence must be positive.",
                "record_id": fallback_record_id,
            })
            continue

        record_id = f"{fixture_id}:{sequence}"
        required = {"event_time", "price", "size", "aggressor"}
        if not required.issubset(record):
            issues.append({
                "code": "malformed-source-record",
                "severity": "error",
                "message": "Source record is missing a required market field.",
                "record_id": record_id,
            })
            continue

        if not isinstance(record["event_time"], str):
            issues.append({
                "code": "invalid-event-time",
                "severity": "error",
                "message": "Event time must be an offset-aware ISO-8601 string.",
                "record_id": record_id,
            })
            continue
        try:
            event_time = _utc_nanoseconds(record["event_time"])
        except (TypeError, ValueError):
            issues.append({
                "code": "invalid-event-time",
                "severity": "error",
                "message": "Event time must be an offset-aware ISO-8601 string.",
                "record_id": record_id,
            })
            continue

        if not isinstance(record["size"], str):
            issues.append({
                "code": "non-positive-size",
                "severity": "error",
                "message": "Trade size must be a positive decimal string.",
                "record_id": record_id,
            })
            continue
        try:
            size = Decimal(record["size"])
        except InvalidOperation:
            size = Decimal(0)
        if not size.is_finite() or size <= 0:
            issues.append({
                "code": "non-positive-size",
                "severity": "error",
                "message": "Trade size must be a positive decimal string.",
                "record_id": record_id,
            })
            continue

        if not isinstance(record["price"], str):
            issues.append({
                "code": "invalid-price-increment",
                "severity": "error",
                "message": "Trade price must align to the instrument tick size.",
                "record_id": record_id,
            })
            continue
        try:
            price = Decimal(record["price"])
        except InvalidOperation:
            price = Decimal("NaN")
        if not price.is_finite() or price % tick_size != 0:
            issues.append({
                "code": "invalid-price-increment",
                "severity": "error",
                "message": "Trade price must align to the instrument tick size.",
                "record_id": record_id,
            })
            continue

        if record["aggressor"] not in _AGGRESSOR_SIDES:
            issues.append({
                "code": "unsupported-aggressor-side",
                "severity": "error",
                "message": "Aggressor side must be buy or sell for this fixture.",
                "record_id": record_id,
            })
            continue

        if record_id in seen_record_ids:
            duplicate_count += 1
            issues.append({
                "code": "duplicate-source-record",
                "severity": "warning",
                "message": "Duplicate source record was excluded from canonical output.",
                "record_id": record_id,
            })
            continue

        seen_record_ids.add(record_id)
        quality_flags: list[str] = []
        if previous_event_time is not None and event_time < previous_event_time:
            out_of_order_count += 1
            quality_flags.append("out-of-order-event-time")
            issues.append({
                "code": "out-of-order-event-time",
                "severity": "warning",
                "message": "Event time precedes the prior accepted source record.",
                "record_id": record_id,
            })
        previous_event_time = event_time
        accepted.append((record, quality_flags))

    if not accepted:
        if not issues:
            issues.append({
                "code": "no-accepted-records",
                "severity": "error",
                "message": "Fixture contains no records eligible for canonical output.",
            })
        flags = list(dict.fromkeys(issue["code"] for issue in issues))
        report = {
            "quality_report_schema_version": "market-quality-report@1",
            "batch_id": batch_id,
            "trace_id": trace_id,
            "state": "invalid",
            "counts": {
                "received": len(records),
                "accepted": 0,
                "rejected": len(records),
                "duplicates": duplicate_count,
                "out_of_order": out_of_order_count,
            },
            "flags": flags,
            "issues": issues,
            "source_sha256": actual_source_sha256,
            "canonical_events_sha256": _empty_events_sha256(),
        }
        raise FixtureQualityError("Fixture has no accepted records", report)

    accepted_records = [record for record, _ in accepted]
    ticks = load_trade_ticks(manifest, accepted_records)
    events: list[dict[str, Any]] = []

    for (record, quality_flags), tick in zip(accepted, ticks, strict=True):
        sequence = str(record["sequence"])
        events.append({
            "event_schema_version": "market-trade-event@1",
            "event_id": f"trade:{fixture_id}:{sequence}",
            "trace_id": trace_id,
            "producer": {
                "name": "trade-god-market-data-engine",
                "version": "0.1.0",
            },
            "instrument": {
                "id": str(instrument["id"]),
                "symbol": str(instrument["symbol"]),
                "venue": str(instrument["venue"]),
                "asset_class": str(instrument["asset_class"]),
                "currency": str(instrument["currency"]),
                "tick_size": str(instrument["tick_size"]),
                "multiplier": str(instrument["multiplier"]),
            },
            "ts_event_ns": str(tick.ts_event),
            "ts_init_ns": str(tick.ts_init),
            "price": _fixed_point(str(tick.price)),
            "size": _fixed_point(str(tick.size)),
            "aggressor_side": _CANONICAL_AGGRESSOR_SIDES[tick.aggressor_side],
            "trade_id": str(tick.trade_id),
            "source": {
                "provider": "trade-god-fixture",
                "record_id": f"{fixture_id}:{sequence}",
                "mode": "replay",
                "fixture_id": fixture_id,
                "fixture_sha256": fixture_sha256,
            },
            "quality_flags": quality_flags,
            "provenance": {
                "source_schema": "synthetic-trades@1",
                "transformations": [
                    "fixture-record-to-trade-tick",
                    "trade-tick-to-market-event",
                ],
            },
            "extensions": {},
        })

    canonical_events_sha256 = hashlib.sha256(
        canonical_json(events).encode("utf-8"),
    ).hexdigest()
    event_times = [int(event["ts_event_ns"]) for event in events]
    quality_flags: list[str] = []
    for issue in issues:
        if issue["code"] not in quality_flags:
            quality_flags.append(issue["code"])
    quality = {
        "quality_report_schema_version": "market-quality-report@1",
        "batch_id": batch_id,
        "trace_id": trace_id,
        "state": "degraded" if quality_flags else "valid",
        "counts": {
            "received": len(records),
            "accepted": len(events),
            "rejected": len(records) - len(events),
            "duplicates": duplicate_count,
            "out_of_order": out_of_order_count,
        },
        "flags": quality_flags,
        "issues": issues,
        "source_sha256": fixture_sha256,
        "canonical_events_sha256": canonical_events_sha256,
    }

    return {
        "batch_schema_version": "market-trade-batch@1",
        "batch_id": batch_id,
        "trace_id": trace_id,
        "mode": "replay",
        "instrument_id": str(instrument["id"]),
        "source": {
            "provider": "trade-god-fixture",
            "fixture_id": fixture_id,
            "source_sha256": fixture_sha256,
        },
        "event_time_range": {
            "start_ns": str(min(event_times)),
            "end_ns": str(max(event_times)),
        },
        "events": events,
        "quality": quality,
        "canonical_events_sha256": canonical_events_sha256,
    }
