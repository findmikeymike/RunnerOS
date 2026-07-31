"""Read-only IB Gateway session probe.

This boundary proves that an authenticated local IB API session exists. It does
not request account data, market data, orders, or executions, and it never
accepts a non-loopback host.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
import threading
from typing import Callable, Literal, Protocol

from ibapi.client import EClient
from ibapi.wrapper import EWrapper


IB_GATEWAY_PORTS = {"live": 4001, "paper": 4002}
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


@dataclass(frozen=True)
class IBGatewayProbeConfig:
    environment: Literal["paper", "live"] = "paper"
    host: str = "127.0.0.1"
    port: int | None = None
    client_id: int = 71
    timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        if self.environment not in IB_GATEWAY_PORTS:
            raise ValueError("IB Gateway environment must be paper or live.")
        if self.host not in LOOPBACK_HOSTS:
            raise ValueError("IB Gateway health probes are restricted to loopback.")
        expected_port = IB_GATEWAY_PORTS[self.environment]
        if self.port is not None and self.port != expected_port:
            raise ValueError(f"{self.environment.title()} IB Gateway must use port {expected_port}.")
        if not 1 <= self.client_id <= 999:
            raise ValueError("IB Gateway client ID must be between 1 and 999.")
        if not 0.1 <= self.timeout_seconds <= 30:
            raise ValueError("IB Gateway probe timeout must be between 0.1 and 30 seconds.")

    @property
    def resolved_port(self) -> int:
        return self.port or IB_GATEWAY_PORTS[self.environment]


@dataclass(frozen=True)
class IBGatewayProbeResult:
    provider: Literal["interactive-brokers"]
    environment: Literal["paper", "live"]
    state: Literal["ready", "unavailable"]
    host: str
    port: int
    client_id: int
    api_session_authenticated: bool
    server_version: int | None
    market_data_entitlement: Literal["unverified"]
    gateway_read_only_setting: Literal["unverified"]
    connector_authority: Literal["health-only"]
    failure: Literal["connection-failed", "authentication-timeout"] | None = None

    def to_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


class _ProbeClient(Protocol):
    ready: threading.Event

    def connect(self, host: str, port: int, clientId: int) -> bool: ...
    def disconnect(self) -> None: ...
    def isConnected(self) -> bool: ...
    def run(self) -> None: ...
    def serverVersion(self) -> int: ...


class _IBGatewayProbeClient(EWrapper, EClient):
    def __init__(self) -> None:
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self.ready = threading.Event()

    def nextValidId(self, orderId: int) -> None:  # noqa: N802 - IB API callback name
        del orderId
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802 - IB API callback name
        # Account identifiers are deliberately discarded at this boundary.
        del accountsList
        self.ready.set()


def probe_ib_gateway(
    config: IBGatewayProbeConfig,
    *,
    client_factory: Callable[[], _ProbeClient] | None = None,
) -> IBGatewayProbeResult:
    """Perform one bounded IB API handshake without requesting protected data."""

    client = (client_factory or _IBGatewayProbeClient)()
    thread: threading.Thread | None = None
    try:
        connected = client.connect(config.host, config.resolved_port, clientId=config.client_id)
        if not connected or not client.isConnected():
            raise ConnectionError("IB Gateway connection failed.")
        thread = threading.Thread(target=client.run, name="ibkr-health-probe", daemon=True)
        thread.start()
        if not client.ready.wait(config.timeout_seconds):
            return IBGatewayProbeResult(
                provider="interactive-brokers",
                environment=config.environment,
                state="unavailable",
                host=config.host,
                port=config.resolved_port,
                client_id=config.client_id,
                api_session_authenticated=False,
                server_version=None,
                market_data_entitlement="unverified",
                gateway_read_only_setting="unverified",
                connector_authority="health-only",
                failure="authentication-timeout",
            )
        return IBGatewayProbeResult(
            provider="interactive-brokers",
            environment=config.environment,
            state="ready",
            host=config.host,
            port=config.resolved_port,
            client_id=config.client_id,
            api_session_authenticated=True,
            server_version=client.serverVersion(),
            market_data_entitlement="unverified",
            gateway_read_only_setting="unverified",
            connector_authority="health-only",
        )
    except (ConnectionError, OSError):
        return IBGatewayProbeResult(
            provider="interactive-brokers",
            environment=config.environment,
            state="unavailable",
            host=config.host,
            port=config.resolved_port,
            client_id=config.client_id,
            api_session_authenticated=False,
            server_version=None,
            market_data_entitlement="unverified",
            gateway_read_only_setting="unverified",
            connector_authority="health-only",
            failure="connection-failed",
        )
    finally:
        client.disconnect()
        if thread is not None:
            thread.join(timeout=1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe a local read-only IB Gateway API session.")
    parser.add_argument("--environment", choices=tuple(IB_GATEWAY_PORTS), default="paper")
    parser.add_argument("--client-id", type=int, default=71)
    parser.add_argument("--timeout-seconds", type=float, default=5.0)
    args = parser.parse_args()
    result = probe_ib_gateway(IBGatewayProbeConfig(
        environment=args.environment,
        client_id=args.client_id,
        timeout_seconds=args.timeout_seconds,
    ))
    print(json.dumps(result.to_dict(), separators=(",", ":"), sort_keys=True), flush=True)
    raise SystemExit(0 if result.state == "ready" else 1)


if __name__ == "__main__":
    main()
