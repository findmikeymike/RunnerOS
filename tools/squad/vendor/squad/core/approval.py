"""Approval primitives for write-capable workflow steps."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Protocol
from uuid import uuid4


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass(slots=True)
class ApprovalRequest:
    id: str
    run_id: str
    stage: str
    summary: str
    payload: dict[str, Any]
    status: ApprovalStatus = ApprovalStatus.PENDING
    reviewer: str | None = None
    reason: str | None = None
    created_at: str = field(default_factory=_utc_now)
    decided_at: str | None = None


class ApprovalBackend(Protocol):
    def submit(
        self,
        *,
        run_id: str,
        stage: str,
        summary: str,
        payload: dict[str, Any],
    ) -> ApprovalRequest:
        ...

    def decide(
        self,
        request_id: str,
        *,
        status: ApprovalStatus,
        reviewer: str | None = None,
        reason: str | None = None,
    ) -> ApprovalRequest:
        ...

    def get(self, request_id: str) -> ApprovalRequest | None:
        ...


class InMemoryApprovalBackend:
    def __init__(self) -> None:
        self._requests: dict[str, ApprovalRequest] = {}

    def submit(
        self,
        *,
        run_id: str,
        stage: str,
        summary: str,
        payload: dict[str, Any],
    ) -> ApprovalRequest:
        request = ApprovalRequest(
            id=str(uuid4()),
            run_id=run_id,
            stage=stage,
            summary=summary,
            payload=dict(payload),
        )
        self._requests[request.id] = request
        return request

    def decide(
        self,
        request_id: str,
        *,
        status: ApprovalStatus,
        reviewer: str | None = None,
        reason: str | None = None,
    ) -> ApprovalRequest:
        request = self._requests[request_id]
        request.status = status
        request.reviewer = reviewer
        request.reason = reason
        request.decided_at = _utc_now()
        return request

    def get(self, request_id: str) -> ApprovalRequest | None:
        return self._requests.get(request_id)
