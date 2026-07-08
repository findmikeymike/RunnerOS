"""Postiz client wrapper with explicit dry-run and non-live behavior defaults."""

from __future__ import annotations

import json
import logging
import os
import uuid
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

logger = logging.getLogger(__name__)


def _coerce_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
    if headers is None:
        return {}
    return {str(k): str(v) for k, v in headers.items()}


@dataclass(frozen=True)
class PostizResult:
    success: bool
    external_call_performed: bool
    message: str
    status_code: int | None = None
    request_payload: dict[str, Any] | None = None
    response_body: dict[str, Any] | None = None
    post_id: str | None = None


class PostizClient:
    """Small adapter around Postiz outbound API.

    Keep defaults safe. If not configured, the client will never call network and
    will return structured dry-run responses instead.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        default_team_id: str | None = None,
        timeout_sec: int = 10,
        additional_headers: Mapping[str, str] | None = None,
        enforce_live: bool = False,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self.default_team_id = default_team_id
        self.timeout_sec = timeout_sec
        self.additional_headers = dict(additional_headers or {})
        self.enforce_live = enforce_live
        self.enabled = bool(self.base_url and self.api_key)

    @classmethod
    def from_env(cls, prefix: str = "POSTIZ") -> "PostizClient":
        return cls(
            base_url=os.getenv(f"{prefix}_BASE_URL"),
            api_key=os.getenv(f"{prefix}_API_KEY"),
            default_team_id=os.getenv(f"{prefix}_DEFAULT_TEAM_ID"),
            timeout_sec=int(os.getenv(f"{prefix}_TIMEOUT_SEC", "10")),
            additional_headers=json.loads(os.getenv(f"{prefix}_HEADERS", "{}")),
            enforce_live=os.getenv(f"{prefix}_ENFORCE_LIVE", "").lower() in {"1", "true", "yes"},
        )

    def _build_payload(
        self,
        content: str,
        channel: str,
        scheduled_at: str | None,
        metadata: Mapping[str, Any],
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "content": content,
            "channel": channel,
            "metadata": dict(metadata),
            "idempotency_key": str(uuid.uuid4()),
        }
        if scheduled_at:
            payload["scheduled_at"] = scheduled_at
        if self.default_team_id and "team_id" not in payload:
            payload["team_id"] = self.default_team_id
        return payload

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
            **_coerce_headers(self.additional_headers),
        }
        return {k: v for k, v in headers.items() if v}

    def _post_json(self, path: str, payload: dict[str, Any]) -> PostizResult:
        if not self.enabled:
            return PostizResult(
                success=True,
                external_call_performed=False,
                message="Postiz client not configured, returned as local draft only.",
                request_payload=payload,
            )

        url = f"{self.base_url}/{path.lstrip('/')}"
        req = urllib.request.Request(
            url=url,
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                body: dict[str, Any] = json.loads(raw) if raw else {}
                return PostizResult(
                    success=200 <= resp.status < 300,
                    external_call_performed=True,
                    status_code=resp.status,
                    message="Postiz request completed.",
                    request_payload=payload,
                    response_body=body,
                    post_id=str(body.get("id") or body.get("postId")),
                )
        except urllib.error.HTTPError as exc:
            return PostizResult(
                success=False,
                external_call_performed=True,
                status_code=exc.code,
                message=f"Postiz returned HTTP error: {exc}",
                request_payload=payload,
            )
        except Exception as exc:  # pragma: no cover - external dependency/path
            logger.exception("postiz request failed")
            return PostizResult(
                success=False,
                external_call_performed=True,
                message=f"Postiz request failed: {exc}",
                request_payload=payload,
            )

    def schedule_content(
        self,
        content: str,
        channel: str,
        *,
        scheduled_at: str | None = None,
        dry_run: bool | None = None,
        path: str = "/api/v1/posts",
        metadata: Mapping[str, Any] | None = None,
    ) -> PostizResult:
        """Create/schedule a post through Postiz.

        If Postiz is not configured, returns a deterministic non-live result and
        does not perform network operations.
        """
        metadata_dict = dict(metadata or {})
        payload = self._build_payload(content, channel, scheduled_at, metadata_dict)
        if dry_run is None:
            dry_run = not self.enabled
        if dry_run and not self.enforce_live:
            return PostizResult(
                success=True,
                external_call_performed=False,
                message="Postiz dry-run mode: not sent to Postiz.",
                request_payload=payload,
            )
        return self._post_json(path=path, payload=payload)

