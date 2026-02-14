"""
Launcher for the SLR Harvester Dashboard
"""

import sys
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_DIR = (ROOT / "src").resolve()

# Ensure repo root and src directory are importable regardless of current working directory
for path in (SRC_DIR, ROOT):
    if path.exists():
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)

def load_dashboard_main():
    """
    Import ui.dashboard.main with a fallback loader that uses an explicit file path.
    This avoids failures when sys.path resolution is altered by the calling shell.
    """
    # In a frozen executable, rely on bundled imports only
    if getattr(sys, "frozen", False):  # type: ignore[attr-defined]
        from ui.dashboard import main  # type: ignore
        return main
    # When running from source, try normal import, then path-based fallback
    try:
        from ui.dashboard import main  # type: ignore
        return main
    except ModuleNotFoundError:
        module_path = SRC_DIR / "ui" / "dashboard.py"
        if not module_path.exists():
            raise
        spec = importlib.util.spec_from_file_location("ui.dashboard", module_path)
        if spec is None or spec.loader is None:
            raise
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore
        return module.main  # type: ignore

main = load_dashboard_main()

if __name__ == "__main__":
    print("Starting SLR Harvester Dashboard...")
    main()
