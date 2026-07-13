"""Newline-delimited JSON-RPC process entry point."""

import argparse
import json
from pathlib import Path
import sys
from typing import Any

from .rpc import MarketDataRpcHandler


def _default_fixture_root() -> Path:
    repo_root = Path(__file__).resolve().parents[4]
    return repo_root / "packages" / "trading-testkit" / "fixtures" / "es-demo"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trade God replay-only market-data sidecar")
    parser.add_argument("--fixture-root", type=Path, default=_default_fixture_root())
    return parser.parse_args()


def _write(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _reject_nonstandard_number(value: str) -> None:
    raise ValueError(f"non-standard JSON number: {value}")


def main() -> int:
    handler = MarketDataRpcHandler(_parse_args().fixture_root)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line, parse_constant=_reject_nonstandard_number)
        except (json.JSONDecodeError, ValueError):
            _write({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        _write(handler.handle(request))
        if handler.state == "stopped":
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
