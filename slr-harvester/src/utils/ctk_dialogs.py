import customtkinter as ctk


def ask_text(parent, title: str, prompt: str, initial: str | None = None) -> str | None:
    """CTk text input dialog.
    Returns the entered text or None if cancelled.
    """
    dlg = ctk.CTkToplevel(parent)
    dlg.title(title)
    dlg.resizable(False, False)
    dlg.transient(parent)
    dlg.grab_set()

    frame = ctk.CTkFrame(dlg)
    frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
    frame.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(frame, text=title, font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
    ctk.CTkLabel(frame, text=prompt, font=ctk.CTkFont(size=12), justify="left", anchor="w", wraplength=480).grid(row=1, column=0, sticky="ew", pady=(8, 8))

    entry = ctk.CTkEntry(frame, width=380)
    entry.grid(row=2, column=0, sticky="ew")
    if initial:
        entry.insert(0, initial)

    result: dict[str, str | None] = {"val": None}

    def _ok():
        result["val"] = entry.get().strip()
        dlg.destroy()

    def _cancel():
        result["val"] = None
        dlg.destroy()

    btns = ctk.CTkFrame(frame, fg_color="transparent")
    btns.grid(row=3, column=0, sticky="e", pady=(10, 0))
    ctk.CTkButton(btns, text="Cancel", width=100, command=_cancel).pack(side="right")
    ctk.CTkButton(btns, text="OK", width=100, command=_ok).pack(side="right", padx=(0, 12))

    dlg.update_idletasks()
    w = dlg.winfo_reqwidth()
    h = dlg.winfo_reqheight()
    x = (dlg.winfo_screenwidth() - w) // 2
    y = (dlg.winfo_screenheight() - h) // 2
    dlg.geometry(f"+{x}+{y}")
    dlg.wait_window()
    return result["val"]


def pick_color(parent, title: str, initial: str | None = None, presets: list[str] | None = None) -> str | None:
    """CTk color picker dialog with presets + hex entry. Returns hex or None."""
    dlg = ctk.CTkToplevel(parent)
    dlg.title(title)
    dlg.resizable(False, False)
    dlg.transient(parent)
    dlg.grab_set()

    frame = ctk.CTkFrame(dlg)
    frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
    frame.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(frame, text=title, font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
    ctk.CTkLabel(frame, text="Pick a color or enter hex (e.g., #64A8FF)", font=ctk.CTkFont(size=12), text_color=("gray20","gray80")).grid(row=1, column=0, sticky="w", pady=(6, 8))

    # Presets grid
    grid = ctk.CTkFrame(frame, fg_color="transparent")
    grid.grid(row=2, column=0, sticky="w")
    cols = 8
    if presets is None:
        presets = [
            "#E57373","#F4A261","#F6D06F","#81C995","#7BD3D3","#64A8FF","#B494F7","#F79AC1",
            "#D38AD8","#B08A6A","#A5ACB8","#3C3C3C","#B7BF5E","#C7B8EA","#C05C5C","#7AA6D9",
            "#F59F8B","#DCB770","#6FB7B7","#7F8AD4","#8FA2D6",
        ]
    for i, hexcol in enumerate(presets):
        r = i // cols
        c = i % cols
        btn = ctk.CTkButton(grid, text="", width=28, height=22, fg_color=hexcol, hover_color=hexcol, command=lambda h=hexcol: _set_hex(h))
        btn.grid(row=r, column=c, padx=4, pady=4)

    # Hex entry + preview
    row = 3
    entry = ctk.CTkEntry(frame, width=180, placeholder_text="#64A8FF")
    entry.grid(row=row, column=0, sticky="w", pady=(10, 4))
    if initial:
        entry.insert(0, initial)

    preview = ctk.CTkLabel(frame, text="    ", width=40, height=22, corner_radius=6, fg_color=initial or "#cccccc")
    preview.place(relx=1.0, rely=0.0, x=-10, y=104, anchor="ne")

    def _set_hex(h: str):
        entry.delete(0, 'end')
        entry.insert(0, h)
        try:
            preview.configure(fg_color=h)
        except Exception:
            preview.configure(fg_color="#cccccc")

    result: dict[str, str | None] = {"val": None}

    def _ok():
        val = entry.get().strip()
        if val and val.startswith('#') and len(val) in (4, 7):
            result["val"] = val
        else:
            result["val"] = None
        dlg.destroy()

    def _cancel():
        result["val"] = None
        dlg.destroy()

    btns = ctk.CTkFrame(frame, fg_color="transparent")
    btns.grid(row=row+1, column=0, sticky="e", pady=(8, 0))
    ctk.CTkButton(btns, text="Cancel", width=100, command=_cancel).pack(side="right")
    ctk.CTkButton(btns, text="OK", width=100, command=_ok).pack(side="right", padx=(0, 12))

    dlg.update_idletasks()
    w = dlg.winfo_reqwidth()
    h = dlg.winfo_reqheight()
    x = (dlg.winfo_screenwidth() - w) // 2
    y = (dlg.winfo_screenheight() - h) // 2
    dlg.geometry(f"+{x}+{y}")
    dlg.wait_window()
    return result["val"]

