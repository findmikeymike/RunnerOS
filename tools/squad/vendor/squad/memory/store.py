"""Structured runtime state with in-memory and Postgres-backed implementations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

from core.approval import ApprovalStatus


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_approval_status(status: str) -> str:
    normalized = str(status).strip().lower()
    allowed = {item.value for item in ApprovalStatus}
    if normalized not in allowed:
        choices = ", ".join(sorted(allowed))
        raise ValueError(f"approval status must be one of: {choices}")
    return normalized


@dataclass(slots=True)
class RunRecord:
    id: str
    workflow: str
    status: str
    input_payload: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)
    started_at: str = field(default_factory=_utc_now)
    finished_at: str | None = None


@dataclass(slots=True)
class ArtifactRecord:
    run_id: str
    stage: str
    payload: dict[str, Any]
    created_at: str = field(default_factory=_utc_now)


@dataclass(slots=True)
class ApprovalRecord:
    id: str
    run_id: str
    stage: str
    summary: str
    payload: dict[str, Any]
    status: str
    created_at: str = field(default_factory=_utc_now)
    updated_at: str | None = None


class MemoryStore(Protocol):
    def start_run(
        self,
        *,
        workflow: str,
        input_payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> RunRecord:
        ...

    def complete_run(self, run_id: str, *, status: str) -> None:
        ...

    def save_artifact(self, run_id: str, *, stage: str, payload: dict[str, Any]) -> ArtifactRecord:
        ...

    def list_artifacts(self, run_id: str) -> list[ArtifactRecord]:
        ...

    def save_approval(
        self,
        *,
        run_id: str,
        stage: str,
        summary: str,
        payload: dict[str, Any],
        status: str = "pending",
    ) -> ApprovalRecord:
        ...

    def update_approval(self, approval_id: str, *, status: str) -> None:
        ...


class InMemoryStore:
    def __init__(self) -> None:
        self.runs: dict[str, RunRecord] = {}
        self.artifacts: list[ArtifactRecord] = []
        self.approvals: dict[str, ApprovalRecord] = {}

    def start_run(
        self,
        *,
        workflow: str,
        input_payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> RunRecord:
        run = RunRecord(
            id=str(uuid4()),
            workflow=workflow,
            status="running",
            input_payload=dict(input_payload),
            metadata=dict(metadata or {}),
        )
        self.runs[run.id] = run
        return run

    def complete_run(self, run_id: str, *, status: str) -> None:
        run = self.runs[run_id]
        run.status = status
        run.finished_at = _utc_now()

    def save_artifact(self, run_id: str, *, stage: str, payload: dict[str, Any]) -> ArtifactRecord:
        artifact = ArtifactRecord(run_id=run_id, stage=stage, payload=dict(payload))
        self.artifacts.append(artifact)
        return artifact

    def list_artifacts(self, run_id: str) -> list[ArtifactRecord]:
        return [artifact for artifact in self.artifacts if artifact.run_id == run_id]

    def save_approval(
        self,
        *,
        run_id: str,
        stage: str,
        summary: str,
        payload: dict[str, Any],
        status: str = "pending",
    ) -> ApprovalRecord:
        normalized_status = _normalize_approval_status(status)
        approval = ApprovalRecord(
            id=str(uuid4()),
            run_id=run_id,
            stage=stage,
            summary=summary,
            payload=dict(payload),
            status=normalized_status,
        )
        self.approvals[approval.id] = approval
        return approval

    def update_approval(self, approval_id: str, *, status: str) -> None:
        approval = self.approvals[approval_id]
        approval.status = _normalize_approval_status(status)
        approval.updated_at = _utc_now()


class PostgresMemoryStore(InMemoryStore):
    """Postgres-backed store with an in-memory-compatible API.

    This keeps the first-loop code straightforward while allowing a real state
    backend when a DSN is configured.
    """

    def __init__(self, dsn: str) -> None:
        super().__init__()
        self.dsn = dsn
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover - dependency issue
            raise RuntimeError("psycopg is required for PostgresMemoryStore") from exc
        self._psycopg = psycopg
        self._init_schema()

    def _connect(self):
        return self._psycopg.connect(self.dsn)

    @staticmethod
    def _coerce_json(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value

    def _load_run(self, run_id: str) -> RunRecord:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select id, workflow, status, input_payload, metadata, started_at, finished_at
                    from runs
                    where id = %s
                    """,
                    (run_id,),
                )
                row = cur.fetchone()
        if not row:
            raise KeyError(run_id)
        run = RunRecord(
            id=row[0],
            workflow=row[1],
            status=row[2],
            input_payload=self._coerce_json(row[3]),
            metadata=self._coerce_json(row[4]),
            started_at=row[5].isoformat() if hasattr(row[5], "isoformat") else str(row[5]),
            finished_at=row[6].isoformat() if row[6] is not None and hasattr(row[6], "isoformat") else (str(row[6]) if row[6] is not None else None),
        )
        self.runs[run.id] = run
        return run

    def _load_approval(self, approval_id: str) -> ApprovalRecord:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select id, run_id, stage, summary, payload, status, created_at, updated_at
                    from approvals
                    where id = %s
                    """,
                    (approval_id,),
                )
                row = cur.fetchone()
        if not row:
            raise KeyError(approval_id)
        approval = ApprovalRecord(
            id=row[0],
            run_id=row[1],
            stage=row[2],
            summary=row[3],
            payload=self._coerce_json(row[4]),
            status=row[5],
            created_at=row[6].isoformat() if hasattr(row[6], "isoformat") else str(row[6]),
            updated_at=row[7].isoformat() if row[7] is not None and hasattr(row[7], "isoformat") else (str(row[7]) if row[7] is not None else None),
        )
        self.approvals[approval.id] = approval
        return approval

    def _init_schema(self) -> None:
        statements = [
            """
            create table if not exists runs (
                id text primary key,
                workflow text not null,
                status text not null,
                input_payload jsonb not null,
                metadata jsonb not null,
                started_at timestamptz not null,
                finished_at timestamptz null
            )
            """,
            """
            create table if not exists artifacts (
                id bigserial primary key,
                run_id text not null,
                stage text not null,
                payload jsonb not null,
                created_at timestamptz not null
            )
            """,
            """
            create table if not exists approvals (
                id text primary key,
                run_id text not null,
                stage text not null,
                summary text not null,
                payload jsonb not null,
                status text not null,
                created_at timestamptz not null,
                updated_at timestamptz null
            )
            """,
        ]
        with self._connect() as conn:
            with conn.cursor() as cur:
                for stmt in statements:
                    cur.execute(stmt)
            conn.commit()

    def start_run(
        self,
        *,
        workflow: str,
        input_payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> RunRecord:
        run = super().start_run(workflow=workflow, input_payload=input_payload, metadata=metadata)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into runs (id, workflow, status, input_payload, metadata, started_at, finished_at)
                    values (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                    """,
                    (
                        run.id,
                        run.workflow,
                        run.status,
                        json.dumps(run.input_payload),
                        json.dumps(run.metadata),
                        run.started_at,
                        run.finished_at,
                    ),
                )
            conn.commit()
        return run

    def complete_run(self, run_id: str, *, status: str) -> None:
        run = self.runs.get(run_id) or self._load_run(run_id)
        super().complete_run(run_id, status=status)
        run = self.runs[run_id]
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update runs set status = %s, finished_at = %s where id = %s",
                    (run.status, run.finished_at, run.id),
                )
            conn.commit()

    def save_artifact(self, run_id: str, *, stage: str, payload: dict[str, Any]) -> ArtifactRecord:
        artifact = super().save_artifact(run_id, stage=stage, payload=payload)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into artifacts (run_id, stage, payload, created_at)
                    values (%s, %s, %s::jsonb, %s)
                    """,
                    (artifact.run_id, artifact.stage, json.dumps(artifact.payload), artifact.created_at),
                )
            conn.commit()
        return artifact

    def list_artifacts(self, run_id: str) -> list[ArtifactRecord]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select run_id, stage, payload, created_at
                    from artifacts
                    where run_id = %s
                    order by id asc
                    """,
                    (run_id,),
                )
                rows = cur.fetchall()
        return [
            ArtifactRecord(
                run_id=row[0],
                stage=row[1],
                payload=self._coerce_json(row[2]),
                created_at=row[3].isoformat() if hasattr(row[3], "isoformat") else str(row[3]),
            )
            for row in rows
        ]

    def save_approval(
        self,
        *,
        run_id: str,
        stage: str,
        summary: str,
        payload: dict[str, Any],
        status: str = "pending",
    ) -> ApprovalRecord:
        approval = super().save_approval(
            run_id=run_id, stage=stage, summary=summary, payload=payload, status=status
        )
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into approvals (id, run_id, stage, summary, payload, status, created_at, updated_at)
                    values (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                    """,
                    (
                        approval.id,
                        approval.run_id,
                        approval.stage,
                        approval.summary,
                        json.dumps(approval.payload),
                        approval.status,
                        approval.created_at,
                        approval.updated_at,
                    ),
                )
            conn.commit()
        return approval

    def update_approval(self, approval_id: str, *, status: str) -> None:
        approval = self.approvals.get(approval_id) or self._load_approval(approval_id)
        super().update_approval(approval_id, status=status)
        approval = self.approvals[approval_id]
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update approvals set status = %s, updated_at = %s where id = %s",
                    (approval.status, approval.updated_at, approval.id),
                )
            conn.commit()


def make_memory_store(postgres_dsn: str | None = None) -> MemoryStore:
    if postgres_dsn:
        return PostgresMemoryStore(postgres_dsn)
    return InMemoryStore()
