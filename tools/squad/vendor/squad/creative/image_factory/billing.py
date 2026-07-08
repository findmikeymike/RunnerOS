"""Sprint 1 billing ledger for image-factory external calls."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass(frozen=True, slots=True)
class CreativeCostEvent:
    """Immutable ledger entry for one external provider operation."""

    run_id: str
    request_id: str
    provider: str
    operation: str
    cost_usd: float
    provider_request_id: str | None = None
    latency_ms: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    sequence: int = 0
    total_cost_after_event_usd: float = 0.0


@dataclass(frozen=True, slots=True)
class ProviderOperationSummary:
    provider: str
    operation: str
    event_count: int
    total_cost_usd: float


@dataclass(frozen=True, slots=True)
class CreativeBillingSummary:
    run_id: str
    request_id: str
    budget_cap_usd: float
    total_cost_usd: float
    remaining_budget_usd: float
    event_count: int
    operation_totals: tuple[ProviderOperationSummary, ...]


class BudgetCapExceeded(ValueError):
    """Raised when an external call would exceed the request budget."""

    def __init__(
        self,
        *,
        run_id: str,
        request_id: str,
        budget_cap_usd: float,
        attempted_total_usd: float,
        provider: str,
        operation: str,
    ) -> None:
        self.run_id = run_id
        self.request_id = request_id
        self.budget_cap_usd = float(budget_cap_usd)
        self.attempted_total_usd = float(attempted_total_usd)
        self.provider = provider
        self.operation = operation
        super().__init__(
            "Budget cap exceeded for "
            f"{provider}.{operation}: attempted ${attempted_total_usd:.6f} "
            f"with cap ${budget_cap_usd:.6f} "
            f"(run_id={run_id}, request_id={request_id})"
        )


@dataclass
class CreativeBillingLedger:
    """Tracks external-call spending for one image-factory request."""

    run_id: str
    request_id: str
    budget_cap_usd: float
    events: list[CreativeCostEvent] = field(default_factory=list)
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def __post_init__(self) -> None:
        self.budget_cap_usd = self._normalize_amount(self.budget_cap_usd, "budget_cap_usd")

    @staticmethod
    def _normalize_amount(amount: float, field_name: str) -> float:
        normalized = float(amount)
        if normalized < 0.0:
            raise ValueError(f"{field_name} must be non-negative")
        return round(normalized, 6)

    @property
    def total_cost_usd(self) -> float:
        with self._lock:
            return round(sum(event.cost_usd for event in self.events), 6)

    @property
    def remaining_budget_usd(self) -> float:
        return round(max(0.0, self.budget_cap_usd - self.total_cost_usd), 6)

    def can_afford(self, cost_usd: float) -> bool:
        normalized_cost = self._normalize_amount(cost_usd, "cost_usd")
        return (self.total_cost_usd + normalized_cost) <= (self.budget_cap_usd + 1e-9)

    def assert_can_afford(
        self,
        cost_usd: float,
        *,
        provider: str,
        operation: str,
    ) -> None:
        normalized_cost = self._normalize_amount(cost_usd, "cost_usd")
        attempted_total = round(self.total_cost_usd + normalized_cost, 6)
        if attempted_total > (self.budget_cap_usd + 1e-9):
            raise BudgetCapExceeded(
                run_id=self.run_id,
                request_id=self.request_id,
                budget_cap_usd=self.budget_cap_usd,
                attempted_total_usd=attempted_total,
                provider=provider,
                operation=operation,
            )

    def record(
        self,
        *,
        provider: str,
        operation: str,
        cost_usd: float,
        provider_request_id: str | None = None,
        latency_ms: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CreativeCostEvent:
        provider_name = provider.strip()
        operation_name = operation.strip()
        if not provider_name:
            raise ValueError("provider must not be empty")
        if not operation_name:
            raise ValueError("operation must not be empty")

        normalized_cost = self._normalize_amount(cost_usd, "cost_usd")
        if latency_ms is not None and float(latency_ms) < 0.0:
            raise ValueError("latency_ms must be non-negative")

        with self._lock:
            current_total = round(sum(event.cost_usd for event in self.events), 6)
            attempted_total = round(current_total + normalized_cost, 6)
            if attempted_total > (self.budget_cap_usd + 1e-9):
                raise BudgetCapExceeded(
                    run_id=self.run_id,
                    request_id=self.request_id,
                    budget_cap_usd=self.budget_cap_usd,
                    attempted_total_usd=attempted_total,
                    provider=provider_name,
                    operation=operation_name,
                )

            event = CreativeCostEvent(
                run_id=self.run_id,
                request_id=self.request_id,
                provider=provider_name,
                operation=operation_name,
                cost_usd=normalized_cost,
                provider_request_id=provider_request_id,
                latency_ms=(round(float(latency_ms), 3) if latency_ms is not None else None),
                metadata=dict(metadata or {}),
                sequence=len(self.events) + 1,
                total_cost_after_event_usd=attempted_total,
            )
            self.events.append(event)
            return event

    def summary(self) -> CreativeBillingSummary:
        with self._lock:
            events = tuple(self.events)

        bucket_costs: dict[tuple[str, str], float] = defaultdict(float)
        bucket_counts: dict[tuple[str, str], int] = defaultdict(int)
        for event in events:
            key = (event.provider, event.operation)
            bucket_costs[key] += event.cost_usd
            bucket_counts[key] += 1

        operation_totals = tuple(
            ProviderOperationSummary(
                provider=provider,
                operation=operation,
                event_count=bucket_counts[(provider, operation)],
                total_cost_usd=round(bucket_costs[(provider, operation)], 6),
            )
            for provider, operation in sorted(bucket_costs.keys())
        )
        total_cost = round(sum(event.cost_usd for event in events), 6)
        return CreativeBillingSummary(
            run_id=self.run_id,
            request_id=self.request_id,
            budget_cap_usd=self.budget_cap_usd,
            total_cost_usd=total_cost,
            remaining_budget_usd=round(max(0.0, self.budget_cap_usd - total_cost), 6),
            event_count=len(events),
            operation_totals=operation_totals,
        )
