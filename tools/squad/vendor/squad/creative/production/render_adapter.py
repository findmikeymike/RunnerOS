from __future__ import annotations

import json
import os
import subprocess
from dataclasses import asdict, is_dataclass, replace
from pathlib import Path
from typing import Any

from creative.production.caption_alignment import CaptionAlignmentAdapter
from creative.production.contracts import CreativeProductionState, FinalAssemblyRecord, RenderPlan
from creative.production.post_pass import _build_caption_cues_for_state, _caption_style_for_platform


class CommandRenderAdapter:
    """Optional bridge to an external renderer such as HyperFrames or Remotion."""

    def __init__(
        self,
        *,
        renderer_name: str,
        command: list[str],
        output_root: Path | str = ".outputs/creative-production",
        timeout_sec: int = 600,
        caption_aligner: CaptionAlignmentAdapter | None = None,
    ) -> None:
        self.renderer_name = renderer_name.strip().lower()
        self.command = tuple(part for part in command if part)
        self.output_root = Path(output_root)
        self.timeout_sec = int(timeout_sec)
        self.caption_aligner = caption_aligner
        if not self.renderer_name:
            raise ValueError("renderer_name is required")
        if not self.command:
            raise ValueError("command is required")

    def render(self, *, state: CreativeProductionState, render_plan: RenderPlan) -> FinalAssemblyRecord | None:
        if state.final_assembly is None:
            return None

        run_dir = self.output_root / state.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        job_path = run_dir / f"{self.renderer_name}-render-job.json"
        default_output_path = run_dir / f"final-{self.renderer_name}.mp4"
        job_path.write_text(
            json.dumps(
                _render_job_payload(
                    state=state,
                    render_plan=render_plan,
                    output_path=default_output_path,
                    caption_aligner=self.caption_aligner,
                    output_root=self.output_root,
                ),
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )

        env = dict(os.environ)
        env["SQUAD_RENDER_JOB_PATH"] = str(job_path)
        env["SQUAD_RENDER_OUTPUT_PATH"] = str(default_output_path)
        completed = subprocess.run(
            [*self.command, str(job_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=self.timeout_sec,
            env=env,
        )
        output_path = _parse_render_output(completed.stdout, base_dir=run_dir) or default_output_path
        if not output_path.exists():
            raise RuntimeError(f"{self.renderer_name} renderer did not create output: {output_path}")
        return replace(
            state.final_assembly,
            asset_path=output_path,
            assembly_method=f"{state.final_assembly.assembly_method}_{self.renderer_name}_render",
        )


def _render_job_payload(
    *,
    state: CreativeProductionState,
    render_plan: RenderPlan,
    output_path: Path,
    caption_aligner: CaptionAlignmentAdapter | None = None,
    output_root: Path | str = ".outputs/creative-production",
) -> dict[str, Any]:
    final_assembly = state.final_assembly
    caption_intent, caption_style, caption_alignment_warning = _caption_payload(
        state,
        caption_aligner=caption_aligner,
        output_root=output_root,
    )
    if caption_alignment_warning and "captions" in render_plan.required_capabilities:
        raise RuntimeError(caption_alignment_warning)
    return {
        "schema_version": "squad.render_job.v1",
        "run_id": state.run_id,
        "renderer": render_plan.renderer,
        "polish_level": render_plan.polish_level,
        "required_capabilities": list(render_plan.required_capabilities),
        "input_video": str(final_assembly.asset_path) if final_assembly else None,
        "output_video": str(output_path),
        "duration_s": final_assembly.duration_s if final_assembly else None,
        "format": _safe_dataclass(state.format_narrative_plan),
        "voiceover": _safe_dataclass(state.voiceover_plan),
        "audio_mix": _safe_dataclass(state.audio_mix_plan),
        "clips": [_safe_dataclass(clip) for clip in state.video_attempt_history],
        "caption_intent": caption_intent,
        "caption_style": caption_style,
        "caption_alignment_warning": caption_alignment_warning,
        "brief": {
            "product_description": state.brief_input.brief.product_description,
            "campaign_goal": state.brief_input.brief.campaign_goal,
            "platform": state.brief_input.brief.platform,
            "copy_for_overlay": state.brief_input.brief.copy_for_overlay,
            "cta_text": state.brief_input.brief.cta_text,
        },
    }


def _caption_payload(
    state: CreativeProductionState,
    *,
    caption_aligner: CaptionAlignmentAdapter | None = None,
    output_root: Path | str = ".outputs/creative-production",
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, str | None]:
    plan = state.format_narrative_plan
    if not plan:
        return [], None, None
    captions_enabled = plan.caption_strategy != "minimal"
    if not captions_enabled:
        return [], None, None
    caption_style = _caption_style_for_platform(state.brief_input.brief, plan.caption_strategy)
    cues, alignment_warning = _build_caption_cues_for_state(
        state=state,
        captions_enabled=captions_enabled,
        caption_style=caption_style,
        caption_aligner=caption_aligner,
        output_root=output_root,
    )
    return (
        [
            {
                "beat_index": cue.index,
                "start_s": cue.start_s,
                "end_s": cue.end_s,
                "text": cue.text,
                "beat_role": cue.beat_role,
                "style": cue.style,
            }
            for cue in cues
        ],
        _safe_dataclass(caption_style),
        alignment_warning,
    )


def _safe_dataclass(value: Any) -> Any:
    if value is None:
        return None
    if is_dataclass(value):
        payload = asdict(value)
        return _jsonable(payload)
    return _jsonable(value)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return value


def _parse_render_output(stdout: str, *, base_dir: Path | None = None) -> Path | None:
    clean = stdout.strip()
    if not clean:
        return None
    for line in reversed(clean.splitlines()):
        candidate = line.strip()
        if not candidate or not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        asset_path = payload.get("asset_path") or payload.get("output_video")
        if asset_path:
            path = Path(asset_path)
            if not path.is_absolute() and base_dir is not None:
                return base_dir / path
            return path
    return None
