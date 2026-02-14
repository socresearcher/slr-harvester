"""UI helper functions."""

from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk


def get_assets_icons_dir() -> Path:
    """Return the absolute path to the icons assets folder.

    - When running as a PyInstaller one-file EXE, data files are extracted
      under ``sys._MEIPASS``. We place icons at ``src/assets/icons`` there.
    - When running from source, resolve the repo root relative to this file
      and point to ``src/assets/icons``.
    """
    try:
        base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    except Exception:
        base = Path(__file__).resolve().parents[2]
    return base / "src" / "assets" / "icons"


def bind_tree_fit_right_edge(tree: ttk.Treeview, right_col: str) -> None:
    """Keep the right_col's right edge flush with the Treeview's right edge.
    
    Accounts for vertical scrollbar and widget chrome so no gap appears.
    
    Args:
        tree: The Treeview widget to configure
        right_col: The column name that should be stretched to the right edge
    """
    try:
        def _fit(_e=None):
            try:
                cols = list(tree.cget('columns') or tree['columns'])
                if right_col not in cols:
                    return
                total = max(int(tree.winfo_width() or 0), 100)
                # Estimate gutter for vertical scrollbar
                try:
                    y0, y1 = tree.yview()
                    gutter = 16 if (y1 - y0) < 1.0 else 0
                except Exception:
                    gutter = 16
                # Border/highlight chrome
                try:
                    bw = int(tree.cget('borderwidth') or 0)
                except Exception:
                    bw = 0
                try:
                    ht = int(tree.cget('highlightthickness') or 0)
                except Exception:
                    ht = 0
                chrome = (bw + ht) * 2
                other = 0
                for c in cols:
                    if c == right_col:
                        continue
                    try:
                        other += int(tree.column(c, 'width') or 0)
                    except Exception:
                        pass
                rem = max(40, total - other)
                tree.column(right_col, width=int(rem), stretch=True, minwidth=40)
            except Exception:
                pass
        tree.bind('<Configure>', _fit, add='+')
        tree.bind('<ButtonRelease-1>', _fit, add='+')
        tree.after(0, _fit)
    except Exception:
        pass
