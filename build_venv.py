#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


def find_python() -> Path | None:
    for candidate in ("python.exe", "py.exe", "python", "py"):
        located = shutil.which(candidate)
        if located:
            return Path(located)
    return None


def run(cmd: list[str], **kwargs) -> None:
    subprocess.run(cmd, check=True, cwd=ROOT, **kwargs)


def main() -> int:
    python = find_python()
    if not python:
        print("[venv] No Python launcher found in PATH. Please install Python 3.9+.")
        return 1

    print(f"[venv] Using Python: {python}")

    if not VENV_PYTHON.exists():
        print("[venv] Creating .venv ...")
        run([str(python), "-m", "venv", ".venv"])

    run([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"])

    requirements = ROOT / "requirements.txt"
    if requirements.exists():
        print("[venv] Installing requirements...")
        run([str(VENV_PYTHON), "-m", "pip", "install", "-r", str(requirements)])
    else:
        print("[venv] requirements.txt not found. Skipping.")

    print("[venv] Ready.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"[venv] Command failed with exit code {exc.returncode}")
        raise SystemExit(exc.returncode)
