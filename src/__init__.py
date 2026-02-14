"""Main application entry point."""

import sys
from pathlib import Path

# Add src to path for imports
src_dir = Path(__file__).parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

# Bootstrap dependencies
from utils.config import ensure_local_config_exists

# Ensure config exists
ensure_local_config_exists()

# Import and run the application
from app import GreGUIApp

if __name__ == "__main__":
    app = GreGUIApp()
    app.mainloop()
