#!/usr/bin/env python3
"""Fail-closed provider balance check before paid creative production smoke runs."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WAVESPEED_API_BASE_URL = "https://api.wavespeed.ai/api"
DEFAULT_WAVESPEED_SMOKE_CLIP_COST_USD = 0.08
DEFAULT_PROVIDER_RESERVE_USD = 0.05


@dataclass(frozen=True, slots=True)
class ProviderBudgetEstimate:
    provider: str
    scenario: str
    expected_clip_count: int
    estimated_video_cost_usd: float
    reserve_usd: float
    required_balance_usd: float


@dataclass(frozen=True, slots=True)
class ProviderBudgetCheck:
    ok: bool
    provider: str
    available_balance_usd: float
    required_balance_usd: float
    estimated_video_cost_usd: float
    reserve_usd: float
    scenario: str
    expected_clip_count: int
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "provider": self.provider,
            "available_balance_usd": self.available_balance_usd,
            "required_balance_usd": self.required_balance_usd,
            "estimated_video_cost_usd": self.estimated_video_cost_usd,
            "reserve_usd": self.reserve_usd,
            "scenario": self.scenario,
            "expected_clip_count": self.expected_clip_count,
            "message": self.message,
        }


class ProviderBudgetError(RuntimeError):
    def __init__(self, check: ProviderBudgetCheck) -> None:
        super().__init__(check.message)
        self.failed_subsystem = "provider_budget"
        self.provider = check.provider
        self.details = check.to_dict()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check provider balance before paid smoke runs.")
    parser.add_argument("--scenario", default="streetwear-drop", help="Smoke scenario name")
    parser.add_argument("--expected-clips", type=int, default=None, help="Override expected video clip count")
    parser.add_argument(
        "--clip-cost-usd",
        type=float,
        default=float(os.getenv("SQUAD_WAVESPEED_SMOKE_CLIP_COST_USD") or DEFAULT_WAVESPEED_SMOKE_CLIP_COST_USD),
        help="Conservative expected WaveSpeed cost per smoke clip",
    )
    parser.add_argument(
        "--reserve-usd",
        type=float,
        default=float(os.getenv("SQUAD_PROVIDER_BUDGET_RESERVE_USD") or DEFAULT_PROVIDER_RESERVE_USD),
        help="Minimum balance cushion required after estimated smoke video spend",
    )
    parser.add_argument(
        "--env-file",
        default=str(PROJECT_ROOT / ".env.local"),
        help="Optional dotenv file to load without printing secrets",
    )
    return parser


def load_env_file(path: str | Path) -> bool:
    env_path = Path(path)
    if not env_path.exists():
        return False
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = _clean_env_value(value)
    return True


def estimate_wavespeed_smoke_budget(
    *,
    scenario: str,
    expected_clip_count: int | None = None,
    clip_cost_usd: float = DEFAULT_WAVESPEED_SMOKE_CLIP_COST_USD,
    reserve_usd: float = DEFAULT_PROVIDER_RESERVE_USD,
) -> ProviderBudgetEstimate:
    clip_count = expected_clip_count if expected_clip_count is not None else _default_clip_count_for_scenario(scenario)
    if clip_count <= 0:
        raise ValueError("expected_clip_count must be positive")
    if clip_cost_usd < 0:
        raise ValueError("clip_cost_usd must be non-negative")
    if reserve_usd < 0:
        raise ValueError("reserve_usd must be non-negative")
    estimated = round(float(clip_count) * float(clip_cost_usd), 6)
    required = round(estimated + float(reserve_usd), 6)
    return ProviderBudgetEstimate(
        provider="wavespeed",
        scenario=scenario,
        expected_clip_count=clip_count,
        estimated_video_cost_usd=estimated,
        reserve_usd=round(float(reserve_usd), 6),
        required_balance_usd=required,
    )


def check_wavespeed_smoke_budget(
    *,
    scenario: str,
    expected_clip_count: int | None = None,
    clip_cost_usd: float = DEFAULT_WAVESPEED_SMOKE_CLIP_COST_USD,
    reserve_usd: float = DEFAULT_PROVIDER_RESERVE_USD,
    api_key: str | None = None,
    api_base_url: str | None = None,
    timeout_sec: int = 20,
) -> ProviderBudgetCheck:
    estimate = estimate_wavespeed_smoke_budget(
        scenario=scenario,
        expected_clip_count=expected_clip_count,
        clip_cost_usd=clip_cost_usd,
        reserve_usd=reserve_usd,
    )
    key = api_key or os.getenv("SQUAD_WAVESPEED_API_KEY") or os.getenv("WAVESPEED_API_KEY")
    if not key:
        raise ProviderBudgetError(
            ProviderBudgetCheck(
                ok=False,
                provider="wavespeed",
                available_balance_usd=0.0,
                required_balance_usd=estimate.required_balance_usd,
                estimated_video_cost_usd=estimate.estimated_video_cost_usd,
                reserve_usd=estimate.reserve_usd,
                scenario=estimate.scenario,
                expected_clip_count=estimate.expected_clip_count,
                message="provider budget check failed: missing WaveSpeed API key",
            )
        )
    balance = get_wavespeed_balance_usd(api_key=key, api_base_url=api_base_url, timeout_sec=timeout_sec)
    ok = balance >= estimate.required_balance_usd
    message = (
        "provider budget check passed"
        if ok
        else (
            "provider budget check failed: WaveSpeed balance "
            f"${balance:.2f} is below required ${estimate.required_balance_usd:.2f} "
            f"for {estimate.expected_clip_count} expected smoke clip(s)"
        )
    )
    check = ProviderBudgetCheck(
        ok=ok,
        provider="wavespeed",
        available_balance_usd=round(balance, 6),
        required_balance_usd=estimate.required_balance_usd,
        estimated_video_cost_usd=estimate.estimated_video_cost_usd,
        reserve_usd=estimate.reserve_usd,
        scenario=estimate.scenario,
        expected_clip_count=estimate.expected_clip_count,
        message=message,
    )
    if not check.ok:
        raise ProviderBudgetError(check)
    return check


def get_wavespeed_balance_usd(
    *,
    api_key: str,
    api_base_url: str | None = None,
    timeout_sec: int = 20,
) -> float:
    url = _wavespeed_balance_url(api_base_url or os.getenv("SQUAD_WAVESPEED_API_BASE_URL") or DEFAULT_WAVESPEED_API_BASE_URL)
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"provider budget check failed: could not read WaveSpeed balance: {exc}") from exc
    try:
        return float(payload["data"]["balance"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("provider budget check failed: unexpected WaveSpeed balance response") from exc


def _wavespeed_balance_url(api_base_url: str) -> str:
    base = api_base_url.rstrip("/")
    if base.endswith("/v3"):
        return f"{base}/balance"
    return f"{base}/v3/balance"


def _default_clip_count_for_scenario(scenario: str) -> int:
    return 5 if scenario == "faceless-youtube" else 3


def _clean_env_value(value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        return cleaned[1:-1]
    return cleaned


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    load_env_file(args.env_file)
    try:
        check = check_wavespeed_smoke_budget(
            scenario=args.scenario,
            expected_clip_count=args.expected_clips,
            clip_cost_usd=args.clip_cost_usd,
            reserve_usd=args.reserve_usd,
        )
    except ProviderBudgetError as exc:
        print(json.dumps({"ok": False, **exc.details}, indent=2))
        return 1
    except Exception as exc:
        print(json.dumps({"ok": False, "provider": "wavespeed", "message": str(exc)}, indent=2))
        return 1
    print(json.dumps(check.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
