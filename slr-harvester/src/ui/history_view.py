"""
History View for SLR Harvester
Displays search history with visualizations and article management
"""

import sys
from pathlib import Path

# Add src directory to path for imports (when run directly)
src_dir = Path(__file__).parent.parent
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import customtkinter as ctk
import json
import os
import webbrowser
from pathlib import Path
from typing import List, Dict, Optional, Any
import re
from datetime import datetime
import tkinter as tk
from utils.mb_shim import messagebox
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from matplotlib.patches import Circle
import matplotlib
from utils.tooltip import ToolTip
from api.client import ScopusAPIClient

# Configure matplotlib for better appearance
matplotlib.use('TkAgg')
matplotlib.rcParams['agg.path.chunksize'] = 10000

# Keep visualization sizing identical between history and corpus views
DOUGHNUT_FIGSIZE = (3.2, 3.2)
DOUGHNUT_CANVAS_PX = int(DOUGHNUT_FIGSIZE[1] * 100)
YEAR_CHART_FIGSIZE = (5.0, 3.0)
YEAR_CANVAS_PX = (int(YEAR_CHART_FIGSIZE[0] * 100), int(YEAR_CHART_FIGSIZE[1] * 100))
YEAR_CONTAINER_HEIGHT = YEAR_CANVAS_PX[1] + 40  # allocate more height to chart and reduce note gap
HEADER_TITLE_MIN_WIDTH = 230
# Slightly reduce right controls min width to free space for pagination on small screens
HEADER_CONTROLS_MIN_WIDTH = 180


class HistoryView(ctk.CTkFrame):
    """
    History View with:
    - Query list with search/filter
    - Permanent visualizations (Doughnut + Year distribution)
    - Article list with annotations
    """
    
    def __init__(self, parent, workspace_path: str, project_folder: str = ""):
        super().__init__(parent, corner_radius=0, fg_color="transparent")
        
        self.workspace_path = Path(workspace_path)
        self.project_folder = project_folder
        
        # Project-specific paths
        self.project_path = self.workspace_path / "projects" / project_folder
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.search_log_path = self.project_path / "search_log.json"
        
        # Migrate old data if this is the bachelor_thesis project and files don't exist yet
        if project_folder == "bachelor_thesis" and not self.search_log_path.exists():
            old_search_log = self.workspace_path / "results" / "search_log.json"
            if old_search_log.exists():
                import shutil
                shutil.copy2(old_search_log, self.search_log_path)
                print(f"Migrated search_log.json to {self.search_log_path}")
        
        # UI State
        self.query_list_visible: bool = True  # Show query list by default
        self.visualizations_visible: bool = True  # Show visualizations by default
        self.tag_sidebar_visible: bool = False  # Tag sidebar hidden by default
        self.filter_sidebar_visible: bool = False  # Filter sidebar hidden by default
        
        # Filter settings
        self.year_from_var = tk.StringVar(value="")
        self.year_to_var = tk.StringVar(value="")
        self.sort_order_var = tk.StringVar(value="newest")  # newest, oldest, year_asc, year_desc
        
        # Data
        self.query_history: List[Dict] = []
        self.current_query: Optional[Dict] = None
        self.selected_article: Optional[Dict] = None
        self.selected_articles: set = set()  # Set of EIDs for multi-selection
        self.global_tags: Dict = {}
        self.locked_queries: set = set()  # Track locked query timestamps
        self.query_names: Dict[str, str] = {}  # Store custom names for queries (by timestamp)
        self.favorite_queries: set = set()  # Track favorite query timestamps
        self.active_tag_filter: Optional[str] = None  # Active tag filter
        self.tag_aliases: Dict[str, str] = {}  # Tag aliases (color key -> display name)
        
        # Filter variables (initialized early for use in _update_article_list)
        self.filter_selected_var = tk.BooleanVar(value=False)
        self.filter_corpus_var = tk.BooleanVar(value=False)
        
        # Year distribution controls
        self.show_unknown_year_var = tk.BooleanVar(value=True)
        self.hide_empty_years_var = tk.BooleanVar(value=False)
        
        # Pagination state
        self.current_page: int = 0
        self.articles_per_page: int = 50  # Show 50 articles per page
        self.filtered_results: List[Dict] = []  # Store filtered results for pagination
        # Debounce handle for visualization updates
        self._viz_after_id = None
        
        # Keyboard navigation state
        self.focused_query_idx: int = 0  # Currently focused query in list
        self.focused_article_idx: int = 0  # Currently focused article in list
        
        # Tag colors - matching the original SLR Harvester palette
        self.tag_colors = {
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

        # Initialize tag label mappings (needed for filter sidebar)
        self._tag_label_to_key = {}
        self._tag_key_to_label = {}

        # Apply project custom tag colors before loading UI
        if hasattr(self, '_load_tag_colors'):
            self._load_tag_colors()

        # Load data
        self._load_history()
        # Build EID -> abstract index from all queries for fallback
        self._build_abstract_index()
        self._load_global_tags()
        self._load_query_names()
        self._load_favorite_queries()
        self._load_locked_queries()
        self._load_tag_aliases()
        
        # Load icons
        self._load_icons()
        
        # Setup UI
        self._setup_ui()
        
        # Load first query if available
        if self.query_history:
            self._select_query(0)
    
    def _load_history(self):
        """Load search history from JSON file"""
        try:
            if self.search_log_path.exists():
                with open(self.search_log_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.query_history = data if isinstance(data, list) else []
        except Exception as e:
            print(f"Error loading history: {e}")
            self.query_history = []

    def _build_abstract_index(self):
        """Build a lookup of eid -> abstract (first non-empty across known keys) across all queries"""
        self._abstract_index = {}
        try:
            for q in self.query_history:
                for a in q.get('results', []):
                    eid = a.get('eid') or ''
                    # Consider multiple possible fields used historically
                    for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                        abs_txt = (a.get(key) or '').strip()
                        if abs_txt:
                            break
                    if eid and abs_txt and eid not in self._abstract_index:
                        self._abstract_index[eid] = abs_txt
        except Exception as e:
            print(f"Error building abstract index: {e}")
    
    def _load_global_tags(self):
        """Load global tags from JSON file (project-specific)"""
        try:
            global_tags_path = self.project_path / "slr_global_tags.json"
            
            # Migrate old data if this is bachelor_thesis and file doesn't exist
            if self.project_folder == "bachelor_thesis" and not global_tags_path.exists():
                old_tags_path = self.workspace_path / "slr_global_tags.json"
                if old_tags_path.exists():
                    import shutil
                    shutil.copy2(old_tags_path, global_tags_path)
                    print(f"Migrated slr_global_tags.json to {global_tags_path}")
            if global_tags_path.exists():
                with open(global_tags_path, "r", encoding="utf-8") as f:
                    self.global_tags = json.load(f)
        except Exception as e:
            print(f"Error loading global tags: {e}")
            self.global_tags = {}
    
    def _load_query_names(self):
        """Load custom query names from JSON file"""
        try:
            query_names_path = self.project_path / "query_names.json"
            if query_names_path.exists():
                with open(query_names_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Migrate old index-based data to timestamp-based
                    if data and isinstance(data, dict):
                        # Check if keys look like indices (all numeric strings)
                        all_numeric = all(k.isdigit() for k in data.keys())
                        if all_numeric:
                            # Migration: convert index-based to timestamp-based
                            print("Migrating query_names from index-based to timestamp-based...")
                            migrated = {}
                            for idx_str, name in data.items():
                                idx = int(idx_str)
                                if 0 <= idx < len(self.query_history):
                                    timestamp = self.query_history[idx].get('timestamp', '')
                                    if timestamp:
                                        migrated[timestamp] = name
                            self.query_names = migrated
                            # Save migrated data
                            self._save_query_names()
                        else:
                            # Already timestamp-based
                            self.query_names = data
                    else:
                        self.query_names = {}
        except Exception as e:
            print(f"Error loading query names: {e}")
            self.query_names = {}
    
    def _save_query_names(self):
        """Save custom query names to JSON file"""
        try:
            query_names_path = self.project_path / "query_names.json"
            # Data is stored with timestamps as keys (already strings)
            with open(query_names_path, "w", encoding="utf-8") as f:
                json.dump(self.query_names, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving query names: {e}")
    
    def _load_favorite_queries(self):
        """Load favorite queries from JSON file"""
        try:
            fav_path = self.project_path / "query_favorites.json"
            if fav_path.exists():
                with open(fav_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list) and data:
                        # Check if data contains integers (old format) or strings (new format)
                        if isinstance(data[0], int):
                            # Migration: convert index-based to timestamp-based
                            print("Migrating favorite_queries from index-based to timestamp-based...")
                            migrated = set()
                            for idx in data:
                                if 0 <= idx < len(self.query_history):
                                    timestamp = self.query_history[idx].get('timestamp', '')
                                    if timestamp:
                                        migrated.add(timestamp)
                            self.favorite_queries = migrated
                            # Save migrated data
                            self._save_favorite_queries()
                        else:
                            # Already timestamp-based
                            self.favorite_queries = set(data)
                    else:
                        self.favorite_queries = set()
        except Exception as e:
            print(f"Error loading favorite queries: {e}")
            self.favorite_queries = set()
    
    def _save_favorite_queries(self):
        """Save favorite queries to JSON file"""
        try:
            fav_path = self.project_path / "query_favorites.json"
            # Convert set to sorted list for JSON
            data = sorted(list(self.favorite_queries))
            with open(fav_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving favorite queries: {e}")
    
    def _load_locked_queries(self):
        """Load locked queries from JSON file"""
        try:
            locked_path = self.project_path / "query_locked.json"
            if locked_path.exists():
                with open(locked_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list) and data:
                        # Check if data contains integers (old format) or strings (new format)
                        if isinstance(data[0], int):
                            # Migration: convert index-based to timestamp-based
                            print("Migrating locked_queries from index-based to timestamp-based...")
                            migrated = set()
                            for idx in data:
                                if 0 <= idx < len(self.query_history):
                                    timestamp = self.query_history[idx].get('timestamp', '')
                                    if timestamp:
                                        migrated.add(timestamp)
                            self.locked_queries = migrated
                            # Save migrated data
                            self._save_locked_queries()
                        else:
                            # Already timestamp-based
                            self.locked_queries = set(data)
                    else:
                        self.locked_queries = set()
        except Exception as e:
            print(f"Error loading locked queries: {e}")
            self.locked_queries = set()
    
    def _save_locked_queries(self):
        """Save locked queries to JSON file"""
        try:
            locked_path = self.project_path / "query_locked.json"
            # Convert set to sorted list of timestamps for JSON
            data = sorted(list(self.locked_queries))
            with open(locked_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving locked queries: {e}")
    
    def _load_tag_aliases(self):
        """Load tag aliases with project-level override"""
        try:
            # Prefer project-level tag_aliases.json
            project_aliases = self.project_path / "tag_aliases.json"
            if project_aliases.exists():
                with open(project_aliases, "r", encoding="utf-8") as f:
                    self.tag_aliases = json.load(f)
                    print(f"Loaded {len(self.tag_aliases)} tag aliases (project)")
            else:
                # Fallback to workspace-level GUI settings
                config_path = self.workspace_path / "slr_gui_settings.json"
                if config_path.exists():
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                        self.tag_aliases = config.get('tag_aliases', {})
                        print(f"Loaded {len(self.tag_aliases)} tag aliases (global)")

            # If no aliases found, create default (color name = display name)
            if not self.tag_aliases:
                self.tag_aliases = {k: k for k in self.tag_colors.keys()}
                print("Using default tag aliases (color names)")
        except Exception as e:
            print(f"Error loading tag aliases: {e}")
            # Default: color name = display name
            self.tag_aliases = {k: k for k in self.tag_colors.keys()}

        # Update tag label mappings after loading aliases
        self._tag_label_to_key = {self._tag_label(k): k for k in self.tag_colors.keys()}
        self._tag_key_to_label = {k: self._tag_label(k) for k in self.tag_colors.keys()}

    def _load_tag_colors(self):
        """Load custom tag colors from project config and merge with defaults"""
        try:
            tags_config = self.project_path / "tags_config.json"
            if tags_config.exists():
                with open(tags_config, "r", encoding="utf-8") as f:
                    custom = json.load(f)
                    # Use the project-defined tags as the authoritative set (deleted tags stay deleted)
                    if isinstance(custom, dict):
                        # Ensure "None" pseudo-tag is always present
                        if "None" not in custom:
                            custom["None"] = ""
                        self.tag_colors = custom
                        print(f"Loaded {len(custom)} project tag colors from tags_config.json")
        except Exception as e:
            print(f"Error loading tag colors: {e}")

    def _refresh_tag_dropdowns(self):
        """Reload tag aliases/colors and refresh dropdowns, lists, and visualizations"""
        self._load_tag_colors()
        self._load_tag_aliases()
        # Refresh tag filter dropdown values
        try:
            if hasattr(self, 'tag_filter_dropdown'):
                tag_labels = ["All"] + sorted([self._tag_label(k) for k in self.tag_colors.keys() if k != "None"], key=lambda x: x.lower())
                self.tag_filter_dropdown.configure(values=tag_labels)
                # Ensure current selection is valid
                try:
                    current = self.tag_filter_var.get() if hasattr(self, 'tag_filter_var') else "All"
                    if current not in tag_labels:
                        self.tag_filter_var.set("All")
                except Exception:
                    pass
        except Exception:
            pass
        # Refresh assign dropdown
        try:
            if hasattr(self, 'assign_tag_dropdown'):
                tag_labels = sorted([self._tag_label(k) for k in self.tag_colors.keys()], key=lambda x: x.lower())
                self.assign_tag_dropdown.configure(values=tag_labels)
                # Ensure current selection is valid
                try:
                    current_assign = self.assign_tag_var.get() if hasattr(self, 'assign_tag_var') else None
                    default_label = self._tag_label("None")
                    if current_assign not in tag_labels:
                        self.assign_tag_var.set(default_label)
                except Exception:
                    pass
        except Exception:
            pass
        # Refresh article list and visualizations
        self._update_article_list()
        self._update_visualizations()
    
    def _tag_label(self, tag_key: str) -> str:
        """Get display label for a tag color key"""
        return self.tag_aliases.get(tag_key, tag_key)
    
    def _load_icons(self):
        """Load icons for buttons with automatic dark mode inversion"""
        try:
            from PIL import Image, ImageChops
            import numpy as np
            from utils.ui_helpers import get_assets_icons_dir
            icons_path = get_assets_icons_dir()
            
            def invert_with_alpha(img):
                """Invert image colors while preserving transparency"""
                img = img.convert('RGBA')
                # Split into channels
                r, g, b, a = img.split()
                # Invert RGB channels
                r = ImageChops.invert(r)
                g = ImageChops.invert(g)
                b = ImageChops.invert(b)
                # Merge back with original alpha
                return Image.merge('RGBA', (r, g, b, a))
            
            # Load previous/next icons with inversion for dark mode
            prev_img_light = Image.open(icons_path / "previous.png").convert('RGBA')
            next_img_light = Image.open(icons_path / "next.png").convert('RGBA')
            
            # Create inverted versions for dark mode (preserving transparency)
            prev_img_dark = invert_with_alpha(prev_img_light)
            next_img_dark = invert_with_alpha(next_img_light)
            
            # Load sidebar icons WITH inversion for dark mode
            sidebar_l_img_light = Image.open(icons_path / "sidebar-l.png").convert('RGBA')
            sidebar_l_act_img_light = Image.open(icons_path / "sidebar-l-act.png").convert('RGBA')
            sidebar_r_img_light = Image.open(icons_path / "sidebar-r.png").convert('RGBA')
            sidebar_r_act_img_light = Image.open(icons_path / "sidebar-r-act.png").convert('RGBA')
            sidebar_b_img_light = Image.open(icons_path / "sidebar-b.png").convert('RGBA')
            sidebar_b_act_img_light = Image.open(icons_path / "sidebar-b-act.png").convert('RGBA')
            sidebar_t_img_light = Image.open(icons_path / "sidebar-t.png").convert('RGBA')
            sidebar_t_act_img_light = Image.open(icons_path / "sidebar-t-act.png").convert('RGBA')
            
            # Create inverted versions for dark mode (preserving transparency)
            sidebar_l_img_dark = invert_with_alpha(sidebar_l_img_light)
            sidebar_l_act_img_dark = invert_with_alpha(sidebar_l_act_img_light)
            sidebar_r_img_dark = invert_with_alpha(sidebar_r_img_light)
            sidebar_r_act_img_dark = invert_with_alpha(sidebar_r_act_img_light)
            sidebar_b_img_dark = invert_with_alpha(sidebar_b_img_light)
            sidebar_b_act_img_dark = invert_with_alpha(sidebar_b_act_img_light)
            sidebar_t_img_dark = invert_with_alpha(sidebar_t_img_light)
            sidebar_t_act_img_dark = invert_with_alpha(sidebar_t_act_img_light)
            
            # Create CTkImage objects with separate light/dark images
            self.icon_previous = ctk.CTkImage(light_image=prev_img_light, dark_image=prev_img_dark, size=(16, 16))
            self.icon_next = ctk.CTkImage(light_image=next_img_light, dark_image=next_img_dark, size=(16, 16))
            # Sidebar icons larger (20x20)
            self.icon_sidebar_l = ctk.CTkImage(light_image=sidebar_l_img_light, dark_image=sidebar_l_img_dark, size=(20, 20))
            self.icon_sidebar_l_act = ctk.CTkImage(light_image=sidebar_l_act_img_light, dark_image=sidebar_l_act_img_dark, size=(20, 20))
            self.icon_sidebar_r = ctk.CTkImage(light_image=sidebar_r_img_light, dark_image=sidebar_r_img_dark, size=(20, 20))
            self.icon_sidebar_r_act = ctk.CTkImage(light_image=sidebar_r_act_img_light, dark_image=sidebar_r_act_img_dark, size=(20, 20))
            self.icon_sidebar_b = ctk.CTkImage(light_image=sidebar_b_img_light, dark_image=sidebar_b_img_dark, size=(20, 20))
            self.icon_sidebar_b_act = ctk.CTkImage(light_image=sidebar_b_act_img_light, dark_image=sidebar_b_act_img_dark, size=(20, 20))
            self.icon_sidebar_t = ctk.CTkImage(light_image=sidebar_t_img_light, dark_image=sidebar_t_img_dark, size=(20, 20))
            self.icon_sidebar_t_act = ctk.CTkImage(light_image=sidebar_t_act_img_light, dark_image=sidebar_t_act_img_dark, size=(20, 20))
        except Exception as e:
            print(f"Error loading icons: {e}")
            # Set to None if loading fails
            self.icon_previous = None
            self.icon_next = None
            self.icon_sidebar_l = None
            self.icon_sidebar_l_act = None
            self.icon_sidebar_r = None
            self.icon_sidebar_r_act = None
            self.icon_sidebar_b = None
            self.icon_sidebar_b_act = None
            self.icon_sidebar_t = None
            self.icon_sidebar_t_act = None
    
    def _save_global_tags(self):
        """Save global tags to JSON file (project-specific)"""
        try:
            global_tags_path = self.project_path / "slr_global_tags.json"
            with open(global_tags_path, "w", encoding="utf-8") as f:
                json.dump(self.global_tags, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving global tags: {e}")
    
    def _get_article_tag_info(self, article: Dict) -> tuple:
        """Get tag information for an article from global tags (supports new and legacy keys)"""
        eid = article.get('eid', '')

        # Start with article's own fields (prefer new keys, fallback to legacy)
        favorite = article.get('selected', False)
        must_cite = article.get('corpus', False)
        color = 'None'
        tag = self._tag_label('None')

        # Override with global_tags if available and resolve alias display name
        if eid and eid in self.global_tags:
            tag_data = self.global_tags[eid]
            color = tag_data.get('color', 'None')  # Color key for lookup in tag_colors
            # Display name is always derived from current alias mapping
            tag = self._tag_label(color)
            favorite = tag_data.get('selected', favorite)
            must_cite = tag_data.get('corpus', must_cite)

        return color, tag, favorite, must_cite
    
    def _setup_ui(self):
        """Setup the main UI layout"""
        # Configure grid (will be updated dynamically)
        self.grid_rowconfigure(0, weight=1)
        self._update_grid_layout()
        
        # Left: Query List
        self._create_query_list()
        
        # Middle: Article List
        self._create_article_list()
        
        # Right: Visualizations (create container but don't load yet)
        self._create_visualizations()
    
    def _update_grid_layout(self):
        """Update grid layout based on query list and visualization visibility"""
        # Configure query list column
        if self.query_list_visible:
            self.grid_columnconfigure(0, weight=0, minsize=360)  # Left sidebar (query list) - fixed width
        else:
            self.grid_columnconfigure(0, weight=0, minsize=0)  # Left sidebar hidden
        
        # Configure visualizations column - fixed width for consistent layout
        if self.visualizations_visible:
            # With visualizations: article list gets all remaining space, viz is fixed
            self.grid_columnconfigure(1, weight=1)  # Middle (article list) - takes all remaining space
            self.grid_columnconfigure(2, weight=0, minsize=620)  # Right (visualizations) - fixed 620px
        else:
            # Without visualizations: article list takes all available space
            self.grid_columnconfigure(1, weight=1)  # Middle (article list) - takes all remaining
            self.grid_columnconfigure(2, weight=0, minsize=0)  # Right (visualizations) - no space
    
    def _create_query_list(self):
        """Create the left sidebar with query list"""
        # Container
        self.query_frame = ctk.CTkFrame(self, corner_radius=15)
        self.query_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 5), pady=0)
        self.query_frame.grid_rowconfigure(2, weight=1)
        self.query_frame.grid_columnconfigure(0, weight=1)
        
        # Hide if not visible
        if not self.query_list_visible:
            self.query_frame.grid_remove()
        
        # Header
        self.query_header = ctk.CTkLabel(
            self.query_frame,
            text=f"Search History ({len(self.query_history)})",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        self.query_header.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")
        
        # Search/Filter
        self.search_var = ctk.StringVar()
        self.search_var.trace_add("write", lambda *_: self._filter_queries())
        search_entry = ctk.CTkEntry(
            self.query_frame,
            placeholder_text="Filter queries...",
            textvariable=self.search_var,
            height=28
        )
        search_entry.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="ew")
        
        # Query list (scrollable)
        self.query_list_container = ctk.CTkScrollableFrame(self.query_frame, fg_color="transparent")
        self.query_list_container.grid(row=2, column=0, padx=10, pady=0, sticky="nsew")
        self.query_list_container.grid_columnconfigure(0, weight=1)
        
        # Bind keyboard navigation for query list to the query_frame
        self.query_frame.bind("<Up>", self._navigate_query_up)
        self.query_frame.bind("<Down>", self._navigate_query_down)
        self.query_frame.bind("<Return>", self._select_focused_query)
        # Make frame focusable
        self.query_frame.bind("<Button-1>", lambda e: (self.query_frame.focus_set(), self.query_frame.focus_force()))
        self.query_list_container.bind("<Button-1>", lambda e: (self.query_frame.focus_set(), self.query_frame.focus_force()))
        # Set initial focus
        self.after(100, lambda: self.query_frame.focus_set())
        
        self.query_buttons = []
        self._populate_query_list(self.query_list_container)
    
    def _populate_query_list(self, container, filter_text: str = ""):
        """Populate the query list with optional filtering"""
        # Clear existing
        for widget in container.winfo_children():
            widget.destroy()
        self.query_buttons.clear()
        
        # Filter queries if search text provided
        filter_lower = filter_text.lower().strip()
        filtered_queries = []
        
        for idx, query in enumerate(self.query_history):
            if not filter_lower:
                # No filter, include all
                filtered_queries.append((idx, query))
            else:
                # Check if filter text is in the query string
                query_text = query.get('query', '').lower()
                if filter_lower in query_text:
                    filtered_queries.append((idx, query))
        
        # Add filtered queries
        for display_idx, (original_idx, query) in enumerate(filtered_queries):
            # Use timestamp as unique identifier instead of index
            query_timestamp = query.get('timestamp', '')
            is_locked = query_timestamp in self.locked_queries
            is_favorite = query_timestamp in self.favorite_queries
            
            # Query card (let height adapt to content to avoid clipping/overlap)
            card = ctk.CTkFrame(container, corner_radius=8)
            card.grid(row=display_idx, column=0, padx=5, pady=5, sticky="ew")
            card.grid_columnconfigure(0, weight=1)
            # Allow the frame to size itself based on its children
            card.grid_propagate(True)
            
            # Apply styling based on state
            if is_locked:
                # Locked queries: gray out the whole card with a distinct gray, no outlines
                mode = ctk.get_appearance_mode()
                locked_bg = '#dddddd' if mode != 'Dark' else '#2a2a2a'
                card.configure(border_width=0, fg_color=locked_bg)
            elif is_favorite:
                # Favorite queries: keep yellow outline (only when not locked)
                card.configure(border_width=2, border_color="#FFD700")
            
            # Highlight if this is the focused query
            if original_idx == self.focused_query_idx:
                card.configure(fg_color=("gray70", "gray30"))
            
            # Show big icons in top-right for favorites/locked
            if is_favorite:
                star_label = ctk.CTkLabel(
                    card,
                    text="⭐",
                    font=ctk.CTkFont(size=16)
                )
                star_label.place(relx=1.0, rely=0.0, anchor="ne", x=-8, y=8)
            if is_locked:
                lock_label = ctk.CTkLabel(
                    card,
                    text="🔒",
                    font=ctk.CTkFont(size=16)
                )
                # Place slightly left if star already present
                offset_x = -32 if is_favorite else -8
                lock_label.place(relx=1.0, rely=0.0, anchor="ne", x=offset_x, y=8)
            
            current_row = 0
            
            # Determine if this query has a custom name
            has_custom_name = query_timestamp in self.query_names
            custom_name_text = self.query_names.get(query_timestamp, "") if has_custom_name else None
            
            # Number and date
            # Queries are stored newest-first, so reverse numbering: latest query = highest number
            query_number = len(self.query_history) - original_idx
            timestamp = query.get('timestamp', 'Unknown')
            count = query.get('count', 0)
            # Info line: no inline icons anymore
            info = ctk.CTkLabel(
                card,
                text=f"#{query_number} • {timestamp} • {count} results",
                font=ctk.CTkFont(size=11),
                text_color="gray",
                anchor="w"
            )
            info.grid(row=current_row, column=0, padx=10, pady=(2 if current_row > 0 else 8, 2), sticky="w")
            current_row += 1
            
            # Second line: show custom name (if set) OR query preview (if unnamed)
            if has_custom_name:
                name_label = ctk.CTkLabel(
                    card,
                    text=custom_name_text,
                    font=ctk.CTkFont(size=13, weight="bold"),
                    anchor="w",
                    text_color=("#2196F3", "#64B5F6")
                )
                name_label.grid(row=current_row, column=0, padx=10, pady=(2, 8), sticky="w")
            else:
                # Unnamed query: show query text preview
                # Normalize whitespace to render a compact, single-line preview regardless of original formatting
                raw_query_text = query.get('query', '')
                normalized = re.sub(r"\s+", " ", raw_query_text).strip()
                query_text = normalized[:57] + "..." if len(normalized) > 60 else normalized
                # Inner frame to provide safe horizontal padding for the preview text
                ql_frame = ctk.CTkFrame(card, fg_color="transparent")
                ql_frame.grid(row=current_row, column=0, padx=12, pady=(2, 8), sticky="ew")
                ql_frame.grid_columnconfigure(0, weight=1)

                query_label = ctk.CTkLabel(
                    ql_frame,
                    text=query_text,
                    font=ctk.CTkFont(size=12),
                    anchor="w",
                    justify="left",
                    wraplength=220
                )
                query_label.grid(row=0, column=0, sticky="w")
                # Make wraplength follow the inner frame width and wrap earlier to avoid clipping
                def _set_query_wrap(event=None, lbl=query_label, container=ql_frame):
                    try:
                        # Prefer container (inner frame) width to avoid feedback on label size
                        cw = container.winfo_width()
                        if cw and cw > 0:
                            # Subtract inner paddings and a generous safety margin
                            w = max(180, cw - 56)
                        else:
                            # Fallbacks: try label width, then a conservative default
                            lw = lbl.winfo_width()
                            if lw and lw > 0:
                                w = max(180, lw - 36)
                            else:
                                w = 220
                        lbl.configure(wraplength=w)
                    except Exception:
                        pass
                _set_query_wrap()
                # Recalculate after layout settles and on resize
                self.after(0, _set_query_wrap)
                card.bind("<Configure>", _set_query_wrap)
                query_label.bind("<Configure>", _set_query_wrap)
                query_label.bind("<Configure>", _set_query_wrap)
            
            # Make card clickable (only if not locked)
            def make_click_handler(i, locked):
                def handler(e=None):
                    if not locked:
                        self._select_query(i)
                return handler
            
            # Right-click context menu
            def make_context_handler(timestamp, q, c):
                return lambda e: self._show_query_context_menu(e, timestamp, q, c)
            
            click_handler = make_click_handler(original_idx, is_locked)
            context_handler = make_context_handler(query_timestamp, query, card)
            
            card.bind("<Button-1>", click_handler)
            info.bind("<Button-1>", click_handler)
            
            # Right-click for context menu
            card.bind("<Button-3>", context_handler)
            info.bind("<Button-3>", context_handler)
            
            # Hover effect
            def on_enter(e, c=card):
                # Do not change hover color for locked queries
                if is_locked:
                    return
                c.configure(fg_color=("gray75", "gray30"))

            def on_leave(e, c=card):
                # Do not change hover color for locked queries
                if is_locked:
                    return
                c.configure(fg_color=("gray90", "gray20"))
            
            card.bind("<Enter>", on_enter)
            card.bind("<Leave>", on_leave)
            info.bind("<Enter>", on_enter)
            info.bind("<Leave>", on_leave)
            
            # Bind to query_label only if it exists (unnamed queries)
            if not has_custom_name:
                query_label.bind("<Button-1>", click_handler)
                query_label.bind("<Button-3>", context_handler)
                query_label.bind("<Enter>", on_enter)
                query_label.bind("<Leave>", on_leave)
            
            # Bind to name_label if it exists (named queries)
            if has_custom_name:
                name_label.bind("<Button-1>", click_handler)
                name_label.bind("<Button-3>", context_handler)
                name_label.bind("<Enter>", on_enter)
                name_label.bind("<Leave>", on_leave)
            
            self.query_buttons.append((card, original_idx))
        
        # Return count of filtered queries
        return len(filtered_queries)
    
    def _filter_queries(self):
        """Filter queries based on search text"""
        filter_text = self.search_var.get()
        
        # Repopulate the query list with the filter
        filtered_count = self._populate_query_list(self.query_list_container, filter_text)
        
        # Update header with count
        if filter_text.strip():
            self.query_header.configure(
                text=f"Search History ({filtered_count} of {len(self.query_history)})"
            )
        else:
            self.query_header.configure(
                text=f"Search History ({len(self.query_history)})"
            )
    
    def _show_query_context_menu(self, event, query_timestamp: str, query: Dict, card):
        """Show context menu for query card"""
        from tkinter import Menu
        
        menu = Menu(self, tearoff=0)
        
        # Dark mode support
        if ctk.get_appearance_mode() == 'Dark':
            menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        
        is_locked = query_timestamp in self.locked_queries
        is_favorite = query_timestamp in self.favorite_queries
        
        # Favorite option
        if is_favorite:
            menu.add_command(label="Unfavorite Query", command=lambda: self._toggle_favorite_query(query_timestamp))
        else:
            menu.add_command(label="Favorite Query", command=lambda: self._toggle_favorite_query(query_timestamp))
        
        menu.add_separator()
        
        # Lock/Unlock option
        if is_locked:
            menu.add_command(label="Unlock Query", command=lambda: self._toggle_lock_query(query_timestamp))
        else:
            menu.add_command(label="Lock Query", command=lambda: self._toggle_lock_query(query_timestamp))
        
        menu.add_separator()
        
        # Name query option
        current_name = self.query_names.get(query_timestamp, "")
        if current_name:
            menu.add_command(label=f"Edit Name ({current_name})", command=lambda: self._name_query(query_timestamp))
            menu.add_command(label="Remove Name", command=lambda: self._remove_query_name(query_timestamp))
        else:
            menu.add_command(label="Name Query", command=lambda: self._name_query(query_timestamp))
        
        menu.add_separator()
        
        # Show query
        menu.add_command(label="Show Query", command=lambda: self._show_query_dialog(query))
        
        # Copy query
        menu.add_command(label="Copy Query", command=lambda: self._copy_query_to_clipboard(query))
        
        menu.add_separator()
        
        # Export submenu
        export_menu = Menu(menu, tearoff=0)
        if ctk.get_appearance_mode() == 'Dark':
            export_menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            export_menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        export_menu.add_command(label="Export as RIS", command=lambda: self._export_query_results(query, 'ris'))
        export_menu.add_command(label="Export as BibTeX", command=lambda: self._export_query_results(query, 'bib'))
        export_menu.add_command(label="Export as CSV", command=lambda: self._export_query_results(query, 'csv'))
        menu.add_cascade(label="Export Results", menu=export_menu)
        
        menu.add_separator()
        
        # Delete query
        menu.add_command(label="Delete Query", command=lambda: self._delete_query(query_timestamp))
        
        # Show menu at cursor position
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()
    
    def _toggle_lock_query(self, query_timestamp: str):
        """Toggle lock status of a query"""
        if query_timestamp in self.locked_queries:
            self.locked_queries.remove(query_timestamp)
        else:
            self.locked_queries.add(query_timestamp)
        
        # Save and refresh
        self._save_locked_queries()
        self._filter_queries()
    
    def _toggle_favorite_query(self, query_timestamp: str):
        """Toggle favorite status of a query"""
        if query_timestamp in self.favorite_queries:
            self.favorite_queries.remove(query_timestamp)
        else:
            self.favorite_queries.add(query_timestamp)
        
        # Save and refresh
        self._save_favorite_queries()
        self._filter_queries()
    
    def _name_query(self, query_timestamp: str):
        """Allow user to name a query"""
        from tkinter import simpledialog
        
        current_name = self.query_names.get(query_timestamp, "")
        
        dialog = ctk.CTkInputDialog(
            text=f"Enter a name for this query:\n(Leave empty to remove name)",
            title="Name Query"
        )
        
        # Set current name if exists
        if current_name:
            dialog._entry.insert(0, current_name)
        
        new_name = dialog.get_input()
        
        if new_name is not None:  # User clicked OK (not Cancel)
            new_name = new_name.strip()
            if new_name:
                self.query_names[query_timestamp] = new_name
            else:
                # Remove name if empty
                if query_timestamp in self.query_names:
                    del self.query_names[query_timestamp]
            
            # Save and refresh
            self._save_query_names()
            self._filter_queries()
    
    def _remove_query_name(self, query_timestamp: str):
        """Remove custom name from a query"""
        if query_timestamp in self.query_names:
            del self.query_names[query_timestamp]
            self._save_query_names()
            self._filter_queries()
    
    def _navigate_query_up(self, event=None):
        """Navigate to previous query in list"""
        if self.focused_query_idx > 0:
            self.focused_query_idx -= 1
            self._filter_queries()
            return "break"
    
    def _navigate_query_down(self, event=None):
        """Navigate to next query in list"""
        if self.focused_query_idx < len(self.query_history) - 1:
            self.focused_query_idx += 1
            self._filter_queries()
            return "break"
    
    def _select_focused_query(self, event=None):
        """Select the currently focused query"""
        if 0 <= self.focused_query_idx < len(self.query_history):
            query = self.query_history[self.focused_query_idx]
            query_timestamp = query.get('timestamp', '')
            if not (query_timestamp in self.locked_queries):
                self._select_query(self.focused_query_idx)
        return "break"
    
    def _show_query_dialog(self, query: Dict):
        """Show query in a dialog window"""
        from utils.mb_shim import messagebox
        
        query_text = query.get('query', 'No query text')
        timestamp = query.get('timestamp', 'Unknown')
        count = query.get('count', 0)
        
        dialog = ctk.CTkToplevel(self)
        dialog.title("Query Details")
        dialog.geometry("700x500")
        dialog.transient(self)
        
        # Header
        header = ctk.CTkLabel(
            dialog,
            text=f"Query from {timestamp}",
            font=ctk.CTkFont(size=16, weight="bold")
        )
        header.pack(padx=20, pady=(20, 10), anchor="w")
        
        info = ctk.CTkLabel(
            dialog,
            text=f"Results: {count}",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        info.pack(padx=20, pady=(0, 20), anchor="w")
        
        # Query text
        query_frame = ctk.CTkFrame(dialog)
        query_frame.pack(fill="both", expand=True, padx=20, pady=(0, 20))
        
        query_textbox = ctk.CTkTextbox(
            query_frame,
            font=ctk.CTkFont(size=12),
            wrap="word"
        )
        query_textbox.pack(fill="both", expand=True, padx=10, pady=10)
        query_textbox.insert("1.0", query_text)
        query_textbox.configure(state="disabled")
        
        # Close button
        close_btn = ctk.CTkButton(
            dialog,
            text="Close",
            width=100,
            command=dialog.destroy
        )
        close_btn.pack(pady=(0, 20))
        
        # Center the dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - (dialog.winfo_width() // 2)
        y = (dialog.winfo_screenheight() // 2) - (dialog.winfo_height() // 2)
        dialog.geometry(f"+{x}+{y}")
    
    def _copy_query_to_clipboard(self, query: Dict):
        """Copy query text to clipboard"""
        query_text = query.get('query', '')
        if query_text:
            try:
                self.clipboard_clear()
                self.clipboard_append(query_text)
                print("Query copied to clipboard")
            except Exception as e:
                print(f"Error copying to clipboard: {e}")

    def _copy_doi_to_clipboard(self, doi: str):
        """Copy DOI string to clipboard and notify user."""
        doi = (doi or '').strip()
        if not doi:
            try:
                from utils.mb_shim import messagebox
                messagebox.showinfo("Copy DOI", "No DOI available for this article.")
            except Exception:
                pass
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(doi)
            from utils.mb_shim import messagebox
            messagebox.showinfo("Copy DOI", "DOI copied to clipboard.")
        except Exception as e:
            try:
                from utils.mb_shim import messagebox
                messagebox.showerror("Copy DOI", f"Failed to copy DOI: {e}")
            except Exception:
                pass
    
    def _delete_query(self, query_timestamp: str):
        """Delete a query from history"""
        from utils.mb_shim import messagebox
        
        # Find the query with this timestamp
        query_idx = None
        for idx, query in enumerate(self.query_history):
            if query.get('timestamp', '') == query_timestamp:
                query_idx = idx
                break
        
        if query_idx is None:
            print(f"Error: Could not find query with timestamp {query_timestamp}")
            return
        
        # Calculate the display query number (reversed, like in the UI)
        query_number = len(self.query_history) - query_idx
        
        # Confirm deletion
        result = messagebox.askyesno(
            "Delete Query",
            f"Are you sure you want to delete query #{query_number}?\n\nThis action cannot be undone.",
            icon='warning'
        )
        
        if result:
            try:
                print(f"Deleting query #{query_number} (timestamp {query_timestamp})")
                print(f"Query history length before deletion: {len(self.query_history)}")
                
                # Remove from history
                deleted_query = self.query_history[query_idx]
                del self.query_history[query_idx]
                
                print(f"Deleted query: {deleted_query.get('query', 'N/A')[:50]}...")
                print(f"Query history length after deletion: {len(self.query_history)}")
                
                # Remove from locked set if present (no index adjustment needed with timestamps!)
                self.locked_queries.discard(query_timestamp)
                
                # Remove from favorites set if present
                self.favorite_queries.discard(query_timestamp)
                
                # Remove custom name if present
                if query_timestamp in self.query_names:
                    del self.query_names[query_timestamp]
                
                # Save updated data
                print(f"Saving history to {self.search_log_path}")
                self._save_history()
                self._save_locked_queries()
                self._save_favorite_queries()
                self._save_query_names()
                
                # Clear current query and article list
                self.current_query = None
                self._update_article_list()
                
                # Refresh the query list
                self._filter_queries()
                
                print(f"Query #{query_number} deleted successfully")
                messagebox.showinfo("Success", f"Query #{query_number} has been deleted.")
            except Exception as e:
                print(f"Error during deletion: {e}")
                import traceback
                traceback.print_exc()
                messagebox.showerror("Error", f"Failed to delete query: {e}")
    
    def _export_query_results(self, query: Dict, format: str):
        """Export query results in specified format (ris, bib, csv)"""
        from datetime import datetime
        from utils.mb_shim import messagebox
        import csv
        
        results = query.get('results', [])
        if not results:
            messagebox.showinfo("Export", "No results to export for this query.")
            return
        
        # Create results folder if it doesn't exist
        results_folder = self.workspace_path / "results"
        results_folder.mkdir(exist_ok=True)
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        try:
            if format == 'ris':
                filename = results_folder / f"query_export_{timestamp}.ris"
                
                def _resolve_abstract(article: dict) -> str:
                    # Prefer explicit abstract, then custom/edit fields, then common API fields
                    for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                        val = (article.get(key) or '').strip()
                        if val:
                            return val
                    # Fallback to prebuilt index across queries if available
                    try:
                        eid = (article.get('eid') or '').strip()
                        if eid and hasattr(self, '_abstract_index'):
                            return (self._abstract_index.get(eid, '') or '').strip()
                    except Exception:
                        pass
                    return ''

                def to_ris(article: dict) -> str:
                    lines = ["TY  - JOUR"]
                    title = article.get('title', '')
                    if title:
                        lines.append(f"TI  - {title}")
                    authors = article.get('authors', '')
                    # Split authors by ';' or ' and '
                    for author in [x.strip() for x in str(authors).replace(' and ', ';').split(';') if x.strip()]:
                        lines.append(f"AU  - {author}")
                    date = article.get('date', '') or article.get('coverDate', '')
                    if date:
                        year = str(date)[:4]
                        lines.append(f"PY  - {year}")
                    journal = article.get('publicationName', '')
                    if journal:
                        lines.append(f"JO  - {journal}")
                    eid = article.get('eid', '')
                    if eid:
                        lines.append(f"ID  - {eid}")
                    doi = article.get('doi', '')
                    if doi:
                        lines.append(f"DO  - {doi}")
                    abstract = _resolve_abstract(article)
                    if abstract:
                        lines.append(f"AB  - {abstract}")
                    lines.append("ER  - ")
                    return "\r\n".join(lines)
                
                with open(filename, 'w', encoding='utf-8') as f:
                    for article in results:
                        # Separate records with an extra blank line for better importer compatibility
                        f.write(to_ris(article) + "\r\n\r\n")
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} articles to:\\n{filename}")
            
            elif format == 'bib':
                filename = results_folder / f"query_export_{timestamp}.bib"
                
                def to_bib(article: dict) -> str:
                    def _s(val) -> str:
                        try:
                            return str(val if val is not None else '').strip()
                        except Exception:
                            return ''
                    def _escape_bib(text: str) -> str:
                        # Minimal escaping: remove unmatched braces; keep simple ASCII braces usage
                        return text.replace('{', '(').replace('}', ')')

                    key_src = _s(article.get('eid')) or _s(article.get('doi')) or _s(article.get('title')) or f"key{abs(hash(str(article)))}"
                    key = _s(key_src).replace(' ', '_').replace('/', '_').replace(':', '_').replace(',', '_')
                    title = _s(article.get('title'))
                    authors = article.get('authors')
                    # Normalize authors to 'A and B and C'
                    if isinstance(authors, list):
                        authors_norm = ' and '.join(_s(a) for a in authors if _s(a))
                    else:
                        a_str = _s(authors)
                        authors_norm = ' and '.join([x.strip() for x in a_str.replace(';', ' and ').split(' and ') if x.strip()])
                    journal = _s(article.get('publicationName'))
                    date = _s(article.get('date') or article.get('coverDate'))
                    year = date[:4] if date else ''
                    doi = _s(article.get('doi'))
                    abstract = _escape_bib(_s(_resolve_abstract(article)))

                    parts = ["@article{" + key + ","]
                    if title:
                        parts.append("  title = {" + _escape_bib(title) + "},")
                    if authors_norm:
                        parts.append("  author = {" + authors_norm + "},")
                    if journal:
                        parts.append("  journal = {" + _escape_bib(journal) + "},")
                    if year:
                        parts.append("  year = {" + year + "},")
                    if doi:
                        parts.append("  doi = {" + doi + "},")
                    if abstract:
                        parts.append("  abstract = {" + abstract + "},")
                    parts.append("}")
                    return "\r\n".join(parts)
                
                with open(filename, 'w', encoding='utf-8') as f:
                    written = 0
                    for i, article in enumerate(results):
                        try:
                            entry = to_bib(article)
                        except Exception as e:
                            # Fallback minimal BibTeX entry to avoid empty files
                            try:
                                title_fallback = str((article or {}).get('title', 'Untitled')).strip()
                            except Exception:
                                title_fallback = 'Untitled'
                            key_fb = f"item_{i}"
                            entry = (
                                "@article{" + key_fb + ",\r\n"
                                f"  title = {{{title_fallback}}},\r\n"
                                "}\r\n"
                            )
                        if entry and entry.strip():
                            f.write(entry + "\r\n")
                            written += 1
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} articles to:\\n{filename}")
            
            elif format == 'csv':
                filename = results_folder / f"query_export_{timestamp}.csv"
                
                # Build stable, user-friendly columns and write with Excel-friendly settings
                # Prepare preferred order and filter out legacy keys
                preferred = [
                    'title','authors','publicationName','date','doi','eid',
                    'abstract','comment','selected','corpus','tag','tag_color','citedby'
                ]
                keys = set()
                for article in results:
                    if isinstance(article, dict):
                        keys.update(article.keys())
                # Remove legacy/unwanted keys
                keys.discard('favorite')
                keys.discard('must_cite')
                keys.discard('custom_abstract')
                # Ensure required columns exist
                keys.update(['abstract','selected','corpus'])
                # Final order: preferred first (that exist), then remaining sorted
                remaining = [k for k in sorted(keys) if k not in preferred]
                fieldnames = [k for k in preferred if k in keys] + remaining

                with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore', delimiter=';')
                    writer.writeheader()
                    for article in results:
                        row = dict(article)
                        # Normalize abstract from custom_abstract if needed
                        if not row.get('abstract') and row.get('custom_abstract'):
                            row['abstract'] = row.get('custom_abstract')
                        # Ensure tag column uses customized alias, not raw color key/default
                        try:
                            color_key, _tag_name, _sel, _corp = self._get_article_tag_info(article)
                            row['tag'] = self._tag_label(color_key)
                            row['tag_color'] = color_key
                        except Exception:
                            pass
                        writer.writerow(row)
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} articles to:\\n{filename}")
        
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export results:\\n{str(e)}")
            import traceback
            traceback.print_exc()
    
    def _save_history(self):
        """Save query history to file"""
        try:
            with open(self.search_log_path, "w", encoding="utf-8") as f:
                json.dump(self.query_history, f, ensure_ascii=False, indent=2)
            print(f"History saved successfully to {self.search_log_path}")
        except Exception as e:
            print(f"Error saving history: {e}")
            import traceback
            traceback.print_exc()
    
    def _select_query(self, idx: int):
        """Select a query and update views"""
        if idx < 0 or idx >= len(self.query_history):
            return
        
        self.current_query = self.query_history[idx]
        
        # Reset pagination
        self.current_page = 0
        
        # Highlight selected query
        for card, card_idx in self.query_buttons:
            if card_idx == idx:
                card.configure(fg_color=("gray70", "gray30"))
            else:
                card.configure(fg_color=("gray90", "gray20"))
        
        # Update article list
        self._update_article_list()
        
        # Update visualizations
        self._update_visualizations()
    
    def _create_article_list(self):
        """Create the middle section with article list"""
        # Container
        self.article_frame = ctk.CTkFrame(self, corner_radius=15)
        self.article_frame.grid(row=0, column=1, sticky="nsew", padx=5, pady=0)
        self.article_frame.grid_rowconfigure(2, weight=1)
        self.article_frame.grid_columnconfigure(0, weight=1)
        
        # Header frame for title and toggle button
        header_frame = ctk.CTkFrame(self.article_frame, fg_color="transparent")
        header_frame.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")
        # Three regions: title (fixed min width), pagination (expands), controls (fixed min width)
        header_frame.grid_columnconfigure(0, weight=0, minsize=HEADER_TITLE_MIN_WIDTH)
        # Middle column expands but does not enforce a minimum to avoid pushing right controls out
        header_frame.grid_columnconfigure(1, weight=1)
        header_frame.grid_columnconfigure(2, weight=0, minsize=HEADER_CONTROLS_MIN_WIDTH)
        
        # Header
        self.article_header = ctk.CTkLabel(
            header_frame,
            text="Articles",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w",
            width=HEADER_TITLE_MIN_WIDTH
        )
        self.article_header.grid(row=0, column=0, sticky="w")

        
        # Pagination controls frame (centered in the header row)
        self.pagination_frame = ctk.CTkFrame(header_frame, fg_color="transparent")
        # Right-align the pagination group inside the middle column to avoid clipping
        self.pagination_frame.grid(row=0, column=1, sticky="e", padx=(0, 8))
        
        # Previous button as icon
        if self.icon_previous:
            self.prev_page_btn = ctk.CTkLabel(
                self.pagination_frame,
                image=self.icon_previous,
                text="",
                cursor="hand2"
            )
            self.prev_page_btn.bind("<Button-1>", lambda e: self._previous_page())
            self.prev_page_btn.bind("<Enter>", lambda e: self.prev_page_btn.configure(fg_color=("gray70", "gray30")))
            self.prev_page_btn.bind("<Leave>", lambda e: self.prev_page_btn.configure(fg_color="transparent"))
        else:
            self.prev_page_btn = ctk.CTkButton(
                self.pagination_frame,
                text="Previous",
                width=90,
                height=28,
                font=ctk.CTkFont(size=11),
                command=self._previous_page
            )
        self.prev_page_btn.grid(row=0, column=0, padx=(0, 3))
        
        self.page_label = ctk.CTkLabel(
            self.pagination_frame,
            text="Page 1 of 1",
            font=ctk.CTkFont(size=11),
            width=64
        )
        self.page_label.grid(row=0, column=1, padx=5)
        
        # Next button as icon
        if self.icon_next:
            self.next_page_btn = ctk.CTkLabel(
                self.pagination_frame,
                image=self.icon_next,
                text="",
                cursor="hand2"
            )
            self.next_page_btn.bind("<Button-1>", lambda e: self._next_page())
            self.next_page_btn.bind("<Enter>", lambda e: self.next_page_btn.configure(fg_color=("gray70", "gray30")))
            self.next_page_btn.bind("<Leave>", lambda e: self.next_page_btn.configure(fg_color="transparent"))
        else:
            self.next_page_btn = ctk.CTkButton(
                self.pagination_frame,
                text="Next",
                width=90,
                height=28,
                font=ctk.CTkFont(size=11),
                command=self._next_page
            )
        self.next_page_btn.grid(row=0, column=2, padx=(3, 0))
        
        # Controls group (query/sidebar/tag/viz toggles)
        controls_frame = ctk.CTkFrame(header_frame, fg_color="transparent")
        controls_frame.grid(row=0, column=2, sticky="e")
        
        # Toggle query list button as icon
        if self.icon_sidebar_l_act:
            self.query_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_l_act,
                text="",
                cursor="hand2"
            )
            self.query_toggle_btn.bind("<Button-1>", lambda e: self._toggle_query_list())
            self.query_toggle_btn.bind("<Enter>", lambda e: self.query_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.query_toggle_btn.bind("<Leave>", lambda e: self.query_toggle_btn.configure(fg_color="transparent"))
        else:
            self.query_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Hide History",
                width=130,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_query_list
            )
        self.query_toggle_btn.grid(row=0, column=0, sticky="e", padx=(10, 0))
        ToolTip(self.query_toggle_btn, "Toggle query history")
        
        # Toggle filter sidebar button as icon (between query and tag toggle)
        if self.icon_sidebar_t:
            self.filter_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_t,
                text="",
                cursor="hand2"
            )
            self.filter_toggle_btn.bind("<Button-1>", lambda e: self._toggle_filter_sidebar())
            self.filter_toggle_btn.bind("<Enter>", lambda e: self.filter_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.filter_toggle_btn.bind("<Leave>", lambda e: self.filter_toggle_btn.configure(fg_color="transparent"))
        else:
            self.filter_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Show Filters",
                width=120,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_filter_sidebar
            )
        self.filter_toggle_btn.grid(row=0, column=1, sticky="e", padx=(10, 0))
        ToolTip(self.filter_toggle_btn, "Toggle filter panel")
        
        # Toggle tag sidebar button as icon
        if self.icon_sidebar_b:
            self.tag_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_b,
                text="",
                cursor="hand2"
            )
            self.tag_toggle_btn.bind("<Button-1>", lambda e: self._toggle_tag_sidebar())
            self.tag_toggle_btn.bind("<Enter>", lambda e: self.tag_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.tag_toggle_btn.bind("<Leave>", lambda e: self.tag_toggle_btn.configure(fg_color="transparent"))
        else:
            self.tag_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Show Tags",
                width=110,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_tag_sidebar
            )
        self.tag_toggle_btn.grid(row=0, column=2, sticky="e", padx=(10, 0))
        ToolTip(self.tag_toggle_btn, "Toggle tag management panel")
        
        # Toggle visualizations button as icon
        if self.icon_sidebar_r_act:
            self.viz_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_r_act,
                text="",
                cursor="hand2"
            )
            self.viz_toggle_btn.bind("<Button-1>", lambda e: self._toggle_visualizations())
            self.viz_toggle_btn.bind("<Enter>", lambda e: self.viz_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.viz_toggle_btn.bind("<Leave>", lambda e: self.viz_toggle_btn.configure(fg_color="transparent"))
        else:
            self.viz_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Hide Charts",
                width=130,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_visualizations
            )
        self.viz_toggle_btn.grid(row=0, column=3, sticky="e", padx=(10, 0))
        ToolTip(self.viz_toggle_btn, "Toggle visualizations")
        
        # Filter sidebar (placed above article list)
        self._create_filter_sidebar()
        
        # Article search bar with search button
        search_container = ctk.CTkFrame(self.article_frame, fg_color="transparent")
        search_container.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="ew")
        search_container.grid_columnconfigure(0, weight=1)
        
        self.article_search_var = ctk.StringVar()
        article_search = ctk.CTkEntry(
            search_container,
            placeholder_text="Search articles by title or journal name...",
            textvariable=self.article_search_var,
            height=28
        )
        article_search.grid(row=0, column=0, sticky="ew", padx=(0, 5))
        article_search.bind("<Return>", lambda e: self._filter_articles())
        
        search_btn = ctk.CTkButton(
            search_container,
            text="Search",
            width=80,
            height=28,
            command=self._filter_articles,
            font=ctk.CTkFont(size=12)
        )
        search_btn.grid(row=0, column=1, sticky="e")
        
        # Article list (scrollable with custom scrollbar)
        self.article_list_container = ctk.CTkScrollableFrame(
            self.article_frame,
            fg_color="transparent"
        )
        self.article_list_container.grid(row=2, column=0, padx=(2, 8), pady=0, sticky="nsew")
        self.article_list_container.grid_columnconfigure(0, weight=1)
        
        # Bind keyboard navigation for article list to the article_frame
        self.article_frame.bind("<Up>", self._navigate_article_up)
        self.article_frame.bind("<Down>", self._navigate_article_down)
        self.article_frame.bind("<Return>", self._select_focused_article)
        # Make frame focusable
        self.article_frame.bind("<Button-1>", lambda e: (self.article_frame.focus_set(), self.article_frame.focus_force()))
        self.article_list_container.bind("<Button-1>", lambda e: (self.article_frame.focus_set(), self.article_frame.focus_force()))
        
        self.article_widgets = []
        
        # Create Tag Sidebar (bottom) - initially hidden
        self._create_tag_sidebar()
    
    def _filter_articles(self):
        """Filter articles based on search text in title or journal name"""
        # Reset to first page when filtering
        self.current_page = 0
        # Refresh the article list which will apply the filter
        self._update_article_list()
    
    def _update_article_list(self):
        """Update the article list with current query results - with pagination for large lists"""
        # Clear existing
        for widget in self.article_list_container.winfo_children():
            widget.destroy()
        self.article_widgets.clear()
        
        if not self.current_query:
            return
        
        results = self.current_query.get('results', [])
        
        # Apply article search filter if present
        filter_text = self.article_search_var.get().lower().strip()
        if filter_text:
            self.filtered_results = []
            for article in results:
                title = article.get('title', '').lower()
                journal = article.get('publicationName', '').lower()
                if filter_text in title or filter_text in journal:
                    self.filtered_results.append(article)
        else:
            self.filtered_results = results
        
        # Apply year range filter if present
        year_from = self.year_from_var.get().strip()
        year_to = self.year_to_var.get().strip()
        if year_from or year_to:
            year_filtered = []
            for article in self.filtered_results:
                # Extract year from date (format: "YYYY-MM-DD")
                cover_date = article.get('date', '')
                if cover_date:
                    try:
                        article_year = int(cover_date.split('-')[0])
                        # Check if article year is within range
                        if year_from and int(year_from) > article_year:
                            continue
                        if year_to and int(year_to) < article_year:
                            continue
                        year_filtered.append(article)
                    except (ValueError, IndexError):
                        # Skip articles with invalid dates
                        continue
            self.filtered_results = year_filtered
        
        # Apply tag filter if active
        if self.active_tag_filter and self.active_tag_filter != "All":
            tag_filtered = []
            for article in self.filtered_results:
                color_name, _, _, _ = self._get_article_tag_info(article)
                if color_name == self.active_tag_filter:
                    tag_filtered.append(article)
            self.filtered_results = tag_filtered
        
        # Apply Selected/Corpus filters if active
        if self.filter_selected_var.get():
            selected_filtered = []
            for article in self.filtered_results:
                _, _, favorite, _ = self._get_article_tag_info(article)
                if favorite:
                    selected_filtered.append(article)
            self.filtered_results = selected_filtered
        
        if self.filter_corpus_var.get():
            corpus_filtered = []
            for article in self.filtered_results:
                _, _, _, must_cite = self._get_article_tag_info(article)
                if must_cite:
                    corpus_filtered.append(article)
            self.filtered_results = corpus_filtered
        
        # Apply sorting
        sort_order = self.sort_order_var.get()
        if sort_order and sort_order != "newest":
            if sort_order == "oldest":
                # Sort by year ascending (oldest first)
                self.filtered_results.sort(key=lambda x: x.get('date', '9999-99-99'))
        else:
            # Default: newest first
            self.filtered_results.sort(key=lambda x: x.get('date', '0000-00-00'), reverse=True)
        
        # Calculate pagination
        total_articles = len(self.filtered_results)
        total_pages = max(1, (total_articles + self.articles_per_page - 1) // self.articles_per_page)
        
        # Ensure current page is within bounds
        if self.current_page >= total_pages:
            self.current_page = max(0, total_pages - 1)
        
        # Calculate range for current page
        start_idx = self.current_page * self.articles_per_page
        end_idx = min(start_idx + self.articles_per_page, total_articles)
        page_results = self.filtered_results[start_idx:end_idx]
        
        # Update header
        total_count = len(self.current_query.get('results', []))
        if filter_text:
            self.article_header.configure(text=f"Articles ({total_articles} of {total_count})")
        else:
            self.article_header.configure(text=f"Articles ({total_articles})")

        # Removed in favor of showing counts within the legend
        
        # Update pagination controls
        self.page_label.configure(text=f"Page {self.current_page + 1} of {total_pages}")
        
        # Handle state for icon labels vs buttons
        if self.icon_previous:
            # For icon labels, change opacity instead of state
            if self.current_page > 0:
                self.prev_page_btn.configure(cursor="hand2")
            else:
                self.prev_page_btn.configure(cursor="arrow")
        else:
            self.prev_page_btn.configure(state="normal" if self.current_page > 0 else "disabled")
        
        if self.icon_next:
            if self.current_page < total_pages - 1:
                self.next_page_btn.configure(cursor="hand2")
            else:
                self.next_page_btn.configure(cursor="arrow")
        else:
            self.next_page_btn.configure(state="normal" if self.current_page < total_pages - 1 else "disabled")
        
        # Hide pagination if only one page
        if total_pages <= 1:
            self.pagination_frame.grid_remove()
        else:
            self.pagination_frame.grid()
        
        # Load current page articles
        for idx, article in enumerate(page_results):
            # Use absolute index for proper numbering
            absolute_idx = start_idx + idx
            self._create_article_card(absolute_idx, article)
    
    def _previous_page(self):
        """Go to previous page of articles"""
        if self.current_page > 0:
            self.current_page -= 1
            self._update_article_list()
            # Scroll to top
            self.article_list_container._parent_canvas.yview_moveto(0)
    
    def _next_page(self):
        """Go to next page of articles"""
        total_pages = max(1, (len(self.filtered_results) + self.articles_per_page - 1) // self.articles_per_page)
        if self.current_page < total_pages - 1:
            self.current_page += 1
            self._update_article_list()
            # Scroll to top
            self.article_list_container._parent_canvas.yview_moveto(0)
    
    def _create_article_card(self, idx: int, article: Dict):
        """Create a compact article card - dynamic height based on content"""
        # Get article data
        title = article.get('title', 'No title')
        authors = article.get('authors', 'Unknown')
        date = article.get('date', '')
        year = date[:4] if date else 'N/A'
        cited = article.get('citedby', '0')
        publication = article.get('publicationName', 'Unknown')
        doi = article.get('doi', '')
        
        # Get tag info
        color_name, tag_name, favorite, must_cite = self._get_article_tag_info(article)
        tag_color = self.tag_colors.get(color_name, '#e0e0e0') or '#e0e0e0'
        
        # Get EID for selection tracking
        eid = article.get('eid', '')
        
        # Card container with colored border and rounded corners - NO fixed height
        card = ctk.CTkFrame(
            self.article_list_container,
            corner_radius=10,
            border_width=2,
            border_color=tag_color,
            fg_color=("gray95", "gray20")
        )
        card.grid(row=idx, column=0, padx=(6, 6), pady=3, sticky="ew")
        card.grid_columnconfigure(1, weight=1)
        # Match corpus view card height for consistency
        card.grid_rowconfigure(0, minsize=130)
        
        # Highlight if selected
        if self.selected_article and article.get('eid') == self.selected_article.get('eid'):
            card.configure(fg_color=("gray85", "gray25"), border_width=3)
        elif idx == self.focused_article_idx:
            card.configure(border_width=3)
        
        # Checkbox for multi-selection
        checkbox_var = tk.BooleanVar(value=eid in self.selected_articles)
        checkbox = ctk.CTkCheckBox(
            card,
            text="",
            variable=checkbox_var,
            width=20,
            command=lambda: self._toggle_article_selection(eid, checkbox_var.get())
        )
        checkbox.grid(row=0, column=0, padx=(8, 5), sticky="w")
        if not self.tag_sidebar_visible:
            checkbox.grid_remove()
        
        # Content container - using grid for line-by-line layout
        content = ctk.CTkFrame(card, fg_color="transparent")
        content.grid(row=0, column=1, sticky="nsew", padx=(8, 8), pady=10)
        content.grid_columnconfigure(0, weight=1)
        
        # Line 1: Title (bold) + Status icons - allow wrapping
        line1_frame = ctk.CTkFrame(content, fg_color="transparent")
        line1_frame.grid(row=0, column=0, sticky="ew", pady=(0, 3))
        line1_frame.grid_columnconfigure(0, weight=1)
        
        title_label = ctk.CTkLabel(
            line1_frame,
            text=title,
            font=ctk.CTkFont(size=12, weight="bold"),
            anchor="w",
            justify="left",
            wraplength=450
        )
        title_label.grid(row=0, column=0, sticky="ew")
        
        # Status icons
        status_text = ""
        if favorite:
            status_text += "✅"
        if must_cite:
            status_text += "⭐"
        if status_text:
            status_label = ctk.CTkLabel(
                card,
                text=status_text,
                font=ctk.CTkFont(size=16)
            )
            status_label.place(relx=1.0, rely=0.0, anchor="ne", x=-8, y=8)
        
        # Line 2: Journal/Publication
        if publication and publication != 'Unknown':
            line2_frame = ctk.CTkFrame(content, fg_color="transparent")
            line2_frame.grid(row=1, column=0, sticky="ew", pady=2)
            line2_frame.grid_columnconfigure(0, weight=1)
            
            pub_label = ctk.CTkLabel(
                line2_frame,
                text=f"Journal: {publication}",
                font=ctk.CTkFont(size=11),
                text_color="gray60",
                anchor="w",
                justify="left",
                wraplength=600
            )
            pub_label.grid(row=0, column=0, sticky="ew")

            # Make journal/source wrap to available width on smaller monitors
            def _set_pub_wrap(event=None, lbl=pub_label, container=card):
                try:
                    w = max(320, container.winfo_width() - 120)
                    lbl.configure(wraplength=w)
                except Exception:
                    pass
            _set_pub_wrap()
            card.bind("<Configure>", _set_pub_wrap)
        
        # Line 3: Authors + Published year (moved up to free space for DOI/tag)
        if authors and authors != 'Unknown':
            line3_frame = ctk.CTkFrame(content, fg_color="transparent")
            line3_frame.grid(row=2, column=0, sticky="ew", pady=2)
            line3_frame.grid_columnconfigure(0, weight=1)
            
            # Append published year after authors with a separator dot
            authors_text = f"Authors: {authors}"
            if year and year != 'N/A':
                authors_text += f" · Published: {year}"

            authors_label = ctk.CTkLabel(
                line3_frame,
                text=authors_text,
                font=ctk.CTkFont(size=11),
                text_color="gray60",
                anchor="w",
                justify="left",
                wraplength=600
            )
            authors_label.grid(row=0, column=0, sticky="ew")
        
        # Line 4: Citations, DOI (year moved up)
        line4_parts = [
            (f"Cited by: {cited}" if cited and cited != '0' else "Cited by: "),
            (f"DOI: {doi}" if doi else "DOI: ")
        ]
        
        if line4_parts:
            line4_frame = ctk.CTkFrame(content, fg_color="transparent")
            line4_frame.grid(row=3, column=0, sticky="ew", pady=2)
            line4_frame.grid_columnconfigure(0, weight=1)
            
            meta_label = ctk.CTkLabel(
                line4_frame,
                text=" • ".join(line4_parts),
                font=ctk.CTkFont(size=11),
                text_color="gray60",
                anchor="w",
                justify="left",
                wraplength=600
            )
            meta_label.grid(row=0, column=0, sticky="ew")
        
        # Abstract availability indicator (independent of tag presence)
        eid = article.get('eid', '')
        # Resolve abstract from article or index across known keys
        abstract_text = ''
        for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
            abstract_text = (article.get(key) or '').strip()
            if abstract_text:
                break
        if not abstract_text and hasattr(self, '_abstract_index'):
            abstract_text = (self._abstract_index.get(eid, '') or '').strip()
        if abstract_text:
            abs_label = ctk.CTkLabel(
                card,
                text="Abstract available",
                font=ctk.CTkFont(size=11),
                text_color="gray70",
                corner_radius=6,
                padx=6,
                pady=2
            )
            abs_label.place(relx=1.0, rely=1.0, anchor="se", x=-8, y=-30)

        # Tag badge in bottom-right corner (match other info font size)
        if color_name != "None" and tag_name != "None":
            tag_label = ctk.CTkLabel(
                card,
                text=tag_name,
                font=ctk.CTkFont(size=10),
                fg_color=tag_color,
                text_color="white" if self._is_dark_color(tag_color) else "black",
                corner_radius=8,
                padx=6,
                pady=2
            )
            tag_label.place(relx=1.0, rely=1.0, anchor="se", x=-8, y=-5)
            
            def edit_tag_name(e=None):
                self._show_tag_name_editor(article, tag_label)
            tag_label.bind("<Button-3>", edit_tag_name)
            tag_label.bind("<Button-1>", lambda e: select_article(e))
        
        # Make clickable
        def select_article(e=None):
            self.selected_article = article
            self.focused_article_idx = idx
            self._highlight_article_card(card)
        
        def open_article(e=None):
            self._open_article_url(article)
        
        def show_context_menu(e):
            self._show_article_context_menu(e, article)
        
        # Bind events
        card.bind("<Button-1>", select_article)
        card.bind("<Double-Button-1>", open_article)
        card.bind("<Button-3>", show_context_menu)
        content.bind("<Button-1>", select_article)
        content.bind("<Double-Button-1>", open_article)
        content.bind("<Button-3>", show_context_menu)
        title_label.bind("<Button-1>", select_article)
        title_label.bind("<Double-Button-1>", open_article)
        title_label.bind("<Button-3>", show_context_menu)

        # Ensure right-click opens context menu anywhere within the card (including nested labels)
        def _bind_right_click_recursive(widget):
            try:
                widget.bind("<Button-3>", lambda e: show_context_menu(e), add="+")
            except Exception:
                pass
            try:
                for child in widget.winfo_children():
                    _bind_right_click_recursive(child)
            except Exception:
                pass

        _bind_right_click_recursive(card)
        
        self.article_widgets.append((card, article))
    
    def _open_article_url(self, article: Dict):
        """Open article URL in default browser"""
        # Try DOI first (most reliable)
        doi = article.get('doi', '').strip()
        if doi:
            url = f"https://doi.org/{doi}"
            try:
                webbrowser.open(url)
                return
            except Exception as e:
                print(f"Error opening DOI URL: {e}")
        
        # Try EID (Scopus)
        eid = article.get('eid', '').strip()
        if eid:
            url = f"https://www.scopus.com/record/display.uri?eid={eid}&origin=resultslist"
            try:
                webbrowser.open(url)
                return
            except Exception as e:
                print(f"Error opening EID URL: {e}")
        
        # Fallback: show message if no URL available
        messagebox.showinfo(
            "No URL Available",
            f"No DOI or EID found for article:\n{article.get('title', 'Unknown')}"
        )

    def _open_article_via_doi(self, article: Dict):
        doi = (article.get('doi') or '').strip()
        if doi:
            try:
                webbrowser.open(f"https://doi.org/{doi}")
                return
            except Exception as e:
                print(f"Error opening DOI URL: {e}")
        messagebox.showinfo("DOI Not Available", "No DOI available for this article.")

    def _open_article_in_scopus(self, article: Dict):
        eid = (article.get('eid') or '').strip()
        if eid:
            try:
                webbrowser.open(f"https://www.scopus.com/record/display.uri?eid={eid}&origin=resultslist")
                return
            except Exception as e:
                print(f"Error opening Scopus URL: {e}")
        messagebox.showinfo("Scopus Link Not Available", "No EID available to open in Scopus.")
    
    def _show_article_context_menu(self, event, article: Dict):
        """Show context menu for article card"""
        from tkinter import Menu
        
        menu = Menu(self, tearoff=0)
        
        # Dark mode support
        if ctk.get_appearance_mode() == 'Dark':
            menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        
        # Helpers to toggle single article flags
        def _set_article_flag(flag: str, value: bool):
            try:
                eid = (article.get('eid') or '').strip()
                if not eid:
                    return
                if eid not in self.global_tags:
                    self.global_tags[eid] = {
                        'color': 'None', 'tag': 'None', 'selected': False, 'corpus': False
                    }
                self.global_tags[eid][flag] = value
                # Reflect into stored article dict (affects exports/UI)
                article[flag] = value
                # Persist to global tags so other views see changes
                self._save_global_tags()
                # Refresh only this card, keep scroll and avoid heavy reloads
                try:
                    self._refresh_article_card_by_eid(eid)
                except Exception:
                    # Fallback to light rebuild if needed
                    self.after(1, self._update_article_list)
                # Debounced charts/legend refresh
                self._schedule_viz_update()
                try:
                    self._update_visualizations()
                except Exception:
                    pass
            except Exception as e:
                print(f"Error setting flag {flag} on {eid}: {e}")
        
        # Determine current flags
        _, _, is_selected, is_corpus = self._get_article_tag_info(article)
        
        # Show Abstract option
        menu.add_command(label="Show Abstract", command=lambda: self._show_article_abstract(article))
        
        # Utility to close the menu before running an action
        def _menu_action(action_fn):
            try:
                try:
                    menu.unpost()
                except Exception:
                    pass
                try:
                    menu.grab_release()
                except Exception:
                    pass
                try:
                    menu.destroy()
                except Exception:
                    pass
                # Flush menu removal, then run action
                try:
                    self.update_idletasks()
                except Exception:
                    pass
                self.after(1, action_fn)
            except Exception:
                # Fallback: run directly
                action_fn()

        # Selected toggle
        menu.add_separator()
        if is_selected:
            menu.add_command(label="Remove from Selected", command=lambda: _menu_action(lambda: _set_article_flag('selected', False)))
        else:
            menu.add_command(label="Add to Selected", command=lambda: _menu_action(lambda: _set_article_flag('selected', True)))
        
        # Corpus toggle
        if is_corpus:
            menu.add_command(label="Remove from Corpus", command=lambda: _menu_action(lambda: _set_article_flag('corpus', False)))
        else:
            menu.add_command(label="Add to Corpus", command=lambda: _menu_action(lambda: _set_article_flag('corpus', True)))
        
        # Export submenu for single article
        export_menu = Menu(menu, tearoff=0)
        # Ensure dark mode compatibility of submenu as well
        if ctk.get_appearance_mode() == 'Dark':
            export_menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            export_menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        export_menu.add_command(label="Export as RIS", command=lambda: self._export_single_article(article, 'ris'))
        export_menu.add_command(label="Export as BibTeX", command=lambda: self._export_single_article(article, 'bib'))
        export_menu.add_command(label="Export as CSV", command=lambda: self._export_single_article(article, 'csv'))
        menu.add_cascade(label="Export", menu=export_menu)
        
        # Copy DOI
        menu.add_separator()
        doi_val = (article.get('doi') or '').strip()
        menu.add_command(label="Copy DOI", command=lambda d=doi_val: self._copy_doi_to_clipboard(d))
        
        # Open article links
        menu.add_separator()
        menu.add_command(label="Open via DOI", command=lambda: self._open_article_via_doi(article))
        menu.add_command(label="Open in Scopus", command=lambda: self._open_article_in_scopus(article))
        
        # Show menu at cursor position
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _refresh_article_card_by_eid(self, eid: str):
        """Rebuild just the card for the given EID on the current page."""
        if not self.current_query or not eid:
            return
        # Find the article object in current filtered list
        for i, a in enumerate(self.filtered_results):
            if (a.get('eid') or '').strip() == eid:
                absolute_idx = i
                break
        else:
            return
        # Only refresh if it's on the current page
        start_idx = self.current_page * self.articles_per_page
        end_idx = start_idx + self.articles_per_page
        if not (start_idx <= absolute_idx < end_idx):
            return
        # Locate existing card widget tuple
        rel_idx = absolute_idx - start_idx
        try:
            old_card, old_article = self.article_widgets[rel_idx]
        except Exception:
            return
        try:
            # Destroy old card, recreate in place
            old_card.grid_forget()
            old_card.destroy()
        except Exception:
            pass
        # Recreate card at same row
        self._create_article_card(absolute_idx, a)

    def _schedule_viz_update(self, delay_ms: int = 120):
        """Debounce visualization refreshes to keep UI responsive during rapid toggles."""
        try:
            if self._viz_after_id is not None:
                self.after_cancel(self._viz_after_id)
        except Exception:
            pass
        self._viz_after_id = self.after(delay_ms, self._update_visualizations)

        # Determine current flags
        _, _, is_selected, is_corpus = self._get_article_tag_info(article)

        # Show Abstract option
        menu.add_command(label="Show Abstract", command=lambda: self._show_article_abstract(article))

        # Selected toggle
        menu.add_separator()
        if is_selected:
            menu.add_command(label="Remove from Selected", command=lambda: _set_article_flag('selected', False))
        else:
            menu.add_command(label="Add to Selected", command=lambda: _set_article_flag('selected', True))

        # Corpus toggle
        if is_corpus:
            menu.add_command(label="Remove from Corpus", command=lambda: _set_article_flag('corpus', False))
        else:
            menu.add_command(label="Add to Corpus", command=lambda: _set_article_flag('corpus', True))

        # Export submenu for single article
        export_menu = Menu(menu, tearoff=0)
        # Ensure dark mode compatibility of submenu as well
        if ctk.get_appearance_mode() == 'Dark':
            export_menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            export_menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        export_menu.add_command(label="Export as RIS", command=lambda: self._export_single_article(article, 'ris'))
        export_menu.add_command(label="Export as BibTeX", command=lambda: self._export_single_article(article, 'bib'))
        export_menu.add_command(label="Export as CSV", command=lambda: self._export_single_article(article, 'csv'))
        menu.add_cascade(label="Export", menu=export_menu)

        # Copy DOI
        menu.add_separator()
        doi_val = (article.get('doi') or '').strip()
        menu.add_command(label="Copy DOI", command=lambda d=doi_val: self._copy_doi_to_clipboard(d))

        # Open article links
        menu.add_separator()
        menu.add_command(label="Open via DOI", command=lambda: self._open_article_via_doi(article))
        menu.add_command(label="Open in Scopus", command=lambda: self._open_article_in_scopus(article))
        
        # Show menu at cursor position
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _export_single_article(self, article: Dict, format: str):
        """Export a single article to results folder in given format (ris, bib, csv)"""
        from datetime import datetime
        from tkinter import messagebox
        import csv
        results_folder = self.workspace_path / "results"
        results_folder.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        def _resolve_abstract_local(a: Dict) -> str:
            try:
                for k in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                    val = (a.get(k) or '').strip()
                    if val:
                        return val
                eid = (a.get('eid') or '').strip()
                if eid and hasattr(self, '_abstract_index'):
                    return (self._abstract_index.get(eid, '') or '').strip()
            except Exception:
                pass
            return ''

        try:
            if format == 'ris':
                filename = results_folder / f"article_{timestamp}.ris"
                lines = ["TY  - JOUR"]
                title = article.get('title', '')
                if title:
                    lines.append(f"TI  - {title}")
                authors = article.get('authors', '')
                for author in [x.strip() for x in str(authors).replace(' and ', ';').split(';') if x.strip()]:
                    lines.append(f"AU  - {author}")
                date = article.get('date', '') or article.get('coverDate', '')
                if date:
                    year = str(date)[:4]
                    lines.append(f"PY  - {year}")
                journal = article.get('publicationName', '')
                if journal:
                    lines.append(f"JO  - {journal}")
                eid = article.get('eid', '')
                if eid:
                    lines.append(f"ID  - {eid}")
                doi = article.get('doi', '')
                if doi:
                    lines.append(f"DO  - {doi}")
                abstract = _resolve_abstract_local(article)
                if abstract:
                    lines.append(f"AB  - {abstract}")
                lines.append("ER  - ")
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write("\r\n".join(lines) + "\r\n")
                messagebox.showinfo("Export Successful", f"Exported article to:\n{filename}")
            elif format == 'bib':
                filename = results_folder / f"article_{timestamp}.bib"
                def _s(val) -> str:
                    try:
                        return str(val if val is not None else '').strip()
                    except Exception:
                        return ''
                def _esc(text: str) -> str:
                    return text.replace('{', '(').replace('}', ')')
                key_src = _s(article.get('eid')) or _s(article.get('doi')) or _s(article.get('title')) or f"key{abs(hash(str(article)))}"
                key = _s(key_src).replace(' ', '_').replace('/', '_').replace(':', '_').replace(',', '_')
                title = _s(article.get('title'))
                authors = article.get('authors')
                if isinstance(authors, list):
                    authors_norm = ' and '.join(_s(a) for a in authors if _s(a))
                else:
                    a_str = _s(authors)
                    authors_norm = ' and '.join([x.strip() for x in a_str.replace(';', ' and ').split(' and ') if x.strip()])
                journal = _s(article.get('publicationName'))
                date = _s(article.get('date') or article.get('coverDate'))
                year = date[:4] if date else ''
                doi = _s(article.get('doi'))
                abstract = _esc(_s(_resolve_abstract_local(article)))
                parts = ["@article{" + key + ","]
                if title:
                    parts.append("  title = {" + _esc(title) + "},")
                if authors_norm:
                    parts.append("  author = {" + authors_norm + "},")
                if journal:
                    parts.append("  journal = {" + _esc(journal) + "},")
                if year:
                    parts.append("  year = {" + year + "},")
                if doi:
                    parts.append("  doi = {" + doi + "},")
                if abstract:
                    parts.append("  abstract = {" + abstract + "},")
                parts.append("}")
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write("\r\n".join(parts) + "\r\n")
                messagebox.showinfo("Export Successful", f"Exported article to:\n{filename}")
            else:  # csv
                filename = results_folder / f"article_{timestamp}.csv"
                preferred = ['title','authors','publicationName','date','doi','eid','abstract','comment','selected','corpus','tag','tag_color','citedby']
                row = dict(article)
                # Normalize abstract field from possible sources
                if not row.get('abstract'):
                    if row.get('custom_abstract'):
                        row['abstract'] = row.get('custom_abstract')
                    elif row.get('dc:description'):
                        row['abstract'] = row.get('dc:description')
                    elif row.get('description'):
                        row['abstract'] = row.get('description')
                # Drop legacy/unwanted keys to keep CSV structure stable
                for k in ['custom_abstract', 'favorite', 'must_cite']:
                    if k in row:
                        row.pop(k, None)
                try:
                    color_key, _t, _sfl, _cfl = self._get_article_tag_info(article)
                    row['tag'] = self._tag_label(color_key)
                    row['tag_color'] = color_key
                except Exception:
                    pass
                fieldnames = [k for k in preferred if k in row.keys()] + [k for k in row.keys() if k not in preferred]
                with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore', delimiter=';')
                    writer.writeheader()
                    writer.writerow(row)
                messagebox.showinfo("Export Successful", f"Exported article to:\n{filename}")
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export article as {format}:\n{e}")
    
    def _show_article_abstract(self, article: Dict):
        """Fetch and display article abstract"""
        # First, check if abstract is already in the article data (from Search API)
        eid = article.get('eid', '')
        abstract_text = ''
        for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
            abstract_text = (article.get(key) or '').strip()
            if abstract_text:
                break
        if not abstract_text and hasattr(self, '_abstract_index'):
            abstract_text = (self._abstract_index.get(eid, '') or '').strip()
        
        if abstract_text:
            # We already have the abstract from search results
            self._display_abstract_dialog(article, abstract_text)
            return
        
        # If no abstract in stored data, try fetching from Abstract Retrieval API
        eid = article.get('eid', '')
        if not eid:
            messagebox.showinfo("No Abstract", "No abstract available for this article")
            return
        
        # Create loading dialog
        loading_dialog = ctk.CTkToplevel(self)
        loading_dialog.title("Loading Abstract")
        loading_dialog.geometry("300x100")
        loading_dialog.transient(self.winfo_toplevel())
        loading_dialog.grab_set()
        
        ctk.CTkLabel(
            loading_dialog,
            text="Fetching abstract from Scopus API...",
            font=ctk.CTkFont(size=12)
        ).pack(pady=30)
        
        # Update to show the dialog
        loading_dialog.update()
        
        try:
            # Load API key from config
            config_path = self.workspace_path / "slr_config.json"
            if not config_path.exists():
                loading_dialog.destroy()
                messagebox.showerror("Error", "No API key configured. Please set your Scopus API key in Settings.")
                return
            
            with open(config_path, "r") as f:
                config = json.load(f)
            
            # Support both old and new API key names
            api_key = config.get("scopus_api_key") or config.get("APIKey", "")
            if not api_key:
                loading_dialog.destroy()
                messagebox.showerror("Error", "No API key configured. Please set your Scopus API key in Settings.")
                return
            
            # Create API client and fetch abstract
            client = ScopusAPIClient(api_key)
            
            # Try different view modes in order of completeness
            view_modes = ["META", "STANDARD", "COMPLETE", "FULL"]
            response = None
            
            for view_mode in view_modes:
                try:
                    print(f"Trying Abstract Retrieval API with view={view_mode}...")
                    response = client.get_abstract(eid, view=view_mode)
                    print(f"Success with view={view_mode}")
                    break
                except Exception as e:
                    print(f"Failed with view={view_mode}: {e}")
                    if "401" in str(e):
                        continue  # Try next view mode
                    else:
                        raise  # Other errors should be handled below
            
            if not response:
                loading_dialog.destroy()
                messagebox.showerror("API Error", 
                    "Could not retrieve abstract with any view mode.\n\n" +
                    "Your API key may not have permission for Abstract Retrieval.\n" +
                    "Note: Abstracts from search results are shown automatically.")
                return
            
            # Debug: Show what we got
            print(f"\nAbstract API returned data with keys: {list(response.keys())}")
            
            if 'abstracts-retrieval-response' in response:
                arr = response['abstracts-retrieval-response']
                print(f"abstracts-retrieval-response has keys: {list(arr.keys())}")
                
                # Debug all paths
                if 'coredata' in arr:
                    cd = arr['coredata']
                    print(f"  coredata has {len(cd)} keys: {list(cd.keys())}")
                    if 'dc:description' in cd:
                        desc = cd.get('dc:description', '')
                        print(f"    dc:description found! Length: {len(desc) if desc else 0}")
                        if desc:
                            print(f"    First 100 chars: {desc[:100]}")
                    else:
                        print(f"    NO dc:description in coredata!")
                
                if 'item' in arr:
                    print(f"  item exists with keys: {list(arr['item'].keys())}")
                    if 'bibrecord' in arr['item']:
                        print(f"    bibrecord exists with keys: {list(arr['item']['bibrecord'].keys())}")
                        if 'head' in arr['item']['bibrecord']:
                            head = arr['item']['bibrecord']['head']
                            print(f"      head has keys: {list(head.keys())}")
                            if 'abstracts' in head:
                                print(f"        abstracts content: {str(head['abstracts'])[:200]}...")
                else:
                    print(f"  NO 'item' key found! Only have: {list(arr.keys())}")
            
            loading_dialog.destroy()
            
            # Extract abstract text from response
            abstract_text = ""
            try:
                # Try different possible paths in the response
                if 'abstracts-retrieval-response' in response:
                    arr = response['abstracts-retrieval-response']
                    
                    # Path 1: coredata -> dc:description
                    if 'coredata' in arr:
                        core_data = arr['coredata']
                        abstract_text = core_data.get('dc:description', '')
                    
                    # Path 2: item -> bibrecord -> head -> abstracts (for structured abstracts)
                    if not abstract_text and 'item' in arr:
                        try:
                            item = arr['item']
                            if 'bibrecord' in item:
                                bibrecord = item['bibrecord']
                                if 'head' in bibrecord:
                                    head = bibrecord['head']
                                    if 'abstracts' in head:
                                        abstracts = head['abstracts']
                                        # Abstract might be in ce:para or as text
                                        if isinstance(abstracts, dict):
                                            abstract_text = abstracts.get('ce:para', '')
                                            if not abstract_text:
                                                abstract_text = abstracts.get('abstract', '')
                        except Exception as e:
                            print(f"Error parsing item path: {e}")
                    
                elif 'coredata' in response:
                    abstract_text = response['coredata'].get('dc:description', '')
                elif 'dc:description' in response:
                    abstract_text = response['dc:description']
            except Exception as e:
                print(f"Error parsing abstract: {e}")
            
            print(f"Extracted abstract text length: {len(abstract_text) if abstract_text else 0}")
            
            if not abstract_text:
                abstract_text = "No abstract text found in API response.\n\nNote: Most articles show their abstract automatically from search results. The Abstract Retrieval API may require additional permissions or institutional access."
            
            # Display the abstract
            self._display_abstract_dialog(article, abstract_text)
            
        except Exception as e:
            loading_dialog.destroy()
            error_msg = str(e)
            
            # Provide helpful error messages
            if "401" in error_msg or "Unauthorized" in error_msg:
                messagebox.showinfo("Abstract Not Available", 
                    "The Abstract Retrieval API requires additional permissions.\n\n" +
                    "However, abstracts from search results are already shown automatically when available.\n\n" +
                    "If you need full abstract access, please verify your API permissions with Elsevier.")
            elif "404" in error_msg:
                messagebox.showinfo("Not Found", 
                    "Abstract not found via API.\n\n" +
                    "Note: Abstracts from search results are shown automatically when available.")
            else:
                messagebox.showerror("Error", f"Failed to fetch abstract:\n{error_msg}")
    
    def _display_abstract_dialog(self, article: Dict, abstract_text: str):
        """Display abstract in a dialog window with edit/copy/save"""
        dialog = ctk.CTkToplevel(self)
        dialog.title("Article Abstract")
        dialog.geometry("800x600")
        dialog.transient(self.winfo_toplevel())
        
        # Title
        title_label = ctk.CTkLabel(
            dialog,
            text=article.get('title', 'Unknown Title'),
            font=ctk.CTkFont(size=14, weight="bold"),
            wraplength=750,
            justify="left"
        )
        title_label.pack(padx=20, pady=(20, 5), anchor="w")
        
        # Authors and year
        authors = article.get('authors', 'Unknown')
        date = article.get('date', '')
        year = date[:4] if date else 'N/A'
        
        meta_label = ctk.CTkLabel(
            dialog,
            text=f"{authors} ({year})",
            font=ctk.CTkFont(size=11),
            text_color="gray",
            wraplength=750,
            justify="left"
        )
        meta_label.pack(padx=20, pady=(0, 15), anchor="w")
        
        # Abstract text in scrollable textbox
        abstract_frame = ctk.CTkFrame(dialog)
        abstract_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))
        
        textbox = ctk.CTkTextbox(
            abstract_frame,
            font=ctk.CTkFont(size=12),
            wrap="word",
            activate_scrollbars=True
        )
        textbox.pack(fill="both", expand=True, padx=5, pady=5)
        textbox.insert("1.0", abstract_text)
        textbox.configure(state="disabled")  # Initially read-only

        # Button bar
        btn_bar = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_bar.pack(fill="x", padx=20, pady=(0, 15))

        def do_copy():
            try:
                dialog.clipboard_clear()
                dialog.clipboard_append(textbox.get("1.0", "end").strip())
            except Exception:
                pass

        def toggle_edit():
            if str(textbox.cget("state")) == "disabled":
                textbox.configure(state="normal")
                edit_btn.configure(text="Lock Edit")
            else:
                textbox.configure(state="disabled")
                edit_btn.configure(text="Edit")

        def save_abstract():
            new_text = textbox.get("1.0", "end").strip()
            # Update in-memory article
            article['abstract'] = new_text
            # Persist into all occurrences of this EID in project search_log.json
            try:
                if self.search_log_path.exists():
                    with open(self.search_log_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    changed = False
                    for query in data if isinstance(data, list) else []:
                        for a in query.get('results', []):
                            if a.get('eid') == article.get('eid'):
                                if a.get('abstract', '') != new_text:
                                    a['abstract'] = new_text
                                    changed = True
                    if changed:
                        with open(self.search_log_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        # Also refresh current query structure
                        if self.current_query:
                            for a in self.current_query.get('results', []):
                                if a.get('eid') == article.get('eid'):
                                    a['abstract'] = new_text
                        self._update_article_list()
                        self._update_visualizations()
            except Exception as e:
                print(f"Error saving abstract: {e}")

        copy_btn = ctk.CTkButton(btn_bar, text="Copy", width=90, command=do_copy)
        copy_btn.pack(side="left", padx=(0, 8))

        edit_btn = ctk.CTkButton(btn_bar, text="Edit", width=90, command=toggle_edit)
        edit_btn.pack(side="left", padx=(0, 8))

        save_btn = ctk.CTkButton(btn_bar, text="Save", width=90, command=save_abstract)
        save_btn.pack(side="left", padx=(0, 8))

        # Close button
        close_btn = ctk.CTkButton(
            dialog,
            text="Close",
            command=dialog.destroy,
            width=100
        )
        close_btn.pack(pady=(0, 20))
    
    def _highlight_article_card(self, selected_card):
        """Highlight the selected article card"""
        for card, article in self.article_widgets:
            # Reset all cards first
            color_name, _, _, _ = self._get_article_tag_info(article)
            tag_color = self.tag_colors.get(color_name, '#e0e0e0') or '#e0e0e0'
            card.configure(border_color=tag_color, border_width=2, fg_color=("gray95", "gray20"))
            
            # Highlight selected card
            if card == selected_card:
                card.configure(border_width=3, fg_color=("gray85", "gray25"))
    
    def _tag_selected_article(self, color_name: str):
        """Tag the selected article with a color"""
        if not self.selected_article:
            messagebox.showinfo("No Selection", "Please select an article first")
            return
        
        eid = self.selected_article.get('eid', '')
        if not eid:
            return
        
        # Update global tags
        if eid not in self.global_tags:
            self.global_tags[eid] = {
                "color": color_name,
                "tag": color_name,  # Use color name as tag for now
                "selected": False,
                "corpus": False,
                "comment": "",
                "last_modified": datetime.now().isoformat()
            }
        else:
            self.global_tags[eid]["color"] = color_name
            self.global_tags[eid]["tag"] = color_name
            self.global_tags[eid]["last_modified"] = datetime.now().isoformat()
        
        self._save_global_tags()
        self._update_article_list()
        self._update_visualizations()
    
    def _show_tag_name_editor(self, article: Dict, tag_badge: ctk.CTkLabel):
        """Show dialog to edit tag name"""
        eid = article.get('eid', '')
        if not eid or eid not in self.global_tags:
            return
        
        current_tag = self.global_tags[eid].get('tag', '')
        
        # Create dialog
        dialog = ctk.CTkInputDialog(
            text=f"Enter tag name for article:\n{article.get('title', '')[:60]}...",
            title="Edit Tag Name"
        )
        
        # Set current value if available
        if hasattr(dialog, '_entry') and current_tag:
            dialog._entry.insert(0, current_tag)
        
        new_tag = dialog.get_input()
        
        if new_tag is not None and new_tag.strip():
            # Update tag name
            self.global_tags[eid]["tag"] = new_tag.strip()
            self.global_tags[eid]["last_modified"] = datetime.now().isoformat()
            self._save_global_tags()
            
            # Update the badge text
            tag_badge.configure(text=f" {new_tag.strip()} ")
            
            # Update visualizations
            self._update_visualizations()
    
    def _darken_color(self, hex_color: str) -> str:
        """Darken a hex color for hover effect"""
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            r = max(0, int(r * 0.8))
            g = max(0, int(g * 0.8))
            b = max(0, int(b * 0.8))
            return f'#{r:02x}{g:02x}{b:02x}'
        except:
            return hex_color
    
    def _is_dark_color(self, hex_color: str) -> bool:
        """Check if a color is dark (for text color selection)"""
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            # Calculate luminance
            luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            return luminance < 0.5
        except:
            return False
    
    def _toggle_query_list(self):
        """Toggle visibility of query history list"""
        self.query_list_visible = not self.query_list_visible
        
        # Update grid layout to redistribute space
        self._update_grid_layout()
        
        if self.query_list_visible:
            # Show query list
            self.query_frame.grid()
            if self.icon_sidebar_l_act:
                self.query_toggle_btn.configure(image=self.icon_sidebar_l_act)
            elif not self.icon_sidebar_l:
                self.query_toggle_btn.configure(text="Hide History")
        else:
            # Hide query list
            self.query_frame.grid_remove()
            if self.icon_sidebar_l:
                self.query_toggle_btn.configure(image=self.icon_sidebar_l)
            elif not self.icon_sidebar_l:
                self.query_toggle_btn.configure(text="Show History")
    
    def _toggle_visualizations(self):
        """Toggle visibility of visualization panel"""
        self.visualizations_visible = not self.visualizations_visible
        
        # Update grid layout to redistribute space
        self._update_grid_layout()
        
        if self.visualizations_visible:
            # Show visualizations
            self.viz_frame.grid()
            if self.icon_sidebar_r_act:
                self.viz_toggle_btn.configure(image=self.icon_sidebar_r_act)
            elif not self.icon_sidebar_r:
                self.viz_toggle_btn.configure(text="Hide Charts")
            # Load visualizations for current query
            if self.current_query:
                self._update_visualizations()
        else:
            # Hide visualizations
            self.viz_frame.grid_remove()
            if self.icon_sidebar_r:
                self.viz_toggle_btn.configure(image=self.icon_sidebar_r)
            elif not self.icon_sidebar_r:
                self.viz_toggle_btn.configure(text="Show Charts")
    
    def _navigate_article_up(self, event=None):
        """Navigate to previous article in list"""
        if self.focused_article_idx > 0:
            self.focused_article_idx -= 1
            self._update_article_list()
            return "break"
    
    def _navigate_article_down(self, event=None):
        """Navigate to next article in list"""
        total_articles = len(self.filtered_results) if hasattr(self, 'filtered_results') else 0
        if self.focused_article_idx < total_articles - 1:
            self.focused_article_idx += 1
            self._update_article_list()
            return "break"
    
    def _select_focused_article(self, event=None):
        """Select the currently focused article"""
        if hasattr(self, 'filtered_results') and self.focused_article_idx < len(self.filtered_results):
            article = self.filtered_results[self.focused_article_idx]
            self._show_article_detail(article)
        return "break"
    
    def _create_visualizations(self):
        """Create the right panel with visualizations"""
        # Container
        self.viz_frame = ctk.CTkFrame(self, corner_radius=15)
        self.viz_frame.grid(row=0, column=2, sticky="nsew", padx=(5, 0), pady=0)
        self.viz_frame.grid_rowconfigure(3, weight=0, minsize=DOUGHNUT_CANVAS_PX)
        self.viz_frame.grid_rowconfigure(5, weight=0, minsize=YEAR_CONTAINER_HEIGHT)
        self.viz_frame.grid_rowconfigure(7, weight=1)  # Legend row fills remaining space
        self.viz_frame.grid_columnconfigure(0, weight=1)
        
        # Initially hide the frame
        if not self.visualizations_visible:
            self.viz_frame.grid_remove()
        
        # Header
        header = ctk.CTkLabel(
            self.viz_frame,
            text="Visualizations",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="w")
        
        # Year controls (under header)
        year_controls = ctk.CTkFrame(self.viz_frame, fg_color="transparent")
        year_controls.grid(row=1, column=0, padx=20, pady=(0, 15), sticky="w")
        
        show_unknown_cb = ctk.CTkCheckBox(
            year_controls,
            text="Show None",
            variable=self.show_unknown_year_var,
            command=self._update_visualizations,
            font=ctk.CTkFont(size=11)
        )
        show_unknown_cb.pack(side="left", padx=(0, 10))
        
        show_empty_cb = ctk.CTkCheckBox(
            year_controls,
            text="Show Empty Years",
            variable=self.hide_empty_years_var,
            command=self._update_visualizations,
            font=ctk.CTkFont(size=11)
        )
        show_empty_cb.pack(side="left")
        
        # Doughnut chart container
        doughnut_label = ctk.CTkLabel(
            self.viz_frame,
            text="Tag Distribution",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        doughnut_label.grid(row=2, column=0, padx=20, pady=(0, 5), sticky="w")
        
        self.doughnut_container = ctk.CTkFrame(self.viz_frame, height=DOUGHNUT_CANVAS_PX, fg_color="transparent")
        self.doughnut_container.grid(row=3, column=0, padx=15, pady=(0, 12), sticky="nsew")
        self.doughnut_container.grid_propagate(False)
        
        # Year distribution container
        year_label = ctk.CTkLabel(
            self.viz_frame,
            text="Year Distribution",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        year_label.grid(row=4, column=0, padx=20, pady=(0, 6), sticky="w")
        
        self.year_container = ctk.CTkFrame(self.viz_frame, height=YEAR_CONTAINER_HEIGHT, fg_color="transparent")
        self.year_container.grid(row=5, column=0, padx=15, pady=(0, 12), sticky="nsew")
        self.year_container.grid_propagate(False)
        
        # Shared legend container
        legend_label = ctk.CTkLabel(
            self.viz_frame,
            text="Legend",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        )
        legend_label.grid(row=6, column=0, padx=20, pady=(0, 6), sticky="w")
        
        self.legend_container = ctk.CTkScrollableFrame(
            self.viz_frame,
            fg_color="transparent"
        )
        self.legend_container.grid(row=7, column=0, padx=15, pady=0, sticky="nsew")
        # Legend is shown inline; popup legend window available via context menu

    
    
    def _update_visualizations(self):
        """Update both visualizations - only if visible"""
        if not self.current_query:
            return
        
        # Only update if visualizations are visible (performance optimization)
        if not self.visualizations_visible:
            return
        
        results = self.current_query.get('results', [])
        
        # Collect tag data for legend
        tag_data = self._collect_tag_data(results)
        
        # Create charts without legends
        self._create_doughnut_chart(results, tag_data)
        self._create_year_distribution(results, tag_data)
        
        # Keep a snapshot for popup legend window
        try:
            self._legend_data = dict(tag_data)
        except Exception:
            self._legend_data = tag_data
        
        # Create shared legend under the charts
        self._create_shared_legend(tag_data)
    
    def _collect_tag_data(self, results: List[Dict]) -> Dict:
        """Collect tag names, colors, and counts from results"""
        if not results:
            return {}
        
        tag_data = {}  # tag_name -> {'color': color, 'count': count}
        
        for article in results:
            color_name, tag_name, _, _ = self._get_article_tag_info(article)
            
            # Skip "None" tag if Show None is unchecked
            if tag_name == "None" and not self.show_unknown_year_var.get():
                continue
            
            if tag_name not in tag_data:
                color = self.tag_colors.get(color_name, '#e0e0e0') or '#e0e0e0'
                tag_data[tag_name] = {'color': color, 'count': 0}
            tag_data[tag_name]['count'] += 1
        
        return tag_data
    
    def _create_doughnut_chart(self, results: List[Dict], tag_data: Dict):
        """Create a doughnut chart showing tag distribution"""
        # Clear previous
        for widget in self.doughnut_container.winfo_children():
            widget.destroy()
        
        # Build counts directly from tag_data to stay consistent with "Show None" filter
        # tag_data already excludes "None" when the checkbox is unchecked
        tag_counts = { name: data['count'] for name, data in tag_data.items() }
        
        if not tag_counts:
            label = ctk.CTkLabel(
                self.doughnut_container,
                text="No data available",
                font=ctk.CTkFont(size=12),
                text_color="gray"
            )
            label.pack(expand=True)
            return
        
        # Create matplotlib figure with transparent background (forced size)
        fig = Figure(figsize=DOUGHNUT_FIGSIZE, dpi=100, facecolor='none')
        ax = fig.add_subplot(111)
        ax.set_facecolor('none')  # Transparent axes background
        
        labels = list(tag_counts.keys())
        sizes = list(tag_counts.values())
        colors = [tag_data[tag]['color'] for tag in labels]
        
        # Create pie chart without labels and without percentages
        wedges, texts = ax.pie(
            sizes,
            labels=None,
            colors=colors,
            autopct=None,
            startangle=90,
            wedgeprops={'linewidth': 0, 'antialiased': True}
        )
        
        # Create doughnut hole - match viz_frame background color
        import customtkinter as ctk
        current_mode = ctk.get_appearance_mode()
        # Match the default CustomTkinter frame color (viz_frame background)
        hole_color = '#2b2b2b' if current_mode == 'Dark' else '#dbdbdb'
        centre_circle = Circle((0, 0), 0.55, fc=hole_color, linewidth=0)
        ax.add_artist(centre_circle)
        # Add centered total count text
        total = sum(sizes)
        text_color = 'white' if current_mode == 'Dark' else 'black'
        ax.text(0, 0, str(total), ha='center', va='center', fontsize=22, fontweight='bold', color=text_color)
        
        ax.axis('equal')
        fig.tight_layout(pad=0)
        
        # Store figure for export
        self.doughnut_fig = fig
        self.doughnut_tag_data = tag_data
        
        # Embed in tkinter with background matching viz_frame
        canvas = FigureCanvasTkAgg(fig, master=self.doughnut_container)
        canvas.draw()
        canvas_widget = canvas.get_tk_widget()
        # Match viz_frame background color exactly
        bg_color = '#2b2b2b' if ctk.get_appearance_mode() == 'Dark' else '#dbdbdb'
        canvas_widget.configure(
            bg=bg_color,
            highlightthickness=0,
            width=DOUGHNUT_CANVAS_PX,
            height=DOUGHNUT_CANVAS_PX
        )
        canvas_widget.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        
        # Add right-click export menu
        canvas_widget.bind("<Button-3>", lambda e: self._show_viz_export_menu(e, 'doughnut'))
    
    def _create_year_distribution(self, results: List[Dict], tag_data: Dict):
        """Create a stacked bar chart showing year distribution by tag"""
        # Clear previous
        for widget in self.year_container.winfo_children():
            widget.destroy()
        
        # Count by year and tag_name from global tags
        year_tag_counts = {}
        
        for article in results:
            date = article.get('date', '')
            year = date[:4] if date and len(date) >= 4 else 'Unknown'
            color_key, tag_name, _, _ = self._get_article_tag_info(article)
            
            # Skip "None" tag if Show None is unchecked
            if tag_name == "None" and not self.show_unknown_year_var.get():
                continue
            
            if year not in year_tag_counts:
                year_tag_counts[year] = {}
            year_tag_counts[year][color_key] = year_tag_counts[year].get(color_key, 0) + 1
        
        if not year_tag_counts:
            label = ctk.CTkLabel(
                self.year_container,
                text="No data available",
                font=ctk.CTkFont(size=12),
                text_color="gray"
            )
            label.pack(expand=True)
            return
        
        # Sort years and apply filters
        years = sorted([y for y in year_tag_counts.keys() if y != 'Unknown'])
        
        # Apply year filter from filter panel - AFFECTS VISUALIZATIONS
        year_from = self.year_from_var.get().strip() if hasattr(self, 'year_from_var') else ""
        year_to = self.year_to_var.get().strip() if hasattr(self, 'year_to_var') else ""
        
        if year_from or year_to:
            numeric_years = [y for y in years if y != 'Unknown']
            if numeric_years:
                try:
                    from_year = int(year_from) if year_from else int(min(numeric_years))
                    to_year = int(year_to) if year_to else int(max(numeric_years))
                    years = [y for y in years if y != 'Unknown' and from_year <= int(y) <= to_year]
                except ValueError:
                    pass
        
        # Add Unknown year if present (always show it, regardless of checkbox)
        if 'Unknown' in year_tag_counts:
            years.append('Unknown')
        
        # Handle empty years - show ALL years in range if checkbox is CHECKED (inverted logic because variable is named 'hide')
        if self.hide_empty_years_var.get() and years:
            # Get min and max year (excluding Unknown)
            numeric_years = [y for y in years if y != 'Unknown']
            if numeric_years:
                min_year = min(numeric_years)
                max_year = max(numeric_years)
                
                # Create complete range from min to max
                all_years_range = [str(y) for y in range(int(min_year), int(max_year) + 1)]
                
                # Use complete range (including years with no articles)
                years = all_years_range
                
                # Re-add Unknown at the end if it exists
                if 'Unknown' in year_tag_counts:
                    years.append('Unknown')
        
        if not years:
            label = ctk.CTkLabel(
                self.year_container,
                text="No data to display",
                font=ctk.CTkFont(size=12),
                text_color="gray"
            )
            label.pack(expand=True)
            return
        
        # Get all tags
        all_tags = set()
        for year_data in year_tag_counts.values():
            all_tags.update(year_data.keys())
        tags = sorted(all_tags)
        
        # Limit display to max displayable years (approximately 18 years fit well in the space)
        max_displayable = 18
        total_years = len(years)
        displayed_years = years
        hidden_count = 0
        
        if total_years > max_displayable:
            # Show the most recent years
            numeric_years = [y for y in years if y != 'Unknown']
            if numeric_years:
                displayed_years = numeric_years[-max_displayable:]
                hidden_count = total_years - len(displayed_years)
                # Re-add Unknown if it was in the original list
                if 'Unknown' in years:
                    displayed_years = displayed_years[:-1]  # Make room for Unknown
                    displayed_years.append('Unknown')
                    hidden_count = total_years - len(displayed_years)
        
        # Fixed size for consistent display
        # Create matplotlib figure with transparent background
        fig = Figure(figsize=YEAR_CHART_FIGSIZE, dpi=100, facecolor='none')
        ax = fig.add_subplot(111)
        ax.set_facecolor('none')  # Transparent axes background
        
        # Prepare data for stacking
        bottoms = [0] * len(displayed_years)
        
        for tag in tags:
            heights = [year_tag_counts.get(year, {}).get(tag, 0) for year in displayed_years]
            color = self.tag_colors.get(tag, '#e0e0e0') or '#e0e0e0'
            
            ax.bar(displayed_years, heights, bottom=bottoms, color=color, width=0.7)
            bottoms = [b + h for b, h in zip(bottoms, heights)]
        
        # Styling (no legend)
        ax.set_xlabel('Year', fontsize=9, color='gray')
        ax.set_ylabel('Count', fontsize=9, color='gray')
        ax.tick_params(axis='x', rotation=45, labelsize=8, colors='gray')
        ax.tick_params(axis='y', labelsize=8, colors='gray')
        
        # Force integer y-axis ticks (no decimal values like 2.5)
        from matplotlib.ticker import MaxNLocator
        ax.yaxis.set_major_locator(MaxNLocator(integer=True))
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['left'].set_color('lightgray')
        ax.spines['bottom'].set_color('lightgray')
        ax.grid(axis='y', alpha=0.3, linestyle='--')
        
        # Center the plot with balanced margins (equal left and right spacing)
        # Slightly reduce bottom margin to bring note closer to x-axis
        fig.subplots_adjust(left=0.13, bottom=0.26, right=0.87, top=0.93)
        
        # Store figure and data for export
        self.year_fig = fig
        self.year_tag_data = tag_data
        self.year_tag_counts = year_tag_counts
        self.year_years = years
        self.year_tags = tags
        
        # Embed in tkinter (no scrollbar)
        from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
        canvas = FigureCanvasTkAgg(fig, master=self.year_container)
        canvas.draw()
        canvas_widget = canvas.get_tk_widget()
        # Match viz_frame background color exactly
        import customtkinter as ctk
        bg_color = '#2b2b2b' if ctk.get_appearance_mode() == 'Dark' else '#dbdbdb'
        canvas_widget.configure(
            bg=bg_color,
            highlightthickness=0,
            width=YEAR_CANVAS_PX[0],
            height=YEAR_CANVAS_PX[1]
        )
        canvas_widget.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        
        # Add right-click export menu
        canvas_widget.bind("<Button-3>", lambda e: self._show_viz_export_menu(e, 'year'))
        
        # Add info label if years are hidden
        if hidden_count > 0:
            year_range_text = f"{displayed_years[0]}-{displayed_years[-2] if 'Unknown' in displayed_years else displayed_years[-1]}"
            info_text = f"⚠️ {hidden_count} year{'s' if hidden_count > 1 else ''} not shown (displaying {len(displayed_years) - (1 if 'Unknown' in displayed_years else 0)} of {total_years - (1 if 'Unknown' in years else 0)} years in range {year_range_text})"
            if 'Unknown' in displayed_years:
                info_text += " + Unknown"
            
            info_label = ctk.CTkLabel(
                self.year_container,
                text=info_text,
                font=ctk.CTkFont(size=10),
                text_color="orange",
                anchor="w"
            )
            info_label.pack(fill=tk.X, padx=10, pady=(2, 0))
    
    def _show_viz_export_menu(self, event, viz_type: str):
        """Show context menu for visualization actions (export, legend)"""
        menu = tk.Menu(self, tearoff=0)
        
        # Dark mode support
        if ctk.get_appearance_mode() == 'Dark':
            menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
        else:
            menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
        
        # Open legend in a popup (better for small monitors)
        menu.add_command(label="Open legend window", command=self._open_legend_window)
        menu.add_separator()
        menu.add_command(label="Export current visualization", command=lambda: self._export_visualization(viz_type))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _open_legend_window(self):
        """Open a centered popup window showing the full legend"""
        try:
            # Determine tag data
            tag_data = getattr(self, '_legend_data', None)
            if tag_data is None and getattr(self, 'current_query', None):
                results = self.current_query.get('results', [])
                tag_data = self._collect_tag_data(results)
            if not tag_data:
                from utils.mb_shim import messagebox
                messagebox.showinfo("Legend", "No legend available.")
                return

            dlg = ctk.CTkToplevel(self)
            dlg.title("Legend")
            dlg.resizable(False, False)
            dlg.transient(self)
            dlg.grab_set()

            frame = ctk.CTkFrame(dlg)
            frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
            frame.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(frame, text="Legend", font=ctk.CTkFont(size=18, weight="bold")).grid(row=0, column=0, sticky="w")

            body = ctk.CTkScrollableFrame(frame, width=540, height=420)
            body.grid(row=1, column=0, sticky="nsew", pady=(10, 0))
            body.grid_columnconfigure(0, weight=1)

            # Selected/Corpus summary at top
            summary = ctk.CTkFrame(body, fg_color="transparent")
            summary.grid(row=0, column=0, sticky="w", pady=(0, 6))
            # counts
            sel_count = 0
            corp_count = 0
            try:
                for a in getattr(self, 'filtered_results', []) or []:
                    _, _, fav, corp = self._get_article_tag_info(a)
                    if fav:
                        sel_count += 1
                    if corp:
                        corp_count += 1
            except Exception:
                pass
            pin = "✅"
            star = "⭐"
            ctk.CTkLabel(summary, text=pin, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
            ctk.CTkLabel(summary, text=f"Selected: {sel_count}", font=ctk.CTkFont(size=12)).pack(side="left", padx=(0, 16))
            ctk.CTkLabel(summary, text=star, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
            ctk.CTkLabel(summary, text=f"Corpus: {corp_count}", font=ctk.CTkFont(size=12)).pack(side="left")

            # Tag items
            row = 1
            total = sum(v['count'] for v in tag_data.values()) or 1
            for tag_name, data in sorted(tag_data.items(), key=lambda x: x[1]['count'], reverse=True):
                item = ctk.CTkFrame(body, fg_color="transparent")
                item.grid(row=row, column=0, sticky="ew", pady=2)
                box = ctk.CTkLabel(item, text="    ", width=24, height=18, corner_radius=4, fg_color=data['color'])
                box.pack(side="left", padx=(0, 8))
                count = data['count']
                pct = (count / total) * 100
                ctk.CTkLabel(item, text=f"{tag_name}: {count} ({pct:.1f}%)", font=ctk.CTkFont(size=12), anchor="w").pack(side="left")
                row += 1

            # Center and show
            dlg.update_idletasks()
            w = dlg.winfo_reqwidth()
            h = dlg.winfo_reqheight()
            x = (dlg.winfo_screenwidth() - w) // 2
            y = (dlg.winfo_screenheight() - h) // 2
            dlg.geometry(f"+{x}+{y}")
        except Exception as e:
            print(f"Error opening legend window: {e}")
    
    def _export_visualization(self, viz_type: str):
        """Export visualization as PNG with legend"""
        try:
            from datetime import datetime
            
            # Get the appropriate figure and tag data
            if viz_type == 'doughnut':
                if not hasattr(self, 'doughnut_fig') or not hasattr(self, 'doughnut_tag_data'):
                    messagebox.showwarning("Export Error", "No visualization to export.")
                    return
                fig = self.doughnut_fig
                tag_data = self.doughnut_tag_data
                viz_name = "tag_distribution"
            else:  # year
                if not hasattr(self, 'year_fig') or not hasattr(self, 'year_tag_data'):
                    messagebox.showwarning("Export Error", "No visualization to export.")
                    return
                fig = self.year_fig
                tag_data = self.year_tag_data
                viz_name = "year_distribution"
            
            # Create results folder if it doesn't exist
            results_folder = self.workspace_path / "results"
            results_folder.mkdir(exist_ok=True)
            
            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = results_folder / f"{viz_name}_{timestamp}.png"
            
            # Create a new figure with legend included
            from matplotlib.figure import Figure
            TAG_FIGSIZE = (12, 6)  # canonical doughnut export size (wider to fit legend)
            YEAR_FIGSIZE = (14, 6) # canonical year export size
            export_size = TAG_FIGSIZE if viz_type == 'doughnut' else YEAR_FIGSIZE
            combined_fig = Figure(figsize=export_size, dpi=150, facecolor='white')

            # Use fixed axes rectangle; shifted left to avoid legend clipping
            AX_RECT = [0.04, 0.12, 0.62, 0.78]  # left, bottom, width, height
            ax_main = combined_fig.add_axes(AX_RECT)
            
            # Get original axes and copy it
            original_ax = fig.get_axes()[0]
            
            # Copy all artists from original to new
            for artist in original_ax.get_children():
                if hasattr(artist, 'get_facecolor'):
                    try:
                        ax_main.add_artist(artist)
                    except:
                        pass
            
            # Recreate the visualization on the new figure
            if viz_type == 'doughnut':
                # Recreate doughnut chart
                labels = list(tag_data.keys())
                sizes = [tag_data[label]['count'] for label in labels]
                colors = [tag_data[label]['color'] for label in labels]
                
                wedges, texts = ax_main.pie(
                    sizes,
                    labels=None,
                    colors=colors,
                    autopct=None,
                    startangle=90,
                    wedgeprops={'linewidth': 0, 'antialiased': True}
                )
                
                from matplotlib.patches import Circle
                centre_circle = Circle((0, 0), 0.55, fc='white', linewidth=0)
                ax_main.add_artist(centre_circle)
                # Centered total count on export (black on white)
                total = sum(sizes)
                ax_main.text(0, 0, str(total), ha='center', va='center', fontsize=26, fontweight='bold', color='black')
                ax_main.axis('equal')
                ax_main.set_title('Tag Distribution', fontsize=14, weight='bold', pad=12)
                
                # Add legend
                total = sum(sizes)
                legend_labels = [f"{label}: {tag_data[label]['count']} ({tag_data[label]['count']/total*100:.1f}%)" for label in labels]
                # Nudge legend slightly left to prevent cropping on wide legends
                ax_main.legend(wedges, legend_labels, loc='center left', bbox_to_anchor=(0.94, 0.5), fontsize=10, frameon=False)
            else:
                # Year distribution - recreate with legend
                if not hasattr(self, 'year_tag_counts') or not hasattr(self, 'year_years') or not hasattr(self, 'year_tags'):
                    # Fallback: enforce year-specific export size on existing figure
                    try:
                        fig.set_size_inches(*YEAR_FIGSIZE)
                    except Exception:
                        pass
                    fig.savefig(str(filename), dpi=150, bbox_inches='tight', facecolor='white')
                    messagebox.showinfo("Export Successful", f"Visualization exported to:\n{filename}")
                    return
                
                year_tag_counts = self.year_tag_counts
                years = self.year_years
                tags = self.year_tags
                
                # Build color to tag name mapping from global tags
                color_to_name = {}
                for eid, tag_info in self.global_tags.items():
                    color_key = tag_info.get('color', 'None')
                    tag_name = tag_info.get('tag', color_key)
                    if color_key not in color_to_name:
                        color_to_name[color_key] = tag_name
                
                # Recreate the stacked bar chart
                bottoms = [0] * len(years)
                bar_patches = []
                
                for tag in tags:
                    heights = [year_tag_counts.get(year, {}).get(tag, 0) for year in years]
                    color = self.tag_colors.get(tag, '#e0e0e0') or '#e0e0e0'
                    
                    patches = ax_main.bar(years, heights, bottom=bottoms, color=color, width=0.7, label=tag)
                    bar_patches.append((patches, tag, sum(heights)))
                    bottoms = [b + h for b, h in zip(bottoms, heights)]
                
                # Styling
                ax_main.set_xlabel('Year', fontsize=12, color='black')
                ax_main.set_ylabel('Count', fontsize=12, color='black')
                ax_main.tick_params(axis='x', rotation=45, labelsize=10, colors='black')
                ax_main.tick_params(axis='y', labelsize=10, colors='black')
                ax_main.set_title('Year Distribution', fontsize=14, weight='bold', pad=12)
                
                # Force integer y-axis ticks
                from matplotlib.ticker import MaxNLocator
                ax_main.yaxis.set_major_locator(MaxNLocator(integer=True))
                
                ax_main.spines['top'].set_visible(False)
                ax_main.spines['right'].set_visible(False)
                ax_main.spines['left'].set_color('gray')
                ax_main.spines['bottom'].set_color('gray')
                ax_main.grid(axis='y', alpha=0.3, linestyle='--')
                
                # Add legend with counts
                legend_labels = [f"{color_to_name.get(tag, tag)}: {count}" for _, tag, count in sorted(bar_patches, key=lambda x: x[2], reverse=True)]
                legend_handles = [patches[0] for patches, _, _ in sorted(bar_patches, key=lambda x: x[2], reverse=True)]
                ax_main.legend(legend_handles, legend_labels, loc='center left', bbox_to_anchor=(1.0, 0.5), fontsize=10, frameon=False)
            
            # Save the figure
            combined_fig.savefig(str(filename), dpi=150, facecolor='white')
            messagebox.showinfo("Export Successful", f"Visualization exported to:\n{filename}")
            
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export visualization:\n{str(e)}")
    
    def _create_shared_legend(self, tag_data: Dict):
        """Create shared legend for both charts with counts and percentages"""
        # Clear previous
        for widget in self.legend_container.winfo_children():
            widget.destroy()
        
        if not tag_data:
            return
        
        # Calculate total count for percentages
        total_count = sum(data['count'] for data in tag_data.values())
        
        # Build a two-column grid inside legend for tags in col 0 and Selected/Corpus in col 1
        grid = ctk.CTkFrame(self.legend_container, fg_color="transparent")
        grid.pack(fill="both", expand=True)
        grid.grid_columnconfigure(0, weight=1)
        grid.grid_columnconfigure(1, weight=0, minsize=220)

        # Left column: tags
        row_idx = 0
        for tag_name, data in sorted(tag_data.items(), key=lambda x: x[1]['count'], reverse=True):
            color = data['color']
            count = data['count']
            percentage = (count / total_count * 100) if total_count > 0 else 0
            
            # Legend item frame
            legend_item = ctk.CTkFrame(grid, fg_color="transparent")
            legend_item.grid(row=row_idx, column=0, sticky="ew", padx=(0, 8), pady=2)
            
            # Color box
            color_box = ctk.CTkFrame(
                legend_item,
                width=20,
                height=20,
                fg_color=color,
                corner_radius=5
            )
            color_box.pack(side="left", padx=(0, 8))
            color_box.pack_propagate(False)
            
            # Tag name with count and percentage
            label = ctk.CTkLabel(
                legend_item,
                text=f"{tag_name}: {count} ({percentage:.1f}%)",
                font=ctk.CTkFont(size=11),
                anchor="w"
            )
            label.pack(side="left", fill="x", expand=True)
            row_idx += 1

        # Right column: Selected/Corpus summary (left-aligned)
        right_col = ctk.CTkFrame(grid, fg_color="transparent")
        right_col.grid(row=0, column=1, rowspan=max(1, row_idx), padx=(12, 0), sticky="nw")
        right_col.grid_columnconfigure(0, weight=0)

        # Compute counts based on current results
        sel_count = 0
        corp_count = 0
        try:
            for a in self.filtered_results:
                _, _, fav, corp = self._get_article_tag_info(a)
                if fav:
                    sel_count += 1
                if corp:
                    corp_count += 1
        except Exception:
            pass

        # Icons matching article cards: keep exactly same as Corpus view
        pin = "✅"   # selected
        star = "⭐"   # corpus
        # Selected row: big icon, normal text (pin)
        sel_row = ctk.CTkFrame(right_col, fg_color="transparent")
        # Left-bound: keep icon column fixed width so symbols align vertically
        sel_row.pack(anchor="w", pady=(2, 2))
        ctk.CTkLabel(sel_row, text=pin, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
        ctk.CTkLabel(sel_row, text=f"Selected: {sel_count}", font=ctk.CTkFont(size=11), anchor="w").pack(side="left")
        # Corpus row: big icon, normal text (star)
        corp_row = ctk.CTkFrame(right_col, fg_color="transparent")
        corp_row.pack(anchor="w", pady=(2, 2))
        ctk.CTkLabel(corp_row, text=star, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
        ctk.CTkLabel(corp_row, text=f"Corpus: {corp_count}", font=ctk.CTkFont(size=11), anchor="w").pack(side="left")
    
    def _create_filter_sidebar(self):
        """Create the top filter sidebar for year range, sorting, and tag filtering"""
        # Container for filter sidebar
        self.filter_sidebar = ctk.CTkFrame(self.article_frame, corner_radius=8)
        # Don't grid it initially - will be gridded when toggled
        
        # Configure grid - 3 columns
        self.filter_sidebar.grid_columnconfigure(0, weight=1)
        self.filter_sidebar.grid_columnconfigure(1, weight=1)
        self.filter_sidebar.grid_columnconfigure(2, weight=1)
        
        # Title
        title_label = ctk.CTkLabel(
            self.filter_sidebar,
            text="Filter & Sort",
            font=ctk.CTkFont(size=13, weight="bold"),
            anchor="w"
        )
        title_label.grid(row=0, column=0, columnspan=3, padx=10, pady=(8, 5), sticky="w")
        
        # Create content frame
        content_frame = ctk.CTkFrame(self.filter_sidebar, fg_color="transparent")
        content_frame.grid(row=1, column=0, columnspan=3, padx=10, pady=(0, 8), sticky="ew")
        content_frame.grid_columnconfigure(0, weight=1)
        content_frame.grid_columnconfigure(1, weight=1)
        content_frame.grid_columnconfigure(2, weight=1)
        
        # Column 1: Year Range Filter
        year_frame = ctk.CTkFrame(content_frame, fg_color="transparent")
        year_frame.grid(row=0, column=0, padx=(0, 5), sticky="ew")
        
        ctk.CTkLabel(
            year_frame,
            text="Year Range:",
            font=ctk.CTkFont(size=11, weight="bold")
        ).pack(anchor="w", pady=(0, 3))
        
        year_inputs = ctk.CTkFrame(year_frame, fg_color="transparent")
        year_inputs.pack(fill="x", pady=(0, 3))
        
        ctk.CTkLabel(year_inputs, text="From:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(0, 3))
        self.year_from_entry = ctk.CTkEntry(year_inputs, textvariable=self.year_from_var, width=65, placeholder_text="2020", height=24)
        self.year_from_entry.pack(side="left", padx=(0, 5))
        
        ctk.CTkLabel(year_inputs, text="To:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(0, 3))
        self.year_to_entry = ctk.CTkEntry(year_inputs, textvariable=self.year_to_var, width=65, placeholder_text="2025", height=24)
        self.year_to_entry.pack(side="left")
        
        year_buttons = ctk.CTkFrame(year_frame, fg_color="transparent")
        year_buttons.pack(fill="x")
        
        ctk.CTkButton(
            year_buttons,
            text="Apply",
            width=65,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._apply_year_filter
        ).pack(side="left", padx=(0, 3))
        
        ctk.CTkButton(
            year_buttons,
            text="Clear",
            width=65,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._clear_year_filter
        ).pack(side="left")
        
        # Column 2: Sort Order
        sort_frame = ctk.CTkFrame(content_frame, fg_color="transparent")
        sort_frame.grid(row=0, column=1, padx=5, sticky="ew")
        
        ctk.CTkLabel(
            sort_frame,
            text="Sort Order:",
            font=ctk.CTkFont(size=11, weight="bold")
        ).pack(anchor="w", pady=(0, 3))
        
        sort_options = [
            ("Newest First", "newest"),
            ("Oldest First", "oldest")
        ]
        
        for label, value in sort_options:
            ctk.CTkRadioButton(
                sort_frame,
                text=label,
                variable=self.sort_order_var,
                value=value,
                font=ctk.CTkFont(size=10),
                command=self._apply_sorting
            ).pack(anchor="w", pady=1)
        
        # Column 3: Tag Filter
        tag_filter_frame = ctk.CTkFrame(content_frame, fg_color="transparent")
        tag_filter_frame.grid(row=0, column=2, padx=(5, 0), sticky="ew")
        
        ctk.CTkLabel(
            tag_filter_frame,
            text="Filter by Tag:",
            font=ctk.CTkFont(size=11, weight="bold")
        ).pack(anchor="w", pady=(0, 3))
        
        # Tag filter dropdown
        tag_labels = ["All"] + sorted([self._tag_label(k) for k in self.tag_colors.keys() if k != "None"], 
                                      key=lambda x: x.lower())
        self.tag_filter_var = ctk.StringVar(value="All")
        self.tag_filter_dropdown = ctk.CTkComboBox(
            tag_filter_frame,
            variable=self.tag_filter_var,
            values=tag_labels,
            width=140,
            height=24,
            font=ctk.CTkFont(size=10),
            dropdown_font=ctk.CTkFont(size=10),
            state="readonly",
            command=lambda _: self._apply_tag_filter()
        )
        self.tag_filter_dropdown.pack(fill="x", pady=(0, 3))
        
        # Status filters
        status_filter_frame = ctk.CTkFrame(tag_filter_frame, fg_color="transparent")
        status_filter_frame.pack(fill="x")
        
        self.filter_selected_check = ctk.CTkCheckBox(
            status_filter_frame,
            text="Show Selected",
            variable=self.filter_selected_var,
            font=ctk.CTkFont(size=10),
            command=self._apply_status_filter
        )
        self.filter_selected_check.pack(anchor="w", pady=1)
        
        self.filter_corpus_check = ctk.CTkCheckBox(
            status_filter_frame,
            text="Show Corpus",
            variable=self.filter_corpus_var,
            font=ctk.CTkFont(size=10),
            command=self._apply_status_filter
        )
        self.filter_corpus_check.pack(anchor="w", pady=1)
    
    def _create_tag_sidebar(self):
        """Create the bottom tag sidebar for tag management (assign tags to articles)"""
        # Container for tag sidebar
        self.tag_sidebar = ctk.CTkFrame(self.article_frame, corner_radius=8)
        # Initially hidden - will be shown when toggled
        if self.tag_sidebar_visible:
            self.tag_sidebar.grid(row=3, column=0, padx=10, pady=(0, 10), sticky="ew")
        
        # Title
        title_label = ctk.CTkLabel(
            self.tag_sidebar,
            text="Tag Management",
            font=ctk.CTkFont(size=13, weight="bold"),
            anchor="w"
        )
        title_label.pack(padx=10, pady=(8, 5), anchor="w")
        
        # Single section: Assign Tags to Selected Articles
        assign_frame = ctk.CTkFrame(self.tag_sidebar, fg_color="transparent")
        assign_frame.pack(fill="both", expand=True, padx=10, pady=(0, 8))
        
        # Tag selection for assignment
        tag_assign_frame = ctk.CTkFrame(assign_frame, fg_color="transparent")
        tag_assign_frame.pack(fill="x", pady=(0, 3))
        
        ctk.CTkLabel(
            tag_assign_frame,
            text="Assign Tag:",
            font=ctk.CTkFont(size=11, weight="bold"),
            width=70,
            anchor="w"
        ).pack(side="left", padx=(0, 5))
        
        # Dropdown for tag selection (will be populated with tag labels)
        # Create sorted list of tag labels
        tag_labels = sorted([self._tag_label(k) for k in self.tag_colors.keys()], 
                           key=lambda x: x.lower())
        self.assign_tag_var = ctk.StringVar(value=self._tag_label("None"))
        self.assign_tag_dropdown = ctk.CTkComboBox(
            tag_assign_frame,
            variable=self.assign_tag_var,
            values=tag_labels,
            width=140,
            height=24,
            font=ctk.CTkFont(size=10),
            dropdown_font=ctk.CTkFont(size=10),
            state="readonly"
        )
        self.assign_tag_dropdown.pack(side="left", padx=3)
        
        # Assign button
        assign_btn = ctk.CTkButton(
            tag_assign_frame,
            text="Assign",
            width=70,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._assign_tag_to_selected
        )
        assign_btn.pack(side="left", padx=3)
        
        # Status buttons
        status_buttons_frame = ctk.CTkFrame(assign_frame, fg_color="transparent")
        status_buttons_frame.pack(fill="x", pady=(0, 3))
        
        ctk.CTkLabel(
            status_buttons_frame,
            text="Quick Actions:",
            font=ctk.CTkFont(size=11, weight="bold"),
            width=70,
            anchor="w"
        ).pack(side="left", padx=(0, 5))
        
        # Selected button (dynamic)
        self.selected_btn = ctk.CTkButton(
            status_buttons_frame,
            text="Show Selected",
            width=130,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._toggle_selected_status
        )
        self.selected_btn.pack(side="left", padx=3)
        
        # Corpus button (dynamic)
        self.corpus_btn = ctk.CTkButton(
            status_buttons_frame,
            text="Show Corpus",
            width=130,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._toggle_corpus_status
        )
        self.corpus_btn.pack(side="left", padx=3)
        
        # Info label for selected count
        self.selected_count_label = ctk.CTkLabel(
            assign_frame,
            text="No articles selected",
            font=ctk.CTkFont(size=10),
            text_color="gray",
            anchor="w"
        )
        self.selected_count_label.pack(pady=(0, 3), anchor="w")
    
    def _apply_year_filter(self):
        """Apply year range filter"""
        self._update_article_list()
    
    def _clear_year_filter(self):
        """Clear year range filter"""
        self.year_from_var.set("")
        self.year_to_var.set("")
        self._update_article_list()
    
    def _apply_tag_filter(self):
        """Apply tag filter from dropdown"""
        selected_tag = self.tag_filter_var.get()
        if selected_tag == "All":
            self.active_tag_filter = None
        else:
            # Convert display label back to color key
            self.active_tag_filter = self._tag_label_to_key.get(selected_tag, None)
        self.current_page = 0  # Reset to first page when filter changes
        self._update_article_list()
    
    def _apply_sorting(self):
        """Apply sort order"""
        self.current_page = 0  # Reset to first page when sorting changes
        self._update_article_list()
    
    def _toggle_filter_sidebar(self):
        """Toggle visibility of the filter sidebar"""
        self.filter_sidebar_visible = not self.filter_sidebar_visible
        
        if self.filter_sidebar_visible:
            # Show filter sidebar under search bar (row 2)
            self.filter_sidebar.grid(row=2, column=0, padx=8, pady=(3, 0), sticky="ew")
            # Move article list down to row 3
            self.article_list_container.grid(row=3, column=0, padx=(2, 8), pady=(3, 0), sticky="nsew")
            # Row 3 should expand (article list), not row 2 (filter sidebar)
            self.article_frame.grid_rowconfigure(2, weight=0)
            self.article_frame.grid_rowconfigure(3, weight=1)
            # Move tag sidebar down if visible
            if self.tag_sidebar_visible:
                self.tag_sidebar.grid(row=4, column=0, padx=8, pady=(3, 5), sticky="ew")
            # Update button icon
            if self.icon_sidebar_t_act:
                self.filter_toggle_btn.configure(image=self.icon_sidebar_t_act)
            elif not self.icon_sidebar_t:
                self.filter_toggle_btn.configure(text="Hide Filters")
        else:
            # Hide filter sidebar
            self.filter_sidebar.grid_remove()
            # Move article list back up to row 2
            self.article_list_container.grid(row=2, column=0, padx=(2, 8), pady=(3, 0), sticky="nsew")
            # Row 2 should expand (article list)
            self.article_frame.grid_rowconfigure(2, weight=1)
            self.article_frame.grid_rowconfigure(3, weight=0)
            # Move tag sidebar back up if visible
            if self.tag_sidebar_visible:
                self.tag_sidebar.grid(row=3, column=0, padx=8, pady=(3, 5), sticky="ew")
            # Update button icon
            if self.icon_sidebar_t:
                self.filter_toggle_btn.configure(image=self.icon_sidebar_t)
            elif not self.icon_sidebar_t:
                self.filter_toggle_btn.configure(text="Show Filters")
    
    def _toggle_tag_sidebar(self):
        """Toggle visibility of the tag sidebar"""
        self.tag_sidebar_visible = not self.tag_sidebar_visible
        
        if self.tag_sidebar_visible:
            # Show tag sidebar at correct row based on filter sidebar visibility
            if self.filter_sidebar_visible:
                # Filter sidebar is shown, so tag sidebar goes to row 4
                self.tag_sidebar.grid(row=4, column=0, padx=8, pady=(0, 5), sticky="ew")
            else:
                # Filter sidebar is hidden, so tag sidebar goes to row 3
                self.tag_sidebar.grid(row=3, column=0, padx=8, pady=(0, 5), sticky="ew")
            # Update button icon
            if self.icon_sidebar_b_act:
                self.tag_toggle_btn.configure(image=self.icon_sidebar_b_act)
            elif not self.icon_sidebar_b:
                self.tag_toggle_btn.configure(text="Hide Tags")
        else:
            # Hide tag sidebar
            self.tag_sidebar.grid_remove()
            # Update button icon
            if self.icon_sidebar_b:
                self.tag_toggle_btn.configure(image=self.icon_sidebar_b)
            elif not self.icon_sidebar_b:
                self.tag_toggle_btn.configure(text="Show Tags")
        
        # Update selected count label
        self._update_selected_count()
        
        # Refresh article list to show/hide checkboxes
        self._update_article_list()
    
    def _toggle_article_selection(self, eid: str, selected: bool):
        """Toggle selection state of an article"""
        if selected:
            self.selected_articles.add(eid)
        else:
            self.selected_articles.discard(eid)
        
        # Update selected count label and button states
        self._update_selected_count()
        
        # Update status buttons if tag sidebar is visible
        if self.tag_sidebar_visible and self.selected_articles:
            self._update_status_buttons()
    
    def _update_selected_count(self):
        """Update the selected articles count label and button states"""
        count = len(self.selected_articles)
        if count == 0:
            self.selected_count_label.configure(text="No articles selected")
            self.selected_btn.configure(text="Add to Selected", state="disabled")
            self.corpus_btn.configure(text="Add to Corpus", state="disabled")
        elif count == 1:
            self.selected_count_label.configure(text="1 article selected")
            self._update_status_buttons()
        else:
            self.selected_count_label.configure(text=f"{count} articles selected")
            self._update_status_buttons()
    
    def _update_status_buttons(self):
        """Update Selected/Corpus button texts based on current selection status"""
        if not self.selected_articles:
            return
        
        # Check if all selected articles have the same status
        all_selected = True
        all_not_selected = True
        all_corpus = True
        all_not_corpus = True
        
        for eid in self.selected_articles:
            _, _, favorite, must_cite = self._get_article_tag_info_by_eid(eid)
            if favorite:
                all_not_selected = False
            else:
                all_selected = False
            if must_cite:
                all_not_corpus = False
            else:
                all_corpus = False
        
        # Update Selected button
        if all_selected:
            self.selected_btn.configure(text="Remove from Selected", state="normal")
        elif all_not_selected:
            self.selected_btn.configure(text="Add to Selected", state="normal")
        else:
            self.selected_btn.configure(text="Toggle Selected", state="normal")
        
        # Update Corpus button
        if all_corpus:
            self.corpus_btn.configure(text="Remove from Corpus", state="normal")
        elif all_not_corpus:
            self.corpus_btn.configure(text="Add to Corpus", state="normal")
        else:
            self.corpus_btn.configure(text="Toggle Corpus", state="normal")
    
    def _get_article_tag_info_by_eid(self, eid: str) -> tuple:
        """Get tag information for an article by EID (supports new and legacy keys)"""
        # Check global_tags
        if eid and eid in self.global_tags:
            tag_data = self.global_tags[eid]
            color = tag_data.get('color', 'None')  # Color key for lookup in tag_colors
            tag = tag_data.get('tag', color)  # Display name (can be custom)
            favorite = tag_data.get('selected', False)
            must_cite = tag_data.get('corpus', False)
            return color, tag, favorite, must_cite
        
        # Check if article exists in current query results
        if self.current_query:
            for article in self.current_query.get('results', []):
                if article.get('eid') == eid:
                    return self._get_article_tag_info(article)
        
        return 'None', self._tag_label('None'), False, False
    
    def _toggle_selected_status(self):
        """Toggle Selected status for selected articles"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        # Check current status
        all_selected = all(
            self._get_article_tag_info_by_eid(eid)[2] 
            for eid in self.selected_articles
        )
        
        # Toggle: if all are selected, unmark them; otherwise mark them
        mark = not all_selected
        self._mark_selected_articles(mark)
    
    def _toggle_corpus_status(self):
        """Toggle Corpus status for selected articles"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        # Check current status
        all_corpus = all(
            self._get_article_tag_info_by_eid(eid)[3] 
            for eid in self.selected_articles
        )
        
        # Toggle: if all are corpus, unmark them; otherwise mark them
        mark = not all_corpus
        self._mark_corpus_articles(mark)
    
    def _assign_tag_to_selected(self):
        """Assign the selected tag to all selected articles"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article to assign a tag.")
            return
        
        tag_label = self.assign_tag_var.get()
        # Convert label back to color key
        tag_key = self._tag_label_to_key.get(tag_label, tag_label)
        
        # Assign tag to all selected articles
        count = 0
        for eid in self.selected_articles:
            # Update global tags
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            
            self.global_tags[eid]['color'] = tag_key
            self.global_tags[eid]['tag'] = tag_label  # Store display label
            self.global_tags[eid]['last_modified'] = datetime.now().isoformat(timespec="seconds")
            
            # Update in current query results
            if self.current_query:
                for article in self.current_query.get('results', []):
                    if article.get('eid') == eid:
                        article['tag'] = tag_key
                        article['tag_color'] = tag_key
            
            count += 1
        
        # Save global tags
        self._save_global_tags()
        
        # Clear selection
        self.selected_articles.clear()
        
        # Refresh article list to show updated tags
        self._update_article_list()
        # Also refresh visualizations to reflect new tag distribution
        self._update_visualizations()
        
        # Show confirmation
        messagebox.showinfo("Success", f"Tag '{tag_label}' assigned to {count} article(s).")
    
    def _mark_selected_articles(self, mark: bool):
        """Mark or unmark selected articles as 'Selected' (writes new and legacy keys)"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        count = 0
        for eid in self.selected_articles:
            # Update global tags
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            
            # Write new keys only
            self.global_tags[eid]['selected'] = mark
            self.global_tags[eid]['last_modified'] = datetime.now().isoformat(timespec="seconds")
            
            # Update in current query results
            if self.current_query:
                for article in self.current_query.get('results', []):
                    if article.get('eid') == eid:
                        article['selected'] = mark
            
            count += 1
        
        # Save global tags
        self._save_global_tags()
        
        # Clear selection
        self.selected_articles.clear()
        
        # Refresh article list
        self._update_article_list()
        # Visualizations are based on tags; safe to refresh
        self._update_visualizations()
        
        # Show confirmation
        action = "marked as Selected" if mark else "unmarked from Selected"
        messagebox.showinfo("Success", f"{count} article(s) {action}.")
    
    def _mark_corpus_articles(self, mark: bool):
        """Mark or unmark selected articles as 'Corpus' (writes new and legacy keys)"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        count = 0
        for eid in self.selected_articles:
            # Update global tags
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            
            # Write new key only
            self.global_tags[eid]['corpus'] = mark
            self.global_tags[eid]['last_modified'] = datetime.now().isoformat(timespec="seconds")
            
            # Update in current query results
            if self.current_query:
                for article in self.current_query.get('results', []):
                    if article.get('eid') == eid:
                        article['corpus'] = mark
                
            count += 1
        
        # Save global tags
        self._save_global_tags()
        
        # Clear selection
        self.selected_articles.clear()
        
        # Refresh article list
        self._update_article_list()
        # Visualizations are based on tags; safe to refresh
        self._update_visualizations()
        
        # Show confirmation
        action = "marked as Corpus" if mark else "unmarked from Corpus"
        messagebox.showinfo("Success", f"{count} article(s) {action}.")
    
    def _apply_status_filter(self):
        """Apply Selected/Corpus filter in addition to tag filter"""
        # Reset to first page and update article list
        self.current_page = 0
        self._update_article_list()


if __name__ == "__main__":
    # Test the view
    root = ctk.CTk()
    root.geometry("1400x900")
    ctk.set_appearance_mode("dark")
    
    # Get workspace path dynamically (two levels up from this file)
    workspace = str(Path(__file__).parent.parent.parent)
    view = HistoryView(root, workspace)
    view.pack(fill="both", expand=True, padx=20, pady=20)
    
    root.mainloop()
