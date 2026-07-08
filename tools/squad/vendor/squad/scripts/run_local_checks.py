#!/usr/bin/env python3
"""Run repo checks with the Python version this project actually requires."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"


def project_python() -> str:
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    if sys.version_info >= (3, 11):
        return sys.executable
    raise SystemExit("Squad requires Python >=3.11. Create .venv or run with a newer Python.")


def run(command: list[str]) -> int:
    print("+ " + " ".join(command))
    return subprocess.run(command, cwd=PROJECT_ROOT).returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run local Squad verification checks.")
    parser.add_argument("--quick", action="store_true", help="Only run carousel and syntax checks")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    py = project_python()
    commands = [
        [py, "-m", "unittest", "tests.test_carousel_planner", "tests.test_micro_agents", "-v"],
        [
            py,
            "-m",
            "py_compile",
            "content/agents/brief_analyzer.py",
            "content/agents/template_selector.py",
            "creative/production/graph.py",
            "creative/production/durable_runner.py",
            "scripts/check_provider_budget.py",
            "scripts/run_creative_production_durable.py",
            "scripts/run_creative_production_smoke.py",
            "content/carousel/planner.py",
            "content/carousel/contracts.py",
            "content/carousel/director.py",
            "content/carousel/renderer.py",
            "scripts/run_carousel_production.py",
        ],
        ["git", "diff", "--check"],
    ]
    if not args.quick:
        commands.insert(0, [py, "-m", "unittest", "discover", "tests", "-p", "test_creative_production*.py", "-v"])
    for command in commands:
        code = run(command)
        if code:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
