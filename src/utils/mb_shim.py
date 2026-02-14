import customtkinter as ctk
import tkinter as tk


class _CTKMessageBox:
    def __init__(self, master=None):
        self.master = master

    def _dialog(self, title: str, message: str, buttons: tuple[str, ...] = ("OK",), default: int = 0):
        parent = self.master
        if parent is None:
            # Try to use current default Tk root (the running CTk app)
            try:
                parent = tk._get_default_root()
            except Exception:
                parent = None
        if parent is None:
            # Fallback: create a transient hidden CTk root
            parent = ctk.CTk()
            parent.withdraw()

        dlg = ctk.CTkToplevel(parent)
        dlg.title(title)
        dlg.resizable(False, False)
        dlg.transient(parent)
        dlg.grab_set()

        frame = ctk.CTkFrame(dlg)
        frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(frame, text=title, font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
        # Wrap the message based on screen width for compact sizing
        try:
            screen_w = dlg.winfo_screenwidth()
            wrap_len = int(min(max(360, screen_w * 0.4), 720))
        except Exception:
            wrap_len = 480
        ctk.CTkLabel(
            frame,
            text=message,
            font=ctk.CTkFont(size=12),
            justify="left",
            anchor="w",
            wraplength=wrap_len,
        ).grid(row=1, column=0, sticky="w", pady=(8, 12))

        result = {"index": default}

        def _set(idx: int):
            result["index"] = idx
            dlg.destroy()

        # Button row centered with consistent spacing
        btns = ctk.CTkFrame(frame, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="ew")
        btns.grid_columnconfigure(0, weight=1)
        btns.grid_columnconfigure(2, weight=1)
        center = ctk.CTkFrame(btns, fg_color="transparent")
        center.grid(row=0, column=1)
        gap = 12
        for i, label in enumerate(buttons):
            idx = i
            kwargs = {}
            if idx == default and len(buttons) > 1:
                kwargs = {"fg_color": "green", "hover_color": "darkgreen"}
            ctk.CTkButton(
                center,
                text=label,
                width=100,
                command=lambda j=idx: _set(j),
                **kwargs
            ).pack(side="left", padx=(0, gap) if i < len(buttons)-1 else 0)

        # Size to content (let Tk compute natural size) and center on the display
        dlg.update_idletasks()
        sw = dlg.winfo_screenwidth()
        sh = dlg.winfo_screenheight()
        # Use requested size to avoid platform decoration rounding issues
        w = dlg.winfo_reqwidth()
        h = dlg.winfo_reqheight()
        x = max(0, (sw - w) // 2)
        y = max(0, (sh - h) // 2)
        dlg.geometry(f"+{x}+{y}")
        dlg.wait_window()
        return result["index"]

    # Public API mirroring tkinter.messagebox
    def showinfo(self, title: str, message: str, **kwargs):
        # kwargs accepted for compatibility (icon, parent, etc.)
        self._dialog(title, message, ("OK",), 0)

    def showwarning(self, title: str, message: str, **kwargs):
        self._dialog(title, message, ("OK",), 0)

    def showerror(self, title: str, message: str, **kwargs):
        self._dialog(title, message, ("OK",), 0)

    def askyesno(self, title: str, message: str, **kwargs) -> bool:
        # kwargs accepted for compatibility (icon, parent, etc.)
        idx = self._dialog(title, message, ("No", "Yes"), default=1)
        return idx == 1


# Export an instance mimicking tkinter.messagebox usage
messagebox = _CTKMessageBox()
