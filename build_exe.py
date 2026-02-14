#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


def run(cmd: list[str], quiet: bool = False) -> None:
    kwargs: dict[str, object] = {"cwd": ROOT}
    if quiet:
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    subprocess.run(cmd, check=True, **kwargs)


def ensure_venv() -> None:
    if VENV_PYTHON.exists():
        return
    print("[build] Preparing virtual environment ...")
    run([sys.executable, str(ROOT / "build_venv.py")])


def ensure_pyinstaller() -> None:
    try:
        run([str(VENV_PYTHON), "-c", "import PyInstaller"], quiet=True)
    except subprocess.CalledProcessError:
        print("[build] Installing PyInstaller...")
        run([str(VENV_PYTHON), "-m", "pip", "install", "pyinstaller"])


def clean_artifacts() -> None:
    for folder in ("build", "dist"):
        path = ROOT / folder
        if path.exists():
            print(f"[build] Removing {folder} ...")
            shutil.rmtree(path)


def collect_data_args() -> list[str]:
    data_args: list[str] = []
    # Icons live under src/assets/icons
    icon_path = ROOT / "src" / "assets" / "icons" / "app.ico"
    if icon_path.exists():
        data_args.extend(["--icon", str(icon_path)])

    mappings = [
        # bundle all icon assets
        (ROOT / "src" / "assets" / "icons", "src/assets/icons"),
        (ROOT / "slr_config.json", "."),
        (ROOT / "slr_gui_settings.json", "."),
        (ROOT / "projects.json", "."),
    ]
    for src, dest in mappings:
        if src.exists():
            data_args.extend(["--add-data", f"{src};{dest}"])
    return data_args


def build() -> None:
    ensure_venv()
    ensure_pyinstaller()
    clean_artifacts()

    name = "slr-harvester_dashboard"
    entry = ROOT / "slr-harvester_dashboard.py"

    cmd = [
        str(VENV_PYTHON),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--onefile",
        "--name",
        name,
        # ensure our src package root is importable
        "--paths",
        str(ROOT / "src"),
        "--hidden-import",
        "customtkinter",
        "--hidden-import",
        "matplotlib.backends.backend_tkagg",
        "--hidden-import",
        "PIL",
        # stdlib/module resources sometimes missed via matplotlib import chain when frozen
        "--hidden-import", "unicodedata",
        # ensure kiwisolver C-extension and submodules are bundled for matplotlib
        "--hidden-import", "kiwisolver",
        "--hidden-import", "kiwisolver._cext",
        "--collect-all", "kiwisolver",
        # include matplotlib data (fonts, etc.) to avoid runtime import issues
        "--collect-data", "matplotlib",
        # explicitly include our internal modules so PyInstaller doesn't miss them
        "--hidden-import", "ui.dashboard",
        "--hidden-import", "ui.history_view",
        "--hidden-import", "ui.search_view",
        "--hidden-import", "ui.project_view",
        "--hidden-import", "ui.corpus_view",
        "--hidden-import", "models.models",
        "--hidden-import", "utils.ui_helpers",
        "--hidden-import", "utils.ctk_dialogs",
        "--hidden-import", "utils.tooltip",
        "--hidden-import", "utils.mb_shim",
        "--hidden-import", "api.client",
    ]
    cmd.extend(collect_data_args())
    cmd.append(str(entry))

    print(f"[build] Building {name} ...")
    run(cmd)
    print(f"[build] Build finished. Output in dist\\{name}")


def main() -> int:
    try:
        build()
    except subprocess.CalledProcessError as exc:
        print(f"[build] Command failed with exit code {exc.returncode}")
        return exc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
