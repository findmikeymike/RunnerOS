"""ComfyUI-backed LTX video adapter.

This adapter targets RunPod/ComfyUI template pods without binding Squad to one
template's UI. It expects an exported ComfyUI API workflow plus explicit node
bindings for the few fields Squad must control.
"""

from __future__ import annotations

import asyncio
import copy
import json
import mimetypes
import shutil
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from creative.video_factory.contracts import (
    BudgetExceededError,
    CostRecord,
    GeneratedAsset,
    VideoGenerationError,
)


DEFAULT_COMFY_LTX_MODEL_ID = "comfy/ltx-video-2.3"
DEFAULT_COMFY_LTX_COST_PER_SECOND_USD = 0.025


@dataclass(frozen=True, slots=True)
class ComfyOutputFile:
    filename: str
    subfolder: str = ""
    type: str = "output"


@dataclass(frozen=True, slots=True)
class ComfyGeneratedAsset:
    output: ComfyOutputFile
    prompt_id: str
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    latency_s: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ComfyWorkflowBindings:
    positive_text_nodes: tuple[str, ...]
    image_nodes: tuple[str, ...] = ()
    negative_text_nodes: tuple[str, ...] = ()
    seed_nodes: tuple[str, ...] = ()
    frame_count_nodes: tuple[str, ...] = ()
    width_nodes: tuple[str, ...] = ()
    height_nodes: tuple[str, ...] = ()
    audio_text_nodes: tuple[str, ...] = ()
    text_input: str = "text"
    image_input: str = "image"
    seed_input: str = "seed"
    frame_count_input: str = "frames"
    width_input: str = "width"
    height_input: str = "height"


@dataclass(frozen=True, slots=True)
class ComfyWorkflowPack:
    workflow_template: dict[str, Any]
    bindings: ComfyWorkflowBindings


class ComfyTransport(Protocol):
    def upload_image(self, path: Path) -> str:
        ...

    def submit_prompt(self, *, workflow: dict[str, Any]) -> str:
        ...

    def wait_for_video(self, *, prompt_id: str) -> ComfyGeneratedAsset:
        ...

    def download_output(self, output: ComfyOutputFile, destination_path: Path) -> None:
        ...


class ComfyTransportError(RuntimeError):
    """Raised when ComfyUI request, polling, or output parsing fails."""


class UnconfiguredComfyTransport:
    def upload_image(self, path: Path) -> str:
        raise RuntimeError("Comfy transport is not configured; inject HttpComfyTransport for live pods")

    def submit_prompt(self, *, workflow: dict[str, Any]) -> str:
        raise RuntimeError("Comfy transport is not configured; inject HttpComfyTransport for live pods")

    def wait_for_video(self, *, prompt_id: str) -> ComfyGeneratedAsset:
        raise RuntimeError("Comfy transport is not configured; inject HttpComfyTransport for live pods")

    def download_output(self, output: ComfyOutputFile, destination_path: Path) -> None:
        raise RuntimeError("Comfy transport is not configured; inject HttpComfyTransport for live pods")


class HttpComfyTransport:
    def __init__(
        self,
        *,
        base_url: str,
        token: str | None = None,
        timeout_sec: int = 900,
        poll_interval_s: float = 2.0,
        urlopen=urllib.request.urlopen,
        sleep=time.sleep,
    ) -> None:
        if not base_url.strip():
            raise ValueError("base_url must not be blank")
        self.base_url, url_token = _clean_base_url_and_token(base_url)
        self.token = _clean_token(token) or url_token
        self.timeout_sec = timeout_sec
        self.poll_interval_s = poll_interval_s
        self.urlopen = urlopen
        self.sleep = sleep

    def upload_image(self, path: Path) -> str:
        if not path.exists():
            raise ComfyTransportError(f"input image does not exist: {path}")
        boundary = f"----squad-comfy-{uuid4().hex}"
        mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = _multipart_body(
            boundary=boundary,
            fields={"overwrite": "true", "type": "input"},
            files={"image": (path.name, mime_type, path.read_bytes())},
        )
        response = self._request_json(
            "POST",
            "/upload/image",
            body,
            content_type=f"multipart/form-data; boundary={boundary}",
        )
        filename = str(response.get("name") or response.get("filename") or path.name).strip()
        if not filename:
            raise ComfyTransportError("Comfy upload response did not include a filename")
        return filename

    def get_system_stats(self) -> dict[str, Any]:
        return self._request_json("GET", "/system_stats", None)

    def submit_prompt(self, *, workflow: dict[str, Any]) -> str:
        response = self._request_json("POST", "/prompt", {"prompt": workflow, "client_id": str(uuid4())})
        prompt_id = str(response.get("prompt_id") or "").strip()
        if not prompt_id:
            raise ComfyTransportError("Comfy /prompt response did not include prompt_id")
        return prompt_id

    def wait_for_video(self, *, prompt_id: str) -> ComfyGeneratedAsset:
        deadline = time.monotonic() + self.timeout_sec
        while time.monotonic() < deadline:
            history = self._request_json("GET", f"/history/{urllib.parse.quote(prompt_id)}", None)
            if prompt_id in history:
                return _asset_from_history(prompt_id=prompt_id, history=history[prompt_id])
            self.sleep(self.poll_interval_s)
        raise ComfyTransportError(f"Comfy prompt {prompt_id} timed out after {self.timeout_sec}s")

    def download_output(self, output: ComfyOutputFile, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        query = urllib.parse.urlencode(
            {
                "filename": output.filename,
                "subfolder": output.subfolder,
                "type": output.type,
            }
        )
        request = urllib.request.Request(
            url=self._url(f"/view?{query}"),
            method="GET",
            headers=self._headers(),
        )
        try:
            with self.urlopen(request, timeout=self.timeout_sec) as response:  # pragma: no cover
                with destination_path.open("wb") as file:
                    shutil.copyfileobj(response, file)
        except Exception as exc:
            raise ComfyTransportError(f"Comfy HTTP request failed: {_scrub_secrets(str(exc))}") from exc

    def _request_json(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | bytes | None,
        *,
        content_type: str = "application/json",
    ) -> dict[str, Any]:
        data: bytes | None
        if isinstance(body, bytes):
            data = body
        elif body is None:
            data = None
        else:
            data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            url=self._url(path),
            data=data,
            method=method,
            headers=self._headers(content_type=content_type),
        )
        try:
            with self.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read()
        except Exception as exc:
            raise ComfyTransportError(f"Comfy HTTP request failed: {_scrub_secrets(str(exc))}") from exc
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ComfyTransportError("Comfy response was not valid JSON") from exc
        if not isinstance(payload, dict):
            raise ComfyTransportError("Comfy response JSON was not an object")
        return payload

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path if path.startswith('/') else '/' + path}"

    def _headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if content_type is not None:
            headers["Content-Type"] = content_type
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers


@dataclass(slots=True)
class ComfyLTXVideoAdapter:
    base_url: str
    workflow_template: dict[str, Any]
    bindings: ComfyWorkflowBindings
    token: str | None = ""
    model_id: str = DEFAULT_COMFY_LTX_MODEL_ID
    transport: ComfyTransport | None = None
    cost_per_second_usd: float = DEFAULT_COMFY_LTX_COST_PER_SECOND_USD
    default_fps: int = 24

    def __post_init__(self) -> None:
        if not self.base_url.strip():
            raise ValueError("base_url must not be blank")
        if self.cost_per_second_usd <= 0:
            raise ValueError("cost_per_second_usd must be positive")
        if not isinstance(self.workflow_template, dict) or not self.workflow_template:
            raise ValueError("workflow_template must be a non-empty dict")
        validate_comfy_workflow_pack(workflow_template=self.workflow_template, bindings=self.bindings)
        if self.transport is None:
            self.transport = UnconfiguredComfyTransport()

    def estimate_cost(self, duration_s: int) -> float:
        return round(self.cost_per_second_usd * max(1, int(duration_s)), 2)

    async def image_to_video(
        self,
        input_image: Path,
        prompt: str,
        duration_s: int = 5,
        aspect_ratio: str = "16:9",
        negative_prompt: str = "",
        seed: int | None = None,
        audio_prompt: str | None = None,
        input_image_url: str | None = None,
        budget_cap_usd: float | None = None,
        output_dir: Path | None = None,
    ) -> GeneratedAsset:
        del input_image_url
        estimated_cost = self.estimate_cost(duration_s)
        if budget_cap_usd is not None and estimated_cost > float(budget_cap_usd):
            raise BudgetExceededError(
                f"estimated image_to_video cost ${estimated_cost:.2f} exceeds budget cap ${float(budget_cap_usd):.2f}"
            )
        if not input_image.exists():
            raise VideoGenerationError(f"input image does not exist: {input_image}")

        destination_dir = output_dir or Path("./.outputs/video-factory/comfy-ltx")
        destination_dir.mkdir(parents=True, exist_ok=True)
        start = time.monotonic()
        try:
            image_name = await asyncio.to_thread(self.transport.upload_image, input_image)  # type: ignore[union-attr]
            workflow = build_ltx_workflow(
                template=self.workflow_template,
                bindings=self.bindings,
                prompt=prompt,
                image_name=image_name,
                duration_s=duration_s,
                fps=self.default_fps,
                aspect_ratio=aspect_ratio,
                negative_prompt=negative_prompt,
                seed=seed,
                audio_prompt=audio_prompt,
            )
            prompt_id = await asyncio.to_thread(self.transport.submit_prompt, workflow=workflow)  # type: ignore[union-attr]
            generated = await asyncio.to_thread(self.transport.wait_for_video, prompt_id=prompt_id)  # type: ignore[union-attr]
            local_path = destination_dir / f"{uuid4()}.mp4"
            await asyncio.to_thread(self.transport.download_output, generated.output, local_path)  # type: ignore[union-attr]
        except BudgetExceededError:
            raise
        except Exception as exc:
            raise VideoGenerationError(str(exc)) from exc

        latency_s = generated.latency_s if generated.latency_s is not None else round(time.monotonic() - start, 3)
        return GeneratedAsset(
            file_path=local_path,
            mime_type="video/mp4",
            duration_s=generated.duration_s or float(duration_s),
            width=generated.width,
            height=generated.height,
            cost=CostRecord(
                operation="image_to_video",
                model=self.model_id,
                input_params={
                    "prompt": prompt,
                    "duration_s": int(duration_s),
                    "aspect_ratio": aspect_ratio,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "has_audio_prompt": bool(audio_prompt),
                },
                cost_usd=estimated_cost,
                duration_s=float(latency_s or 0.0),
                provider_request_id=generated.prompt_id,
            ),
            metadata={
                "provider": "comfyui",
                "base_url": self.base_url,
                "model_id": self.model_id,
                "comfy_output": {
                    "filename": generated.output.filename,
                    "subfolder": generated.output.subfolder,
                    "type": generated.output.type,
                },
                **generated.metadata,
            },
        )


def build_ltx_workflow(
    *,
    template: dict[str, Any],
    bindings: ComfyWorkflowBindings,
    prompt: str,
    image_name: str,
    duration_s: int,
    fps: int,
    aspect_ratio: str,
    negative_prompt: str = "",
    seed: int | None = None,
    audio_prompt: str | None = None,
) -> dict[str, Any]:
    workflow = copy.deepcopy(template)
    width, height = _resolution_for_aspect_ratio(aspect_ratio)
    frame_count = _frame_count_for_duration(duration_s, fps)
    _set_inputs(workflow, bindings.positive_text_nodes, bindings.text_input, prompt)
    _set_inputs(workflow, bindings.negative_text_nodes, bindings.text_input, negative_prompt)
    _set_inputs(workflow, bindings.image_nodes, bindings.image_input, image_name)
    _set_inputs(workflow, bindings.frame_count_nodes, bindings.frame_count_input, frame_count)
    _set_inputs(workflow, bindings.width_nodes, bindings.width_input, width)
    _set_inputs(workflow, bindings.height_nodes, bindings.height_input, height)
    if seed is not None:
        _set_inputs(workflow, bindings.seed_nodes, bindings.seed_input, int(seed))
    if audio_prompt:
        _set_inputs(workflow, bindings.audio_text_nodes, bindings.text_input, audio_prompt)
    return workflow


def load_comfy_workflow_pack(*, workflow_path: Path, bindings_path: Path) -> ComfyWorkflowPack:
    workflow = _read_json_object(workflow_path, label="workflow")
    bindings_payload = _read_json_object(bindings_path, label="bindings")
    bindings = comfy_bindings_from_dict(bindings_payload)
    validate_comfy_workflow_pack(workflow_template=workflow, bindings=bindings)
    return ComfyWorkflowPack(workflow_template=workflow, bindings=bindings)


def comfy_bindings_from_dict(payload: dict[str, Any]) -> ComfyWorkflowBindings:
    allowed = {field.name for field in ComfyWorkflowBindings.__dataclass_fields__.values()}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ComfyTransportError(f"bindings include unknown keys: {', '.join(unknown)}")
    return ComfyWorkflowBindings(
        positive_text_nodes=_tuple_of_strings(payload.get("positive_text_nodes"), "positive_text_nodes"),
        image_nodes=_tuple_of_strings(payload.get("image_nodes", ()), "image_nodes"),
        negative_text_nodes=_tuple_of_strings(payload.get("negative_text_nodes", ()), "negative_text_nodes"),
        seed_nodes=_tuple_of_strings(payload.get("seed_nodes", ()), "seed_nodes"),
        frame_count_nodes=_tuple_of_strings(payload.get("frame_count_nodes", ()), "frame_count_nodes"),
        width_nodes=_tuple_of_strings(payload.get("width_nodes", ()), "width_nodes"),
        height_nodes=_tuple_of_strings(payload.get("height_nodes", ()), "height_nodes"),
        audio_text_nodes=_tuple_of_strings(payload.get("audio_text_nodes", ()), "audio_text_nodes"),
        text_input=str(payload.get("text_input", "text")),
        image_input=str(payload.get("image_input", "image")),
        seed_input=str(payload.get("seed_input", "seed")),
        frame_count_input=str(payload.get("frame_count_input", "frames")),
        width_input=str(payload.get("width_input", "width")),
        height_input=str(payload.get("height_input", "height")),
    )


def validate_comfy_workflow_pack(*, workflow_template: dict[str, Any], bindings: ComfyWorkflowBindings) -> None:
    if not bindings.positive_text_nodes:
        raise ComfyTransportError("bindings must include at least one positive_text_nodes entry")
    if "nodes" in workflow_template and isinstance(workflow_template.get("nodes"), list):
        raise ComfyTransportError("workflow looks like ComfyUI UI JSON; export/save it in API format before live use")
    checks = (
        (bindings.positive_text_nodes, bindings.text_input, "positive_text_nodes"),
        (bindings.negative_text_nodes, bindings.text_input, "negative_text_nodes"),
        (bindings.image_nodes, bindings.image_input, "image_nodes"),
        (bindings.seed_nodes, bindings.seed_input, "seed_nodes"),
        (bindings.frame_count_nodes, bindings.frame_count_input, "frame_count_nodes"),
        (bindings.width_nodes, bindings.width_input, "width_nodes"),
        (bindings.height_nodes, bindings.height_input, "height_nodes"),
        (bindings.audio_text_nodes, bindings.text_input, "audio_text_nodes"),
    )
    for node_ids, input_name, binding_name in checks:
        _validate_bound_inputs(workflow_template, node_ids, input_name, binding_name)


def _set_inputs(workflow: dict[str, Any], node_ids: tuple[str, ...], input_name: str, value: Any) -> None:
    for node_id in node_ids:
        node = workflow.get(str(node_id))
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ComfyTransportError(f"workflow node {node_id!r} is missing inputs")
        node["inputs"][input_name] = value


def _validate_bound_inputs(
    workflow: dict[str, Any],
    node_ids: tuple[str, ...],
    input_name: str,
    binding_name: str,
) -> None:
    for node_id in node_ids:
        node = workflow.get(str(node_id))
        if not isinstance(node, dict):
            raise ComfyTransportError(f"{binding_name} references missing workflow node {node_id!r}")
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            raise ComfyTransportError(f"{binding_name} node {node_id!r} is missing inputs")
        if input_name not in inputs:
            raise ComfyTransportError(f"{binding_name} node {node_id!r} is missing input {input_name!r}")


def _asset_from_history(*, prompt_id: str, history: dict[str, Any]) -> ComfyGeneratedAsset:
    outputs = history.get("outputs") or {}
    if not isinstance(outputs, dict):
        raise ComfyTransportError(f"Comfy prompt {prompt_id} history outputs were not an object")
    output_file = _find_video_output(outputs)
    if output_file is None:
        raise ComfyTransportError(f"Comfy prompt {prompt_id} completed without a video output")
    return ComfyGeneratedAsset(
        output=output_file,
        prompt_id=prompt_id,
        metadata={"history_status": history.get("status")},
    )


def _find_video_output(outputs: dict[str, Any]) -> ComfyOutputFile | None:
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for key in ("videos", "gifs", "images"):
            values = node_output.get(key)
            if not isinstance(values, list):
                continue
            for value in values:
                if not isinstance(value, dict):
                    continue
                filename = str(value.get("filename") or "").strip()
                if not filename:
                    continue
                if key == "images" and not filename.lower().endswith((".mp4", ".webm", ".mov", ".gif")):
                    continue
                return ComfyOutputFile(
                    filename=filename,
                    subfolder=str(value.get("subfolder") or ""),
                    type=str(value.get("type") or "output"),
                )
    return None


def _clean_base_url_and_token(base_url: str) -> tuple[str, str | None]:
    parsed = urllib.parse.urlsplit(base_url.strip())
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    token = next((value.strip() for key, value in query if key.lower() == "token" and value.strip()), None)
    cleaned = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
    return cleaned.rstrip("/"), token


def _clean_token(token: str | None) -> str | None:
    if token is None:
        return None
    token = token.strip()
    return token or None


def _scrub_secrets(message: str) -> str:
    parsed = urllib.parse.urlsplit(message)
    if parsed.query:
        message = urllib.parse.urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urllib.parse.urlencode(
                    [
                        (key, "[redacted]" if key.lower() in {"token", "access_token", "api_key"} else value)
                        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
                    ]
                ),
                parsed.fragment,
            )
        )
    for key in ("token", "access_token", "api_key"):
        message = _scrub_query_value(message, key)
    return message


def _scrub_query_value(message: str, key: str) -> str:
    for separator in ("?", "&"):
        marker = f"{separator}{key}="
        start = message.lower().find(marker)
        while start >= 0:
            value_start = start + len(marker)
            value_end = value_start
            while value_end < len(message) and message[value_end] not in "&#'\" )]":
                value_end += 1
            message = f"{message[:value_start]}[redacted]{message[value_end:]}"
            start = message.lower().find(marker, value_start + len("[redacted]"))
    return message


def _resolution_for_aspect_ratio(aspect_ratio: str) -> tuple[int, int]:
    return (720, 1280) if aspect_ratio.strip() == "9:16" else (1280, 720)


def _frame_count_for_duration(duration_s: int, fps: int) -> int:
    return max(1, int(duration_s)) * max(1, int(fps)) + 1


def _multipart_body(
    *,
    boundary: str,
    fields: dict[str, str],
    files: dict[str, tuple[str, str, bytes]],
) -> bytes:
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, (filename, mime_type, content) in files.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                    f"Content-Type: {mime_type}\r\n\r\n"
                ).encode("utf-8"),
                content,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks)


def _read_json_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ComfyTransportError(f"{label} file does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ComfyTransportError(f"{label} file is not valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise ComfyTransportError(f"{label} JSON must be an object: {path}")
    return payload


def _tuple_of_strings(value: Any, label: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise ComfyTransportError(f"{label} must be a list of node ids")
    result = tuple(str(item).strip() for item in value if str(item).strip())
    if label == "positive_text_nodes" and not result:
        raise ComfyTransportError("positive_text_nodes must include at least one node id")
    return result
