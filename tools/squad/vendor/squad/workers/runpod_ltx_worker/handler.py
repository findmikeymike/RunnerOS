from __future__ import annotations

from typing import Any

from workers.runpod_ltx_worker.worker import (
    LTXWorkerConfig,
    LTXWorkerError,
    LTXWorkerRequest,
    run_ltx_job,
)


def handle_event(
    event: dict[str, Any],
    *,
    config: LTXWorkerConfig | None = None,
    downloader=None,
    runner=None,
    uploader=None,
) -> dict[str, Any]:
    payload = event.get("input")
    if not isinstance(payload, dict):
        raise LTXWorkerError("event.input must be an object")
    request = LTXWorkerRequest.from_payload(payload)
    return run_ltx_job(
        request=request,
        config=config or LTXWorkerConfig.from_env(),
        downloader=downloader,
        runner=runner,
        uploader=uploader,
    )


def _runpod_handler(event: dict[str, Any]) -> dict[str, Any]:
    return handle_event(event)


if __name__ == "__main__":  # pragma: no cover
    import runpod

    runpod.serverless.start({"handler": _runpod_handler})
