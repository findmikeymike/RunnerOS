"""Inspect a local music library folder.

Walks a folder, runs each file through the same filename inference Squad uses,
and prints the mood/energy/genre/instrumentation tags that would attach to each
track when the production graph picks music.

Use this BEFORE a real run to verify your filenames are giving Squad enough
to work with. If everything comes back with empty tags or `energy=medium`,
rename your files with mood/energy/genre/instrument hints.

Examples of good filenames:
    cinematic_dark_premium_120bpm_loop.wav
    funny_high_pop_140bpm.mp3
    nostalgic_low_ambient_keys_loop.wav
    energetic_hard_electronic_drums_bass.wav

Usage:
    .venv/bin/python scripts/inspect_music_library.py /path/to/music
    .venv/bin/python scripts/inspect_music_library.py /path/to/music --json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from creative.production.track_library import DirectoryTrackSourceAdapter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect what Squad will infer from a music folder.")
    parser.add_argument("root", help="Path to your music folder")
    parser.add_argument(
        "--probe-durations",
        action="store_true",
        help="Run ffprobe on each file to fill in track duration (slower).",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a human report.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).expanduser().resolve()
    if not root.exists():
        print(f"error: {root} does not exist", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2

    adapter = DirectoryTrackSourceAdapter(
        library_root=root,
        probe_durations=bool(args.probe_durations),
    )
    tracks = adapter.load_tracks()

    if args.json:
        payload = [
            {
                **{k: v for k, v in asdict(track).items() if k != "asset_path"},
                "asset_path": str(track.asset_path) if track.asset_path else None,
            }
            for track in tracks
        ]
        print(json.dumps({"root": str(root), "track_count": len(tracks), "tracks": payload}, indent=2))
        return 0

    print(f"Music library root: {root}")
    print(f"Files found: {len(tracks)}")
    print()
    if not tracks:
        print("  (no audio files found — drop .mp3/.wav/.m4a/.flac/.ogg files in)")
        return 0

    weak_count = 0
    for track in tracks:
        mood = ", ".join(track.mood) or "—"
        genre = ", ".join(track.genre) or "—"
        instr = ", ".join(track.instrumentation) or "—"
        vocals = "vocals" if track.has_vocals else "instrumental"
        loop = "loopable" if track.loopable else "one-shot"
        duration = f"{track.duration_s:.1f}s" if track.duration_s else "?"
        is_weak = not track.mood and not track.genre and not track.instrumentation
        if is_weak:
            weak_count += 1
        marker = "  ⚠ " if is_weak else "    "
        print(f"{marker}{track.title}")
        print(f"      energy: {track.energy}  |  bpm: {track.tempo_bpm or '?'}  |  duration: {duration}")
        print(f"      mood: {mood}")
        print(f"      genre: {genre}  |  instrumentation: {instr}")
        print(f"      {vocals}  |  {loop}")
        print()

    if weak_count:
        print(
            f"  ⚠  {weak_count} track(s) have empty mood/genre/instrument tags — "
            "rename their files with descriptive hints (cinematic, dark, premium, "
            "ambient, drums, etc.) so the audio router can pick them when briefs match."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
