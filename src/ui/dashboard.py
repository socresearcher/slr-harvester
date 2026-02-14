"""
Dashboard for SLR Harvester
A sleek, professional GUI with dark/light mode support
"""

import sys
from pathlib import Path
from utils.config import get_app_root_dir, ensure_dirs

# Add src directory to path for imports (when run directly)
src_dir = Path(__file__).parent.parent
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import customtkinter as ctk
from typing import Optional, Callable
from ui.history_view import HistoryView
from ui.search_view import SearchView
from ui.project_view import ProjectView
from ui.corpus_view import CorpusView


class Dashboard(ctk.CTk):
    """
    Main Dashboard Application with modern UI
    Features:
    - Dark/Light mode toggle
    - Sidebar navigation
    - Responsive design
    - Professional appearance
    """
    
    def __init__(self):
        super().__init__()
        
        # Configure window
        self.title("SLR Harvester - Dashboard")
        
        # Get screen dimensions
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        self.geometry(f"{screen_width}x{screen_height}+0+0")
        
        # Use stable app root (EXE dir in frozen, repo root in dev)
        app_root = Path(get_app_root_dir())
        # Workspace path is the app root; projects and results under it
        self.workspace_path = app_root
        ensure_dirs(str(self.workspace_path / "projects"), str(self.workspace_path / "results"))
        
        # Set color theme and load persisted appearance mode FIRST
        mode = self._load_appearance_mode()
        ctk.set_appearance_mode(mode)  # Modes: "dark", "light", "system"
        ctk.set_default_color_theme("blue")  # Themes: "blue", "green", "dark-blue"
        
        # Load and apply display mode
        display_mode = self._load_display_mode()
        self._apply_display_mode(display_mode)
        
        # Load display scale and apply it AFTER theme settings
        self.display_scale = self._load_display_scale()
        self._apply_display_scale(self.display_scale)
        
        # Load current project (may be None on first run)
        self.current_project = self._load_current_project()
        
        # Initialize UI
        self._setup_grid()
        self._create_sidebar()
        self._create_main_content()
        
        # Track current view
        self.current_view = None
        
        # Show default view
        self.show_project_view()
    
    def _load_current_project(self) -> Optional[str]:
        """Load the current project name from projects.json (or None)."""
        try:
            projects_file = self.workspace_path / "projects.json"
            if projects_file.exists():
                import json
                with open(projects_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("current_project") or None
        except Exception as e:
            print(f"Error loading current project: {e}")
        return None
    
    def _get_project_folder(self) -> str:
        """Get the workspace folder name for the current project ("" if unavailable)."""
        try:
            projects_file = self.workspace_path / "projects.json"
            if projects_file.exists():
                import json
                with open(projects_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    projects = data.get("projects", [])
                    for project in projects:
                        if project.get("name") == self.current_project:
                            return project.get("workspace_folder", "")
        except Exception as e:
            print(f"Error getting project folder: {e}")
        return ""
    
    def reload_current_project(self):
        """Reload current project and refresh current view"""
        self.current_project = self._load_current_project()
        # Refresh current view
        if self.current_view == "history":
            self.show_history_view()
        elif self.current_view == "search":
            self.show_search_view()
        elif self.current_view == "project":
            self.show_project_view()
        elif self.current_view == "tags":
            self.show_tags_view()
        elif self.current_view == "corpus":
            self.show_corpus_view()
    
    def _setup_grid(self):
        """Configure the main grid layout"""
        self.grid_columnconfigure(0, weight=0, minsize=220)  # Sidebar column
        self.grid_columnconfigure(1, weight=1)  # Main content column
        self.grid_rowconfigure(0, weight=1)
    
    def _create_sidebar(self):
        """Create the sidebar with permanent navigation"""
        # Sidebar container - using grid for permanent visibility
        self.sidebar = ctk.CTkFrame(
            self,
            width=190,
            corner_radius=0,
            fg_color=("gray90", "gray13")
        )
        self.sidebar.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
        self.sidebar.grid_columnconfigure(0, weight=1)
        self.sidebar.grid_rowconfigure(14, weight=1)  # Spacer to push Restart App to bottom
        
        # Load icons
        self._load_icons()
        
        # Title
        title_label = ctk.CTkLabel(
            self.sidebar,
            text="SLR Harvester",
            font=ctk.CTkFont(size=20, weight="bold"),
            anchor="w"
        )
        title_label.grid(row=0, column=0, padx=20, pady=(20, 20), sticky="w")
        
        # RESEARCH Section
        lit_review_label = ctk.CTkLabel(
            self.sidebar,
            text="RESEARCH",
            font=ctk.CTkFont(size=12, weight="bold"),
            anchor="w"
        )
        lit_review_label.grid(row=1, column=0, padx=10, pady=(10, 10), sticky="w")
        
        # Navigation buttons - Literature Review
        self.btn_project = self._create_nav_button(
            self.sidebar, "     Project", row=2, command=self.show_project_view, icon=self.icon_project
        )
        self.btn_search = self._create_nav_button(
            self.sidebar, "     Search", row=3, command=self.show_search_view, icon=self.icon_search
        )
        self.btn_tags = self._create_nav_button(
            self.sidebar, "     Tags", row=4, command=self.show_tags_view, icon=self.icon_tags
        )
        self.btn_history = self._create_nav_button(
            self.sidebar, "     History", row=5, command=self.show_history_view, icon=self.icon_history
        )
        self.btn_corpus = self._create_nav_button(
            self.sidebar, "     Corpus", row=6, command=self.show_corpus_view, icon=self.icon_corpus
        )
        
        # SETTINGS Section
        settings_label = ctk.CTkLabel(
            self.sidebar,
            text="SETTINGS",
            font=ctk.CTkFont(size=12, weight="bold"),
            anchor="w"
        )
        settings_label.grid(row=7, column=0, padx=10, pady=(15, 10), sticky="w")
        
        # Navigation buttons - Settings
        self.btn_api = self._create_nav_button(
            self.sidebar, "     API Settings", row=8, command=self.show_api_settings, icon=self.icon_api
        )
        self.btn_theme = self._create_nav_button(
            self.sidebar, "     Display Settings", row=9, command=self.show_theme_settings, icon=self.icon_display
        )
        
        # SUPPORT Section
        help_label = ctk.CTkLabel(
            self.sidebar,
            text="SUPPORT",
            font=ctk.CTkFont(size=12, weight="bold"),
            anchor="w"
        )
        help_label.grid(row=10, column=0, padx=10, pady=(15, 10), sticky="w")
        
        # Navigation buttons - Help
        self.btn_field_codes = self._create_nav_button(
            self.sidebar, "     Field Codes", row=11, command=self.show_field_codes_help, icon=self.icon_boolean
        )
        self.btn_api_portal = self._create_nav_button(
            self.sidebar, "     Scopus API Key", row=12, command=self.show_api_portal_help, icon=self.icon_key
        )
        self.btn_contact_dev = self._create_nav_button(
            self.sidebar, "     Ask Developer", row=13, command=self.show_contact_developer, icon=self.icon_developer
        )
        
        # Restart App button at the bottom (no sub-heading)
        self.btn_relaunch = self._create_nav_button(
            self.sidebar, "     Restart App", row=15, command=self.relaunch_app, icon=self.icon_relaunch, pady=(3, 3), sticky="sew"
        )
        
        # Close App button
        self.btn_close = self._create_nav_button(
            self.sidebar, "     Close App", row=16, command=self.close_app, icon=self.icon_close, pady=(3, 10), sticky="sew"
        )
    
    def _load_icons(self):
        """Load sidebar icons"""
        try:
            from PIL import Image
            from utils.ui_helpers import get_assets_icons_dir
            icons_path = get_assets_icons_dir()
            
            # Load and create CTkImages for each icon (64x64 px)
            icon_size = (32, 32)  # Display size in the UI
            
            self.icon_project = self._load_icon(icons_path / "project.png", icon_size)
            self.icon_search = self._load_icon(icons_path / "search.png", icon_size)
            self.icon_tags = self._load_icon(icons_path / "tag.png", icon_size)
            self.icon_history = self._load_icon(icons_path / "history.png", icon_size)
            self.icon_corpus = self._load_icon(icons_path / "corpus.png", icon_size)
            self.icon_api = self._load_icon(icons_path / "api.png", icon_size)
            self.icon_display = self._load_icon(icons_path / "display.png", icon_size)
            self.icon_relaunch = self._load_icon(icons_path / "relaunch.png", icon_size)
            self.icon_close = self._load_icon(icons_path / "shutdown.png", icon_size)
            self.icon_boolean = self._load_icon(icons_path / "boolean.png", icon_size)
            self.icon_key = self._load_icon(icons_path / "key.png", icon_size)
            self.icon_developer = self._load_icon(icons_path / "developer.png", icon_size)
            
        except Exception as e:
            print(f"Error loading icons: {e}")
            # Set icons to None if loading fails
            self.icon_project = None
            self.icon_search = None
            self.icon_tags = None
            self.icon_history = None
            self.icon_corpus = None
            self.icon_api = None
            self.icon_display = None
            self.icon_relaunch = None
            self.icon_close = None
            self.icon_boolean = None
            self.icon_key = None
            self.icon_developer = None
    
    def _load_icon(self, path: Path, size: tuple) -> Optional[ctk.CTkImage]:
        """Load a single icon and return CTkImage with inverted version for dark mode"""
        try:
            from PIL import Image, ImageOps
            if path.exists():
                img_light = Image.open(path).convert("RGBA")
                
                # Create inverted version for dark mode
                # Split into RGB and Alpha channels
                r, g, b, a = img_light.split()
                # Invert RGB channels only, keep alpha
                rgb_inverted = ImageOps.invert(Image.merge("RGB", (r, g, b)))
                # Merge back with original alpha
                img_dark = Image.merge("RGBA", (*rgb_inverted.split(), a))
                
                return ctk.CTkImage(light_image=img_light, dark_image=img_dark, size=size)
            else:
                print(f"Icon not found: {path}")
                return None
        except Exception as e:
            print(f"Error loading icon {path}: {e}")
            return None
    
    def _create_nav_button(self, parent, text: str, row: int, command: Callable, icon: Optional[ctk.CTkImage] = None, pady: int | tuple = 3, sticky: str = "ew") -> ctk.CTkButton:
        """Create a styled navigation button"""
        btn = ctk.CTkButton(
            parent,
            text=text,
            image=icon,
            compound="left",
            font=ctk.CTkFont(size=13),
            height=40,
            corner_radius=8,
            fg_color="transparent",
            text_color=("gray10", "gray90"),
            hover_color=("gray70", "gray30"),
            anchor="w",
            command=command
        )
        btn.grid(row=row, column=0, padx=10, pady=pady, sticky=sticky)
        return btn
    
    def _create_main_content(self):
        """Create the main content area"""
        # Main content in column 1 (sidebar is in column 0)
        self.main_frame = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
        self.main_frame.grid(row=0, column=1, sticky="nsew", padx=0, pady=0)
        self.main_frame.grid_columnconfigure(0, weight=1)
        self.main_frame.grid_rowconfigure(0, weight=1)

    def _show_no_project_selected(self):
        """Show a friendly message prompting user to create/select a project."""
        self._clear_main_content()
        container = ctk.CTkFrame(self.main_frame, corner_radius=15)
        container.grid(row=0, column=0, sticky="nsew", padx=30, pady=30)
        container.grid_columnconfigure(0, weight=1)

        header = ctk.CTkLabel(
            container,
            text="No Project Selected",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        header.grid(row=0, column=0, padx=30, pady=(30, 10), sticky="w")

        msg = ctk.CTkLabel(
            container,
            text="Create a project in the Project view, or select one from the list.",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        msg.grid(row=1, column=0, padx=30, pady=(0, 20), sticky="w")

        btn = ctk.CTkButton(
            container,
            text="Go to Projects",
            command=self.show_project_view,
            width=160,
            height=40
        )
        btn.grid(row=2, column=0, padx=30, pady=(0, 30), sticky="w")
    
    def _clear_main_content(self):
        """Clear the main content area"""
        for widget in self.main_frame.winfo_children():
            widget.destroy()
    
    def _notify_views_tag_changed(self):
        """Notify History and Corpus views that tags have changed"""
        from ui.history_view import HistoryView
        from ui.corpus_view import CorpusView
        
        for widget in self.main_frame.winfo_children():
            if isinstance(widget, HistoryView) or isinstance(widget, CorpusView):
                if hasattr(widget, '_refresh_tag_dropdowns'):
                    widget._refresh_tag_dropdowns()
                    print(f"Notified {widget.__class__.__name__} of tag changes")
    
    def _highlight_nav_button(self, active_button: ctk.CTkButton):
        """Highlight the active navigation button"""
        # List of all navigation buttons
        all_buttons = [
            self.btn_project, self.btn_search, self.btn_tags, self.btn_history, self.btn_corpus,
            self.btn_api, self.btn_theme,
            self.btn_field_codes, self.btn_api_portal, self.btn_contact_dev,
            self.btn_relaunch, self.btn_close
        ]
        
        # Reset all buttons
        for btn in all_buttons:
            btn.configure(fg_color="transparent")
        
        # Highlight active button
        active_button.configure(fg_color=("gray75", "gray25"))
    
    # View Methods
    def show_project_view(self):
        """Show the Project management view"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_project)
        self.current_view = "project"
        
        # Create and display project view with reload callback
        project_view = ProjectView(self.main_frame, str(self.workspace_path), 
                                   on_project_switch=self.reload_current_project)
        project_view.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
    
    def show_search_view(self):
        """Show the Search view"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_search)
        self.current_view = "search"

        try:
            # Create and display search view
            project_folder = self._get_project_folder()
            if not project_folder:
                self._show_no_project_selected()
                return
            search_view = SearchView(self.main_frame, str(self.workspace_path), project_folder)
            search_view.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
            print("SearchView created and displayed successfully")
        except Exception as e:
            print(f"Error creating SearchView: {e}")
            import traceback
            traceback.print_exc()
            
            # Show error to user
            error_label = ctk.CTkLabel(
                self.main_frame,
                text=f"Error loading search view:\n{str(e)}",
                font=ctk.CTkFont(size=14),
                text_color="red"
            )
            error_label.grid(row=0, column=0, padx=30, pady=30)
    
    def show_tags_view(self):
        """Show the Tags management view"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_tags)
        self.current_view = "tags"
        
        # Scrollable container for the entire view
        view_frame = ctk.CTkScrollableFrame(self.main_frame, corner_radius=15)
        view_frame.grid(row=0, column=0, sticky="nsew", padx=30, pady=30)
        view_frame.grid_columnconfigure(0, weight=1)
        
        header = ctk.CTkLabel(
            view_frame,
            text="Tag Management",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        header.grid(row=0, column=0, padx=30, pady=(30, 10), sticky="w")
        
        # Description
        desc = ctk.CTkLabel(
            view_frame,
            text="Manage your article tags: add new tags, rename, change colors, or delete existing ones.",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        desc.grid(row=1, column=0, padx=30, pady=(0, 20), sticky="w")
        
        # Load current project's tags
        project_folder = self._get_project_folder()
        if not project_folder:
            self._show_no_project_selected()
            return
        project_path = self.workspace_path / "projects" / project_folder
        tags_config_path = project_path / "tags_config.json"
        tag_aliases_path = project_path / "tag_aliases.json"
        
        # Load tag aliases from project-level tag_aliases.json
        self.tag_aliases = {}
        import json
        try:
            if tag_aliases_path.exists():
                with open(tag_aliases_path, "r", encoding="utf-8") as f:
                    self.tag_aliases = json.load(f)
                print(f"Loaded {len(self.tag_aliases)} tag aliases from project")
        except Exception as e:
            print(f"Error loading tag aliases: {e}")
        
        # Store path for saving
        self.tag_aliases_path = tag_aliases_path
        
        # Default tag colors (same as in history/corpus views)
        self.default_tag_colors = {
            "None": "",
            "Red": "#E57373",
            "Orange": "#F4A261",
            "Yellow": "#F6D06F",
            "Green": "#81C995",
            "Turquoise": "#7BD3D3",
            "Blue": "#64A8FF",
            "Violet": "#B494F7",
            "Pink": "#F79AC1",
            "Magenta": "#D38AD8",
            "Brown": "#B08A6A",
            "Gray": "#A5ACB8",
            "Black": "#3C3C3C",
            "Olive": "#B7BF5E",
            "Lavender": "#C7B8EA",
            "Dark Red": "#C05C5C",
            "Steel Blue": "#7AA6D9",
            "Coral": "#F59F8B",
            "Gold": "#DCB770",
            "Teal": "#6FB7B7",
            "Indigo": "#7F8AD4",
            "Slate Blue": "#8FA2D6",
        }
        
        # Load tags with backward-compatible behavior
        if tags_config_path.exists():
            try:
                import json
                with open(tags_config_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                # Heuristic: legacy files contained only overrides; merge with defaults in that case.
                # If the saved file already looks like a full set (contains most defaults), use it as authoritative.
                default_keys = set(self.default_tag_colors.keys())
                loaded_keys = set(loaded.keys())
                has_none = "None" in loaded_keys
                overlap_ratio = len(loaded_keys & default_keys) / max(1, len(default_keys))
                is_overrides_only = (not has_none) or (overlap_ratio < 0.6)
                if is_overrides_only:
                    self.current_tags = {**self.default_tag_colors, **loaded}
                else:
                    self.current_tags = loaded
            except Exception:
                # On error, fall back to defaults (do not persist yet)
                self.current_tags = self.default_tag_colors.copy()
        else:
            # First-time: seed with defaults and persist
            self.current_tags = self.default_tag_colors.copy()
            self._save_tags_config()
        
        # Store refs for later
        self.tags_config_path = tags_config_path
        self.tags_list_container = None
        
        # Add new tag section
        add_section = ctk.CTkFrame(view_frame)
        add_section.grid(row=2, column=0, padx=30, pady=(0, 30), sticky="ew")
        add_section.grid_columnconfigure(1, weight=1)
        
        add_label = ctk.CTkLabel(
            add_section,
            text="Add New Tag:",
            font=ctk.CTkFont(size=13, weight="bold")
        )
        add_label.grid(row=0, column=0, padx=10, pady=10, sticky="w")
        
        self.new_tag_name = ctk.CTkEntry(
            add_section,
            placeholder_text="Tag name (e.g., 'Important')",
            width=200,
            height=30
        )
        self.new_tag_name.grid(row=0, column=1, padx=10, pady=10, sticky="w")
        
        self.new_tag_color = ctk.CTkEntry(
            add_section,
            placeholder_text="Color (e.g., #FF5733)",
            width=150,
            height=30
        )
        self.new_tag_color.grid(row=0, column=2, padx=10, pady=10, sticky="w")
        
        # Color preview
        self.color_preview = ctk.CTkLabel(
            add_section,
            text="    ",
            width=40,
            height=25,
            corner_radius=5,
            fg_color="#cccccc"
        )
        self.color_preview.grid(row=0, column=3, padx=10, pady=10)
        
        # Bind color entry to update preview
        self.new_tag_color.bind("<KeyRelease>", self._update_color_preview)
        
        color_picker_btn = ctk.CTkButton(
            add_section,
            text="Pick Color",
            width=100,
            height=30,
            font=ctk.CTkFont(size=12),
            command=self._open_color_picker
        )
        color_picker_btn.grid(row=0, column=4, padx=10, pady=10)
        
        add_btn = ctk.CTkButton(
            add_section,
            text="➕ Add Tag",
            width=120,
            height=30,
            command=self._add_new_tag,
            font=ctk.CTkFont(size=12, weight="bold")
        )
        add_btn.grid(row=0, column=5, padx=10, pady=10)
        
        # Tags list section
        list_label = ctk.CTkLabel(
            view_frame,
            text="Current Tags:",
            font=ctk.CTkFont(size=14, weight="bold")
        )
        list_label.grid(row=3, column=0, padx=30, pady=(15, 8), sticky="w")
        
        # Container for tag list
        self.tags_list_container = ctk.CTkFrame(view_frame)
        self.tags_list_container.grid(row=4, column=0, padx=30, pady=(0, 30), sticky="ew")
        self.tags_list_container.grid_columnconfigure(0, weight=1)
        
        self._refresh_tags_list()
    
    def _update_color_preview(self, event=None):
        """Update color preview when typing color code"""
        color = self.new_tag_color.get().strip()
        try:
            # Validate hex color
            if color.startswith("#") and len(color) in [4, 7]:
                self.color_preview.configure(fg_color=color)
            else:
                self.color_preview.configure(fg_color="#cccccc")
        except:
            self.color_preview.configure(fg_color="#cccccc")
    
    def _open_color_picker(self):
        """Open the system color picker dialog (full manual control)"""
        from tkinter import colorchooser
        current = self.new_tag_color.get().strip() or "#cccccc"
        try:
            color = colorchooser.askcolor(title="Choose Tag Color", initialcolor=current)
        except Exception:
            color = (None, None)
        if color and color[1]:  # color[1] is the hex code
            self.new_tag_color.delete(0, 'end')
            self.new_tag_color.insert(0, color[1])
            self._update_color_preview()
    
    def _add_new_tag(self):
        """Add a new tag to the list"""
        from utils.mb_shim import messagebox
        
        name = self.new_tag_name.get().strip()
        color = self.new_tag_color.get().strip()
        
        if not name:
            messagebox.showwarning("Invalid Input", "Please enter a tag name.")
            return
        
        if not color or not color.startswith("#"):
            messagebox.showwarning("Invalid Input", "Please enter a valid hex color (e.g., #FF5733).")
            return
        
        if name in self.current_tags:
            messagebox.showwarning("Duplicate Tag", f"Tag '{name}' already exists.")
            return
        
        # Add tag
        self.current_tags[name] = color
        self._save_tags_config()
        self._refresh_tags_list()
        self._notify_views_tag_changed()
        
        # Clear inputs
        self.new_tag_name.delete(0, 'end')
        self.new_tag_color.delete(0, 'end')
        self._update_color_preview()
        
        messagebox.showinfo("Success", f"Tag '{name}' added successfully!")
    
    def _save_tags_config(self):
        """Save custom tags to config file"""
        try:
            import json
            # Persist exactly what the user manages (no auto-restore of defaults)
            with open(self.tags_config_path, "w", encoding="utf-8") as f:
                json.dump(self.current_tags, f, ensure_ascii=False, indent=2)
            
            print(f"Tags configuration saved to {self.tags_config_path}")
        except Exception as e:
            print(f"Error saving tags config: {e}")
    
    def _refresh_tags_list(self):
        """Refresh the list of tags"""
        # Clear existing
        for widget in self.tags_list_container.winfo_children():
            widget.destroy()
        
        # Sort tags alphabetically (but keep None first)
        sorted_tags = sorted(self.current_tags.items(), key=lambda x: (x[0] != "None", x[0]))
        
        for idx, (tag_name, tag_color) in enumerate(sorted_tags):
            tag_frame = ctk.CTkFrame(self.tags_list_container, fg_color=("gray90", "gray20"))
            tag_frame.grid(row=idx, column=0, padx=10, pady=5, sticky="ew")
            tag_frame.grid_columnconfigure(1, weight=1)
            
            # Color indicator
            color_display = tag_color if tag_color else "#e0e0e0"
            color_label = ctk.CTkLabel(
                tag_frame,
                text="    ",
                width=40,
                height=24,
                corner_radius=5,
                fg_color=color_display
            )
            color_label.grid(row=0, column=0, padx=8, pady=6)
            
            # Tag name - use alias if available
            display_name = self.tag_aliases.get(tag_name, tag_name)
            name_label = ctk.CTkLabel(
                tag_frame,
                text=display_name,
                font=ctk.CTkFont(size=12),
                anchor="w"
            )
            name_label.grid(row=0, column=1, padx=8, pady=6, sticky="w")
            
            # Color code
            color_code_label = ctk.CTkLabel(
                tag_frame,
                text=tag_color if tag_color else "No color",
                font=ctk.CTkFont(size=10),
                text_color="gray",
                anchor="w"
            )
            color_code_label.grid(row=0, column=2, padx=8, pady=6, sticky="w")
            
            # Action buttons
            btn_frame = ctk.CTkFrame(tag_frame, fg_color="transparent")
            btn_frame.grid(row=0, column=3, padx=8, pady=6, sticky="e")

            # Hover highlight for the entire tag card
            def on_enter(e, card=tag_frame):
                card.configure(fg_color=("gray75", "gray30"))

            def on_leave(e, card=tag_frame):
                card.configure(fg_color=("gray90", "gray20"))

            def bind_hover(widget):
                widget.bind("<Enter>", on_enter)
                widget.bind("<Leave>", on_leave)

            bind_hover(tag_frame)
            bind_hover(color_label)
            bind_hover(name_label)
            bind_hover(color_code_label)
            bind_hover(btn_frame)
            
            # Rename button
            rename_btn = ctk.CTkButton(
                btn_frame,
                text="Rename",
                width=80,
                height=26,
                font=ctk.CTkFont(size=11),
                command=lambda t=tag_name: self._rename_tag(t)
            )
            rename_btn.pack(side="left", padx=3)
            bind_hover(rename_btn)
            
            # Change color button
            color_btn = ctk.CTkButton(
                btn_frame,
                text="Color",
                width=70,
                height=26,
                font=ctk.CTkFont(size=11),
                command=lambda t=tag_name: self._change_tag_color(t)
            )
            color_btn.pack(side="left", padx=3)
            bind_hover(color_btn)
            
            # Delete button (disabled for "None")
            if tag_name != "None":
                delete_btn = ctk.CTkButton(
                    btn_frame,
                    text="Delete",
                    width=70,
                    height=26,
                    font=ctk.CTkFont(size=11),
                    fg_color="red",
                    hover_color="darkred",
                    command=lambda t=tag_name: self._delete_tag(t)
                )
                delete_btn.pack(side="left", padx=3)
                bind_hover(delete_btn)
    
    def _rename_tag(self, old_name: str):
        """Rename a tag (updates alias)"""
        from utils.ctk_dialogs import ask_text
        from utils.mb_shim import messagebox
        import json
        
        # Get current display name (alias or original name)
        current_display_name = self.tag_aliases.get(old_name, old_name)
        new_name = ask_text(self, title="Rename Tag", prompt="Enter new name for tag:", initial=current_display_name)
        
        if new_name and new_name.strip() and new_name.strip() != current_display_name:
            new_name = new_name.strip()
            
            # Update tag alias
            self.tag_aliases[old_name] = new_name
            
            # Save tag aliases to project-level tag_aliases.json
            try:
                with open(self.tag_aliases_path, "w", encoding="utf-8") as f:
                    json.dump(self.tag_aliases, f, ensure_ascii=False, indent=2)
                
                self._refresh_tags_list()
                self._notify_views_tag_changed()
                messagebox.showinfo("Success", f"Tag renamed to '{new_name}'.")
                print(f"Tag aliases saved to {self.tag_aliases_path}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to save tag alias: {e}")
    
    def _change_tag_color(self, tag_name: str):
        """Change tag color using system color dialog"""
        from tkinter import colorchooser
        from utils.mb_shim import messagebox
        
        # Get display name for dialog title
        display_name = self.tag_aliases.get(tag_name, tag_name)
        current_color = self.current_tags[tag_name]
        try:
            color = colorchooser.askcolor(title=f"Choose color for '{display_name}'", initialcolor=current_color if current_color else "#cccccc")
        except Exception:
            color = (None, None)
        
        if color and color[1]:
            self.current_tags[tag_name] = color[1]
            self._save_tags_config()
            self._refresh_tags_list()
            self._notify_views_tag_changed()
            messagebox.showinfo("Success", f"Color updated for '{display_name}'.")
    
    def _delete_tag(self, tag_name: str):
        """Delete a tag and remove it from all articles that use it"""
        from utils.mb_shim import messagebox
        import json
        
        # Get display name for dialog
        display_name = self.tag_aliases.get(tag_name, tag_name)
        
        result = messagebox.askyesno(
            "Delete Tag",
            f"Are you sure you want to delete the tag '{display_name}'?\n\n"
            f"This will remove this tag from all articles that currently have it."
        )
        
        if not result:
            return
        
        # 1) Remove from tag color config
        if tag_name in self.current_tags:
            del self.current_tags[tag_name]
            self._save_tags_config()
        
        # 2) Remove tag from all articles in project global tags
        try:
            project_folder = self._get_project_folder()
            project_path = self.workspace_path / "projects" / project_folder
            global_tags_path = project_path / "slr_global_tags.json"
            if global_tags_path.exists():
                with open(global_tags_path, "r", encoding="utf-8") as f:
                    global_tags = json.load(f)
                changed = False
                for eid, info in list(global_tags.items()):
                    color_key = info.get('color', 'None')
                    if color_key == tag_name:
                        info['color'] = 'None'
                        # Remove display label if present
                        if 'tag' in info:
                            del info['tag']
                        info['last_modified'] = __import__('datetime').datetime.now().isoformat(timespec='seconds')
                        changed = True
                if changed:
                    with open(global_tags_path, "w", encoding="utf-8") as f:
                        json.dump(global_tags, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error removing deleted tag from articles: {e}")
        
        # 3) Refresh UI
        self._refresh_tags_list()
        self._notify_views_tag_changed()
        messagebox.showinfo("Success", f"Tag '{display_name}' deleted and removed from articles.")
    
    def show_history_view(self):
        """Show the History view"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_history)
        self.current_view = "history"

        # Create and display history view with project folder
        project_folder = self._get_project_folder()
        if not project_folder:
            self._show_no_project_selected()
            return
        history_view = HistoryView(self.main_frame, str(self.workspace_path), project_folder)
        history_view.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
    
    def show_corpus_view(self):
        """Show the Corpus view"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_corpus)
        self.current_view = "corpus"

        # Create and display corpus view
        project_folder = self._get_project_folder()
        if not project_folder:
            self._show_no_project_selected()
            return
        corpus_view = CorpusView(self.main_frame, str(self.workspace_path), project_folder)
        corpus_view.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
    
    def show_api_settings(self):
        """Show Scopus API settings"""
        from utils.config import load_existing_config, write_default_config
        
        self._clear_main_content()
        self._highlight_nav_button(self.btn_api)
        self.current_view = "api"
        
        # Scrollable container for the entire view
        view_frame = ctk.CTkScrollableFrame(self.main_frame, corner_radius=15)
        view_frame.grid(row=0, column=0, sticky="nsew", padx=30, pady=30)
        view_frame.grid_columnconfigure(0, weight=1)
        
        # Header
        header = ctk.CTkLabel(
            view_frame,
            text="Scopus API Configuration",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        header.grid(row=0, column=0, padx=30, pady=(30, 10), sticky="w")
        
        # Description
        desc = ctk.CTkLabel(
            view_frame,
            text="Configure your Elsevier/Scopus API credentials. You can add multiple API keys.",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        desc.grid(row=1, column=0, padx=30, pady=(0, 20), sticky="w")
        
        # Settings container
        settings_container = ctk.CTkFrame(view_frame)
        settings_container.grid(row=2, column=0, padx=30, pady=(0, 20), sticky="ew")
        settings_container.grid_columnconfigure(1, weight=1)
        
        # Load current config
        api_key, inst_token, view_mode = load_existing_config()
        
        # API Keys section
        api_keys_label = ctk.CTkLabel(
            settings_container,
            text="API Keys (one per line):",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        api_keys_label.grid(row=0, column=0, columnspan=2, padx=20, pady=(20, 10), sticky="w")
        
        api_keys_info = ctk.CTkLabel(
            settings_container,
            text="Enter your Elsevier API key(s). Multiple keys will be used in rotation.",
            font=ctk.CTkFont(size=11),
            text_color="gray",
            anchor="w"
        )
        api_keys_info.grid(row=1, column=0, columnspan=2, padx=20, pady=(0, 5), sticky="w")
        
        # API Keys textbox (supports multiple keys)
        api_keys_text = ctk.CTkTextbox(
            settings_container,
            height=120,
            font=ctk.CTkFont(size=12)
        )
        api_keys_text.grid(row=2, column=0, columnspan=2, padx=20, pady=(0, 20), sticky="ew")
        api_keys_text.insert("1.0", api_key)
        
        # InstToken section
        inst_token_label = ctk.CTkLabel(
            settings_container,
            text="Institutional Token:",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        inst_token_label.grid(row=3, column=0, columnspan=2, padx=20, pady=(10, 5), sticky="w")
        
        inst_token_info = ctk.CTkLabel(
            settings_container,
            text="Optional. Required for institutional access to full-text articles.",
            font=ctk.CTkFont(size=11),
            text_color="gray",
            anchor="w"
        )
        inst_token_info.grid(row=4, column=0, columnspan=2, padx=20, pady=(0, 5), sticky="w")
        
        inst_token_entry = ctk.CTkEntry(
            settings_container,
            placeholder_text="Enter institutional token (optional)",
            font=ctk.CTkFont(size=12),
            height=40
        )
        inst_token_entry.grid(row=5, column=0, columnspan=2, padx=20, pady=(0, 20), sticky="ew")
        if inst_token:
            inst_token_entry.insert(0, inst_token)
        
        # View mode section
        view_mode_label = ctk.CTkLabel(
            settings_container,
            text="API View Mode:",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        view_mode_label.grid(row=6, column=0, padx=20, pady=(10, 5), sticky="w")
        
        view_mode_var = ctk.StringVar(value=view_mode or "STANDARD")
        view_mode_menu = ctk.CTkOptionMenu(
            settings_container,
            values=["STANDARD", "COMPLETE"],
            variable=view_mode_var,
            font=ctk.CTkFont(size=12),
            height=40,
            width=200
        )
        view_mode_menu.grid(row=6, column=1, padx=20, pady=(10, 20), sticky="w")
        
        # Status label
        status_label = ctk.CTkLabel(
            view_frame,
            text="",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        status_label.grid(row=3, column=0, padx=30, pady=(0, 10), sticky="w")
        
        # Buttons frame
        buttons_frame = ctk.CTkFrame(view_frame, fg_color="transparent")
        buttons_frame.grid(row=4, column=0, padx=30, pady=(0, 30), sticky="w")
        
        def save_settings():
            """Save the API settings"""
            # Get API keys (split by newline, filter empty)
            api_keys_raw = api_keys_text.get("1.0", "end").strip()
            api_keys_list = [k.strip() for k in api_keys_raw.split('\n') if k.strip()]
            
            # Join with comma for storage (backward compatible)
            new_api_key = ",".join(api_keys_list) if api_keys_list else ""
            new_inst_token = inst_token_entry.get().strip()
            new_view_mode = view_mode_var.get()
            
            # Save to config
            write_default_config(new_api_key, new_inst_token, new_view_mode)
            
            # Update status
            status_label.configure(
                text=f"✅ Settings saved! ({len(api_keys_list)} API key(s) configured)",
                text_color="green"
            )
            
            # Reset status after 3 seconds
            self.after(3000, lambda: status_label.configure(text="", text_color="gray"))
        
        def test_connection():
            """Test API connection"""
            api_keys_raw = api_keys_text.get("1.0", "end").strip()
            api_keys_list = [k.strip() for k in api_keys_raw.split('\n') if k.strip()]
            
            if not api_keys_list:
                status_label.configure(
                    text="⚠️ Please enter at least one API key",
                    text_color="orange"
                )
                return
            
            status_label.configure(
                text="🔄 Testing connection...",
                text_color="blue"
            )
            
            # Simple test (we can expand this later with actual API call)
            # For now just validate format
            valid_keys = [k for k in api_keys_list if len(k) > 10]
            
            if len(valid_keys) == len(api_keys_list):
                status_label.configure(
                    text=f"✅ {len(valid_keys)} API key(s) appear valid",
                    text_color="green"
                )
            else:
                status_label.configure(
                    text=f"⚠️ Some keys may be invalid ({len(valid_keys)}/{len(api_keys_list)} valid)",
                    text_color="orange"
                )
            
            self.after(3000, lambda: status_label.configure(text="", text_color="gray"))
        
        # Test button
        test_btn = ctk.CTkButton(
            buttons_frame,
            text="Test Connection",
            font=ctk.CTkFont(size=14),
            height=45,
            width=180,
            fg_color="gray",
            hover_color="gray30",
            command=test_connection
        )
        test_btn.grid(row=0, column=0, padx=(0, 10), sticky="w")
        
        # Save button
        save_btn = ctk.CTkButton(
            buttons_frame,
            text="Save Settings",
            font=ctk.CTkFont(size=14),
            height=45,
            width=180,
            command=save_settings
        )
        save_btn.grid(row=0, column=1, sticky="w")
    
    def show_theme_settings(self):
        """Show display settings (theme, window mode, scale)"""
        self._clear_main_content()
        self._highlight_nav_button(self.btn_theme)
        self.current_view = "theme"
        
        # Scrollable container for the entire view
        view_frame = ctk.CTkScrollableFrame(self.main_frame, corner_radius=15)
        view_frame.grid(row=0, column=0, sticky="nsew", padx=30, pady=30)
        view_frame.grid_columnconfigure(0, weight=1)
        
        header = ctk.CTkLabel(
            view_frame,
            text="Display Settings",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        header.grid(row=0, column=0, padx=30, pady=(30, 20), sticky="w")
        
        # Display settings – theme/appearance options
        options_frame = ctk.CTkFrame(view_frame, fg_color="transparent")
        options_frame.grid(row=1, column=0, padx=30, pady=20, sticky="nw")
        # Allow placing action controls to the right of the scale
        options_frame.grid_columnconfigure(0, weight=0)
        options_frame.grid_columnconfigure(1, weight=0)
        
        theme_label = ctk.CTkLabel(
            options_frame,
            text="Appearance Mode:",
            font=ctk.CTkFont(size=16, weight="bold")
        )
        theme_label.grid(row=0, column=0, padx=10, pady=(0, 15), sticky="w")
        
        # Radio buttons for theme (load persisted appearance)
        current_theme = self._load_appearance_mode()
        self.theme_var = ctk.StringVar(value=current_theme)
        
        dark_radio = ctk.CTkRadioButton(
            options_frame,
            text="Dark Mode",
            variable=self.theme_var,
            value="dark",
            command=self._change_appearance_mode,
            font=ctk.CTkFont(size=14)
        )
        dark_radio.grid(row=1, column=0, padx=20, pady=5, sticky="w")
        
        light_radio = ctk.CTkRadioButton(
            options_frame,
            text="Light Mode",
            variable=self.theme_var,
            value="light",
            command=self._change_appearance_mode,
            font=ctk.CTkFont(size=14)
        )
        light_radio.grid(row=2, column=0, padx=20, pady=5, sticky="w")
        
        system_radio = ctk.CTkRadioButton(
            options_frame,
            text="System Default",
            variable=self.theme_var,
            value="system",
            command=self._change_appearance_mode,
            font=ctk.CTkFont(size=14)
        )
        system_radio.grid(row=3, column=0, padx=20, pady=5, sticky="w")
        
        # Display Mode section
        display_mode_label = ctk.CTkLabel(
            options_frame,
            text="Window Mode:",
            font=ctk.CTkFont(size=16, weight="bold")
        )
        display_mode_label.grid(row=4, column=0, padx=10, pady=(30, 15), sticky="w")
        
        # Radio buttons for display mode
        current_mode = self._load_display_mode()
        self.display_mode_var = ctk.StringVar(value=current_mode)
        
        fullscreen_radio = ctk.CTkRadioButton(
            options_frame,
            text="Fullscreen (no window controls)",
            variable=self.display_mode_var,
            value="fullscreen",
            command=self._change_display_mode,
            font=ctk.CTkFont(size=14)
        )
        fullscreen_radio.grid(row=5, column=0, padx=20, pady=5, sticky="w")
        
        maximized_radio = ctk.CTkRadioButton(
            options_frame,
            text="Maximized (with window controls)",
            variable=self.display_mode_var,
            value="maximized",
            command=self._change_display_mode,
            font=ctk.CTkFont(size=14)
        )
        maximized_radio.grid(row=6, column=0, padx=20, pady=5, sticky="w")
        
        windowed_radio = ctk.CTkRadioButton(
            options_frame,
            text="Windowed (resizable)",
            variable=self.display_mode_var,
            value="windowed",
            command=self._change_display_mode,
            font=ctk.CTkFont(size=14)
        )
        windowed_radio.grid(row=7, column=0, padx=20, pady=5, sticky="w")
        
        # Display Scale section
        scale_label = ctk.CTkLabel(
            options_frame,
            text="Display Scale:",
            font=ctk.CTkFont(size=16, weight="bold")
        )
        scale_label.grid(row=8, column=0, padx=10, pady=(30, 15), sticky="w")
        
        # Load current scale setting
        current_scale = self._load_display_scale()
        try:
            current_scale_float = float(current_scale)
        except:
            current_scale_float = 75.0
        
        # Current scale value display
        self.scale_value_label = ctk.CTkLabel(
            options_frame,
            text=f"{int(current_scale_float)}%",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color=("gray10", "gray90")
        )
        self.scale_value_label.grid(row=9, column=0, padx=20, pady=(0, 10), sticky="w")
        
        # Scale slider (75% to 125%, continuous)
        self.scale_slider = ctk.CTkSlider(
            options_frame,
            from_=75,
            to=125,
            number_of_steps=50,  # 50 steps = 1% increments from 75 to 125
            width=300,
            command=self._on_scale_slider_change
        )
        self.scale_slider.set(current_scale_float)
        self.scale_slider.grid(row=10, column=0, padx=20, pady=(0, 0), sticky="w")
        
        # Info label (place directly under the slider, aligned with it)
        info_label = ctk.CTkLabel(
            options_frame,
            text="Note: Changing display scale requires app restart.",
            font=ctk.CTkFont(size=11),
            text_color="gray"
        )
        # Place the note immediately under the slider to minimize vertical gap
        info_label.grid(row=11, column=0, padx=20, pady=(4, 4), sticky="w")

        # Scale range labels - aligned with slider ends
        scale_range_frame = ctk.CTkFrame(options_frame, fg_color="transparent", width=300)
        # Place range labels below the note with tight spacing
        scale_range_frame.grid(row=12, column=0, padx=20, pady=(0, 6), sticky="w")
        scale_range_frame.grid_propagate(False)
        scale_range_frame.grid_columnconfigure(0, weight=1)
        
        left_label = ctk.CTkLabel(
            scale_range_frame,
            text="75%",
            font=ctk.CTkFont(size=11),
            text_color="gray"
        )
        left_label.place(x=0, y=0)
        
        right_label = ctk.CTkLabel(
            scale_range_frame,
            text="125%",
            font=ctk.CTkFont(size=11),
            text_color="gray"
        )
        right_label.place(relx=1.0, y=0, anchor="ne")
        
        # Apply button
        apply_scale_btn = ctk.CTkButton(
            options_frame,
            text="Apply Scale",
            font=ctk.CTkFont(size=14),
            height=32,
            width=140,
            command=self._change_display_scale
        )
        # Place the button to the right of the slider for proximity
        apply_scale_btn.grid(row=10, column=1, padx=(12, 0), pady=(0, 0), sticky="w")
    
    def _change_appearance_mode(self):
        """Change appearance mode from theme settings"""
        mode = self.theme_var.get()
        ctk.set_appearance_mode(mode)
        self._save_appearance_mode(mode)

    def _load_appearance_mode(self) -> str:
        """Load appearance mode (dark/light/system) from GUI settings"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    return settings.get("appearance_mode", "dark")
        except Exception as e:
            print(f"Error loading appearance mode: {e}")
        return "dark"

    def _save_appearance_mode(self, mode: str):
        """Persist appearance mode (dark/light/system) to GUI settings"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            settings = {}
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            settings["appearance_mode"] = mode
            import json
            with open(gui_settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            print(f"Appearance mode saved: {mode}")
        except Exception as e:
            print(f"Error saving appearance mode: {e}")
    
    def _load_display_scale(self) -> str:
        """Load display scale setting from GUI settings file"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    return settings.get("display_scale", "100")
        except Exception as e:
            print(f"Error loading display scale: {e}")
        return "100"
    
    def _load_display_mode(self) -> str:
        """Load display mode setting from GUI settings file"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    return settings.get("display_mode", "fullscreen")
        except Exception as e:
            print(f"Error loading display mode: {e}")
        return "fullscreen"
    
    def _save_display_mode(self, mode: str):
        """Save display mode setting to GUI settings file"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            settings = {}
            
            # Load existing settings if file exists
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            
            # Update mode
            settings["display_mode"] = mode
            
            # Save
            import json
            with open(gui_settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            
            print(f"Display mode saved: {mode}")
        except Exception as e:
            print(f"Error saving display mode: {e}")
    
    def _apply_display_mode(self, mode: str):
        """Apply display mode to the window"""
        try:
            if mode == "fullscreen":
                self.attributes('-fullscreen', True)
                # Unbind escape if it was bound
                self.unbind('<Escape>')
                # Re-bind to prevent exit
                self.bind('<Escape>', lambda e: None)
            elif mode == "maximized":
                self.attributes('-fullscreen', False)
                self.state('zoomed')
                # Allow escape to unmaximize
                self.unbind('<Escape>')
            else:  # windowed
                self.attributes('-fullscreen', False)
                self.state('normal')
                # Set a reasonable default size
                screen_width = self.winfo_screenwidth()
                screen_height = self.winfo_screenheight()
                window_width = int(screen_width * 0.8)
                window_height = int(screen_height * 0.8)
                x = (screen_width - window_width) // 2
                y = (screen_height - window_height) // 2
                self.geometry(f"{window_width}x{window_height}+{x}+{y}")
                self.unbind('<Escape>')
            
            print(f"Display mode applied: {mode}")
        except Exception as e:
            print(f"Error applying display mode: {e}")
    
    def _change_display_mode(self):
        """Handle display mode change"""
        mode = self.display_mode_var.get()
        self._save_display_mode(mode)
        self._apply_display_mode(mode)
    
    def _save_display_scale(self, scale: str):
        """Save display scale setting to GUI settings file"""
        try:
            gui_settings_path = self.workspace_path / "slr_gui_settings.json"
            settings = {}
            
            # Load existing settings if file exists
            if gui_settings_path.exists():
                import json
                with open(gui_settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            
            # Update scale
            settings["display_scale"] = scale
            
            # Save
            import json
            with open(gui_settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            
            print(f"Display scale saved: {scale}%")
        except Exception as e:
            print(f"Error saving display scale: {e}")
    
    def _apply_display_scale(self, scale: str):
        """Apply display scale to the application"""
        try:
            scale_factor = float(scale) / 100.0
            
            # Set CustomTkinter widget scaling
            ctk.set_widget_scaling(scale_factor)
            
            # Also set window scaling for consistency
            ctk.set_window_scaling(scale_factor)
            
            print(f"Display scale applied: {scale}% (factor: {scale_factor})")
        except Exception as e:
            print(f"Error applying display scale: {e}")
    
    def _on_scale_slider_change(self, value):
        """Handle display scale slider change"""
        # Update the display label
        scale_percent = int(value)
        self.scale_value_label.configure(text=f"{scale_percent}%")
    
    def _change_display_scale(self):
        """Change display scale setting"""
        from utils.mb_shim import messagebox
        
        # Get current slider value
        scale_percent = int(self.scale_slider.get())
        scale_str = str(scale_percent)
        self._save_display_scale(scale_str)
        
        # Prompt user to restart
        messagebox.showinfo(
            "Display Scale Changed",
            f"Display scale changed to {scale_percent}%.\n\nPlease restart the application for changes to take effect.",
            icon='info'
        )
    
    def show_field_codes_help(self):
        """Show Scopus field codes help by opening the documentation link"""
        import webbrowser
        
        # Prompt to open the documentation page (dark-mode compatible)
        open_now = self._ask_yes_no(
            "Field codes",
            "On the documentation page, click on 'Field codes' and then on 'All available field codes' to see all available Scopus field codes.\n\nOpen this page in your default browser now?"
        )
        if open_now:
            url = "https://service.elsevier.com/app/answers/detail/a_id/11365/supporthub/scopus/"
            webbrowser.open(url)
    
    def show_api_portal_help(self):
        """Show Scopus API Portal information and open the developer portal"""
        import webbrowser
        
        # Prompt to open the developer portal (dark-mode compatible)
        open_now = self._ask_yes_no(
            "Scopus API Portal",
            "The Elsevier Developer Portal provides access to Scopus API documentation, usage limits, and API key management.\n\n"
            "You can request an API Key on Elsevier's Developer Portal. If you do not already have an Elsevier user ID, you will have to register before you can request an API Key.\n\n"
            "Open the developer portal in your default browser now?"
        )
        if open_now:
            url = "https://dev.elsevier.com/sc_apis.html"
            webbrowser.open(url)
    
    def show_contact_developer(self):
        """Show developer contact information and open GitHub profile"""
        import webbrowser
        
        # Prompt to open the GitHub profile (dark-mode compatible)
        open_now = self._ask_yes_no(
            "Developer",
            "If you have questions, suggestions, or need support, please feel free to contact the developer.\n\n"
            "Open the developer's GitHub profile in your default browser now?"
        )
        if open_now:
            url = "https://github.com/socresearcher"
            webbrowser.open(url)
    
    def close_app(self):
        """Close the application"""
        # Ask for confirmation (dark-mode compatible)
        result = self._ask_yes_no(
            "Close Application",
            "Are you sure you want to close the application?"
        )
        
        if result:
            self.quit()
            self.destroy()
    
    def relaunch_app(self):
        """Restart the application"""
        import subprocess
        import sys
        import os
        
        # Ask for confirmation (dark-mode compatible)
        result = self._ask_yes_no(
            "Restart Application",
            "Are you sure you want to restart the application?"
        )
        
        if result:
            try:
                if getattr(sys, "frozen", False):
                    # Running as PyInstaller EXE
                    exe_path = sys.executable
                    app_dir = os.path.dirname(exe_path)
                    subprocess.Popen([exe_path], cwd=app_dir)
                else:
                    # Running from source
                    script_path = os.path.abspath(sys.argv[0])
                    app_dir = os.path.dirname(script_path)
                    subprocess.Popen([sys.executable, script_path], cwd=app_dir)
            except Exception as e:
                print(f"Error restarting application: {e}")
            finally:
                # Close current window
                self.quit()
                self.destroy()

    # --- Dark-mode compatible dialogs ---
    def _ask_yes_no(self, title: str, message: str) -> bool:
        dialog = ctk.CTkToplevel(self)
        dialog.title(title)
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        # Container
        frame = ctk.CTkFrame(dialog)
        frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        frame.grid_columnconfigure(0, weight=1)

        # Title
        title_lbl = ctk.CTkLabel(frame, text=title, font=ctk.CTkFont(size=16, weight="bold"))
        title_lbl.grid(row=0, column=0, sticky="w")

        # Message (wrap to a reasonable width)
        try:
            screen_w = dialog.winfo_screenwidth()
            wrap_len = int(min(max(360, screen_w * 0.4), 720))
        except Exception:
            wrap_len = 480
        msg_lbl = ctk.CTkLabel(frame, text=message, font=ctk.CTkFont(size=12), justify="left", wraplength=wrap_len, anchor="w")
        msg_lbl.grid(row=1, column=0, sticky="w", pady=(8, 12))

        result = {"val": False}

        def _yes():
            result["val"] = True
            dialog.destroy()

        def _no():
            result["val"] = False
            dialog.destroy()

        # Center button row with consistent spacing (matches shim)
        btns = ctk.CTkFrame(frame, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="ew")
        btns.grid_columnconfigure(0, weight=1)
        btns.grid_columnconfigure(2, weight=1)
        center = ctk.CTkFrame(btns, fg_color="transparent")
        center.grid(row=0, column=1)
        gap = 12
        ctk.CTkButton(center, text="No", width=100, command=_no).pack(side="left", padx=(0, gap))
        ctk.CTkButton(center, text="Yes", width=100, fg_color="green", hover_color="darkgreen", command=_yes).pack(side="left")

        # Center dialog on screen based on requested size (prevents clipping/square boxes)
        dialog.update_idletasks()
        w = dialog.winfo_reqwidth()
        h = dialog.winfo_reqheight()
        sw = dialog.winfo_screenwidth()
        sh = dialog.winfo_screenheight()
        x = (sw - w) // 2
        y = (sh - h) // 2
        dialog.geometry(f"+{x}+{y}")

        dialog.wait_window()
        return result["val"]

    def _show_info(self, title: str, message: str):
        dlg = ctk.CTkToplevel(self)
        dlg.title(title)
        dlg.resizable(False, False)
        dlg.transient(self)
        dlg.grab_set()

        frame = ctk.CTkFrame(dlg)
        frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(frame, text=title, font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w")
        ctk.CTkLabel(frame, text=message, font=ctk.CTkFont(size=12), justify="left").grid(row=1, column=0, sticky="w", pady=(8, 12))
        ctk.CTkButton(frame, text="OK", width=100, command=dlg.destroy).grid(row=2, column=0, sticky="e")
        dlg.update_idletasks()
        x = (dlg.winfo_screenwidth() // 2) - (dlg.winfo_width() // 2)
        y = (dlg.winfo_screenheight() // 2) - (dlg.winfo_height() // 2)
        dlg.geometry(f"+{x}+{y}")
        dlg.wait_window()


def main():
    """Main entry point for the dashboard"""
    app = Dashboard()
    app.mainloop()


if __name__ == "__main__":
    main()
