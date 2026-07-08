from __future__ import annotations

import os
import shutil
import shlex
from pathlib import Path

from creative.production.audio import FfmpegAudioMixAdapter, LocalSfxLibraryAdapter
from creative.production.post_pass_visual import FfmpegUpscaleAdapter
from creative.production.caption_alignment import CommandCaptionAlignmentAdapter
from creative.production.post_pass import FfmpegCaptionBurnInAdapter, FfmpegLoudnessNormalizeAdapter, FfmpegMediaProbeAdapter
from creative.production.render_adapter import CommandRenderAdapter
from creative.production.track_library import (
    CompositeTrackLibraryAdapter,
    DirectoryTrackSourceAdapter,
    LocalTrackLibraryAdapter,
    ManifestTrackSourceAdapter,
)


def build_track_library_adapter_from_env(*, prefix: str = "SQUAD") -> LocalTrackLibraryAdapter | CompositeTrackLibraryAdapter | None:
    manifest = os.getenv(f"{prefix}_TRACK_LIBRARY_MANIFEST")
    root = os.getenv(f"{prefix}_TRACK_LIBRARY_ROOT")
    manifests = _split_env_paths(os.getenv(f"{prefix}_TRACK_LIBRARY_MANIFESTS"))
    roots = _split_env_paths(os.getenv(f"{prefix}_TRACK_LIBRARY_ROOTS"))
    if not manifest and not root:
        if not manifests and not roots:
            return None

    manifest_path = Path(manifest).expanduser() if manifest else None
    library_root = Path(root).expanduser() if root else None
    if manifest_path is not None and not manifest_path.exists():
        raise RuntimeError(f"{prefix}_TRACK_LIBRARY_MANIFEST does not exist: {manifest_path}")
    if library_root is not None and not library_root.exists():
        raise RuntimeError(f"{prefix}_TRACK_LIBRARY_ROOT does not exist: {library_root}")
    for path in manifests:
        if not path.exists():
            raise RuntimeError(f"{prefix}_TRACK_LIBRARY_MANIFESTS contains missing path: {path}")
    for path in roots:
        if not path.exists():
            raise RuntimeError(f"{prefix}_TRACK_LIBRARY_ROOTS contains missing path: {path}")

    ffprobe_binary = os.getenv(f"{prefix}_FFPROBE_BINARY", "ffprobe")
    probe_durations = _env_truthy(os.getenv(f"{prefix}_TRACK_LIBRARY_PROBE_DURATIONS"))
    allow_placeholders = _env_truthy(os.getenv(f"{prefix}_TRACK_LIBRARY_ALLOW_PLACEHOLDERS"))

    if not manifests and not roots:
        # Preserve the old single-source type for existing call sites/tests.
        return LocalTrackLibraryAdapter(
            manifest_path=manifest_path,
            library_root=library_root,
            ffprobe_binary=ffprobe_binary,
            probe_durations=probe_durations,
            allow_placeholder_tracks=allow_placeholders,
        )

    sources = []
    if manifest_path is not None:
        sources.append(
            ManifestTrackSourceAdapter(
                manifest_path=manifest_path,
                library_root=library_root,
                ffprobe_binary=ffprobe_binary,
                probe_durations=probe_durations,
                source_name="manifest",
            )
        )
    elif library_root is not None:
        sources.append(
            DirectoryTrackSourceAdapter(
                library_root=library_root,
                ffprobe_binary=ffprobe_binary,
                probe_durations=probe_durations,
                source_name="local_directory",
            )
        )
    sources.extend(
        ManifestTrackSourceAdapter(
            manifest_path=path,
            ffprobe_binary=ffprobe_binary,
            probe_durations=probe_durations,
            source_name="manifest",
        )
        for path in manifests
    )
    sources.extend(
        DirectoryTrackSourceAdapter(
            library_root=path,
            ffprobe_binary=ffprobe_binary,
            probe_durations=probe_durations,
            source_name="local_directory",
        )
        for path in roots
    )
    return CompositeTrackLibraryAdapter(sources, allow_placeholder_tracks=allow_placeholders)


def build_sfx_library_adapter_from_env(*, prefix: str = "SQUAD") -> LocalSfxLibraryAdapter | None:
    root = os.getenv(f"{prefix}_SFX_LIBRARY_ROOT")
    if not root:
        return None
    library_root = Path(root).expanduser()
    if not library_root.exists():
        raise RuntimeError(f"{prefix}_SFX_LIBRARY_ROOT does not exist: {library_root}")
    return LocalSfxLibraryAdapter(root=library_root)


def build_visual_polish_config_from_env(*, prefix: str = "SQUAD") -> dict:
    """Build visual polish config from environment variables.

    Returns a dict that maps to CreativeProductionTools.visual_polish_* fields.
    When SQUAD_VISUAL_POLISH_TARGET_HEIGHT is unset, polish is fully disabled
    (all fields None) and the pipeline runs unchanged.

    Env vars:
        SQUAD_VISUAL_POLISH_TARGET_HEIGHT — int (e.g. 1080). Enables upscale.
        SQUAD_VISUAL_POLISH_TARGET_FPS    — int (e.g. 30). Only used if an
                                            interpolation adapter is wired in.
        SQUAD_FFMPEG_BINARY               — optional ffmpeg override (shared).
        SQUAD_FFPROBE_BINARY              — optional ffprobe override (shared).
    """
    target_height_raw = os.getenv(f"{prefix}_VISUAL_POLISH_TARGET_HEIGHT")
    target_fps_raw = os.getenv(f"{prefix}_VISUAL_POLISH_TARGET_FPS")
    if not target_height_raw:
        return {
            "upscale_adapter": None,
            "interpolation_adapter": None,
            "target_height": None,
            "target_fps": None,
        }
    try:
        target_height = int(target_height_raw)
    except ValueError as exc:
        raise RuntimeError(
            f"{prefix}_VISUAL_POLISH_TARGET_HEIGHT must be an integer: {target_height_raw}"
        ) from exc
    if target_height < 64 or target_height > 4320:
        raise RuntimeError(
            f"{prefix}_VISUAL_POLISH_TARGET_HEIGHT out of range (64..4320): {target_height}"
        )
    target_fps: int | None = None
    if target_fps_raw:
        try:
            target_fps = int(target_fps_raw)
        except ValueError as exc:
            raise RuntimeError(
                f"{prefix}_VISUAL_POLISH_TARGET_FPS must be an integer: {target_fps_raw}"
            ) from exc
    ffmpeg_binary = os.getenv(f"{prefix}_FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"
    ffprobe_binary = os.getenv(f"{prefix}_FFPROBE_BINARY") or shutil.which("ffprobe") or "ffprobe"
    return {
        "upscale_adapter": FfmpegUpscaleAdapter(
            ffmpeg_binary=ffmpeg_binary,
            ffprobe_binary=ffprobe_binary,
        ),
        "interpolation_adapter": None,  # opt-in paid path; not wired yet
        "target_height": target_height,
        "target_fps": target_fps,
    }


def _split_env_paths(value: str | None) -> list[Path]:
    if not value:
        return []
    raw_parts = []
    for part in value.split(os.pathsep):
        raw_parts.extend(part.split(","))
    return [Path(part.strip()).expanduser() for part in raw_parts if part.strip()]


def build_audio_mix_adapter_from_env(
    *,
    prefix: str = "SQUAD",
    default_enabled: bool = False,
) -> FfmpegAudioMixAdapter | None:
    enabled_env = os.getenv(f"{prefix}_ENABLE_AUDIO_MIX")
    enabled = default_enabled if enabled_env is None else _env_truthy(enabled_env)
    if not enabled:
        return None
    return FfmpegAudioMixAdapter(
        ffmpeg_binary=os.getenv(f"{prefix}_FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"
    )


def build_media_probe_adapter_from_env(
    *,
    prefix: str = "SQUAD",
    default_enabled: bool = False,
) -> FfmpegMediaProbeAdapter | None:
    enabled_env = os.getenv(f"{prefix}_ENABLE_POST_PROBE")
    enabled = default_enabled if enabled_env is None else _env_truthy(enabled_env)
    if not enabled:
        return None
    return FfmpegMediaProbeAdapter(
        ffprobe_binary=os.getenv(f"{prefix}_FFPROBE_BINARY") or shutil.which("ffprobe") or "ffprobe"
    )


def build_loudness_normalizer_from_env(
    *,
    prefix: str = "SQUAD",
    default_enabled: bool = False,
) -> FfmpegLoudnessNormalizeAdapter | None:
    enabled_env = os.getenv(f"{prefix}_ENABLE_LOUDNESS_NORMALIZE")
    enabled = default_enabled if enabled_env is None else _env_truthy(enabled_env)
    if not enabled:
        return None
    return FfmpegLoudnessNormalizeAdapter(
        ffmpeg_binary=os.getenv(f"{prefix}_FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"
    )


def build_caption_burn_in_adapter_from_env(
    *,
    prefix: str = "SQUAD",
    default_enabled: bool = True,
) -> FfmpegCaptionBurnInAdapter | None:
    enabled_env = os.getenv(f"{prefix}_ENABLE_CAPTION_BURN_IN")
    enabled = default_enabled if enabled_env is None else _env_truthy(enabled_env)
    if not enabled:
        return None
    ffmpeg_binary = os.getenv(f"{prefix}_FFMPEG_BINARY") or shutil.which("ffmpeg")
    if not ffmpeg_binary:
        return None
    return FfmpegCaptionBurnInAdapter(ffmpeg_binary=ffmpeg_binary)


def build_render_adapter_from_env(
    *,
    prefix: str = "SQUAD",
) -> CommandRenderAdapter | None:
    command = os.getenv(f"{prefix}_RENDER_COMMAND")
    if not command:
        return None
    renderer_name = os.getenv(f"{prefix}_RENDERER") or "hyperframes"
    timeout_sec = int(os.getenv(f"{prefix}_RENDER_TIMEOUT_SEC") or "600")
    output_root = os.getenv(f"{prefix}_RENDER_OUTPUT_ROOT") or ".outputs/creative-production"
    return CommandRenderAdapter(
        renderer_name=renderer_name,
        command=shlex.split(command),
        output_root=output_root,
        timeout_sec=timeout_sec,
        caption_aligner=build_caption_alignment_adapter_from_env(prefix=prefix),
    )


def build_caption_alignment_adapter_from_env(
    *,
    prefix: str = "SQUAD",
) -> CommandCaptionAlignmentAdapter | None:
    command = os.getenv(f"{prefix}_CAPTION_ALIGN_COMMAND")
    if not command:
        return None
    timeout_sec = int(os.getenv(f"{prefix}_CAPTION_ALIGN_TIMEOUT_SEC") or "900")
    output_root = os.getenv(f"{prefix}_CAPTION_ALIGN_OUTPUT_ROOT") or ".outputs/creative-production"
    return CommandCaptionAlignmentAdapter(
        command=shlex.split(command),
        output_root=output_root,
        timeout_sec=timeout_sec,
    )


def _env_truthy(value: str | None) -> bool:
    return bool(value and value.strip().lower() in {"1", "true", "yes", "y", "on"})
