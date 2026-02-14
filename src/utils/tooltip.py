"""Tooltip widget for UI."""

import tkinter as tk


class ToolTip:
    """Simple hover tooltip for widgets."""
    
    def __init__(self, widget: tk.Widget, text: str, delay_ms: int = 300):
        self.widget = widget
        self.text = text
        self.delay_ms = max(0, int(delay_ms))
        self._after_id = None
        self._tip = None
        try:
            self.widget.bind('<Enter>', self._schedule)
            self.widget.bind('<Leave>', self._hide)
            self.widget.bind('<Motion>', self._move)
        except Exception:
            pass

    def _schedule(self, _e=None):
        self._cancel()
        try:
            self._after_id = self.widget.after(self.delay_ms, self._show)
        except Exception:
            pass

    def _cancel(self):
        if self._after_id is not None:
            try:
                self.widget.after_cancel(self._after_id)
            except Exception:
                pass
            self._after_id = None

    def _show(self):
        self._cancel()
        if self._tip is not None:
            return
        try:
            x = self.widget.winfo_pointerx() + 12
            y = self.widget.winfo_pointery() + 12
        except Exception:
            x, y = 0, 0
        try:
            tip = tk.Toplevel(self.widget)
            tip.wm_overrideredirect(True)
            tip.wm_geometry(f"+{x}+{y}")
            
            # Check CustomTkinter appearance mode for dark mode support
            try:
                import customtkinter as ctk
                is_dark = ctk.get_appearance_mode() == 'Dark'
            except Exception:
                # Fallback to widget background color detection
                def _is_dark(c: str) -> bool:
                    try:
                        r, g, b = self.widget.winfo_rgb(c)
                        r8, g8, b8 = r/257.0, g/257.0, b/257.0
                        # Simple luminance check (0..255)
                        lum = 0.2126*r8 + 0.7152*g8 + 0.0722*b8
                        return lum < 128
                    except Exception:
                        return False
                try:
                    base_bg = self.widget.cget('background')
                except Exception:
                    base_bg = ''
                is_dark = _is_dark(base_bg)
            
            # Dark mode colors
            if is_dark:
                tip_bg = '#2b2b2b'
                tip_fg = '#ffffff'
                border_col = '#5a5a5a'
            else:
                tip_bg = '#ffffe0'
                tip_fg = '#000000'
                border_col = '#a0a0a0'
            
            lbl = tk.Label(tip, text=self.text, background=tip_bg, foreground=tip_fg,
                           borderwidth=1, relief='solid', padx=6, pady=2)
            try:
                lbl.configure(highlightthickness=1, highlightbackground=border_col)
            except Exception:
                pass
            lbl.pack()
            self._tip = tip
        except Exception:
            self._tip = None

    def _move(self, _e=None):
        # Reposition tooltip near the cursor when moving
        if self._tip is None:
            return
        try:
            x = self.widget.winfo_pointerx() + 12
            y = self.widget.winfo_pointery() + 12
            self._tip.wm_geometry(f"+{x}+{y}")
        except Exception:
            pass

    def _hide(self, _e=None):
        self._cancel()
        if self._tip is not None:
            try:
                self._tip.destroy()
            except Exception:
                pass
            self._tip = None
