import threading
import unittest

from trade_god_market_data.ibkr_gateway import (
    IBGatewayProbeConfig,
    probe_ib_gateway,
)


class FakeProbeClient:
    def __init__(self, *, connects: bool = True, becomes_ready: bool = True) -> None:
        self.ready = threading.Event()
        self.connects = connects
        self.becomes_ready = becomes_ready
        self.disconnected = False

    def connect(self, host: str, port: int, clientId: int) -> bool:
        self.connection = (host, port, clientId)
        return self.connects

    def isConnected(self) -> bool:
        return self.connects and not self.disconnected

    def run(self) -> None:
        if self.becomes_ready:
            self.ready.set()

    def serverVersion(self) -> int:
        return 192

    def disconnect(self) -> None:
        self.disconnected = True


class IBGatewayProbeTest(unittest.TestCase):
    def test_restricts_the_probe_to_local_canonical_gateway_ports(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            IBGatewayProbeConfig(host="broker.example.com")
        with self.assertRaisesRegex(ValueError, "port 4002"):
            IBGatewayProbeConfig(environment="paper", port=7497)
        with self.assertRaisesRegex(ValueError, "port 4001"):
            IBGatewayProbeConfig(environment="live", port=4002)

    def test_proves_an_api_session_without_claiming_entitlements_or_order_authority(self) -> None:
        fake = FakeProbeClient()
        result = probe_ib_gateway(
            IBGatewayProbeConfig(environment="paper", timeout_seconds=0.1),
            client_factory=lambda: fake,
        )

        self.assertEqual(fake.connection, ("127.0.0.1", 4002, 71))
        self.assertEqual(result.state, "ready")
        self.assertTrue(result.api_session_authenticated)
        self.assertEqual(result.server_version, 192)
        self.assertEqual(result.market_data_entitlement, "unverified")
        self.assertEqual(result.gateway_read_only_setting, "unverified")
        self.assertEqual(result.connector_authority, "health-only")
        self.assertTrue(fake.disconnected)
        self.assertNotIn("account", result.to_dict())

    def test_fails_closed_when_gateway_is_missing_or_not_authenticated(self) -> None:
        refused = probe_ib_gateway(
            IBGatewayProbeConfig(timeout_seconds=0.1),
            client_factory=lambda: FakeProbeClient(connects=False),
        )
        waiting = probe_ib_gateway(
            IBGatewayProbeConfig(timeout_seconds=0.1),
            client_factory=lambda: FakeProbeClient(becomes_ready=False),
        )

        self.assertEqual((refused.state, refused.failure), ("unavailable", "connection-failed"))
        self.assertEqual((waiting.state, waiting.failure), ("unavailable", "authentication-timeout"))
        self.assertFalse(refused.api_session_authenticated)
        self.assertFalse(waiting.api_session_authenticated)


if __name__ == "__main__":
    unittest.main()
