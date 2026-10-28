"""
Project View for SLR Harvester Dashboard
Manage different research projects with separate histories and tags
"""

import sys
from pathlib import Path

# Add src directory to path for imports (when run directly)
src_dir = Path(__file__).parent.parent
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import customtkinter as ctk
import json
from typing import List, Dict, Optional, Callable
from utils.mb_shim import messagebox


class ProjectView(ctk.CTkFrame):
    """
    Project View with:
    - Project list
    - Current project indicator
    - Add/Delete/Switch project functionality
    """
    
    def __init__(self, parent, workspace_path: str, on_project_switch: Optional[Callable] = None):
        super().__init__(parent, corner_radius=0, fg_color="transparent")
        
        self.workspace_path = Path(workspace_path)
        self.projects_file = self.workspace_path / "projects.json"
        self.on_project_switch = on_project_switch
        
        # Data
        self.projects: List[Dict] = []
        self.current_project: Optional[str] = None
        
        # Load or initialize projects
        self._load_or_initialize_projects()
        
        # Setup UI
        self._setup_ui()
    
    def _load_or_initialize_projects(self):
        """Load projects from disk; do not create defaults"""
        try:
            if self.projects_file.exists():
                with open(self.projects_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.projects = data.get("projects", [])
                    self.current_project = data.get("current_project", None)
            else:
                # No projects file present: start with an empty list and no current project
                self.projects = []
                self.current_project = None
        except Exception as e:
            print(f"Error loading projects: {e}")
            # On error, do not assume a default project
            self.projects = []
            self.current_project = None
    
    def _save_projects(self):
        """Save projects to file"""
        try:
            data = {
                "projects": self.projects,
                "current_project": self.current_project
            }
            with open(self.projects_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving projects: {e}")
    
    def _setup_ui(self):
        """Setup the main UI layout"""
        # Configure grid
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)
        
        # Main container
        main_frame = ctk.CTkFrame(self, corner_radius=15)
        main_frame.grid(row=0, column=0, sticky="nsew", padx=30, pady=30)
        main_frame.grid_rowconfigure(3, weight=1)
        main_frame.grid_columnconfigure(0, weight=1)
        
        # Header
        header = ctk.CTkLabel(
            main_frame,
            text="Project Management",
            font=ctk.CTkFont(size=28, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, padx=30, pady=(30, 10), sticky="w")
        
        # Current project indicator
        current_project_frame = ctk.CTkFrame(main_frame, fg_color=("gray85", "gray25"), corner_radius=10)
        current_project_frame.grid(row=1, column=0, padx=30, pady=(10, 20), sticky="ew")
        
        self.current_label = ctk.CTkLabel(
            current_project_frame,
            text=f"Current Project: {self.current_project}",
            font=ctk.CTkFont(size=16, weight="bold"),
            anchor="w"
        )
        self.current_label.pack(padx=20, pady=15, anchor="w")
        
        # Description
        desc = ctk.CTkLabel(
            main_frame,
            text="Manage your research projects. Each project has its own search history, tags, annotations and corpus.",
            font=ctk.CTkFont(size=12),
            text_color="gray",
            anchor="w"
        )
        desc.grid(row=2, column=0, padx=30, pady=(0, 20), sticky="w")
        
        # Projects list
        projects_container = ctk.CTkScrollableFrame(
            main_frame,
            fg_color="transparent"
        )
        projects_container.grid(row=3, column=0, padx=30, pady=(0, 20), sticky="nsew")
        projects_container.grid_columnconfigure(0, weight=1)
        
        self.projects_container = projects_container
        self._populate_projects_list()
        
        # Action buttons
        actions_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        actions_frame.grid(row=4, column=0, padx=30, pady=(0, 30), sticky="ew")
        
        ctk.CTkButton(
            actions_frame,
            text="+ New Project",
            width=150,
            height=40,
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._add_project
        ).pack(side="left", padx=(0, 10))
    
    def _populate_projects_list(self):
        """Populate the projects list"""
        # If container got destroyed due to a parent refresh, bail out gracefully
        try:
            if not hasattr(self, "projects_container") or not self.projects_container.winfo_exists():
                return
        except Exception:
            return

        # Clear existing
        for widget in self.projects_container.winfo_children():
            widget.destroy()
        
        for idx, project in enumerate(self.projects):
            project_name = project.get("name", "Unnamed Project")
            is_current = project_name == self.current_project
            workspace_folder = project.get("workspace_folder", "")
            
            # Stats per project
            query_count = self._get_query_count(workspace_folder)
            unique_articles = self._get_unique_article_count(workspace_folder)
            custom_tag_count = self._get_custom_tag_count(workspace_folder)
            selected_count, corpus_count = self._get_selection_counts(workspace_folder)
            
            # Project card with rounded corners and border (compact)
            default_bg = ("gray90", "gray20")
            card = ctk.CTkFrame(
                self.projects_container,
                corner_radius=10,
                border_width=2 if is_current else 0,
                border_color="green" if is_current else ("gray60", "gray40"),
                fg_color=default_bg
            )
            card.grid(row=idx, column=0, padx=5, pady=4, sticky="ew")
            card.grid_columnconfigure(0, weight=1)
            
            # Project info
            info_frame = ctk.CTkFrame(card, fg_color="transparent")
            info_frame.grid(row=0, column=0, sticky="ew", padx=12, pady=10)
            info_frame.grid_columnconfigure(0, weight=1)
            
            # Project name
            name_text = f"{project_name}"
            name_label = ctk.CTkLabel(
                info_frame,
                text=name_text,
                font=ctk.CTkFont(size=16, weight="bold"),
                anchor="w"
            )
            name_label.grid(row=0, column=0, sticky="w")
            
            # Project description
            description = project.get("description", "No description")
            desc_label = ctk.CTkLabel(
                info_frame,
                text=description,
                font=ctk.CTkFont(size=12),
                text_color=("gray50", "gray60"),
                anchor="w"
            )
            desc_label.grid(row=1, column=0, sticky="w", pady=(4, 0))
            
            # Statistics row: single compact line with middle dot separator
            stats_frame = ctk.CTkFrame(info_frame, fg_color="transparent")
            stats_frame.grid(row=2, column=0, sticky="w", pady=(6, 0))

            created = project.get("created", "Unknown")
            # Single compact stats line (no extra spacing around separators)
            stats_text = (
                f"Created: {created} • "
                f"{query_count} queries in history • "
                f"{unique_articles} unique articles • "
                f"{custom_tag_count} customized tags"
            )
            stats_label = ctk.CTkLabel(
                stats_frame,
                text=stats_text,
                font=ctk.CTkFont(size=12),
                text_color=("gray50", "gray60"),
                anchor="w"
            )
            stats_label.pack(side="left")

            # Selection/Corpus line
            selection_frame = ctk.CTkFrame(info_frame, fg_color="transparent")
            selection_frame.grid(row=3, column=0, sticky="w", pady=(4, 0))
            selection_label = ctk.CTkLabel(
                selection_frame,
                text=f"Selected: {selected_count} • Corpus: {corpus_count}",
                font=ctk.CTkFont(size=12),
                text_color=("gray50", "gray60"),
                anchor="w"
            )
            selection_label.pack(side="left")

            # Click/hover behaviour to match other cards
            def switch_if_allowed(e=None, pname=project_name, current=is_current):
                if not current:
                    self._switch_project(pname)

            def open_edit(e=None, pname=project_name):
                self._edit_project(pname)

            def on_enter(e=None, c=card, current=is_current):
                if not current:
                    c.configure(fg_color=("gray75", "gray30"))

            def on_leave(e=None, c=card, current=is_current):
                if not current:
                    c.configure(fg_color=default_bg)

            for widget in (card, info_frame, name_label, desc_label, stats_label):
                widget.bind("<Enter>", on_enter)
                widget.bind("<Leave>", on_leave)
                widget.bind("<Button-1>", switch_if_allowed)
                widget.bind("<Button-3>", open_edit)
            
            # Actions
            actions_frame = ctk.CTkFrame(card, fg_color="transparent")
            actions_frame.grid(row=0, column=1, padx=12, pady=10, sticky="ns")
            # Stack buttons vertically and center them with top/bottom spacers
            actions_frame.grid_columnconfigure(0, weight=1)
            actions_frame.grid_rowconfigure(0, weight=1)  # top spacer
            actions_frame.grid_rowconfigure(4, weight=1)  # bottom spacer
            
            # Edit button (always available)
            edit_btn = ctk.CTkButton(
                actions_frame,
                text="Edit",
                width=90,
                height=30,
                font=ctk.CTkFont(size=12),
                fg_color="gray",
                hover_color="gray30",
                command=lambda p=project_name: self._edit_project(p)
            )
            # Edit should be the middle button (always present)
            # Use symmetric spacing: create consistent gaps only on bottoms
            edit_btn.grid(row=2, column=0, padx=0, pady=(0, 8), sticky="ew")
            
            if not is_current:
                switch_btn = ctk.CTkButton(
                    actions_frame,
                    text="Switch",
                    width=90,
                    height=30,
                    font=ctk.CTkFont(size=12),
                    command=lambda p=project_name: self._switch_project(p)
                )
                # Place Switch above Edit, same gap rule
                switch_btn.grid(row=1, column=0, padx=0, pady=(0, 8), sticky="ew")

            # Don't allow deletion of current project if it's the only one
            can_delete = len(self.projects) > 1 and not is_current
            if can_delete:
                delete_btn = ctk.CTkButton(
                    actions_frame,
                    text="Delete",
                    width=90,
                    height=30,
                    font=ctk.CTkFont(size=12),
                    fg_color="red",
                    hover_color="darkred",
                    command=lambda p=project_name: self._delete_project(p)
                )
                # If there is a switch button, place delete next to it; otherwise next to edit
                # Place Delete below Edit; no extra bottom padding (bottom spacer handles tail space)
                delete_btn.grid(row=3, column=0, padx=0, pady=(0, 0), sticky="ew")
    
    def _get_query_count(self, workspace_folder: str) -> int:
        """Get the number of queries in the project's search history"""
        try:
            if not workspace_folder:
                return 0
            
            search_log_path = self.workspace_path / "projects" / workspace_folder / "search_log.json"
            if not search_log_path.exists():
                return 0
            
            with open(search_log_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return len(data)
                return 0
        except Exception as e:
            print(f"Error counting queries for {workspace_folder}: {e}")
            return 0

    def _get_unique_article_count(self, workspace_folder: str) -> int:
        """Count unique articles (by EID) across the project's search_log.json"""
        try:
            if not workspace_folder:
                return 0
            search_log_path = self.workspace_path / "projects" / workspace_folder / "search_log.json"
            if not search_log_path.exists():
                return 0
            with open(search_log_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            entries = data if isinstance(data, list) else data.get("queries", [])
            eids = set()
            for entry in entries:
                for a in entry.get("results", []):
                    eid = (a.get("eid") or a.get("dc:identifier") or "").strip()
                    if eid:
                        eids.add(eid)
            return len(eids)
        except Exception:
            return 0

    def _get_custom_tag_count(self, workspace_folder: str) -> int:
        """Estimate number of customized tags for the project.

        Counts distinct non-"None" tag color keys used in slr_global_tags.json (if present).
        """
        try:
            if not workspace_folder:
                return 0
            tags_path = self.workspace_path / "projects" / workspace_folder / "slr_global_tags.json"
            if not tags_path.exists():
                return 0
            with open(tags_path, "r", encoding="utf-8") as f:
                tg = json.load(f)
            tag_keys = set()
            if isinstance(tg, dict):
                for _eid, info in tg.items():
                    key = (info or {}).get("color")
                    if key and key != "None":
                        tag_keys.add(key)
            elif isinstance(tg, list):
                for info in tg:
                    key = (info or {}).get("color")
                    if key and key != "None":
                        tag_keys.add(key)
            return len(tag_keys)
        except Exception:
            return 0

    def _get_selection_counts(self, workspace_folder: str) -> tuple[int, int]:
        """Return (selected_count, corpus_count) from slr_global_tags.json if available."""
        try:
            if not workspace_folder:
                return (0, 0)
            tags_path = self.workspace_path / "projects" / workspace_folder / "slr_global_tags.json"
            if not tags_path.exists():
                return (0, 0)
            with open(tags_path, "r", encoding="utf-8") as f:
                tg = json.load(f)
            selected = 0
            corpus = 0
            if isinstance(tg, dict):
                for _eid, info in tg.items():
                    if (info or {}).get("selected"):
                        selected += 1
                    if (info or {}).get("corpus"):
                        corpus += 1
            elif isinstance(tg, list):
                for info in tg:
                    if (info or {}).get("selected"):
                        selected += 1
                    if (info or {}).get("corpus"):
                        corpus += 1
            return (selected, corpus)
        except Exception:
            return (0, 0)
    
    def _add_project(self):
        """Add a new project"""
        # Create dialog
        dialog = ctk.CTkToplevel(self)
        dialog.title("New Project")
        dialog.geometry("500x350")
        dialog.transient(self)
        dialog.grab_set()
        
        # Center dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - (dialog.winfo_width() // 2)
        y = (dialog.winfo_screenheight() // 2) - (dialog.winfo_height() // 2)
        dialog.geometry(f"+{x}+{y}")
        
        # Content
        ctk.CTkLabel(
            dialog,
            text="Create New Project",
            font=ctk.CTkFont(size=18, weight="bold")
        ).pack(padx=20, pady=(20, 10))
        
        # Name
        ctk.CTkLabel(
            dialog,
            text="Project Name:",
            font=ctk.CTkFont(size=12)
        ).pack(padx=20, pady=(10, 5), anchor="w")
        
        name_entry = ctk.CTkEntry(
            dialog,
            placeholder_text="e.g., Master's Thesis",
            height=35
        )
        name_entry.pack(padx=20, pady=(0, 10), fill="x")
        
        # Description
        ctk.CTkLabel(
            dialog,
            text="Description (optional):",
            font=ctk.CTkFont(size=12)
        ).pack(padx=20, pady=(10, 5), anchor="w")
        
        desc_entry = ctk.CTkTextbox(
            dialog,
            height=80
        )
        desc_entry.pack(padx=20, pady=(0, 20), fill="x")
        
        def create():
            name = name_entry.get().strip()
            if not name:
                messagebox.showwarning("Invalid Input", "Please enter a project name.")
                return
            
            # Check if name already exists
            if any(p.get("name") == name for p in self.projects):
                messagebox.showwarning("Duplicate Name", "A project with this name already exists.")
                return
            
            description = desc_entry.get("1.0", "end-1c").strip()
            
            from datetime import datetime
            # Generate a DTG-based workspace folder (stable even if name changes)
            folder_base = datetime.now().strftime("%Y%m%d_%H%M%S")
            folder = folder_base
            # Ensure uniqueness if created within the same second
            i = 1
            projects_root = self.workspace_path / "projects"
            while (projects_root / folder).exists():
                folder = f"{folder_base}_{i}"
                i += 1

            new_project = {
                "name": name,
                "description": description or "No description",
                "created": datetime.now().strftime("%Y-%m-%d"),
                "workspace_folder": folder
            }
            
            self.projects.append(new_project)
            # Make newly created project the current one
            self.current_project = name
            self._save_projects()

            # Ensure project folder exists
            try:
                project_dir = self.workspace_path / "projects" / new_project["workspace_folder"]
                project_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

            # Refresh UI and notify dashboard
            self._populate_projects_list()
            dialog.destroy()
            try:
                if self.on_project_switch:
                    self.on_project_switch()
            except Exception:
                pass
        
        # Buttons
        btn_frame = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_frame.pack(padx=20, pady=(0, 20), fill="x")
        
        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            width=100,
            command=dialog.destroy,
            fg_color="gray",
            hover_color="gray30"
        ).pack(side="right", padx=(10, 0))
        
        ctk.CTkButton(
            btn_frame,
            text="Create",
            width=100,
            command=create
        ).pack(side="right")
    
    def _edit_project(self, project_name: str):
        """Edit an existing project"""
        # Find the project
        project = None
        for p in self.projects:
            if p.get("name") == project_name:
                project = p
                break
        
        if not project:
            messagebox.showerror("Error", "Project not found.")
            return
        
        # Create dialog
        dialog = ctk.CTkToplevel(self)
        dialog.title("Edit Project")
        dialog.geometry("500x350")
        dialog.transient(self)
        dialog.grab_set()
        
        # Center dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - (dialog.winfo_width() // 2)
        y = (dialog.winfo_screenheight() // 2) - (dialog.winfo_height() // 2)
        dialog.geometry(f"+{x}+{y}")
        
        # Content
        ctk.CTkLabel(
            dialog,
            text="Edit Project",
            font=ctk.CTkFont(size=18, weight="bold")
        ).pack(padx=20, pady=(20, 10))
        
        # Name
        ctk.CTkLabel(
            dialog,
            text="Project Name:",
            font=ctk.CTkFont(size=12)
        ).pack(padx=20, pady=(10, 5), anchor="w")
        
        name_entry = ctk.CTkEntry(
            dialog,
            placeholder_text="e.g., Master's Thesis",
            height=35
        )
        name_entry.pack(padx=20, pady=(0, 10), fill="x")
        name_entry.insert(0, project.get("name", ""))
        
        # Description
        ctk.CTkLabel(
            dialog,
            text="Description (optional):",
            font=ctk.CTkFont(size=12)
        ).pack(padx=20, pady=(10, 5), anchor="w")
        
        desc_entry = ctk.CTkTextbox(
            dialog,
            height=80
        )
        desc_entry.pack(padx=20, pady=(0, 20), fill="x")
        desc_entry.insert("1.0", project.get("description", ""))
        
        def save():
            new_name = name_entry.get().strip()
            if not new_name:
                messagebox.showwarning("Invalid Input", "Please enter a project name.")
                return
            
            # Check if name already exists (but allow same name)
            if new_name != project_name and any(p.get("name") == new_name for p in self.projects):
                messagebox.showwarning("Duplicate Name", "A project with this name already exists.")
                return
            
            description = desc_entry.get("1.0", "end-1c").strip()
            
            # Update project
            project["name"] = new_name
            project["description"] = description or "No description"
            
            # If we renamed the current project, update current_project reference
            renamed_current = False
            if project_name == self.current_project:
                self.current_project = new_name
                renamed_current = True
                # Update the current project label
                try:
                    self.current_label.configure(text=f"Current Project: {self.current_project}")
                except Exception:
                    pass

            self._save_projects()
            # Preserve scroll position while refreshing the list for instant visual update
            scroll_pos = None
            try:
                if hasattr(self.projects_container, "_parent_canvas"):
                    canvas = getattr(self.projects_container, "_parent_canvas")
                    rng = canvas.yview()
                    scroll_pos = rng[0] if isinstance(rng, tuple) and rng else None
            except Exception:
                scroll_pos = None

            # Repopulate list and force UI to refresh immediately after save
            try:
                self._populate_projects_list()
            except Exception:
                pass
            try:
                if scroll_pos is not None and hasattr(self.projects_container, "_parent_canvas"):
                    canvas = getattr(self.projects_container, "_parent_canvas")
                    canvas.yview_moveto(scroll_pos)
                # Ensure the refreshed widgets draw without waiting for view switches
                self.projects_container.update_idletasks()
                self.update_idletasks()
            except Exception:
                pass
            
            dialog.destroy()
            messagebox.showinfo("Success", f"Project '{new_name}' has been updated.")

            # Only after local UI refresh, notify dashboard to reload if the current project was renamed
            try:
                if renamed_current and self.on_project_switch:
                    self.on_project_switch()
            except Exception:
                pass
        
        # Buttons
        btn_frame = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_frame.pack(padx=20, pady=(0, 20), fill="x")
        
        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            width=100,
            command=dialog.destroy,
            fg_color="gray",
            hover_color="gray30"
        ).pack(side="right", padx=(10, 0))
        
        ctk.CTkButton(
            btn_frame,
            text="Save",
            width=100,
            command=save
        ).pack(side="right")
    
    def _switch_project(self, project_name: str):
        """Switch to a different project"""
        result = messagebox.askyesno(
            "Switch Project",
            f"Switch to project '{project_name}'?\n\nThis will reload the dashboard with that project's data.",
            icon='question'
        )
        
        if result:
            self.current_project = project_name
            self._save_projects()
            
            # Reload views if callback provided
            if self.on_project_switch:
                self.on_project_switch()
            
            # Show info message
            messagebox.showinfo(
                "Project Switched",
                f"Switched to '{project_name}'.\n\nThe dashboard has been refreshed with this project's data."
            )
            
            self._populate_projects_list()
    
    def _delete_project(self, project_name: str):
        """Delete a project"""
        result = messagebox.askyesno(
            "Delete Project",
            f"Are you sure you want to delete '{project_name}'?\n\nThis action cannot be undone.",
            icon='warning'
        )
        
        if result:
            self.projects = [p for p in self.projects if p.get("name") != project_name]
            self._save_projects()
            self._populate_projects_list()
            
            messagebox.showinfo("Success", f"Project '{project_name}' has been deleted.")


if __name__ == "__main__":
    # Test the view
    root = ctk.CTk()
    root.geometry("1400x900")
    ctk.set_appearance_mode("dark")
    
    # Get workspace path dynamically (two levels up from this file)
    workspace = str(Path(__file__).parent.parent.parent)
    view = ProjectView(root, workspace)
    view.pack(fill="both", expand=True, padx=20, pady=20)
    
    root.mainloop()
