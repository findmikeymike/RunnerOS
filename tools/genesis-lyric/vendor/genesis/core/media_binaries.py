"""Resolve local media tool binaries in app and desktop runtimes."""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def resolve_media_binary(name: str) -> str:
    """Return a usable ffmpeg/ffprobe path even when Homebrew is not on PATH."""
    binary = str(name or "").strip()
    if not binary:
        raise FileNotFoundError(name)

    explicit_path = Path(binary)
    if (explicit_path.is_absolute() or "/" in binary) and explicit_path.exists():
        return str(explicit_path)

    normalized = binary.lower()
    if normalized not in {"ffmpeg", "ffprobe"}:
        return binary

    env_key = "GENESIS_FFMPEG_PATH" if normalized == "ffmpeg" else "GENESIS_FFPROBE_PATH"
    explicit = (os.environ.get(env_key) or "").strip()
    if explicit:
        return explicit

    discovered = shutil.which(normalized)
    if discovered:
        return discovered

    for base in ("/opt/homebrew/bin", "/usr/local/bin"):
        candidate = Path(base) / normalized
        if candidate.exists():
            return str(candidate)

    return binary


def ensure_media_binary_on_path(name: str) -> str:
    """Resolve a media binary and prepend its directory for libraries that shell out."""
    resolved = resolve_media_binary(name)
    resolved_path = Path(resolved)
    if resolved_path.is_absolute():
        directory = str(resolved_path.parent)
        path_parts = [part for part in (os.environ.get("PATH") or "").split(os.pathsep) if part]
        if directory not in path_parts:
            os.environ["PATH"] = os.pathsep.join([directory, *path_parts])
    return resolved
