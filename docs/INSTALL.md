# Installation and Setup

This guide covers running from source and building the Windows EXE.

## Requirements

- Python 3.10+
- Internet access for Scopus API calls
- Valid Scopus API key (and InstToken for institutional access, if available)

## Option A: Run With Python (from source)

1. Install Python 3.10+.
2. Easiest launcher (auto‑prepares venv and runs the app):
   - Windows: `slr-harvester_dashboard.cmd`
3. Or prepare the virtual environment explicitly, then run:
   - Prepare venv (choose one): `build_venv.cmd` | `build_venv.bat` | `python build_venv.py`
   - Run app: `.venv\\Scripts\\python.exe slr-harvester_dashboard.py`
4. Optional install via packaging metadata:
   - `pip install .` (uses `pyproject.toml`)
   - For editable/dev installs: `pip install -e .`

## Option B: Build and Run Windows EXE

Since the EXE is not bundled, build it locally first, then run it from `dist/`.

1. Recommended (optional): prepare the virtual environment first
   - `build_venv.cmd` | `build_venv.bat` | `python build_venv.py`
   - Note: The EXE builder auto‑creates `.venv` if missing and installs PyInstaller.
2. Build the EXE using one of:
   - `build_exe.cmd` (recommended on Windows)
   - `build_exe.bat`
   - `python build_exe.py`
   - Output: `dist\\slr-harvester_dashboard.exe`
3. Run the app:
   - `dist\\slr-harvester_dashboard.exe`

### PyInstaller Reference (manual)

If you need to regenerate an EXE manually, a typical one‑file build is:

```
pyinstaller --noconfirm --onefile --windowed --name slr-harvester_dashboard slr-harvester_dashboard.py
```

Note: The project’s `build_exe.py` includes icons and data via `--add-data` when present.

## Configuration & Data Location

- `slr_config.json` and `slr_gui_settings.json`: created in repo root on first run.
- `projects/`: all project data (created locally, not uploaded).
- `projects.json`: overview index for projects.

Do not commit API keys or share config files publicly.

