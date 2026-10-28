"""Configuration management for SLR Harvester."""

import os
import json
import configparser
import sys
from typing import Tuple


class CaseSensitiveConfigParser(configparser.ConfigParser):
    """ConfigParser that preserves option case."""
    
    def optionxform(self, optionstr: str) -> str:
        return optionstr


def _ensure_requirements_file():
    """Ensure requirements.txt exists in the project directory."""
    try:
        req_path = os.path.join(os.path.abspath(os.getcwd()), "requirements.txt")
        if not os.path.exists(req_path):
            contents = (
                "# Runtime dependencies for SLR GUI\n"
                "# tkinter ships with Python (Windows/macOS); no pip package needed.\n"
                "requests>=2.0.0\n"
                "pandas>=2.0.0,<3.0.0\n"
                "plotly>=5.0.0,<6.0.0\n"
                "Pillow>=10.0.0,<11.0.0\n"
            )
            with open(req_path, "w", encoding="utf-8") as f:
                f.write(contents)
    except Exception:
        pass


def bootstrap_dependencies():
    """Check and install required dependencies.
    
    Returns:
        Status message string
    """
    _ensure_requirements_file()
    required = [("requests", "requests")]
    optional = [
        ("pandas", "pandas"),
        ("plotly.express", "plotly"),
        ("PIL", "Pillow"),
    ]
    missing = []
    
    def _try_import(mod: str) -> bool:
        try:
            __import__(mod)
            return True
        except Exception:
            return False
    
    for mod, _pkg in required + optional:
        if not _try_import(mod):
            missing.append(mod)
    
    if not missing:
        status = "Dependencies OK"
        print("[SLR] Dependency check: OK")
        return status
    
    print("[SLR] Missing packages detected:", ", ".join(missing))
    print("[SLR] Attempting: python -m pip install -r requirements.txt")
    req_path = os.path.join(os.path.abspath(os.getcwd()), "requirements.txt")
    
    try:
        cmd = [sys.executable, "-m", "pip", "install", "-r", req_path]
        __import__("subprocess").run(cmd, check=False)
    except Exception as e:
        print("[SLR] Auto-install failed:", e)
    
    still = []
    for mod, _pkg in required + optional:
        if not _try_import(mod):
            still.append(mod)
    
    if still:
        status = (
            "Missing after auto-install: " + ", ".join(still) +
            " | Run manually: pip install -r requirements.txt"
        )
        print("[SLR] " + status)
        return status
    
    status = "Dependencies installed"
    print("[SLR] Dependencies installed successfully.")
    return status


def get_app_root_dir() -> str:
    """Return the application root directory.

    - Frozen (PyInstaller): directory of the executable
    - Dev: repository root (two parents up from src)
    - Fallback: current working directory
    """
    try:
        if getattr(sys, "frozen", False):
            return os.path.dirname(sys.executable)
        from pathlib import Path
        return str(Path(__file__).resolve().parents[2])
    except Exception:
        return os.path.abspath(os.getcwd())


def get_active_config_path() -> str:
    """Return the path to ``slr_config.json`` in the app root."""
    base_dir = get_app_root_dir()
    return os.path.join(base_dir, "slr_config.json")


def write_default_config(
    api_key: str = "", 
    inst_token: str = "", 
    view: str = "STANDARD", 
    *, 
    path: str | None = None
) -> None:
    """Write a simple local JSON config with API key and InstToken."""
    cfg_path = path or get_active_config_path()
    data = {
        "APIKey": api_key or "", 
        "InstToken": inst_token or "", 
        "View": view or "STANDARD"
    }
    try:
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def load_existing_config() -> Tuple[str, str, str]:
    """Load local JSON config with APIKey/InstToken/View.
    
    Returns:
        Tuple of (api_key, inst_token, view)
    """
    api_key = ""
    inst_token = ""
    view = "STANDARD"
    cfg_path = get_active_config_path()
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    api_key = str(data.get("APIKey", "") or "")
                    inst_token = str(data.get("InstToken", "") or "")
                    view = str(data.get("View", view) or view)
        except Exception:
            pass
    return api_key, inst_token, view


def ensure_local_config_exists() -> str:
    """Ensure a local JSON config exists in the app folder.
    
    Returns:
        Path to the config file
    """
    cfg_path = get_active_config_path()
    if not os.path.exists(cfg_path):
        write_default_config(path=cfg_path)
    return cfg_path


def ensure_dirs(config_dir: str, results_dir: str) -> None:
    """Ensure required directories exist."""
    for d in [config_dir, results_dir]:
        os.makedirs(d, exist_ok=True)


def has_valid_api_key() -> bool:
    """Check if a valid API key is configured."""
    api_key, _, _ = load_existing_config()
    return bool(api_key and api_key.strip())
