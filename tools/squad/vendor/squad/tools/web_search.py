"""Web search adapters used by research-facing agents.

The goal is a stable, mock-friendly contract, not a deep wrapper around a
specific vendor.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Protocol, Sequence
from urllib.parse import quote_plus


logger = logging.getLogger(__name__)


def _trim(value: str | None, limit: int = 500) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v[:limit] if len(v) > limit else v


@dataclass(frozen=True)
class SearchResult:
    query: str
    title: str
    snippet: str
    url: str
    source: str = "duckduckgo_text"


@dataclass(frozen=True)
class SearchResponse:
    query: str
    results: list[SearchResult]
    provider: str
    elapsed_ms: int | None = None
    warnings: list[str] | None = None
    metadata: dict[str, Any] | None = None


class SearchClient(Protocol):
    def search(self, query: str, max_results: int = 5) -> SearchResponse:
        ...


class DisabledWebSearchClient:
    """Used when no provider is configured or no optional dependency exists."""

    def __init__(self, reason: str = "search disabled") -> None:
        self.reason = reason

    def search(self, query: str, max_results: int = 5) -> SearchResponse:
        del max_results  # kept for signature compatibility
        logger.info("web_search disabled: %s", self.reason)
        return SearchResponse(
            query=query,
            provider="disabled",
            results=[],
            warnings=[self.reason],
            metadata={"disabled": True},
        )


class DuckDuckGoTextSearchClient:
    """Optional client using duckduckgo-search package if available.

    This keeps runtime dependency explicit and avoids forcing the project to add a
    hard dependency before we know we need it.
    """

    def __init__(self, region: str = "us-en") -> None:
        self.region = region
        self._ddgs = None
        try:
            from duckduckgo_search import DDGS  # type: ignore[import-not-found]
        except Exception as exc:  # pragma: no cover - exercised by absence/presence
            raise RuntimeError("duckduckgo-search package unavailable") from exc
        else:
            self._ddgs = DDGS()

    def search(self, query: str, max_results: int = 5) -> SearchResponse:
        from time import perf_counter

        start = perf_counter()
        q = query.strip()
        if not q:
            return SearchResponse(
                query=query,
                provider="duckduckgo_text",
                results=[],
                warnings=["empty query"],
            )

        try:
            raw = self._ddgs.text(q, region=self.region, max_results=max_results)
        except Exception as exc:  # pragma: no cover - network dependent
            logger.exception("duckduckgo search failed")
            return SearchResponse(
                query=q,
                provider="duckduckgo_text",
                results=[],
                warnings=[f"search failed: {exc}"],
                metadata={"error": str(exc)},
            )

        results: list[SearchResult] = []
        for item in raw or []:
            try:
                title = _trim(item.get("title") or "", 250) or ""
                body = _trim(item.get("body") or "", 500) or ""
                href = item.get("href") or item.get("url")
                if not href:
                    continue
                results.append(
                    SearchResult(
                        query=q,
                        title=title,
                        snippet=body,
                        url=href,
                        source="duckduckgo_text",
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("invalid search result row: %s", exc)
                continue

        return SearchResponse(
            query=q,
            provider="duckduckgo_text",
            results=results,
            elapsed_ms=int((perf_counter() - start) * 1000),
            metadata={"query": q, "encoded_query": quote_plus(q)},
        )


def make_search_client(
    provider: str = "auto",
    region: str = "us-en",
    disabled_reason: str | None = None,
) -> SearchClient:
    """Factory with an explicit, stable no-fail default.

    Returns:
        SearchClient
    """

    provider = (provider or "auto").lower().strip()
    if provider == "auto":
        try:
            return DuckDuckGoTextSearchClient(region=region)
        except Exception as exc:
            return DisabledWebSearchClient(
                reason=disabled_reason
                or f"auto provider unavailable: {exc.__class__.__name__}"
            )

    if provider == "disabled":
        return DisabledWebSearchClient(disabled_reason or "search disabled by config")

    if provider == "duckduckgo":
        try:
            return DuckDuckGoTextSearchClient(region=region)
        except Exception as exc:
            return DisabledWebSearchClient(
                reason=f"duckduckgo provider unavailable: {exc.__class__.__name__}: {exc}"
            )

    return DisabledWebSearchClient(f"unknown search provider: {provider}")


def read_env_client(prefix: str = "WEB_SEARCH") -> SearchClient:
    """Build a client from environment variables without hard coupling runtime.

    Env:
      WEB_SEARCH_PROVIDER=duckduckgo|disabled|auto
      WEB_SEARCH_REGION=us-en
      WEB_SEARCH_DISABLED_REASON=<optional>
    """

    provider = os.getenv(f"{prefix}_PROVIDER", "auto")
    region = os.getenv(f"{prefix}_REGION", "us-en")
    reason = os.getenv(f"{prefix}_DISABLED_REASON")
    return make_search_client(provider=provider, region=region, disabled_reason=reason)
