"""
RunnerOS Genesis Lyric core exports.

This vendored fork keeps the single-video lyric/render pieces importable without
eagerly loading paid-provider SDK clients from the full Genesis app.
"""

from .assembler import AssemblyResult, TransitionSpec, VideoAssembler
from .typography import TextOverlay, TypographyEngine

try:
    from .audio_analysis import AudioAnalysisResult, analyze_audio
except Exception:  # Optional librosa/numpy path.
    AudioAnalysisResult = None

    def analyze_audio(*_args, **_kwargs):
        raise RuntimeError("Genesis audio analysis dependencies are not installed")


__all__ = [
    "AssemblyResult",
    "TransitionSpec",
    "VideoAssembler",
    "TextOverlay",
    "TypographyEngine",
    "AudioAnalysisResult",
    "analyze_audio",
]
