"""
Audio Analysis Utilities
------------------------
Provides lightweight helpers for the music pipeline to derive BPM,
beat grids, energy envelopes, and coarse song sections using librosa.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Dict, Any

import numpy as np
import librosa


@dataclass
class AudioAnalysisResult:
    """Structured audio analysis summary."""
    bpm: float
    beat_times: List[float]
    duration: float
    sections: List[Dict[str, Any]]
    energy_profile: List[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "bpm": self.bpm,
            "beat_times": self.beat_times,
            "duration": self.duration,
            "sections": self.sections,
            "energy_profile": self.energy_profile,
        }


def analyze_audio(audio_path: str, hop_length: int = 512) -> AudioAnalysisResult:
    """
    Analyze an audio file and return BPM, beat grid, and coarse sections.

    Args:
        audio_path: Path to audio file (wav/mp3).
        hop_length: librosa hop length for beat tracking / RMS.

    Returns:
        AudioAnalysisResult
    """
    resolved_path = Path(audio_path)
    if not resolved_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    y, sr = librosa.load(resolved_path.as_posix(), sr=None, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    tempo_value = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length).tolist()

    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_norm = (rms - rms.min()) / (np.ptp(rms) or 1.0)
    energy_profile = rms_norm.tolist()

    sections = _estimate_sections(duration, energy_profile, hop_length, sr)

    return AudioAnalysisResult(
        bpm=float(round(tempo_value, 2)),
        beat_times=beat_times,
        duration=duration,
        sections=sections,
        energy_profile=energy_profile,
    )


def _estimate_sections(
    duration: float,
    energy_profile: List[float],
    hop_length: int,
    sr: int,
    target_sections: int = 4,
) -> List[Dict[str, Any]]:
    """
    Heuristic segmentation into intro/verse/chorus/bridge style buckets.
    """
    if duration <= 0:
        return []

    section_names = ["intro", "verse", "chorus", "bridge", "outro"]
    num_sections = min(target_sections, len(section_names))
    split_times = np.linspace(0, duration, num_sections + 1)

    sections = []
    frames_per_section = max(1, len(energy_profile) // num_sections)
    for idx in range(num_sections):
        start = float(split_times[idx])
        end = float(split_times[idx + 1])
        energy_slice = energy_profile[idx * frames_per_section:(idx + 1) * frames_per_section]
        avg_energy = float(np.mean(energy_slice) if energy_slice else 0.0)
        sections.append(
            {
                "section_type": section_names[idx],
                "start_time": start,
                "end_time": end,
                "energy_level": _energy_to_level(avg_energy),
            }
        )
    return sections


def _energy_to_level(value: float) -> str:
    if value > 0.75:
        return "climax"
    if value > 0.5:
        return "high"
    if value > 0.25:
        return "medium"
    return "low"
