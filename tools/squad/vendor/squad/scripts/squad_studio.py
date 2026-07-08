#!/usr/bin/env python3
"""Launch the local Squad Studio UI and JSON control API."""

from __future__ import annotations

import argparse
import json
import mimetypes
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from dataclasses import asdict, fields
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from content.writing.brief_generator import CreativeBrief
from scripts.prepare_creative_redo_brief import prepare_redo_brief
from scripts.record_creative_production_review import build_review_record, record_review


ROOT = PROJECT_ROOT
STUDIO_UI = ROOT / "studio-ui"
DIST = STUDIO_UI / "dist"
CREATIVE_ROOT = ROOT / ".outputs" / "creative-production"
CAROUSEL_ROOT = ROOT / ".outputs" / "carousel-production"
STUDIO_ROOT = ROOT / ".outputs" / "studio"
ALLOWED_MEDIA_ROOTS = (CREATIVE_ROOT.resolve(), CAROUSEL_ROOT.resolve())
VALID_BRIEF_FIELDS = {field.name for field in fields(CreativeBrief)}
VALID_REVIEW_VERDICTS = {"approved", "redo"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch the local Squad Studio visual cockpit.")
    parser.add_argument("--host", default="127.0.0.1", help="Host for the local server")
    parser.add_argument("--port", type=int, default=7860, help="Port for the local server")
    parser.add_argument("--install", action="store_true", help="Run npm install first if node_modules is missing")
    parser.add_argument("--build", action="store_true", help="Build the studio UI and exit")
    parser.add_argument("--dev-ui", action="store_true", help="Run Vite dev server only; no local API")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _ensure_ui_ready(install=args.install)
    if args.build:
        return _build_ui()
    if args.dev_ui:
        return _run_vite(host=args.host, port=args.port)

    if _build_ui() != 0:
        return 1
    STUDIO_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), StudioHandler)
    print(f"Squad Studio: http://{args.host}:{args.port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0


def _ensure_ui_ready(*, install: bool) -> None:
    if not STUDIO_UI.exists():
        raise SystemExit(f"studio UI directory not found: {STUDIO_UI}")
    if shutil.which("npm") is None:
        raise SystemExit("npm is required to run Squad Studio")
    if not (STUDIO_UI / "node_modules").exists():
        if not install:
            raise SystemExit(
                "studio-ui/node_modules is missing. Run:\n"
                ".venv/bin/python scripts/squad_studio.py --install"
            )
        subprocess.run(["npm", "install"], cwd=STUDIO_UI, check=True)


def _build_ui() -> int:
    return subprocess.run(["npm", "run", "build"], cwd=STUDIO_UI).returncode


def _run_vite(*, host: str, port: int) -> int:
    try:
        return subprocess.run(
            ["npm", "run", "dev", "--", "--host", host, "--port", str(port)],
            cwd=STUDIO_UI,
        ).returncode
    except KeyboardInterrupt:
        return 130


class StudioHandler(SimpleHTTPRequestHandler):
    server_version = "SquadStudio/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/runs":
            return self._send_json({"runs": list_runs()})
        if parsed.path == "/api/runs/latest":
            runs = list_runs()
            return self._send_json({"run": runs[0] if runs else None})
        if parsed.path.startswith("/api/runs/"):
            run_id = unquote(parsed.path.removeprefix("/api/runs/")).strip("/")
            return self._send_json({"run": get_run(run_id)})
        if parsed.path == "/media":
            query = parse_qs(parsed.query)
            return self._send_media(query.get("path", [""])[0])
        return self._send_static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            payload = self._read_json()
            if parsed.path == "/api/briefs/validate":
                return self._send_json(save_brief(payload, validate_only=True))
            if parsed.path == "/api/briefs":
                return self._send_json(save_brief(payload, validate_only=False))
            if parsed.path == "/api/preflight":
                return self._send_json(run_preflight(payload))
            if parsed.path.endswith("/review") and parsed.path.startswith("/api/runs/"):
                run_id = unquote(parsed.path.removeprefix("/api/runs/").removesuffix("/review")).strip("/")
                return self._send_json(write_review(run_id, payload))
            if parsed.path.endswith("/redo-brief") and parsed.path.startswith("/api/runs/"):
                run_id = unquote(parsed.path.removeprefix("/api/runs/").removesuffix("/redo-brief")).strip("/")
                return self._send_json(write_redo_brief(run_id, payload))
            self._send_json({"ok": False, "error": "unknown endpoint"}, status=404)
        except ValueError as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=400)
        except Exception as exc:  # pragma: no cover - surfaced in browser during local use
            self._send_json({"ok": False, "error": str(exc)}, status=500)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[studio] {self.address_string()} {format % args}", file=sys.stderr)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, request_path: str) -> None:
        relative = request_path.lstrip("/") or "index.html"
        target = (DIST / relative).resolve()
        if not _is_relative_to(target, DIST) or not target.exists() or target.is_dir():
            target = DIST / "index.html"
        body = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_media(self, raw_path: str) -> None:
        try:
            path = _resolve_media_path(raw_path)
        except ValueError as exc:
            return self.send_error(404, str(exc))
        body = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def list_runs() -> list[dict[str, Any]]:
    runs = [_normalize_creative_manifest(path, include_details=False) for path in _newest_manifest_paths(CREATIVE_ROOT, limit=200)]
    runs += [_normalize_carousel_manifest(path, include_details=False) for path in _newest_manifest_paths(CAROUSEL_ROOT, limit=200)]
    return sorted((run for run in runs if run), key=lambda item: item["updated_at_epoch"], reverse=True)[:200]


def get_run(run_id: str) -> dict[str, Any] | None:
    run_id = _validate_run_id(run_id)
    for root, normalizer in (
        (CREATIVE_ROOT, _normalize_creative_manifest),
        (CAROUSEL_ROOT, _normalize_carousel_manifest),
    ):
        candidate = root / run_id / "manifest.json"
        if candidate.exists():
            return normalizer(candidate, include_details=True)
    return None


def save_brief(payload: dict[str, Any], *, validate_only: bool) -> dict[str, Any]:
    brief = dict(payload.get("brief") or payload)
    normalized, errors = _normalize_brief_payload(brief)
    if validate_only:
        return {"ok": not errors, "errors": errors, "brief": normalized or brief}
    if errors:
        return {"ok": False, "errors": errors}
    run_id = _safe_slug(str(payload.get("run_id") or f"studio-brief-{_stamp()}"))
    out_dir = STUDIO_ROOT / "briefs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    brief_path = out_dir / "brief.json"
    brief_path.write_text(json.dumps(normalized, indent=2, sort_keys=True), encoding="utf-8")
    return {"ok": True, "brief_path": str(brief_path), "brief": normalized}


def run_preflight(payload: dict[str, Any]) -> dict[str, Any]:
    brief_path = payload.get("brief_path")
    if not brief_path:
        saved = save_brief(payload, validate_only=False)
        if not saved.get("ok"):
            return saved
        brief_path = saved["brief_path"]
    brief = _load_json(Path(brief_path))
    if brief.get("output_type") == "carousel":
        cmd = [
            sys.executable,
            "scripts/run_carousel_production.py",
            "--brief-file",
            str(brief_path),
        ]
        return {
            "ok": True,
            "command": _display_command(cmd),
            "returncode": 0,
            "stdout": {
                "mode": "carousel_preflight",
                "ok": True,
                "message": "Carousel/slideshow briefs use the local no-provider carousel runner.",
                "brief": {
                    "output_type": brief.get("output_type"),
                    "platform": brief.get("platform"),
                    "product_type": brief.get("product_type"),
                },
            },
            "stderr": "",
            "brief_path": str(brief_path),
        }
    quality = str(payload.get("video_quality") or payload.get("quality") or "budget").lower()
    budget = float(payload.get("budget_cap_usd") or payload.get("budget") or 1.0)
    cmd = [
        sys.executable,
        "scripts/run_creative_production.py",
        "--brief-file",
        str(brief_path),
        "--video-quality",
        quality,
        "--budget-cap-usd",
        f"{budget:.2f}",
        "--preflight-only",
    ]
    proc = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    return {
        "ok": proc.returncode == 0,
        "command": _display_command(cmd),
        "returncode": proc.returncode,
        "stdout": _json_or_text(proc.stdout),
        "stderr": proc.stderr.strip(),
        "brief_path": str(brief_path),
    }


def write_review(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    manifest_path = _manifest_path_for_run(run_id)
    manifest = _load_json(manifest_path)
    verdict = str(payload.get("verdict") or "redo").lower()
    if verdict not in VALID_REVIEW_VERDICTS:
        raise ValueError("verdict must be approved or redo")
    notes = str(payload.get("notes") or ("approved" if verdict == "approved" else "")).strip()
    if not notes:
        notes = "redo requested from Squad Studio"
    review = build_review_record(
        verdict=verdict,
        notes=notes,
        reuse=list(payload.get("reuse") or []),
        source_run_id=str(manifest.get("run_id") or run_id),
        new_run_id=payload.get("new_run_id"),
    )
    result = record_review(manifest_path=manifest_path, review=review)
    return {"ok": True, **result}


def write_redo_brief(run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    manifest_path = _manifest_path_for_run(run_id)
    if _is_relative_to(manifest_path, CAROUSEL_ROOT.resolve()):
        return _write_carousel_redo_brief(run_id=run_id, payload=payload, manifest_path=manifest_path)
    manifest = _load_json(manifest_path)
    new_run_id = _safe_slug(str(payload.get("new_run_id") or f"{run_id}-redo-{_stamp()}"))
    result = prepare_redo_brief(
        manifest_path=manifest_path,
        manifest=manifest,
        new_run_id=new_run_id,
        notes=str(payload.get("notes") or ""),
        hook_direction=str(payload.get("hook_direction") or ""),
        script_bits=list(payload.get("script_bits") or []),
        must_say=list(payload.get("must_say") or []),
        avoid_phrases=list(payload.get("avoid_phrases") or []),
        tone_direction=str(payload.get("tone_direction") or ""),
        aesthetic_notes=list(payload.get("aesthetic_notes") or []),
        video_quality=str(payload.get("video_quality") or "budget"),
        budget_cap_usd=payload.get("budget_cap_usd"),
        asset_roots=list(payload.get("asset_roots") or []),
        force=True,
    )
    return {"ok": True, **result}


def _write_carousel_redo_brief(*, run_id: str, payload: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    manifest = _load_json(manifest_path)
    brief = dict(manifest.get("brief") or {})
    brief["output_type"] = "carousel"
    brief["max_cost_usd"] = min(float(brief.get("max_cost_usd") or 0.01), 0.01)

    notes = str(payload.get("notes") or "").strip()
    hook_direction = str(payload.get("hook_direction") or "").strip()
    tone_direction = str(payload.get("tone_direction") or "").strip()
    aesthetic_notes = payload.get("aesthetic_notes") or []
    if isinstance(aesthetic_notes, str):
        aesthetic_notes = [aesthetic_notes]
    if notes:
        brief["aesthetic_notes"] = _join_text_notes(brief.get("aesthetic_notes"), f"Redo direction: {notes}")
    if hook_direction:
        brief["hook_direction"] = _join_text_notes(brief.get("hook_direction"), hook_direction)
    elif notes and "hook" in notes.lower():
        brief["hook_direction"] = _join_text_notes(brief.get("hook_direction"), notes)
    if tone_direction:
        brief["tone_direction"] = _join_text_notes(brief.get("tone_direction"), tone_direction)
    for note in aesthetic_notes:
        brief["aesthetic_notes"] = _join_text_notes(brief.get("aesthetic_notes"), str(note))

    new_run_id = _safe_slug(str(payload.get("new_run_id") or f"{run_id}-redo-{_stamp()}"))
    saved = save_brief({"run_id": new_run_id, "brief": brief}, validate_only=False)
    if not saved.get("ok"):
        return saved
    cmd = [
        sys.executable,
        "scripts/run_carousel_production.py",
        "--brief-file",
        saved["brief_path"],
        "--run-id",
        new_run_id,
    ]
    return {
        "ok": True,
        "source_run_id": run_id,
        "new_run_id": new_run_id,
        "brief_path": saved["brief_path"],
        "rerun_command": _display_command(cmd),
        "redo_notes": notes,
    }


def _normalize_creative_manifest(path: Path, *, include_details: bool = False) -> dict[str, Any] | None:
    try:
        data = _load_json(path)
    except Exception:
        return None
    run_dir = path.parent
    brief = data.get("brief") or {}
    final = data.get("final_assembly") or {}
    post = data.get("post_pass_plan") or {}
    final_asset = final.get("asset_path") or post.get("final_asset_path")
    review = data.get("latest_operator_review") or {}
    clips = data.get("video_attempt_history") or []
    selected_still = data.get("selected_still") or {}
    total_spend = float(data.get("total_spend_usd") or 0.0)
    status = str(data.get("final_status") or "unknown")
    mode = _mode_from_brief(brief)
    result = {
        "id": str(data.get("run_id") or run_dir.name),
        "type": "creative-production",
        "mode": mode,
        "status": _label_status(status, review),
        "raw_status": status,
        "spend": f"${total_spend:.2f}",
        "total_spend_usd": total_spend,
        "platform": str(brief.get("platform") or "unknown"),
        "timestamp": _iso_from_mtime(path),
        "updated_at_epoch": path.stat().st_mtime,
        "verdict": str(review.get("verdict") or "Pending"),
        "manifest_path": str(path),
        "run_dir": str(run_dir),
        "final_asset_path": final_asset,
        "final_asset_url": _media_url(final_asset),
        "review_path": str(run_dir / "operator-review.json") if (run_dir / "operator-review.json").exists() else None,
        "brief": {
            "topic": brief.get("product_description") or data.get("creative_goal") or "Untitled",
            "goal": brief.get("campaign_goal") or data.get("creative_goal") or "",
            "budget": f"${float(data.get('budget_cap_usd') or brief.get('max_cost_usd') or 0.0):.2f}",
            "quality": data.get("video_quality") or "budget",
            "hook": brief.get("hook_direction") or brief.get("campaign_goal") or "",
            "aesthetic": brief.get("aesthetic_notes") or "",
        },
        "clips": [_clip_payload(clip, index) for index, clip in enumerate(clips)] if include_details else [],
        "images": [_still_payload(selected_still, 0)] if include_details and selected_still else [],
        "qa": (data.get("output_qa_report") or data.get("free_output_qa") or {}) if include_details else {},
        "manifest": data if include_details else None,
    }
    return result


def _normalize_carousel_manifest(path: Path, *, include_details: bool = False) -> dict[str, Any] | None:
    try:
        data = _load_json(path)
    except Exception:
        return None
    run_dir = path.parent
    brief = data.get("brief") or {}
    slide_paths = list(data.get("slide_paths") or [])
    final_asset = data.get("video_path") or data.get("mp4_path") or data.get("pdf_path") or (slide_paths[0] if slide_paths else None)
    total_spend = float(data.get("total_spend_usd") or 0.0)
    review = data.get("latest_operator_review") or {}
    status = str(data.get("status") or "completed")
    display_status = "review_ready" if status == "completed" else status
    result = {
        "id": str(data.get("run_id") or run_dir.name),
        "type": "carousel-production",
        "mode": "Carousel/Slideshow",
        "status": _label_status(display_status, review),
        "raw_status": status,
        "spend": f"${total_spend:.2f}",
        "total_spend_usd": total_spend,
        "platform": str(brief.get("platform") or "unknown"),
        "timestamp": _iso_from_mtime(path),
        "updated_at_epoch": path.stat().st_mtime,
        "verdict": str(review.get("verdict") or "Pending"),
        "manifest_path": str(path),
        "run_dir": str(run_dir),
        "final_asset_path": final_asset,
        "final_asset_url": _media_url(final_asset),
        "review_path": str(run_dir / "operator-review.json") if (run_dir / "operator-review.json").exists() else None,
        "brief": {
            "topic": brief.get("product_description") or "Carousel",
            "goal": brief.get("campaign_goal") or "",
            "budget": f"${float(brief.get('max_cost_usd') or 0.0):.2f}",
            "quality": "local",
            "hook": brief.get("campaign_goal") or "",
            "aesthetic": "",
        },
        "clips": [],
        "images": [_still_payload({"asset_path": slide}, index) for index, slide in enumerate(slide_paths)] if include_details else [],
        "qa": {},
        "manifest": data if include_details else None,
    }
    return result


def _clip_payload(clip: dict[str, Any], index: int) -> dict[str, Any]:
    path = clip.get("asset_path")
    return {
        "id": clip.get("clip_id") or f"clip-{index + 1}",
        "beat": f"Beat {index + 1:02d}",
        "duration": f"{float(clip.get('duration_s') or 0.0):.1f}s",
        "model": clip.get("model_id") or "local/mock",
        "cost": f"${float(clip.get('cost_usd') or 0.0):.2f}",
        "status": str(clip.get("verdict") or "generated").title(),
        "prompt": clip.get("prompt_summary") or "",
        "asset_path": path,
        "asset_url": _media_url(path),
    }


def _still_payload(still: dict[str, Any], index: int) -> dict[str, Any]:
    path = still.get("asset_path") or still.get("path")
    return {
        "id": still.get("candidate_id") or f"image-{index + 1}",
        "beat": f"Beat {index + 1:02d}",
        "prompt": still.get("prompt_summary") or still.get("prompt") or "",
        "model": still.get("model_id") or "local",
        "cost": f"${float(still.get('cost_usd') or 0.0):.2f}",
        "asset_path": path,
        "asset_url": _media_url(path),
    }


def _validate_brief_payload(brief: dict[str, Any]) -> list[str]:
    return _normalize_brief_payload(brief)[1]


def _normalize_brief_payload(brief: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    if not isinstance(brief, dict):
        return None, ["brief must be a JSON object"]
    unknown = sorted(str(key) for key in brief if key not in VALID_BRIEF_FIELDS)
    if unknown:
        return None, [
            "brief contains unsupported field(s): "
            + ", ".join(unknown)
            + ". Put CLI options like video_quality on the command line, not in brief.json."
        ]
    try:
        creative_brief = CreativeBrief(**brief)
    except Exception as exc:
        return None, [f"brief is invalid: {exc}"]
    errors = creative_brief.validate()
    if errors:
        return None, errors
    return asdict(creative_brief), []


def _manifest_path_for_run(run_id: str) -> Path:
    run_id = _validate_run_id(run_id)
    for root in (CREATIVE_ROOT, CAROUSEL_ROOT):
        candidate = root / run_id / "manifest.json"
        if candidate.exists():
            return candidate
    raise ValueError(f"manifest not found for run_id={run_id}")


def _creative_manifest_path_for_run(run_id: str) -> Path:
    run_id = _validate_run_id(run_id)
    candidate = CREATIVE_ROOT / run_id / "manifest.json"
    if candidate.exists():
        return candidate
    if (CAROUSEL_ROOT / run_id / "manifest.json").exists():
        raise ValueError("redo brief preparation only supports creative-production runs")
    raise ValueError(f"manifest not found for run_id={run_id}")


def _validate_run_id(run_id: str) -> str:
    value = str(run_id or "").strip()
    if not value or "/" in value or "\\" in value or value in {".", ".."}:
        raise ValueError("run_id is invalid")
    if any(part in {"", ".", ".."} for part in Path(value).parts):
        raise ValueError("run_id is invalid")
    return value


def _mode_from_brief(brief: dict[str, Any]) -> str:
    output_type = str(brief.get("output_type") or "")
    goal = " ".join(str(brief.get(key) or "") for key in ("campaign_goal", "product_description")).lower()
    if output_type == "carousel" or "carousel" in goal or "slideshow" in goal:
        return "Carousel/Slideshow"
    if "ugc" in goal or "creator" in goal or "talking head" in goal:
        return "UGC"
    if "music" in goal or "song" in goal or "single" in goal or "lyric" in goal:
        return "Music Promo"
    if "app" in goal or "saas" in goal or "dashboard" in goal:
        return "App Demo"
    if "faceless" in goal or "documentary" in goal or "explainer" in goal:
        return "Faceless Narrative"
    return "Creative Video"


def _label_status(status: str, review: dict[str, Any]) -> str:
    if review.get("verdict") == "approved":
        return "Approved"
    if review.get("verdict") == "redo":
        return "Redo Requested"
    if status == "review_ready":
        return "Awaiting Review"
    if "fail" in status.lower():
        return "Failed"
    return status.replace("_", " ").title() or "Unknown"


def _media_url(path: Any) -> str | None:
    if not path:
        return None
    return "/media?path=" + quote(str(path))


def _resolve_media_path(raw_path: str) -> Path:
    if not raw_path:
        raise ValueError("missing media path")
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    if not path.exists() or path.is_dir():
        raise ValueError("media not found")
    if path.name.startswith(".env"):
        raise ValueError("media path is not allowed")
    if not any(_is_relative_to(path, root) for root in ALLOWED_MEDIA_ROOTS):
        raise ValueError("media path is not allowed")
    return path


def _newest_manifest_paths(root: Path, *, limit: int) -> list[Path]:
    paths = [path for path in root.glob("*/manifest.json") if path.is_file()]
    paths.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return paths[:limit]


def _iso_from_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _safe_slug(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in value.strip().lower())
    return "-".join(part for part in cleaned.split("-") if part)[:96] or f"studio-{_stamp()}"


def _join_text_notes(*parts: Any) -> str:
    return "\n".join(" ".join(str(part or "").split()) for part in parts if " ".join(str(part or "").split()))


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_or_text(text: str) -> Any:
    cleaned = text.strip()
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return cleaned


def _display_command(cmd: list[str]) -> str:
    parts = [".venv/bin/python" if part == sys.executable else part for part in cmd]
    return " ".join(parts)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
