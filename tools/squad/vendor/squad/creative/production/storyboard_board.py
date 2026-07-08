from __future__ import annotations

import html
import hashlib
import json
import shutil
from dataclasses import asdict, is_dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Any

from content.agents.brief_analyzer import analyze_brief_deterministic
from content.agents.prompt_composer import compose_deterministic
from content.agents.template_selector import select_template
from content.carousel.planner import build_carousel_plan
from content.writing.brief_generator import CreativeBrief
from creative.production.contracts import CandidateStillRecord, CreativeProductionInput, CreativeProductionState
from creative.production.graph import CreativeProductionGraph
from creative.production.heygen import HeyGenUgcRequest, build_heygen_ugc_video_request
from creative.production.model_routing import select_video_model_route
from creative.production.narrative import build_format_narrative_plan
from creative.production.prompt import build_motion_prompt_plan, compact_motion_prompt_for_provider
from creative.production.provider_prompt_compiler import compile_video_provider_prompt
from creative.production.ugc import build_ugc_presenter_script
from creative.production.voice import build_voiceover_plan
from scripts.run_creative_production import apply_reference_asset_roots_to_brief, build_preflight_summary


def build_storyboard_board(
    *,
    brief: CreativeBrief,
    name: str = "storyboard",
    run_id: str | None = None,
    brief_file: str | Path | None = None,
    video_quality: str = "budget",
    asset_roots: tuple[Path, ...] = (),
) -> dict[str, Any]:
    if asset_roots:
        brief = apply_reference_asset_roots_to_brief(brief, tuple(str(root) for root in asset_roots))

    findings: list[dict[str, str]] = []
    for error in brief.validate():
        findings.append({"severity": "high", "code": "invalid_brief", "message": error})

    board_run_id = run_id or f"storyboard-{name}"
    analysis = analyze_brief_deterministic(brief)
    selection = select_template(analysis)
    prompt = compose_deterministic(analysis, selection)
    plan = None if brief.output_type == "carousel" else build_format_narrative_plan(brief)
    state = CreativeProductionState(
        run_id=board_run_id,
        brief_input=CreativeProductionInput(brief=brief, budget_cap_usd=brief.max_cost_usd, video_quality=video_quality),
        creative_goal=brief.campaign_goal,
        budget_cap_usd=brief.max_cost_usd,
        max_attempts=1,
        format_narrative_plan=plan,
    )
    route = _route_for_plan(brief=brief, plan=plan)
    beats = _build_beat_reports(state=state, production_input=state.brief_input, selection_style=analysis.style_family, video_quality=video_quality)
    for beat in beats:
        findings.extend(beat.get("findings") or [])
    first_beat = beats[0] if beats else {"present": False, "findings": []}

    provider_contracts = _provider_contracts(brief=brief, state=state, route=route, beat_report=first_beat)
    findings.extend(_provider_contract_findings(provider_contracts))
    operator = _operator_commands(
        name=name,
        brief=brief,
        route=route,
        video_quality=video_quality,
        brief_file=brief_file,
    )
    findings.extend(_operator_findings(operator))

    carousel = _carousel_summary(brief) if brief.output_type == "carousel" else None
    voiceover = _voiceover_summary(
        brief=brief,
        plan=plan,
        style_family=analysis.style_family,
        duration_s=first_beat.get("motion_duration_s"),
    )
    script = _script_summary(brief=brief, plan=plan, route=route, voiceover=voiceover)

    return _jsonable(
        {
            "ok": not findings,
            "mode": "storyboard_plan_board",
            "provider_spend_enabled": False,
            "name": name,
            "run_id": board_run_id,
            "lane": route["lane"],
            "route": route,
            "brief": {
                **asdict(brief),
                "max_cost_usd": brief.max_cost_usd,
            },
            "strategy": _strategy_summary(brief),
            "references": _reference_summaries(brief=brief, asset_roots=asset_roots),
            "analysis": analysis.to_dict(),
            "template_selection": selection,
            "default_still_prompt": _prompt_summary(prompt.image_prompt),
            "format_plan": {
                "format_type": plan.format_type if plan else "carousel",
                "production_mode": plan.production_mode if plan else "local_slideshow",
                "audio_mode": plan.audio_mode if plan else "none",
                "caption_strategy": plan.caption_strategy if plan else "slide_text",
                "beat_count": len(plan.scene_beats) if plan else 0,
                "ugc_provider_strategy": plan.ugc_strategy.provider_strategy if plan and plan.ugc_strategy else None,
            },
            "script": script,
            "beats": beats,
            "first_beat": first_beat,
            "voiceover": voiceover,
            "carousel": carousel,
            "provider_contracts": provider_contracts,
            "operator": operator,
            "operator_commands": operator,
            "preflight": _safe_preflight(
                brief=brief,
                name=name,
                video_quality=video_quality,
                brief_file=brief_file,
                asset_roots=asset_roots,
            ),
            "findings": findings,
        }
    )


def write_storyboard_board(board: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    copy_reference_thumbnails(board, output_dir)
    json_path = output_dir / "storyboard-board.json"
    html_path = output_dir / "storyboard-board.html"
    json_path.write_text(json.dumps(_jsonable(board), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    html_path.write_text(render_storyboard_html(board), encoding="utf-8")
    return {
        "ok": bool(board.get("ok")),
        "mode": "storyboard_plan_board",
        "run_id": board.get("run_id"),
        "lane": board.get("lane"),
        "json_path": str(json_path),
        "html_path": str(html_path),
        "provider_spend_enabled": False,
        "findings": board.get("findings", []),
    }


def render_storyboard_html(board: dict[str, Any]) -> str:
    title = f"Squad Storyboard - {board.get('run_id', 'storyboard')}"
    beats = board.get("beats") or []
    refs = board.get("references") or []
    strategy = board.get("strategy") or {}
    script = board.get("script") or {}
    provider = board.get("provider_contracts") or {}
    operator = board.get("operator_commands") or {}
    findings = board.get("findings") or []
    beat_cards = "\n".join(_beat_card(beat) for beat in beats) or '<section class="empty">No video beats for this lane.</section>'
    ref_cards = "\n".join(_ref_card(ref) for ref in refs) or '<div class="muted">No local references supplied.</div>'
    finding_rows = "\n".join(f"<li>{_e(item.get('severity'))}: {_e(item.get('code'))} - {_e(item.get('message'))}</li>" for item in findings) or "<li>None</li>"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_e(title)}</title>
  <style>
    :root {{ color-scheme: dark; --bg:#080909; --panel:#111312; --line:#2a2f2d; --text:#f0eee8; --muted:#8e948f; --accent:#00d084; --warn:#e7b84a; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    main {{ max-width: 1440px; margin: 0 auto; padding: 28px; }}
    header {{ display:flex; justify-content:space-between; gap:24px; border-bottom:1px solid var(--line); padding-bottom:18px; margin-bottom:24px; }}
    h1 {{ margin:0 0 8px; font-size:24px; letter-spacing:0; }}
    h2 {{ margin:0 0 14px; font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }}
    h3 {{ margin:0 0 8px; font-size:15px; }}
    code, pre {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
    pre {{ white-space:pre-wrap; overflow-wrap:anywhere; background:#0b0d0c; border:1px solid var(--line); padding:12px; border-radius:6px; color:#d8dbd6; }}
    .pill {{ display:inline-flex; border:1px solid var(--line); border-radius:6px; padding:4px 8px; color:var(--accent); font-size:12px; }}
    .grid {{ display:grid; grid-template-columns: 1fr 1fr; gap:18px; margin-bottom:18px; }}
    .panel {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; }}
    .muted {{ color:var(--muted); }}
    .small {{ font-size:12px; }}
    .strategy {{ display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }}
    .field {{ border-top:1px solid var(--line); padding-top:10px; }}
    .label {{ color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.1em; margin-bottom:4px; }}
    .beats {{ display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:14px; }}
    .beat {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; min-height:220px; }}
    .beat-head {{ display:flex; justify-content:space-between; gap:12px; margin-bottom:12px; }}
    .refs {{ display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px; }}
    .ref {{ border:1px solid var(--line); border-radius:8px; padding:10px; background:#0d0f0e; }}
    .ref img {{ width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:6px; border:1px solid var(--line); margin-bottom:8px; }}
    .empty {{ border:1px dashed var(--line); color:var(--muted); border-radius:8px; padding:18px; }}
    ul {{ margin:0; padding-left:18px; }}
    @media (max-width: 900px) {{ main {{ padding:16px; }} header, .grid, .strategy {{ grid-template-columns:1fr; display:grid; }} }}
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>{_e(title)}</h1>
      <div class="muted">{_e(board.get('lane'))} | {_e((board.get('brief') or {}).get('platform'))} | spend disabled</div>
    </div>
    <div><span class="pill">{'OK' if board.get('ok') else 'NEEDS REVIEW'}</span></div>
  </header>

  <section class="grid">
    <div class="panel">
      <h2>Strategy</h2>
      <div class="strategy">
        {_field('Product', strategy.get('product'))}
        {_field('Goal', strategy.get('campaign_goal'))}
        {_field('Hook', strategy.get('hook_direction'))}
        {_field('Tone', strategy.get('tone_direction'))}
        {_field('Must Say', ', '.join(strategy.get('must_say') or []))}
        {_field('Avoid', ', '.join(strategy.get('avoid_phrases') or []))}
      </div>
    </div>
    <div class="panel">
      <h2>Script / Narration</h2>
      <div class="label">{_e(script.get('kind'))}</div>
      <pre>{_e(script.get('text') or '')}</pre>
    </div>
  </section>

  <section class="panel">
    <h2>References</h2>
    <div class="refs">{ref_cards}</div>
  </section>

  <section>
    <h2>Shot Grid</h2>
    <div class="beats">{beat_cards}</div>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Provider Contracts</h2>
      <pre>{_e(json.dumps(provider, indent=2, sort_keys=True))}</pre>
    </div>
    <div class="panel">
      <h2>Operator Commands</h2>
      <div class="label">Preflight</div>
      <pre>{_e(operator.get('preflight_command'))}</pre>
      <div class="label">Execute after approval</div>
      <pre>{_e(operator.get('execute_command'))}</pre>
    </div>
  </section>

  <section class="panel">
    <h2>Findings</h2>
    <ul>{finding_rows}</ul>
  </section>
</main>
</body>
</html>
"""


def _build_beat_reports(*, state: CreativeProductionState, production_input: CreativeProductionInput, selection_style: str, video_quality: str) -> list[dict[str, Any]]:
    plan = state.format_narrative_plan
    if not plan or not plan.scene_beats or production_input.brief.output_type == "carousel":
        return []
    reports: list[dict[str, Any]] = []
    for beat in plan.scene_beats:
        reports.append(
            _audit_beat(
                state=state,
                production_input=production_input,
                selection_style=selection_style,
                video_quality=video_quality,
                beat=beat,
            )
        )
    return reports


def _audit_beat(*, state: CreativeProductionState, production_input: CreativeProductionInput, selection_style: str, video_quality: str, beat) -> dict[str, Any]:
    plan = state.format_narrative_plan
    beat_input = CreativeProductionGraph._production_input_for_beat(
        state=state,
        production_input=production_input,
        beat=beat,
        per_beat_budget_usd=max(0.01, production_input.effective_budget_cap_usd / max(1, len(plan.scene_beats))),
    )
    analysis = analyze_brief_deterministic(beat_input.brief)
    selection = select_template(analysis)
    composed = compose_deterministic(analysis, selection)
    still = CandidateStillRecord(
        candidate_id="storyboard-still",
        source_run_id=state.run_id,
        asset_path=None,
        score=4.0,
        verdict="storyboard",
        style_family=selection_style or analysis.style_family,
        template_id=selection.image_template_id,
        prompt_summary=composed.image_prompt,
        attempt_index=1,
    )
    motion_input = CreativeProductionGraph._production_input_with_motion_notes(
        state=state,
        production_input=beat_input,
        beat_index=beat.beat_index,
    )
    motion_plan = compact_motion_prompt_for_provider(
        build_motion_prompt_plan(brief=motion_input.brief, selected_still=still, format_hint=plan.format_type)
    )
    aspect_ratio = CreativeProductionGraph._video_aspect_ratio(state)
    video_route = None
    provider_prompt = None
    provider_prompt_profile = None
    provider_negative_prompt = ""
    findings: list[dict[str, str]] = []
    try:
        video_route = select_video_model_route(
            brief=motion_input.brief,
            motion_prompt=motion_plan.motion_prompt,
            duration_s=motion_plan.duration_s,
            budget_cap_usd=max(0.01, production_input.effective_budget_cap_usd / max(1, len(plan.scene_beats))),
            requested_quality=video_quality,
            aspect_ratio=aspect_ratio,
            require_adapter_ready=True,
        )
        provider_prompt = compile_video_provider_prompt(
            motion_plan=motion_plan,
            model_id=video_route.model_id,
            aspect_ratio=aspect_ratio,
        )
        provider_prompt_profile = getattr(provider_prompt, "profile", None)
        provider_negative_prompt = str(getattr(provider_prompt, "negative_prompt", "") or "")
    except Exception as exc:
        findings.append({"severity": "medium", "code": "video_route_unavailable", "message": str(exc)})

    _check_prompt_contains(
        findings=findings,
        prompt=composed.image_prompt,
        needles=(beat.visual_premise, beat.image_prompt_focus, beat.visual_goal),
        code="still_prompt_missing_beat_direction",
    )
    _check_prompt_contains(
        findings=findings,
        prompt=motion_plan.motion_prompt,
        needles=(beat.motion_intent, getattr(beat.shot_directive, "visual_action", "")),
        code="motion_prompt_missing_beat_direction",
    )
    provider_prompt_text = getattr(provider_prompt, "prompt", "") if provider_prompt is not None else ""
    return {
        "present": True,
        "index": beat.beat_index,
        "beat_index": beat.beat_index,
        "role": beat.beat_role,
        "beat_role": beat.beat_role,
        "visual_premise": beat.visual_premise,
        "visual_goal": beat.visual_goal,
        "emotional_job": getattr(beat, "viewer_emotion", ""),
        "shot_purpose": getattr(getattr(beat, "shot_directive", None), "shot_purpose", "") or beat.visual_goal,
        "still_prompt": _prompt_summary(composed.image_prompt),
        "still_negative_prompt": _prompt_summary(composed.image_negative_prompt, max_chars=280),
        "motion_prompt": _prompt_summary(motion_plan.motion_prompt),
        "motion_negative_prompt": _prompt_summary(motion_plan.negative_prompt, max_chars=280),
        "provider_prompt": _prompt_summary(provider_prompt_text),
        "provider_prompt_profile": provider_prompt_profile,
        "negative_prompt_sent_separately": bool(provider_negative_prompt),
        "motion_duration_s": motion_plan.duration_s,
        "duration_s": motion_plan.duration_s,
        "aspect_ratio": aspect_ratio,
        "estimated_cost_usd": getattr(video_route, "estimated_cost_usd", None),
        "video_route": video_route,
        "findings": findings,
    }


def _route_for_plan(*, brief: CreativeBrief, plan) -> dict[str, Any]:
    if brief.output_type == "carousel":
        return {"lane": "carousel_slideshow", "provider_spend": False, "runner": "scripts/run_carousel_production.py"}
    if plan.format_type == "spotify_canvas_loop":
        return {"lane": "spotify_canvas_loop", "provider_spend": True, "requires_explicit_enablement": True, "provider_mode": "modular"}
    if plan.format_type == "ugc_scripted_ad" and plan.ugc_strategy is not None:
        if plan.ugc_strategy.provider_strategy == "requires_presenter_or_lipsync_provider_before_spend":
            return {"lane": "ugc_presenter", "provider_spend": True, "requires_explicit_enablement": True}
        return {"lane": "ugc_i2v_broll", "provider_spend": True, "requires_explicit_enablement": True}
    if plan.format_type == "no_face_youtube":
        return {"lane": "faceless_youtube", "provider_spend": True, "requires_explicit_enablement": True}
    if plan.format_type == "lyric_video":
        return {"lane": "music_lyric", "provider_spend": True, "requires_explicit_enablement": True}
    return {"lane": "multi_shot_video", "provider_spend": True, "requires_explicit_enablement": True}


def _provider_contracts(*, brief: CreativeBrief, state: CreativeProductionState, route: dict[str, Any], beat_report: dict[str, Any]) -> dict[str, Any]:
    contracts: dict[str, Any] = {
        "no_provider_calls_made": True,
        "video": None,
        "heygen": None,
    }
    video_route = beat_report.get("video_route")
    if video_route is not None:
        contracts["video"] = {
            "provider": video_route.provider,
            "model_id": video_route.model_id,
            "adapter_ready": video_route.adapter_ready,
            "estimated_cost_usd": video_route.estimated_cost_usd,
            "prompt_profile": beat_report.get("provider_prompt_profile"),
            "negative_prompt_sent_separately": bool(beat_report.get("negative_prompt_sent_separately")),
            "fallback_model_id": video_route.fallback_model_id,
            "graph_auto_fallback_disabled": True,
        }
    if route["lane"] == "ugc_presenter":
        script = build_ugc_presenter_script(brief=brief, strategy=state.format_narrative_plan.ugc_strategy)
        payload = build_heygen_ugc_video_request(
            HeyGenUgcRequest(
                avatar_id="dry-run-avatar-id",
                voice_id="dry-run-voice-id",
                script=script,
                title=f"storyboard-{state.run_id}",
                aspect_ratio=CreativeProductionGraph._video_aspect_ratio(state),
                duration_estimate_s=max(1, int(beat_report.get("motion_duration_s") or 20)),
            )
        )
        contracts["heygen"] = {
            "payload_keys": sorted(payload.keys()),
            "type": payload.get("type"),
            "has_script": bool(payload.get("script")),
            "has_audio_asset_id": bool(payload.get("audio_asset_id")),
            "aspect_ratio": payload.get("aspect_ratio"),
            "resolution": payload.get("resolution"),
            "script_preview": _prompt_summary(script, max_chars=280),
        }
    return contracts


def _provider_contract_findings(contracts: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    heygen = contracts.get("heygen") or {}
    if heygen and heygen.get("type") != "avatar":
        findings.append({"severity": "high", "code": "heygen_missing_avatar_type", "message": "HeyGen create-video payload must declare type=avatar"})
    if heygen and heygen.get("has_script") == heygen.get("has_audio_asset_id"):
        findings.append({"severity": "high", "code": "heygen_script_audio_contract_invalid", "message": "HeyGen payload must have exactly one of script or audio asset"})
    return findings


def _operator_commands(*, name: str, brief: CreativeBrief, route: dict[str, Any], video_quality: str, brief_file: str | Path | None) -> dict[str, Any]:
    brief_path = str(brief_file or f".outputs/studio/briefs/storyboard-{name}/brief.json")
    if brief.output_type == "carousel":
        preflight = f".venv/bin/python scripts/run_carousel_production.py --brief-file {brief_path} --run-id storyboard-{name}"
        execute = preflight
    else:
        preflight = (
            f".venv/bin/python scripts/run_creative_production.py --brief-file {brief_path} "
            f"--video-quality {video_quality} --budget-cap-usd {brief.max_cost_usd:.2f} --preflight-only"
        )
        execute = preflight.replace(" --preflight-only", "")
    return {
        "brief_path": brief_path,
        "preflight_command": preflight,
        "execute_command": execute,
        "requires_explicit_spend_intent": bool(route.get("provider_spend")),
    }


def _operator_findings(operator: dict[str, Any]) -> list[dict[str, str]]:
    if operator.get("requires_explicit_spend_intent") and "--preflight-only" not in operator.get("preflight_command", ""):
        return [{"severity": "high", "code": "missing_preflight_command", "message": "paid lane operator command must include a no-spend preflight"}]
    return []


def _voiceover_summary(*, brief: CreativeBrief, plan, style_family: str, duration_s: int | None) -> dict[str, Any]:
    if brief.output_type == "carousel":
        return {"enabled": False, "template_id": None, "script_preview": "", "voice_direction": "", "rationale": "carousel slideshow lane uses slide text, not voiceover"}
    if plan and plan.format_type == "spotify_canvas_loop":
        return {"enabled": False, "template_id": None, "script_preview": "", "voice_direction": "", "rationale": "Spotify Canvas is a silent visual loop; no voiceover, captions, or CTA"}
    voice_brief = brief
    script_plan = getattr(plan, "script_plan", None)
    narration_script = str(getattr(script_plan, "narration_script", "") or "").strip()
    if narration_script:
        voice_brief = replace(brief, voiceover_script=narration_script)
    still = CandidateStillRecord(
        candidate_id="storyboard-still",
        source_run_id="storyboard",
        asset_path=None,
        score=4.0,
        verdict="storyboard",
        style_family=style_family,
        template_id="storyboard",
        prompt_summary="storyboard",
        attempt_index=1,
    )
    voice_plan = build_voiceover_plan(brief=voice_brief, selected_still=still, target_duration_s=duration_s)
    return {
        "enabled": voice_plan.enabled,
        "template_id": voice_plan.template_id,
        "script_preview": _prompt_summary(voice_plan.script, max_chars=500),
        "voice_direction": voice_plan.voice_direction,
        "rationale": voice_plan.rationale,
    }


def _script_summary(*, brief: CreativeBrief, plan, route: dict[str, Any], voiceover: dict[str, Any]) -> dict[str, str]:
    if route["lane"] == "ugc_presenter" and plan and plan.ugc_strategy:
        return {"kind": "ugc_presenter", "text": build_ugc_presenter_script(brief=brief, strategy=plan.ugc_strategy)}
    if voiceover.get("enabled"):
        kind = "faceless_narration" if route["lane"] == "faceless_youtube" else "voiceover"
        return {"kind": kind, "text": str(voiceover.get("script_preview") or "")}
    if brief.output_type == "carousel":
        return {"kind": "slide_text", "text": ""}
    if route["lane"] == "spotify_canvas_loop":
        return {"kind": "silent_visual_loop", "text": ""}
    if route["lane"] == "music_lyric":
        return {"kind": "music_led", "text": ""}
    return {"kind": "none", "text": ""}


def _carousel_summary(brief: CreativeBrief) -> dict[str, Any]:
    plan = build_carousel_plan(brief)
    return {
        "slide_count": plan.slide_count,
        "format": plan.export_spec.export_format,
        "aspect_ratio": plan.export_spec.aspect_ratio,
        "first_slide": plan.slides[0].headline if plan.slides else "",
        "runner": "scripts/run_carousel_production.py",
        "slides": [
            {"index": slide.slide_number, "headline": slide.headline, "body": slide.body, "role": slide.role}
            for slide in plan.slides
        ],
    }


def _strategy_summary(brief: CreativeBrief) -> dict[str, Any]:
    return {
        "product": brief.product_description,
        "campaign_goal": brief.campaign_goal,
        "hook_direction": brief.hook_direction,
        "script_bits": brief.script_bits,
        "must_say": brief.must_say,
        "avoid_phrases": brief.avoid_phrases,
        "tone_direction": brief.tone_direction,
        "cta_text": brief.cta_text,
        "aesthetic_notes": brief.aesthetic_notes,
    }


def _reference_summaries(*, brief: CreativeBrief, asset_roots: tuple[Path, ...]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen_paths: set[str] = set()

    def append_ref(ref: dict[str, Any]) -> None:
        raw_path = str(ref.get("path") or "")
        key = str(Path(raw_path).expanduser().resolve()) if raw_path else ""
        if key and key in seen_paths:
            return
        if key:
            seen_paths.add(key)
        refs.append(ref)

    for item in brief.reference_assets:
        raw_path = str(item.get("path") or item.get("asset_path") or item.get("value") or "")
        if not raw_path:
            continue
        path = Path(raw_path)
        append_ref(
            {
                "role": str(item.get("role") or item.get("declared_role") or _infer_reference_role(path)),
                "path": str(path),
                "exists": path.exists(),
                "kind": str(item.get("kind") or item.get("source_kind") or "asset"),
                "label": str(item.get("label") or path.stem),
            }
        )
    for raw_path in brief.reference_image_paths:
        path = Path(raw_path)
        append_ref({"role": _infer_reference_role(path), "path": str(path), "exists": path.exists(), "kind": "image"})
    for root in asset_roots:
        if not root.exists():
            refs.append({"role": "asset_root", "path": str(root), "exists": False, "kind": "directory"})
    return refs


def _safe_preflight(*, brief: CreativeBrief, name: str, video_quality: str, brief_file: str | Path | None, asset_roots: tuple[Path, ...]) -> dict[str, Any]:
    if brief.output_type == "carousel":
        return {"mode": "carousel_local_no_provider", "ok": True, "blockers": [], "warnings": []}
    summary = build_preflight_summary(
        brief=brief,
        brief_file=str(brief_file or f".outputs/studio/briefs/storyboard-{name}/brief.json"),
        asset_roots=list(asset_roots),
        budget_cap_usd=brief.max_cost_usd,
        video_quality=video_quality,
        image_eval_provider="auto",
    )
    return {
        "mode": summary["mode"],
        "ok": summary["ok"],
        "providers": summary["providers"],
        "blockers": summary["blockers"],
        "warnings": summary["warnings"],
    }


def copy_reference_thumbnails(board: dict[str, Any], output_dir: Path) -> None:
    refs_dir = output_dir / "references"
    for ref in board.get("references") or []:
        path = Path(str(ref.get("path") or ""))
        if not path.exists() or not path.is_file():
            continue
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        refs_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:10]
        dest = refs_dir / f"{digest}-{path.name}"
        if dest.resolve() != path.resolve():
            shutil.copy2(path, dest)
        ref["thumbnail_path"] = str(dest.relative_to(output_dir))


def _check_prompt_contains(*, findings: list[dict[str, str]], prompt: str, needles: tuple[str, ...], code: str) -> None:
    prompt_l = prompt.lower()
    useful_needles = [needle for needle in needles if needle and len(needle.split()) >= 3]
    if not useful_needles:
        return
    if not any(_keyword_overlap(needle.lower(), prompt_l) >= 2 for needle in useful_needles):
        findings.append({"severity": "medium", "code": code, "message": "prompt appears to drop beat-level creative direction"})


def _keyword_overlap(needle: str, prompt: str) -> int:
    stop = {"the", "and", "with", "that", "this", "into", "scene", "beat", "clear", "show"}
    words = {word for word in "".join(ch if ch.isalnum() else " " for ch in needle).split() if len(word) > 3 and word not in stop}
    return sum(1 for word in words if word in prompt)


def _prompt_summary(text: str, *, max_chars: int = 600) -> str:
    cleaned = " ".join(str(text or "").split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max(0, max_chars - 1)].rstrip(" ,.;") + "."


def _infer_reference_role(path: Path) -> str:
    text = " ".join(path.parts).lower().replace("_", " ").replace("-", " ")
    if any(term in text for term in ("character", "person", "face", "avatar", "talent")):
        return "character"
    if any(term in text for term in ("world", "environment", "location", "set", "room", "scene")):
        return "world"
    if any(term in text for term in ("product", "app", "screen", "device", "logo")):
        return "product"
    if any(term in text for term in ("mood", "style", "palette", "light", "lighting")):
        return "mood"
    if any(term in text for term in ("music", "audio", "track", "song")):
        return "music"
    return "unknown"


def _beat_card(beat: dict[str, Any]) -> str:
    return f"""<article class="beat">
  <div class="beat-head"><h3>Beat {_e(beat.get('index'))}: {_e(beat.get('role'))}</h3><span class="pill">${_e(beat.get('estimated_cost_usd'))}</span></div>
  {_field('Premise', beat.get('visual_premise'))}
  {_field('Emotion', beat.get('emotional_job'))}
  {_field('Still Prompt', beat.get('still_prompt'))}
  {_field('Motion Prompt', beat.get('motion_prompt'))}
  {_field('Negative', beat.get('motion_negative_prompt'))}
</article>"""


def _ref_card(ref: dict[str, Any]) -> str:
    thumb = ref.get("thumbnail_path")
    image = f'<img src="{_e(thumb)}" alt="{_e(ref.get("role"))} reference">' if thumb else ""
    return f"""<div class="ref">{image}<div class="label">{_e(ref.get('role'))}</div><div class="small muted">{_e(ref.get('path'))}</div></div>"""


def _field(label: str, value: Any) -> str:
    rendered = _e(value) if value not in (None, "") else '<span class="muted">Not set</span>'
    return f'<div class="field"><div class="label">{_e(label)}</div><div>{rendered}</div></div>'


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value
