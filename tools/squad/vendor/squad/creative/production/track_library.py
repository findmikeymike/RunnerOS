from __future__ import annotations

import json
import subprocess
import urllib.request
from dataclasses import replace
from pathlib import Path
from typing import Any, Protocol

from creative.production.contracts import MusicTrackQuery, MusicTrackRecord


AUDIO_EXTENSIONS = {".mp3", ".wav", ".aiff", ".aif", ".m4a", ".aac", ".flac", ".ogg"}
MAX_REMOTE_TRACK_BYTES = 100 * 1024 * 1024
PLACEHOLDER_TRACK_SOURCES = {"local_test_library", "test_library", "smoke_test", "synthetic", "placeholder"}
PLACEHOLDER_PATH_MARKERS = {".tmp-live-smoke"}

MOOD_HINTS = {
    "premium",
    "cinematic",
    "dark",
    "dreamy",
    "nostalgic",
    "luxury",
    "energetic",
    "funny",
    "calm",
    "weird",
    "gritty",
    "romantic",
    "futuristic",
    "ambient",
    "aggressive",
    "soft",
    "sad",
    "happy",
}
GENRE_HINTS = {"hip-hop", "hip hop", "ambient", "electronic", "cinematic", "indie", "pop", "jazz", "rock"}
INSTRUMENT_HINTS = {"drums", "bass", "synth", "pads", "keys", "guitar", "piano", "strings", "texture"}
VOCAL_HINTS = {"vocal", "vocals", "song", "lyrics", "lyric", "rap", "singer"}
INSTRUMENTAL_HINTS = {"instrumental", "inst", "bed", "underscore", "score", "no-vocals", "no vocals"}
ENERGY_HINTS = {
    "low": {"low", "slow", "soft", "calm", "ambient", "minimal"},
    "medium": {"medium", "mid", "groove", "pulse"},
    "high": {"high", "fast", "hard", "hype", "energetic", "aggressive", "impact"},
}


class MusicTrackValidationError(RuntimeError):
    pass


class TrackLibrarySourceAdapter(Protocol):
    """Provider boundary: local folder, manifest, DB, S3, etc. only need to emit records."""

    def load_tracks(self) -> list[MusicTrackRecord]:
        ...

    def materialize_track(
        self,
        track: MusicTrackRecord,
        *,
        run_id: str,
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 60,
        max_download_bytes: int = MAX_REMOTE_TRACK_BYTES,
    ) -> MusicTrackRecord:
        ...


class CompositeTrackLibraryAdapter:
    def __init__(
        self,
        sources: list[TrackLibrarySourceAdapter],
        *,
        allow_placeholder_tracks: bool = False,
    ) -> None:
        self.sources = tuple(sources)
        self.allow_placeholder_tracks = allow_placeholder_tracks

    def search_tracks(self, query: MusicTrackQuery, *, limit: int = 8) -> list[MusicTrackRecord]:
        tracks = []
        rejected: list[str] = []
        for track in self.load_tracks():
            if not self.allow_placeholder_tracks and _is_placeholder_track(track):
                continue
            try:
                _validate_track_for_query(track, query)
            except MusicTrackValidationError as exc:
                rejected.append(str(exc))
                continue
            tracks.append(track)
        if not tracks and rejected:
            raise MusicTrackValidationError(
                "no usable music tracks matched the query after validation: " + "; ".join(rejected[:3])
            )
        ranked = sorted(
            ((track, _score_sparse_track(track, query)) for track in tracks),
            key=lambda item: item[1],
            reverse=True,
        )
        return [track for track, score in ranked if score > -10.0][:limit]

    def load_tracks(self) -> list[MusicTrackRecord]:
        by_id: dict[str, MusicTrackRecord] = {}
        for source in self.sources:
            for track in source.load_tracks():
                by_id.setdefault(track.track_id, track)
        return list(by_id.values())

    def materialize_track(
        self,
        track: MusicTrackRecord,
        *,
        run_id: str,
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 60,
        max_download_bytes: int = MAX_REMOTE_TRACK_BYTES,
    ) -> MusicTrackRecord:
        if track.asset_path is not None:
            _validate_local_audio_asset(track.asset_path, track_id=track.track_id)
            return track
        for source in self.sources:
            try:
                materialized = source.materialize_track(
                    track,
                    run_id=run_id,
                    output_root=output_root,
                    timeout_sec=timeout_sec,
                    max_download_bytes=max_download_bytes,
                )
            except NotImplementedError:
                continue
            if materialized.asset_path is not None:
                _validate_local_audio_asset(materialized.asset_path, track_id=track.track_id)
                return materialized
        return _materialize_http_track(
            track,
            run_id=run_id,
            output_root=output_root,
            timeout_sec=timeout_sec,
            max_download_bytes=max_download_bytes,
        )


class ManifestTrackSourceAdapter:
    def __init__(
        self,
        *,
        manifest_path: Path | str,
        library_root: Path | str | None = None,
        ffprobe_binary: str = "ffprobe",
        probe_durations: bool = False,
        source_name: str = "manifest",
    ) -> None:
        self.manifest_path = Path(manifest_path)
        self.library_root = Path(library_root) if library_root else None
        self.ffprobe_binary = ffprobe_binary
        self.probe_durations = probe_durations
        self.source_name = source_name

    def load_tracks(self) -> list[MusicTrackRecord]:
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        rows = payload.get("tracks", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise ValueError("track manifest must be a list or an object with a tracks list")
        base = self.library_root or self.manifest_path.parent
        tracks: list[MusicTrackRecord] = []
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                raise ValueError(f"track manifest row {index} must be an object")
            asset_uri = row.get("asset_uri") or row.get("asset_path") or row.get("path") or row.get("url")
            if not asset_uri:
                raise ValueError(f"track manifest row {index} is missing asset_uri")
            path = _resolve_asset_path(asset_uri=str(asset_uri), base=base)
            tracks.append(
                _record_from_path(
                    path,
                    row,
                    asset_uri=str(asset_uri),
                    ffprobe_binary=self.ffprobe_binary,
                    probe_durations=self.probe_durations,
                    default_source=self.source_name,
                )
            )
        return tracks

    def materialize_track(
        self,
        track: MusicTrackRecord,
        *,
        run_id: str,
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 60,
        max_download_bytes: int = MAX_REMOTE_TRACK_BYTES,
    ) -> MusicTrackRecord:
        return _materialize_http_track(
            track,
            run_id=run_id,
            output_root=output_root,
            timeout_sec=timeout_sec,
            max_download_bytes=max_download_bytes,
        )


class DirectoryTrackSourceAdapter:
    def __init__(
        self,
        *,
        library_root: Path | str,
        ffprobe_binary: str = "ffprobe",
        probe_durations: bool = False,
        source_name: str = "local_directory",
    ) -> None:
        self.library_root = Path(library_root)
        self.ffprobe_binary = ffprobe_binary
        self.probe_durations = probe_durations
        self.source_name = source_name

    def load_tracks(self) -> list[MusicTrackRecord]:
        return [
            _record_from_path(
                path,
                {"track_id": _slug(str(path.relative_to(self.library_root).with_suffix("")))},
                ffprobe_binary=self.ffprobe_binary,
                probe_durations=self.probe_durations,
                default_source=self.source_name,
            )
            for path in _iter_audio_files(self.library_root)
        ]

    def materialize_track(
        self,
        track: MusicTrackRecord,
        *,
        run_id: str,
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 60,
        max_download_bytes: int = MAX_REMOTE_TRACK_BYTES,
    ) -> MusicTrackRecord:
        return _materialize_http_track(
            track,
            run_id=run_id,
            output_root=output_root,
            timeout_sec=timeout_sec,
            max_download_bytes=max_download_bytes,
        )


class LocalTrackLibraryAdapter(CompositeTrackLibraryAdapter):
    def __init__(
        self,
        *,
        manifest_path: Path | str | None = None,
        library_root: Path | str | None = None,
        ffprobe_binary: str = "ffprobe",
        probe_durations: bool = False,
        allow_placeholder_tracks: bool = False,
    ) -> None:
        self.manifest_path = Path(manifest_path) if manifest_path else None
        self.library_root = Path(library_root) if library_root else None
        self.ffprobe_binary = ffprobe_binary
        self.probe_durations = probe_durations
        super().__init__(
            _build_local_sources(
                manifest_path=self.manifest_path,
                library_root=self.library_root,
                ffprobe_binary=ffprobe_binary,
                probe_durations=probe_durations,
            ),
            allow_placeholder_tracks=allow_placeholder_tracks,
        )


def _build_local_sources(
    *,
    manifest_path: Path | None,
    library_root: Path | None,
    ffprobe_binary: str,
    probe_durations: bool,
) -> list[TrackLibrarySourceAdapter]:
    sources: list[TrackLibrarySourceAdapter] = []
    if manifest_path is not None:
        sources.append(
            ManifestTrackSourceAdapter(
                manifest_path=manifest_path,
                library_root=library_root,
                ffprobe_binary=ffprobe_binary,
                probe_durations=probe_durations,
            )
        )
    elif library_root is not None:
        sources.append(
            DirectoryTrackSourceAdapter(
                library_root=library_root,
                ffprobe_binary=ffprobe_binary,
                probe_durations=probe_durations,
            )
        )
    return sources


def _record_from_path(
    path: Path | None,
    row: dict[str, Any],
    *,
    asset_uri: str | None = None,
    ffprobe_binary: str,
    probe_durations: bool,
    default_source: str,
) -> MusicTrackRecord:
    title = str(row.get("title") or (path.stem if path else row.get("track_id") or row.get("id") or "Untitled Track"))
    inferred = _infer_from_text(" ".join(part for part in (str(path or asset_uri or ""), title) if part))
    track_id = str(row.get("track_id") or row.get("id") or _slug(title))
    duration = _optional_float(row.get("duration_s") or row.get("duration"))
    if duration is None and probe_durations and path is not None and path.exists():
        duration = _probe_duration(path=path, ffprobe_binary=ffprobe_binary)
    has_vocals = _optional_bool(row.get("has_vocals"))
    if has_vocals is None:
        has_vocals = inferred["has_vocals"]
    return MusicTrackRecord(
        track_id=track_id,
        title=title,
        artist=str(row.get("artist") or row.get("creator") or "Unknown"),
        asset_path=path,
        duration_s=duration,
        mood=_tuple_field(row.get("mood") or row.get("moods")) or inferred["mood"],
        energy=str(row.get("energy") or inferred["energy"] or "medium").lower(),
        tempo_bpm=_optional_int(row.get("tempo_bpm") or row.get("bpm")),
        genre=_tuple_field(row.get("genre") or row.get("genres")) or inferred["genre"],
        instrumentation=_tuple_field(row.get("instrumentation") or row.get("instruments")) or inferred["instrumentation"],
        has_vocals=bool(has_vocals),
        explicit=bool(_optional_bool(row.get("explicit")) or False),
        loopable=bool(_optional_bool(row.get("loopable")) or inferred["loopable"]),
        license=str(row.get("license") or row.get("rights") or "unknown"),
        source=str(row.get("source") or default_source),
        metadata={
            **({"asset_uri": asset_uri} if asset_uri else {}),
            **{key: value for key, value in row.items() if key not in {"asset_uri", "asset_path", "path"}},
        },
    )


def _materialize_http_track(
    track: MusicTrackRecord,
    *,
    run_id: str,
    output_root: Path | str,
    timeout_sec: int,
    max_download_bytes: int,
) -> MusicTrackRecord:
    if track.asset_path is not None:
        _validate_local_audio_asset(track.asset_path, track_id=track.track_id)
        return track
    asset_uri = str(track.metadata.get("asset_uri") or track.metadata.get("url") or "")
    if not asset_uri.startswith(("http://", "https://")):
        raise MusicTrackValidationError(
            f"music track `{track.track_id}` has no local asset path or http(s) asset_uri"
        )

    suffix = Path(asset_uri.split("?", 1)[0]).suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise MusicTrackValidationError(
            f"music track `{track.track_id}` asset_uri has unsupported audio extension: {asset_uri}"
        )
    destination = Path(output_root) / run_id / "music" / f"{_slug(track.track_id)}{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(asset_uri, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            _download_response_to_path(response, destination, max_bytes=max_download_bytes)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"failed to materialize music track `{track.track_id}` from {asset_uri}: {exc}") from exc
    _validate_local_audio_asset(destination, track_id=track.track_id)
    return replace(track, asset_path=destination)


def _validate_track_for_query(track: MusicTrackRecord, query: MusicTrackQuery) -> None:
    if _is_placeholder_track(track):
        raise MusicTrackValidationError(f"music track `{track.track_id}` is marked as placeholder/test audio")
    if track.asset_path is not None:
        _validate_local_audio_asset(track.asset_path, track_id=track.track_id)
    else:
        asset_uri = str(track.metadata.get("asset_uri") or track.metadata.get("url") or "")
        if not asset_uri.startswith(("http://", "https://")):
            raise MusicTrackValidationError(
                f"music track `{track.track_id}` has no local asset path or materializable http(s) asset_uri"
            )
        suffix = Path(asset_uri.split("?", 1)[0]).suffix.lower()
        if suffix not in AUDIO_EXTENSIONS:
            raise MusicTrackValidationError(
                f"music track `{track.track_id}` asset_uri has unsupported audio extension: {asset_uri}"
            )
    if query.license_required and query.license_required not in track.license:
        raise MusicTrackValidationError(
            f"music track `{track.track_id}` is not licensed for `{query.license_required}`"
        )
    if query.vocal_policy == "instrumental_required" and track.has_vocals:
        raise MusicTrackValidationError(f"music track `{track.track_id}` has vocals but instrumental audio is required")
    if track.explicit and not query.explicit_allowed:
        raise MusicTrackValidationError(f"music track `{track.track_id}` is explicit but explicit audio is not allowed")


def _validate_local_audio_asset(path: Path, *, track_id: str) -> None:
    if path.suffix.lower() not in AUDIO_EXTENSIONS:
        raise MusicTrackValidationError(
            f"music track `{track_id}` has unsupported audio extension: {path}"
        )
    if not path.exists():
        raise MusicTrackValidationError(f"music track `{track_id}` asset file does not exist: {path}")
    if not path.is_file():
        raise MusicTrackValidationError(f"music track `{track_id}` asset path is not a file: {path}")
    if path.stat().st_size <= 0:
        raise MusicTrackValidationError(f"music track `{track_id}` asset file is empty: {path}")


def _score_sparse_track(track: MusicTrackRecord, query: MusicTrackQuery) -> float:
    score = 0.0
    if track.mood:
        score += 3.0 * len(set(track.mood) & set(query.mood))
    else:
        score -= 0.25
    if track.energy and track.energy == query.energy:
        score += 2.0
    if track.genre:
        score += 1.5 * len(set(track.genre) & set(query.genre))
    if track.instrumentation:
        score += 1.0 * len(set(track.instrumentation) & set(query.instrumentation))
    if track.tempo_bpm is not None and query.tempo_bpm_min is not None and query.tempo_bpm_max is not None:
        score += 2.0 if query.tempo_bpm_min <= track.tempo_bpm <= query.tempo_bpm_max else -1.0
    if query.vocal_policy == "instrumental_required" and track.has_vocals:
        score -= 4.0
    if not query.explicit_allowed and track.explicit:
        score -= 6.0
    if query.loopable_preferred and track.loopable:
        score += 1.0
    if query.license_required:
        if query.license_required in track.license:
            score += 2.0
        elif track.license == "unknown":
            score -= 0.75
    if track.duration_s is not None and query.duration_min_s is not None and query.duration_max_s is not None:
        score += 1.0 if query.duration_min_s <= track.duration_s <= query.duration_max_s else -0.5
    return score


def _is_placeholder_track(track: MusicTrackRecord) -> bool:
    metadata = track.metadata or {}
    if _optional_bool(metadata.get("is_placeholder")) or _optional_bool(metadata.get("review_safe")) is False:
        return True
    if track.source.strip().lower() in PLACEHOLDER_TRACK_SOURCES:
        return True
    asset_path = str(track.asset_path or metadata.get("asset_uri") or "").replace("\\", "/")
    return any(marker in asset_path for marker in PLACEHOLDER_PATH_MARKERS)


def _iter_audio_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS)


def _download_response_to_path(response, destination: Path, *, max_bytes: int) -> None:
    content_length = getattr(response, "headers", {}).get("Content-Length")
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise RuntimeError(f"remote track exceeds max download size: {content_length} bytes")
        except ValueError:
            pass

    total = 0
    with destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                handle.close()
                destination.unlink(missing_ok=True)
                raise RuntimeError(f"remote track exceeded max download size: {total} bytes")
            handle.write(chunk)


def _resolve_asset_path(*, asset_uri: str, base: Path) -> Path | None:
    if "://" in asset_uri:
        return None
    path = Path(asset_uri)
    return path if path.is_absolute() else base / path


def _infer_from_text(text: str) -> dict[str, Any]:
    normalized = _normalize_text(text)
    tokens = set(normalized.split())
    mood = tuple(sorted(term for term in MOOD_HINTS if _term_in_text(term, normalized, tokens)))
    genre = tuple(sorted(term for term in GENRE_HINTS if _term_in_text(term, normalized, tokens)))
    instrumentation = tuple(sorted(term for term in INSTRUMENT_HINTS if _term_in_text(term, normalized, tokens)))
    has_vocals = any(_term_in_text(term, normalized, tokens) for term in VOCAL_HINTS) and not any(
        _term_in_text(term, normalized, tokens) for term in INSTRUMENTAL_HINTS
    )
    energy = "medium"
    for candidate, hints in ENERGY_HINTS.items():
        if any(_term_in_text(hint, normalized, tokens) for hint in hints):
            energy = candidate
            break
    return {
        "mood": mood,
        "genre": genre,
        "instrumentation": instrumentation,
        "has_vocals": has_vocals,
        "energy": energy,
        "loopable": any(term in tokens for term in ("loop", "loopable", "bed", "underscore")),
    }


def _term_in_text(term: str, normalized: str, tokens: set[str]) -> bool:
    return term in normalized if " " in term or "-" in term else term in tokens


def _tuple_field(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        items = [item.strip().lower() for item in value.replace("|", ",").split(",")]
    else:
        items = [str(item).strip().lower() for item in value]
    return tuple(dict.fromkeys(item for item in items if item))


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def _optional_bool(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _normalize_text(text: str) -> str:
    lowered = text.lower().replace("_", " ").replace("-", " ")
    return " ".join("".join(ch if ch.isalnum() or ch.isspace() else " " for ch in lowered).split())


def _slug(text: str) -> str:
    return "-".join(_normalize_text(text).split()) or "track"


def _probe_duration(*, path: Path, ffprobe_binary: str) -> float | None:
    try:
        result = subprocess.run(
            [
                ffprobe_binary,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return _optional_float(result.stdout.strip())
