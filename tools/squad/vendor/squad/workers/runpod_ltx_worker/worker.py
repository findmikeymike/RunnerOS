from __future__ import annotations

import os
import shutil
import subprocess
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4


class LTXWorkerError(RuntimeError):
    """Raised for invalid input or worker execution failures."""


@dataclass(frozen=True, slots=True)
class LTXWorkerRequest:
    mode: str
    prompt: str
    duration_s: int
    aspect_ratio: str
    negative_prompt: str
    seed: int | None
    input_image_url: str
    audio_prompt: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "LTXWorkerRequest":
        mode = str(payload.get("mode") or "image_to_video").strip()
        if mode != "image_to_video":
            raise LTXWorkerError("only image_to_video mode is supported by this worker")
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            raise LTXWorkerError("prompt must not be blank")
        input_image_url = str(payload.get("input_image_url") or "").strip()
        if not input_image_url:
            raise LTXWorkerError("input_image_url is required for image_to_video")
        return cls(
            mode=mode,
            prompt=prompt,
            duration_s=normalize_duration_s(payload.get("duration_s") or payload.get("duration") or 5),
            aspect_ratio=str(payload.get("aspect_ratio") or "16:9").strip(),
            negative_prompt=str(payload.get("negative_prompt") or "").strip(),
            seed=_optional_int(payload.get("seed")),
            input_image_url=input_image_url,
            audio_prompt=_optional_str(payload.get("audio_prompt")),
        )


@dataclass(frozen=True, slots=True)
class LTXWorkerConfig:
    work_dir: Path = Path("/tmp/squad-ltx-worker")
    ltx_repo_dir: Path = Path("/opt/LTX-Video")
    pipeline_config: str = "configs/ltxv-13b-0.9.8-distilled.yaml"
    default_fps: int = 24
    output_object_name: str = "ltx-video.mp4"

    @classmethod
    def from_env(cls) -> "LTXWorkerConfig":
        return cls(
            work_dir=Path(os.getenv("SQUAD_LTX_WORK_DIR", "/tmp/squad-ltx-worker")),
            ltx_repo_dir=Path(os.getenv("SQUAD_LTX_REPO_DIR", "/opt/LTX-Video")),
            pipeline_config=os.getenv("SQUAD_LTX_PIPELINE_CONFIG", "configs/ltxv-13b-0.9.8-distilled.yaml"),
            default_fps=int(os.getenv("SQUAD_LTX_FPS", "24")),
            output_object_name=os.getenv("SQUAD_LTX_OUTPUT_OBJECT_NAME", "ltx-video.mp4"),
        )


class Downloader(Protocol):
    def download(self, url: str, destination_path: Path) -> None:
        ...


class Runner(Protocol):
    def run(self, *, request: LTXWorkerRequest, input_image_path: Path, output_path: Path, config: LTXWorkerConfig) -> None:
        ...


class Uploader(Protocol):
    def upload(self, path: Path, *, object_name: str) -> str:
        ...


class UrlDownloader:
    def download(self, url: str, destination_path: Path) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url=url, method="GET")
        with urllib.request.urlopen(request, timeout=120) as response:  # pragma: no cover
            with destination_path.open("wb") as output:
                shutil.copyfileobj(response, output)


class CommandLTXRunner:
    def run(self, *, request: LTXWorkerRequest, input_image_path: Path, output_path: Path, config: LTXWorkerConfig) -> None:
        ltx_output_dir = output_path.parent / "ltx-output"
        ltx_output_dir.mkdir(parents=True, exist_ok=True)
        command = build_ltx_command(
            request=request,
            input_image_path=input_image_path,
            output_path=ltx_output_dir,
            config=config,
        )
        subprocess.run(command, cwd=config.ltx_repo_dir, check=True)
        generated_output = newest_generated_video(ltx_output_dir)
        if generated_output is None:
            raise LTXWorkerError("LTX runner did not write an mp4 output")
        shutil.copyfile(generated_output, output_path)


class LocalFileUploader:
    """Fallback uploader for local tests only; production should use object storage."""

    def upload(self, path: Path, *, object_name: str) -> str:
        base_url = os.getenv("SQUAD_LTX_PUBLIC_OUTPUT_BASE_URL", "").rstrip("/")
        if not base_url:
            raise LTXWorkerError("SQUAD_LTX_PUBLIC_OUTPUT_BASE_URL is required unless a real uploader is injected")
        return f"{base_url}/{object_name}"


class S3CompatibleUploader:
    def __init__(
        self,
        *,
        bucket: str,
        public_base_url: str,
        client=None,
    ) -> None:
        if not bucket.strip():
            raise ValueError("bucket must not be blank")
        if not public_base_url.strip():
            raise ValueError("public_base_url must not be blank")
        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")
        self.client = client or _make_s3_client()

    def upload(self, path: Path, *, object_name: str) -> str:
        key = object_name.lstrip("/")
        self.client.upload_file(
            str(path),
            self.bucket,
            key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        return f"{self.public_base_url}/{key}"


class RunPodBucketUploader:
    """Uploads through RunPod's SDK helper and returns its presigned URL."""

    def __init__(self, *, bucket_name: str | None = None, upload_fn=None) -> None:
        self.bucket_name = bucket_name or None
        self.upload_fn = upload_fn or _runpod_upload_file_to_bucket

    def upload(self, path: Path, *, object_name: str) -> str:
        url = self.upload_fn(
            file_name=object_name.lstrip("/"),
            file_location=str(path),
            bucket_name=self.bucket_name,
            extra_args={"ContentType": "video/mp4"},
        )
        if not str(url).startswith("http"):
            raise LTXWorkerError(
                "RunPod upload did not return a downloadable URL; configure BUCKET_ENDPOINT_URL, "
                "BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY, and BUCKET_NAME"
            )
        return str(url)


def choose_default_uploader(*, env: dict[str, str] | None = None, client_factory=None) -> Uploader:
    env = env or os.environ
    bucket = env.get("SQUAD_LTX_S3_BUCKET", "").strip()
    public_base_url = env.get("SQUAD_LTX_S3_PUBLIC_BASE_URL", "").strip()
    if bucket and public_base_url:
        client = client_factory() if client_factory else None
        return S3CompatibleUploader(bucket=bucket, public_base_url=public_base_url, client=client)
    if (
        env.get("BUCKET_ENDPOINT_URL", "").strip()
        and env.get("BUCKET_ACCESS_KEY_ID", "").strip()
        and env.get("BUCKET_SECRET_ACCESS_KEY", "").strip()
    ):
        return RunPodBucketUploader(bucket_name=env.get("BUCKET_NAME", "").strip() or None)
    return LocalFileUploader()


def run_ltx_job(
    *,
    request: LTXWorkerRequest,
    config: LTXWorkerConfig,
    downloader: Downloader | None = None,
    runner: Runner | None = None,
    uploader: Uploader | None = None,
) -> dict[str, Any]:
    downloader = downloader or UrlDownloader()
    runner = runner or CommandLTXRunner()
    uploader = uploader or choose_default_uploader()

    job_dir = config.work_dir / str(uuid4())
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / "input.png"
    output_path = job_dir / "output.mp4"

    downloader.download(request.input_image_url, input_path)
    runner.run(request=request, input_image_path=input_path, output_path=output_path, config=config)
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise LTXWorkerError("LTX runner did not produce output video")

    video_url = uploader.upload(output_path, object_name=config.output_object_name)
    width, height = normalize_resolution(request.aspect_ratio)
    return {
        "video_url": video_url,
        "duration_s": request.duration_s,
        "width": width,
        "height": height,
        "metadata": {
            "mode": request.mode,
            "aspect_ratio": request.aspect_ratio,
            "fps": config.default_fps,
            "frame_count": frame_count_for_duration(request.duration_s, config.default_fps),
            "pipeline_config": config.pipeline_config,
            "audio_requested": bool(request.audio_prompt),
        },
    }


def build_ltx_command(
    *,
    request: LTXWorkerRequest,
    input_image_path: Path,
    output_path: Path,
    config: LTXWorkerConfig,
) -> list[str]:
    width, height = normalize_resolution(request.aspect_ratio)
    command = [
        "python",
        "inference.py",
        "--prompt",
        _combined_prompt(request),
        "--conditioning_media_paths",
        str(input_image_path),
        "--conditioning_start_frames",
        "0",
        "--height",
        str(height),
        "--width",
        str(width),
        "--num_frames",
        str(frame_count_for_duration(request.duration_s, config.default_fps)),
        "--frame_rate",
        str(config.default_fps),
        "--pipeline_config",
        config.pipeline_config,
        "--output_path",
        str(output_path),
    ]
    if request.seed is not None:
        command.extend(["--seed", str(request.seed)])
    if request.negative_prompt:
        command.extend(["--negative_prompt", request.negative_prompt])
    return command


def normalize_duration_s(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 5
    return max(1, min(parsed, 20))


def normalize_resolution(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio.strip() == "9:16":
        return (720, 1280)
    return (1280, 720)


def frame_count_for_duration(duration_s: int, fps: int) -> int:
    return int(duration_s) * int(fps) + 1


def newest_generated_video(output_dir: Path) -> Path | None:
    videos = sorted(output_dir.glob("*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
    return videos[0] if videos else None


def _combined_prompt(request: LTXWorkerRequest) -> str:
    prompt = request.prompt.strip()
    if request.audio_prompt:
        prompt = f"{prompt} Audio direction: {request.audio_prompt.strip()}"
    return prompt


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_str(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _make_s3_client():
    try:
        import boto3
    except ImportError as exc:  # pragma: no cover
        raise LTXWorkerError("boto3 is required for S3-compatible uploads") from exc
    endpoint_url = os.getenv("SQUAD_LTX_S3_ENDPOINT_URL") or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=os.getenv("SQUAD_LTX_S3_ACCESS_KEY_ID") or None,
        aws_secret_access_key=os.getenv("SQUAD_LTX_S3_SECRET_ACCESS_KEY") or None,
    )


def _runpod_upload_file_to_bucket(**kwargs):
    try:
        from runpod.serverless.utils.rp_upload import upload_file_to_bucket
    except ImportError as exc:  # pragma: no cover
        raise LTXWorkerError("runpod SDK is required for RunPod bucket uploads") from exc
    return upload_file_to_bucket(**kwargs)
