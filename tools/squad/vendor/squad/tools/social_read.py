"""Read-only social intelligence tools with a narrow client contract."""

from __future__ import annotations

import logging
import re
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Protocol
from urllib.parse import urlparse

from .web_search import _trim

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SocialPost:
    source: str
    title: str
    body: str
    url: str
    published_at: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class SocialReadResponse:
    source: str
    posts: list[SocialPost]
    query: str
    warnings: list[str] | None = None


class SocialReadClient(Protocol):
    def read(self, query: str, limit: int = 10) -> SocialReadResponse:
        ...


def _safe_text(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(node.itertext()).strip()


class DisabledSocialReadClient:
    def __init__(self, reason: str = "social read disabled") -> None:
        self.reason = reason

    def read(self, query: str, limit: int = 10) -> SocialReadResponse:
        del limit
        return SocialReadResponse(
            source="disabled",
            query=query,
            posts=[],
            warnings=[self.reason],
        )


class RssFeedSocialReader:
    """Read from RSS/Atom sources and run local text filtering.

    This keeps the first loop useful without requiring one large platform SDK
    per destination.
    """

    def __init__(self, sources: Mapping[str, str], timeout_sec: int = 8) -> None:
        self.sources = dict(sources)
        self.timeout_sec = timeout_sec

    def read(self, query: str, limit: int = 10) -> SocialReadResponse:
        query_l = query.lower().strip()
        if not query_l:
            return SocialReadResponse(
                source="rss",
                query=query,
                posts=[],
                warnings=["empty query"],
            )

        if not self.sources:
            return SocialReadResponse(
                source="rss",
                query=query,
                posts=[],
                warnings=["no rss sources configured"],
            )

        pattern = re.compile(re.escape(query_l), re.IGNORECASE)
        posts: list[SocialPost] = []
        warnings: list[str] = []

        for source_name, feed_url in self.sources.items():
            try:
                parsed = urllib.request.urlopen(feed_url, timeout=self.timeout_sec)
                content = parsed.read()
            except Exception as exc:  # pragma: no cover - network dependent
                logger.warning("failed reading rss source %s: %s", source_name, exc)
                warnings.append(f"{source_name}: {exc}")
                continue

            try:
                root = ET.fromstring(content)
            except Exception as exc:  # pragma: no cover - malformed xml/network
                warnings.append(f"{source_name}: invalid xml feed")
                logger.warning("invalid rss xml for %s: %s", source_name, exc)
                continue

            channel = root.find("channel")
            feed_posts = []
            if channel is not None:
                feed_posts = channel.findall("item")
            else:
                feed_posts = root.findall(".//entry")

            for item in feed_posts:
                title = _safe_text(item.findtext("title"))
                body = _safe_text(item.findtext("description")) or _safe_text(
                    item.findtext("summary")
                )
                link = item.findtext("link") or item.findtext("{http://www.w3.org/2005/Atom}link")
                if link is None:
                    continue
                if hasattr(link, "attrib") and isinstance(link, ET.Element):
                    link = link.attrib.get("href", "")
                link = str(link)
                if not link:
                    continue
                text = f"{title}\n{body}".lower()
                if not pattern.search(text):
                    continue

                pub = item.findtext("pubDate") or item.findtext(
                    "{http://www.w3.org/2005/Atom}published"
                )
                posts.append(
                    SocialPost(
                        source=source_name,
                        title=title[:240],
                        body=_trim(body, 1000) or "",
                        url=link,
                        published_at=pub,
                        metadata={
                            "host": urlparse(feed_url).netloc,
                        },
                    )
                )
                if len(posts) >= limit:
                    break

            if len(posts) >= limit:
                break

        return SocialReadResponse(
            source="rss",
            query=query,
            posts=posts[:limit],
            warnings=warnings or None,
        )


def make_social_read_client(
    source_urls: Mapping[str, str] | None = None,
    disabled_reason: str = "social-read disabled",
) -> SocialReadClient:
    if not source_urls:
        return DisabledSocialReadClient(disabled_reason)
    return RssFeedSocialReader(sources=source_urls)
