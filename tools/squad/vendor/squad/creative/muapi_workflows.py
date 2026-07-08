"""MuAPI workflow marketplace/client helpers.

This module is intentionally small: Squad can scout and run hosted MuAPI
workflows without hard-coding secrets or making MuAPI the core runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import mimetypes
from pathlib import Path
import time
from urllib.parse import urlparse, urlunparse
import urllib.error
import urllib.request
from typing import Any, Mapping


DEFAULT_MUAPI_BASE_URL = "https://api.muapi.ai/workflow"


class MuAPIWorkflowError(RuntimeError):
    """Raised when MuAPI workflow calls fail."""


@dataclass(frozen=True)
class MuAPIWorkflowSummary:
    workflow_id: str
    name: str
    category: str
    source: str
    updated_at: str | None = None
    thumbnail: str | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any], *, source: str) -> "MuAPIWorkflowSummary":
        workflow_id = str(payload.get("id") or "").strip()
        if not workflow_id:
            raise MuAPIWorkflowError("workflow summary missing id")
        return cls(
            workflow_id=workflow_id,
            name=str(payload.get("name") or "").strip() or "Untitled Workflow",
            category=str(payload.get("category") or "Uncategorized").strip() or "Uncategorized",
            source=source,
            updated_at=str(payload.get("updated_at")) if payload.get("updated_at") else None,
            thumbnail=str(payload.get("thumbnail")) if payload.get("thumbnail") else None,
        )


@dataclass(frozen=True)
class MuAPIWorkflowShape:
    summary: MuAPIWorkflowSummary
    required_inputs: tuple[str, ...]
    input_properties: dict[str, dict[str, Any]]
    node_count: int
    node_categories: dict[str, int]
    node_models: tuple[str, ...]


@dataclass(frozen=True)
class MuAPIArtifactCandidate:
    response_path: str
    url: str
    media_type: str


class MuAPIWorkflowClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_MUAPI_BASE_URL,
        timeout_sec: float = 45.0,
        poll_interval_sec: float = 2.0,
        max_poll_attempts: int = 900,
        urlopen=urllib.request.urlopen,
    ) -> None:
        self.api_key = str(api_key or "").strip()
        if not self.api_key:
            raise MuAPIWorkflowError("MuAPI API key is required")
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.poll_interval_sec = poll_interval_sec
        self.max_poll_attempts = max_poll_attempts
        self._urlopen = urlopen

    def list_template_workflows(self) -> list[MuAPIWorkflowSummary]:
        return self._list_workflows("get-template-workflows", source="template")

    def list_published_workflows(self) -> list[MuAPIWorkflowSummary]:
        return self._list_workflows("get-published-workflows", source="published")

    def get_workflow_def(self, workflow_id: str) -> dict[str, Any]:
        return self._request_json("GET", f"get-workflow-def/{workflow_id}")

    def get_workflow_inputs(self, workflow_id: str) -> dict[str, Any]:
        return self._request_json("GET", f"{workflow_id}/api-inputs")

    def get_node_schemas(self, workflow_id: str) -> dict[str, Any]:
        return self._request_json("GET", f"{workflow_id}/node-schemas")

    def describe_workflow(self, summary: MuAPIWorkflowSummary) -> MuAPIWorkflowShape:
        workflow_def = self.get_workflow_def(summary.workflow_id)
        inputs = self.get_workflow_inputs(summary.workflow_id)
        nodes = _workflow_nodes(workflow_def)
        properties, required = _input_schema_parts(inputs)
        categories: dict[str, int] = {}
        models: list[str] = []
        for node in nodes:
            category = str(node.get("category") or "unknown")
            categories[category] = categories.get(category, 0) + 1
            model = str(node.get("model") or "").strip()
            if model:
                models.append(model)
        return MuAPIWorkflowShape(
            summary=summary,
            required_inputs=tuple(required),
            input_properties=properties,
            node_count=len(nodes),
            node_categories=categories,
            node_models=tuple(models),
        )

    def execute_workflow(self, workflow_id: str, *, inputs: Mapping[str, Any]) -> dict[str, Any]:
        submit = self._request_json("POST", f"{workflow_id}/api-execute", {"inputs": dict(inputs)})
        run_id = submit.get("run_id") or submit.get("id")
        if not run_id:
            return submit
        return self.poll_workflow_outputs(str(run_id))

    def poll_workflow_outputs(self, run_id: str) -> dict[str, Any]:
        for attempt in range(1, self.max_poll_attempts + 1):
            if attempt > 1:
                time.sleep(self.poll_interval_sec)
            payload = self._request_json("GET", f"run/{run_id}/api-outputs")
            status = str(payload.get("status") or "").lower()
            if status in {"completed", "succeeded", "success"}:
                return payload
            if status in {"failed", "error"}:
                raise MuAPIWorkflowError(f"MuAPI workflow run failed: {payload.get('error') or 'unknown error'}")
        raise MuAPIWorkflowError(f"MuAPI workflow run timed out: {run_id}")

    def _list_workflows(self, path: str, *, source: str) -> list[MuAPIWorkflowSummary]:
        payload = self._request_json("GET", path)
        if not isinstance(payload, list):
            raise MuAPIWorkflowError(f"MuAPI {path} returned non-list payload")
        return [MuAPIWorkflowSummary.from_payload(item, source=source) for item in payload if isinstance(item, dict)]

    def _request_json(self, method: str, path: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any] | list[Any]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url=f"{self.base_url}/{path.lstrip('/')}",
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "Squad-MuAPI-Workflow/1.0",
                "x-api-key": self.api_key,
            },
        )
        try:
            with self._urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read(500).decode("utf-8", "replace")
            raise MuAPIWorkflowError(f"MuAPI request failed: HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise MuAPIWorkflowError(f"MuAPI request failed: {exc.reason}") from exc
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise MuAPIWorkflowError("MuAPI returned invalid JSON") from exc


def workflow_shape_to_payload(shape: MuAPIWorkflowShape) -> dict[str, Any]:
    return {
        "id": shape.summary.workflow_id,
        "name": shape.summary.name,
        "category": shape.summary.category,
        "source": shape.summary.source,
        "updated_at": shape.summary.updated_at,
        "thumbnail": shape.summary.thumbnail,
        "required_inputs": list(shape.required_inputs),
        "input_properties": shape.input_properties,
        "node_count": shape.node_count,
        "node_categories": shape.node_categories,
        "node_models": list(shape.node_models),
    }


def discover_artifact_urls(payload: Any) -> tuple[MuAPIArtifactCandidate, ...]:
    candidates: list[MuAPIArtifactCandidate] = []
    seen: set[str] = set()

    def visit(value: Any, path: str, *, key_hint: str = "") -> None:
        if isinstance(value, str):
            media_type = _media_type_for_url(value, key_hint=key_hint)
            if media_type and value not in seen:
                seen.add(value)
                candidates.append(MuAPIArtifactCandidate(response_path=path, url=value, media_type=media_type))
            return
        if isinstance(value, Mapping):
            for key, item in value.items():
                key_text = str(key)
                visit(item, f"{path}.{key_text}" if path else key_text, key_hint=key_text.lower())
            return
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}[{index}]", key_hint=key_hint)

    visit(payload, "")
    return tuple(candidates)


def download_artifacts(
    candidates: tuple[MuAPIArtifactCandidate, ...],
    output_dir: Path | str,
    *,
    urlopen=urllib.request.urlopen,
    timeout_sec: float = 120.0,
    max_bytes: int = 250_000_000,
) -> list[dict[str, Any]]:
    root = Path(output_dir)
    root.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        suffix = _artifact_suffix(candidate.url, media_type=candidate.media_type)
        filename = f"artifact-{index:02d}{suffix}"
        path = root / filename
        request = urllib.request.Request(
            candidate.url,
            headers={"User-Agent": "Squad-MuAPI-Artifact/1.0"},
        )
        try:
            with urlopen(request, timeout=timeout_sec) as response:
                data = response.read(max_bytes + 1)
                content_type = response.getheader("Content-Type", "") if hasattr(response, "getheader") else ""
        except urllib.error.URLError as exc:
            raise MuAPIWorkflowError(f"MuAPI artifact download failed: {candidate.response_path}: {exc.reason}") from exc
        if len(data) > max_bytes:
            raise MuAPIWorkflowError(f"MuAPI artifact exceeds max_bytes: {candidate.response_path}")
        if not data:
            raise MuAPIWorkflowError(f"MuAPI artifact download was empty: {candidate.response_path}")
        path.write_bytes(data)
        artifacts.append(
            {
                "path": str(path),
                "bytes": len(data),
                "media_type": candidate.media_type,
                "content_type": content_type,
                "response_path": candidate.response_path,
                "source_url": redact_url(candidate.url),
            }
        )
    return artifacts


def artifact_candidate_to_payload(candidate: MuAPIArtifactCandidate) -> dict[str, str]:
    return {
        "response_path": candidate.response_path,
        "media_type": candidate.media_type,
        "source_url": redact_url(candidate.url),
    }


def redact_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query and not parsed.fragment:
        return url
    return urlunparse(parsed._replace(query="", fragment=""))


def redact_payload_urls(value: Any) -> Any:
    if isinstance(value, str):
        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return redact_url(value)
        return value
    if isinstance(value, Mapping):
        return {str(key): redact_payload_urls(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_payload_urls(item) for item in value]
    return value


def validate_workflow_inputs(*, schema: Mapping[str, Any], inputs: Mapping[str, Any]) -> tuple[str, ...]:
    _properties, required = _input_schema_parts(schema)
    missing = [name for name in required if not _has_value(inputs.get(name))]
    return tuple(missing)


def _workflow_nodes(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    nodes = data.get("nodes") if isinstance(data, dict) else None
    return [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []


def _input_schema_parts(payload: Mapping[str, Any]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    schema = payload.get("input_data") if isinstance(payload.get("input_data"), dict) else payload
    properties = schema.get("properties") if isinstance(schema, dict) else {}
    required = schema.get("required") if isinstance(schema, dict) else []
    return (
        {str(key): value for key, value in properties.items() if isinstance(value, dict)} if isinstance(properties, dict) else {},
        [str(item) for item in required] if isinstance(required, list) else [],
    )


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _media_type_for_url(value: str, *, key_hint: str = "") -> str | None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    path = parsed.path.lower()
    guessed, _encoding = mimetypes.guess_type(path)
    if guessed:
        if guessed.startswith("image/"):
            return "image"
        if guessed.startswith("video/"):
            return "video"
        if guessed.startswith("audio/"):
            return "audio"
    if any(token in key_hint for token in ("image", "video", "audio", "asset", "file", "download", "output")):
        return "file"
    return None


def _artifact_suffix(url: str, *, media_type: str) -> str:
    suffix = Path(urlparse(url).path).suffix
    if suffix:
        return suffix[:16]
    return {
        "image": ".png",
        "video": ".mp4",
        "audio": ".mp3",
    }.get(media_type, ".bin")
