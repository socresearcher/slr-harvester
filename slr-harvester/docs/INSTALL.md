# Installation and Setup

This guide covers running the desktop version from source. It is no longer developed further; see the notice in the main README.

## Requirements

- Python 3.10+
- Internet access for Scopus API calls
- Valid Scopus API key (and InstToken for institutional access, if available)

## Run With Python (from source)

Run these commands inside the `slr-harvester/` folder:

1. Create a virtual environment and install the dependencies:
   - `python -m venv .venv`
   - Windows: `.venv\Scripts\pip install -r requirements.txt`
   - macOS/Linux: `.venv/bin/pip install -r requirements.txt`
2. Start the app:
   - Windows: `.venv\Scripts\python slr-harvester_dashboard.py`
   - macOS/Linux: `.venv/bin/python slr-harvester_dashboard.py`
3. Optional install via packaging metadata:
   - `pip install .` (uses `pyproject.toml`)
   - For editable/dev installs: `pip install -e .`

There are no build scripts and no prebuilt executable.

## Configuration & Data Location

- `slr_config.json` and `slr_gui_settings.json`: created next to `slr-harvester_dashboard.py` on first run.
- `projects/`: all project data (created locally, not uploaded).
- `projects.json`: overview index for projects.

Do not commit API keys or share config files publicly.
