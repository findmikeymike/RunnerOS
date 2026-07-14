"""Bounded pull-based paced replay sessions with cooperative cancellation."""

from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
import threading
import time
from typing import Any


REPLAY_SESSION_SCHEMA_VERSION = "market-replay-session@1"
REPLAY_STEP_SCHEMA_VERSION = "market-replay-step@1"
MAX_REPLAY_SESSIONS = 64


class ReplayLifecycleError(Exception):
    def __init__(self, code: str, category: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.category = category


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass
class ReplaySession:
    replay_id: str
    cancellation_id: str
    trace_id: str
    batch: dict[str, Any]
    pace_interval_ms: int
    started_at: datetime
    deadline_at: datetime
    next_due: float
    cursor: int = 0
    state: str = "ready"
    cancellation: threading.Event = field(default_factory=threading.Event)
    pull_lock: threading.Lock = field(default_factory=threading.Lock)


class PacedReplayRegistry:
    def __init__(
        self,
        *,
        now: Callable[[], datetime] = utc_now,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._now = now
        self._monotonic = monotonic
        self._lock = threading.RLock()
        self._sessions: OrderedDict[str, ReplaySession] = OrderedDict()
        self._cancellations: dict[str, str] = {}

    def start(
        self,
        *,
        replay_id: str,
        cancellation_id: str,
        batch: Mapping[str, Any],
        pace_interval_ms: int,
        deadline_at: str,
    ) -> dict[str, Any]:
        now = self._now()
        deadline = parse_utc(deadline_at)
        if deadline <= now:
            raise ReplayLifecycleError("DEADLINE_EXCEEDED", "timeout", "Replay deadline has elapsed.")
        with self._lock:
            if replay_id in self._sessions:
                raise ReplayLifecycleError("REPLAY_ALREADY_EXISTS", "validation", "Replay id is already active.")
            if cancellation_id in self._cancellations:
                raise ReplayLifecycleError("CANCELLATION_ID_IN_USE", "validation", "Cancellation id is already active.")
            self._evict_terminal_session_if_needed()
            if len(self._sessions) >= MAX_REPLAY_SESSIONS:
                raise ReplayLifecycleError("REPLAY_CAPACITY_EXCEEDED", "lifecycle", "Replay session capacity is exhausted.")
            session = ReplaySession(
                replay_id=replay_id,
                cancellation_id=cancellation_id,
                trace_id=str(batch["trace_id"]),
                batch=dict(batch),
                pace_interval_ms=pace_interval_ms,
                started_at=now,
                deadline_at=deadline,
                next_due=self._monotonic(),
            )
            self._sessions[replay_id] = session
            self._cancellations[cancellation_id] = replay_id
        return {
            "replay_schema_version": REPLAY_SESSION_SCHEMA_VERSION,
            "replay_id": replay_id,
            "cancellation_id": cancellation_id,
            "trace_id": session.trace_id,
            "batch_id": batch["batch_id"],
            "instrument_id": batch["instrument_id"],
            "event_count": len(batch["events"]),
            "canonical_events_sha256": batch["canonical_events_sha256"],
            "pace_interval_ms": pace_interval_ms,
            "state": "ready",
            "next_index": 0,
            "started_at": iso_utc(now),
            "deadline_at": deadline_at,
        }

    def next(self, replay_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._require_session(replay_id)
        with session.pull_lock:
            return self._next_serialized(replay_id)

    def _next_serialized(self, replay_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._require_session(replay_id)
            self._raise_if_terminal(session)
            pace_delay = max(0.0, session.next_due - self._monotonic())
            deadline_delay = max(0.0, (session.deadline_at - self._now()).total_seconds())
            delay = min(pace_delay, deadline_delay)
            cancellation = session.cancellation

        cancellation.wait(delay)

        with self._lock:
            session = self._require_session(replay_id)
            self._raise_if_terminal(session)
            now = self._now()
            if now >= session.deadline_at:
                session.state = "deadline"
                session.cancellation.set()
                raise ReplayLifecycleError("DEADLINE_EXCEEDED", "timeout", "Replay deadline elapsed while pacing.")
            events = session.batch["events"]
            if session.cursor >= len(events):
                session.state = "completed"
                self._cancellations.pop(session.cancellation_id, None)
                return {
                    "replay_step_schema_version": REPLAY_STEP_SCHEMA_VERSION,
                    "replay_id": session.replay_id,
                    "trace_id": session.trace_id,
                    "batch_id": session.batch["batch_id"],
                    "state": "completed",
                    "emitted_count": session.cursor,
                    "remaining_count": 0,
                    "completed_at": iso_utc(now),
                    "batch": session.batch,
                }
            event_index = session.cursor
            event = events[event_index]
            session.cursor += 1
            session.next_due = max(session.next_due + session.pace_interval_ms / 1_000, self._monotonic())
            return {
                "replay_step_schema_version": REPLAY_STEP_SCHEMA_VERSION,
                "replay_id": session.replay_id,
                "trace_id": session.trace_id,
                "batch_id": session.batch["batch_id"],
                "state": "event",
                "event_index": event_index,
                "emitted_count": session.cursor,
                "remaining_count": len(events) - session.cursor,
                "emitted_at": iso_utc(now),
                "event": event,
            }

    def cancel(self, cancellation_id: str) -> dict[str, Any]:
        with self._lock:
            replay_id = self._cancellations.get(cancellation_id)
            if replay_id is None:
                raise ReplayLifecycleError("REPLAY_NOT_FOUND", "validation", "Active replay cancellation id was not found.")
            session = self._sessions[replay_id]
            session.state = "canceled"
            session.cancellation.set()
            self._cancellations.pop(cancellation_id, None)
            return {
                "replay_id": replay_id,
                "cancellation_id": cancellation_id,
                "state": "canceled",
                "canceled_at": iso_utc(self._now()),
            }

    def stop(self) -> None:
        with self._lock:
            for session in self._sessions.values():
                if session.state == "ready":
                    session.state = "canceled"
                    session.cancellation.set()
            self._cancellations.clear()

    def _require_session(self, replay_id: str) -> ReplaySession:
        session = self._sessions.get(replay_id)
        if session is None:
            raise ReplayLifecycleError("REPLAY_NOT_FOUND", "validation", "Replay id was not found.")
        self._sessions.move_to_end(replay_id)
        return session

    @staticmethod
    def _raise_if_terminal(session: ReplaySession) -> None:
        if session.state == "canceled":
            raise ReplayLifecycleError("CANCELED", "canceled", "Replay was canceled.")
        if session.state == "deadline":
            raise ReplayLifecycleError("DEADLINE_EXCEEDED", "timeout", "Replay deadline elapsed while pacing.")
        if session.state == "completed":
            raise ReplayLifecycleError("REPLAY_COMPLETED", "lifecycle", "Replay is already complete.")

    def _evict_terminal_session_if_needed(self) -> None:
        if len(self._sessions) < MAX_REPLAY_SESSIONS:
            return
        for replay_id, session in self._sessions.items():
            if session.state != "ready":
                self._sessions.pop(replay_id)
                self._cancellations.pop(session.cancellation_id, None)
                return
