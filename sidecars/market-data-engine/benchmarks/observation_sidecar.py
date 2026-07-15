#!/usr/bin/env python3
"""Benchmark-only JSONL sidecar which observes frames without policy enforcement.

This entrypoint is not packaged or used by production. It preserves the real RPC
handler, fixture adapter, replay registry, JSON parsing, and stdout framing while
disabling only the policy guards so pre-enforcement payload boundaries remain
reproducible after the production sidecar begins rejecting them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import trade_god_market_data.rpc as rpc_module
from trade_god_market_data.rpc import MarketDataRpcHandler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture-root", type=Path, required=True)
    args = parser.parse_args()
    rpc_module.load_requires_dedicated_streaming = lambda _batch: False
    rpc_module.requires_dedicated_streaming = lambda _batch, _pace: False
    handler = MarketDataRpcHandler(args.fixture_root)
    for line in sys.stdin:
        if not line.strip():
            continue
        response = handler.handle(json.loads(line))
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        if isinstance(response.get("result"), dict) and response["result"].get("state") == "stopped":
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
