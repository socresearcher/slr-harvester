"""
Corpus View for SLR Harvester
Displays all articles from search history with filtering (All/Selected/Corpus)
Layout identical to History View
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
from datetime import datetime
import tkinter as tk
from utils.mb_shim import messagebox
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from matplotlib.patches import Circle
import matplotlib
from utils.tooltip import ToolTip

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
HEADER_CONTROLS_MIN_WIDTH = 180


class CorpusView(ctk.CTkFrame):
    """
    Corpus View with:
    - Filter panel (All/Selected/Corpus)
    - Article list with annotations
    - Visualizations (Tag Distribution + Year Distribution)
    """
    
    def __init__(self, parent, workspace_path: str, project_folder: str = ""):
        super().__init__(parent, corner_radius=0, fg_color="transparent")
        
        self.workspace_path = Path(workspace_path)
        self.project_folder = project_folder
        
        # Project-specific paths
        self.project_path = self.workspace_path / "projects" / project_folder
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.search_log_path = self.project_path / "search_log.json"
        
        # UI State
        self.filter_panel_visible: bool = True
        self.visualizations_visible: bool = True
        # Visualization panel width is fixed for consistent layout
        self.tag_sidebar_visible: bool = False
        self.filter_sidebar_visible: bool = False
        
        # Corpus filter mode
        self.corpus_filter_var = tk.StringVar(value="all")
        
        # Filter settings
        self.year_from_var = tk.StringVar(value="")
        self.year_to_var = tk.StringVar(value="")
        self.sort_order_var = tk.StringVar(value="newest")
        self.filter_selected_var = tk.BooleanVar(value=False)
        self.filter_corpus_var = tk.BooleanVar(value=False)
        self.active_tag_filter: Optional[str] = None  # Active tag filter
        
        # Data
        self.all_articles: List[Dict] = []
        self.selected_article: Optional[Dict] = None
        self.selected_articles: set = set()
        self.article_widgets: List = []
        self.global_tags: Dict = {}
        self.tag_aliases: Dict[str, str] = {}
        
        # Pagination
        self.current_page: int = 0
        self.articles_per_page: int = 50
        self.filtered_results: List[Dict] = []
        # Debounce handle for visualization updates
        self._viz_after_id = None
        
        # Tag colors
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

        # Tag label mappings
        self._tag_label_to_key = {}
        self._tag_key_to_label = {}

        # Apply project custom tag colors before UI
        self._load_tag_colors()
        
        # Year distribution controls
        self.show_unknown_year_var = tk.BooleanVar(value=True)
        self.hide_empty_years_var = tk.BooleanVar(value=False)
        
        # Load data
        self._load_all_articles()
        # Build abstract index from all loaded articles (for enriched data across queries)
        self._build_abstract_index()
        self._load_global_tags()
        self._load_tag_aliases()
        
        # Load icons
        self._load_icons()
        
        # Setup UI
        self._setup_ui()
        
        # Initial update
        self._update_article_list()
    
    def _load_all_articles(self):
        """Load all unique articles from all queries"""
        try:
            if self.search_log_path.exists():
                with open(self.search_log_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    query_history = data if isinstance(data, list) else []
                
                seen_eids = set()
                self.all_articles = []
                
                for query in query_history:
                    results = query.get('results', [])
                    for article in results:
                        eid = article.get('eid', '')
                        if eid and eid not in seen_eids:
                            seen_eids.add(eid)
                            self.all_articles.append(article)
                
                print(f"Loaded {len(self.all_articles)} unique articles")
        except Exception as e:
            print(f"Error loading articles: {e}")
            self.all_articles = []
    
    def _load_global_tags(self):
        """Load global tags"""
        try:
            global_tags_path = self.project_path / "slr_global_tags.json"
            if global_tags_path.exists():
                with open(global_tags_path, "r", encoding="utf-8") as f:
                    self.global_tags = json.load(f)
                print(f"Loaded {len(self.global_tags)} global tags from {global_tags_path}")
            else:
                print(f"Global tags file not found: {global_tags_path}")
                self.global_tags = {}
        except Exception as e:
            print(f"Error loading global tags: {e}")
            self.global_tags = {}
    
    def _save_global_tags(self):
        """Save global tags"""
        try:
            global_tags_path = self.project_path / "slr_global_tags.json"
            with open(global_tags_path, "w", encoding="utf-8") as f:
                json.dump(self.global_tags, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving global tags: {e}")
    
    def _load_tag_aliases(self):
        """Load tag aliases (project-level overrides)"""
        try:
            # Prefer project-level aliases
            project_aliases = self.project_path / "tag_aliases.json"
            if project_aliases.exists():
                with open(project_aliases, "r", encoding="utf-8") as f:
                    self.tag_aliases = json.load(f)
            else:
                config_path = self.workspace_path / "slr_gui_settings.json"
                if config_path.exists():
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                        self.tag_aliases = config.get('tag_aliases', {})
        except Exception as e:
            self.tag_aliases = {k: k for k in self.tag_colors.keys()}
        
        self._tag_label_to_key = {self._tag_label(k): k for k in self.tag_colors.keys()}
        self._tag_key_to_label = {k: self._tag_label(k) for k in self.tag_colors.keys()}

    def _build_abstract_index(self):
        """Build a lookup of eid -> abstract using multiple possible keys"""
        self._abstract_index = {}
        try:
            for a in self.all_articles:
                eid = a.get('eid') or ''
                if not eid:
                    continue
                abs_text = ''
                for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                    abs_text = (a.get(key) or '').strip()
                    if abs_text:
                        break
                if abs_text and eid not in self._abstract_index:
                    self._abstract_index[eid] = abs_text
        except Exception as e:
            print(f"Error building abstract index: {e}")

    def _load_tag_colors(self):
        """Load custom tag colors from project config and merge with defaults"""
        try:
            tags_config = self.project_path / "tags_config.json"
            if tags_config.exists():
                with open(tags_config, "r", encoding="utf-8") as f:
                    custom = json.load(f)
                    # Use project-defined set as authoritative; keep None
                    if isinstance(custom, dict):
                        if "None" not in custom:
                            custom["None"] = ""
                        self.tag_colors = custom
        except Exception:
            pass

    def _refresh_tag_dropdowns(self):
        """Reload tag aliases/colors and refresh dropdowns, lists, and visualizations"""
        self._load_tag_colors()
        self._load_tag_aliases()
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
        self._update_article_list()
    
    def _tag_label(self, tag_key: str) -> str:
        """Get display label for tag"""
        return self.tag_aliases.get(tag_key, tag_key)
    
    def _load_icons(self):
        """Load icons"""
        try:
            from PIL import Image, ImageChops
            from utils.ui_helpers import get_assets_icons_dir
            icons_path = get_assets_icons_dir()
            
            def invert_with_alpha(img):
                img = img.convert('RGBA')
                r, g, b, a = img.split()
                r = ImageChops.invert(r)
                g = ImageChops.invert(g)
                b = ImageChops.invert(b)
                return Image.merge('RGBA', (r, g, b, a))
            
            # Load icons
            prev_img_light = Image.open(icons_path / "previous.png").convert('RGBA')
            next_img_light = Image.open(icons_path / "next.png").convert('RGBA')
            sidebar_l_img_light = Image.open(icons_path / "sidebar-l.png").convert('RGBA')
            sidebar_l_act_img_light = Image.open(icons_path / "sidebar-l-act.png").convert('RGBA')
            sidebar_r_img_light = Image.open(icons_path / "sidebar-r.png").convert('RGBA')
            sidebar_r_act_img_light = Image.open(icons_path / "sidebar-r-act.png").convert('RGBA')
            sidebar_b_img_light = Image.open(icons_path / "sidebar-b.png").convert('RGBA')
            sidebar_b_act_img_light = Image.open(icons_path / "sidebar-b-act.png").convert('RGBA')
            sidebar_t_img_light = Image.open(icons_path / "sidebar-t.png").convert('RGBA')
            sidebar_t_act_img_light = Image.open(icons_path / "sidebar-t-act.png").convert('RGBA')
            
            prev_img_dark = invert_with_alpha(prev_img_light)
            next_img_dark = invert_with_alpha(next_img_light)
            sidebar_l_img_dark = invert_with_alpha(sidebar_l_img_light)
            sidebar_l_act_img_dark = invert_with_alpha(sidebar_l_act_img_light)
            sidebar_r_img_dark = invert_with_alpha(sidebar_r_img_light)
            sidebar_r_act_img_dark = invert_with_alpha(sidebar_r_act_img_light)
            sidebar_b_img_dark = invert_with_alpha(sidebar_b_img_light)
            sidebar_b_act_img_dark = invert_with_alpha(sidebar_b_act_img_light)
            sidebar_t_img_dark = invert_with_alpha(sidebar_t_img_light)
            sidebar_t_act_img_dark = invert_with_alpha(sidebar_t_act_img_light)
            
            self.icon_previous = ctk.CTkImage(light_image=prev_img_light, dark_image=prev_img_dark, size=(16, 16))
            self.icon_next = ctk.CTkImage(light_image=next_img_light, dark_image=next_img_dark, size=(16, 16))
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
    
    def _setup_ui(self):
        """Setup UI layout - identical to History View"""
        self.grid_rowconfigure(0, weight=1)
        
        if self.filter_panel_visible:
            self.grid_columnconfigure(0, weight=0, minsize=360)
        else:
            self.grid_columnconfigure(0, weight=0, minsize=0)
        
        if self.visualizations_visible:
            self.grid_columnconfigure(1, weight=1)
            self.grid_columnconfigure(2, weight=0, minsize=620)
        else:
            self.grid_columnconfigure(1, weight=1)
            self.grid_columnconfigure(2, weight=0, minsize=0)
        
        self._create_filter_panel()
        self._create_article_list()
        self._create_visualizations()
        self._create_tag_sidebar()
    
    def _create_filter_panel(self):
        """Create left filter panel"""
        self.filter_frame = ctk.CTkFrame(self, corner_radius=15)
        self.filter_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 5), pady=0)
        self.filter_frame.grid_rowconfigure(1, weight=1)
        self.filter_frame.grid_columnconfigure(0, weight=1)
        
        if not self.filter_panel_visible:
            self.filter_frame.grid_remove()
        
        header = ctk.CTkLabel(
            self.filter_frame,
            text="Filter & Export",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, padx=20, pady=(20, 20), sticky="ew")
        
        radio_frame = ctk.CTkFrame(self.filter_frame, fg_color="transparent")
        radio_frame.grid(row=1, column=0, padx=20, pady=0, sticky="new")
        
        ctk.CTkLabel(
            radio_frame,
            text="View Mode:",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        ).pack(anchor="w", pady=(0, 10))
        
        ctk.CTkRadioButton(
            radio_frame,
            text="Show All Articles",
            variable=self.corpus_filter_var,
            value="all",
            command=self._update_article_list,
            font=ctk.CTkFont(size=13)
        ).pack(anchor="w", pady=5)
        
        ctk.CTkRadioButton(
            radio_frame,
            text="Show Selected Only",
            variable=self.corpus_filter_var,
            value="selected",
            command=self._update_article_list,
            font=ctk.CTkFont(size=13)
        ).pack(anchor="w", pady=5)
        
        ctk.CTkRadioButton(
            radio_frame,
            text="Show Corpus Only",
            variable=self.corpus_filter_var,
            value="corpus",
            command=self._update_article_list,
            font=ctk.CTkFont(size=13)
        ).pack(anchor="w", pady=5)
        
        stats_frame = ctk.CTkFrame(self.filter_frame, corner_radius=10)
        stats_frame.grid(row=2, column=0, padx=20, pady=(20, 20), sticky="ew")
        
        ctk.CTkLabel(
            stats_frame,
            text="Statistics",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        ).pack(anchor="w", padx=15, pady=(15, 10))
        
        self.stats_total_label = ctk.CTkLabel(
            stats_frame,
            text=f"Total Articles: {len(self.all_articles)}",
            font=ctk.CTkFont(size=12),
            anchor="w"
        )
        self.stats_total_label.pack(anchor="w", padx=15, pady=3)
        
        self.stats_selected_label = ctk.CTkLabel(
            stats_frame,
            text="Selected: 0",
            font=ctk.CTkFont(size=12),
            anchor="w"
        )
        self.stats_selected_label.pack(anchor="w", padx=15, pady=3)
        
        self.stats_corpus_label = ctk.CTkLabel(
            stats_frame,
            text="Corpus: 0",
            font=ctk.CTkFont(size=12),
            anchor="w"
        )
        self.stats_corpus_label.pack(anchor="w", padx=15, pady=(3, 15))
        
        self._update_stats()
        
        # Export section
        export_frame = ctk.CTkFrame(self.filter_frame, corner_radius=10)
        export_frame.grid(row=3, column=0, padx=20, pady=(0, 20), sticky="ew")
        
        ctk.CTkLabel(
            export_frame,
            text="Export",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w"
        ).pack(anchor="w", padx=15, pady=(15, 10))
        
        export_ris_btn = ctk.CTkButton(
            export_frame,
            text="Export as RIS",
            command=lambda: self._export_corpus_results('ris'),
            font=ctk.CTkFont(size=12),
            height=32
        )
        export_ris_btn.pack(fill="x", padx=15, pady=(0, 8))
        
        export_bib_btn = ctk.CTkButton(
            export_frame,
            text="Export as BibTeX",
            command=lambda: self._export_corpus_results('bib'),
            font=ctk.CTkFont(size=12),
            height=32
        )
        export_bib_btn.pack(fill="x", padx=15, pady=(0, 8))
        
        export_csv_btn = ctk.CTkButton(
            export_frame,
            text="Export as CSV",
            command=lambda: self._export_corpus_results('csv'),
            font=ctk.CTkFont(size=12),
            height=32
        )
        export_csv_btn.pack(fill="x", padx=15, pady=(0, 15))
    
    def _update_stats(self):
        """Update statistics"""
        selected_count = sum(1 for a in self.all_articles if self._get_article_tag_info(a)[2])
        corpus_count = sum(1 for a in self.all_articles if self._get_article_tag_info(a)[3])
        
        self.stats_total_label.configure(text=f"Total Articles: {len(self.all_articles)}")
        self.stats_selected_label.configure(text=f"Selected: {selected_count}")
        self.stats_corpus_label.configure(text=f"Corpus: {corpus_count}")
    
    def _export_corpus_results(self, format: str):
        """Export corpus results in specified format (ris, bib, csv)"""
        from datetime import datetime
        from utils.mb_shim import messagebox
        import csv
        
        # Get filtered articles based on current view mode
        filter_mode = self.corpus_filter_var.get()
        if filter_mode == "selected":
            results = [a for a in self.all_articles if self._get_article_tag_info(a)[2]]
            mode_name = "selected"
        elif filter_mode == "corpus":
            results = [a for a in self.all_articles if self._get_article_tag_info(a)[3]]
            mode_name = "corpus"
        else:  # all
            results = self.all_articles
            mode_name = "all"
        
        if not results:
            messagebox.showinfo("Export", f"No {mode_name} articles to export.")
            return
        
        # Create results folder if it doesn't exist
        results_folder = self.workspace_path / "results"
        results_folder.mkdir(exist_ok=True)
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        try:
            if format == 'ris':
                filename = results_folder / f"corpus_{mode_name}_{timestamp}.ris"
                
                def _resolve_abstract(article: dict) -> str:
                    for key in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                        val = (article.get(key) or '').strip()
                        if val:
                            return val
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
                    return "\n".join(lines)
                
                with open(filename, 'w', encoding='utf-8') as f:
                    for article in results:
                        f.write(to_ris(article) + "\n")
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} {mode_name} articles to:\n{filename}")
            
            elif format == 'bib':
                filename = results_folder / f"corpus_{mode_name}_{timestamp}.bib"
                
                def to_bib(article: dict) -> str:
                    def _s(val) -> str:
                        try:
                            return str(val if val is not None else '').strip()
                        except Exception:
                            return ''
                    def _escape_bib(text: str) -> str:
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
                            # Fallback minimal BibTeX entry
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
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} {mode_name} articles to:\n{filename}")
            
            elif format == 'csv':
                filename = results_folder / f"corpus_{mode_name}_{timestamp}.csv"
                
                # Build stable, user-friendly columns and write with Excel-friendly settings
                preferred = [
                    'title','authors','publicationName','date','doi','eid',
                    'abstract','comment','selected','corpus','tag','tag_color','citedby'
                ]
                keys = set()
                for article in results:
                    if isinstance(article, dict):
                        keys.update(article.keys())
                keys.discard('favorite')
                keys.discard('must_cite')
                keys.discard('custom_abstract')
                keys.update(['abstract','selected','corpus'])
                remaining = [k for k in sorted(keys) if k not in preferred]
                fieldnames = [k for k in preferred if k in keys] + remaining

                with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore', delimiter=';')
                    writer.writeheader()
                    for article in results:
                        row = dict(article)
                        # Normalize abstract from multiple possible sources
                        if not row.get('abstract'):
                            if row.get('custom_abstract'):
                                row['abstract'] = row.get('custom_abstract')
                            elif row.get('dc:description'):
                                row['abstract'] = row.get('dc:description')
                            elif row.get('description'):
                                row['abstract'] = row.get('description')
                        # Use tag alias in tag column
                        try:
                            color_key, _tag_name, _sel, _corp = self._get_article_tag_info(article)
                            row['tag'] = self._tag_label(color_key)
                            row['tag_color'] = color_key
                        except Exception:
                            pass
                        writer.writerow(row)
                
                messagebox.showinfo("Export Successful", f"Exported {len(results)} {mode_name} articles to:\n{filename}")
        
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export results:\n{str(e)}")
            import traceback
            traceback.print_exc()
    
    def _create_article_list(self):
        """Create middle article list - same layout as History"""
        self.article_frame = ctk.CTkFrame(self, corner_radius=15)
        self.article_frame.grid(row=0, column=1, sticky="nsew", padx=5, pady=0)
        self.article_frame.grid_rowconfigure(2, weight=1)
        self.article_frame.grid_columnconfigure(0, weight=1)
        
        header_frame = ctk.CTkFrame(self.article_frame, fg_color="transparent")
        header_frame.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")
        header_frame.grid_columnconfigure(0, weight=0, minsize=HEADER_TITLE_MIN_WIDTH)
        header_frame.grid_columnconfigure(1, weight=1)
        header_frame.grid_columnconfigure(2, weight=0, minsize=HEADER_CONTROLS_MIN_WIDTH)
        
        self.article_header = ctk.CTkLabel(
            header_frame,
            text="Articles (0)",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w",
            width=HEADER_TITLE_MIN_WIDTH
        )
        self.article_header.grid(row=0, column=0, sticky="w")
        
        # Pagination
        # Center pagination in header
        self.pagination_frame = ctk.CTkFrame(header_frame, fg_color="transparent")
        self.pagination_frame.grid(row=0, column=1, sticky="e", padx=(0, 8))
        
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
                text="â† Previous",
                width=90,
                height=28,
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
                text="Next â†’",
                width=90,
                height=28,
                command=self._next_page
            )
        self.next_page_btn.grid(row=0, column=2, padx=(3, 0))
        
        # Toggle buttons - EXACT same layout as History
        controls_frame = ctk.CTkFrame(header_frame, fg_color="transparent")
        controls_frame.grid(row=0, column=2, sticky="e")
        
        if self.icon_sidebar_l_act:
            self.filter_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_l_act,
                text="",
                cursor="hand2"
            )
            self.filter_toggle_btn.bind("<Button-1>", lambda e: self._toggle_filter_panel())
            self.filter_toggle_btn.bind("<Enter>", lambda e: self.filter_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.filter_toggle_btn.bind("<Leave>", lambda e: self.filter_toggle_btn.configure(fg_color="transparent"))
        else:
            self.filter_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Hide Filters",
                width=130,
                height=32,
                command=self._toggle_filter_panel
            )
        self.filter_toggle_btn.grid(row=0, column=0, sticky="e", padx=(10, 0))
        ToolTip(self.filter_toggle_btn, "Toggle filter panel")
        
        if self.icon_sidebar_t:
            self.extra_filter_toggle_btn = ctk.CTkLabel(
                controls_frame,
                image=self.icon_sidebar_t,
                text="",
                cursor="hand2"
            )
            self.extra_filter_toggle_btn.bind("<Button-1>", lambda e: self._toggle_filter_sidebar())
            self.extra_filter_toggle_btn.bind("<Enter>", lambda e: self.extra_filter_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.extra_filter_toggle_btn.bind("<Leave>", lambda e: self.extra_filter_toggle_btn.configure(fg_color="transparent"))
        else:
            self.extra_filter_toggle_btn = ctk.CTkButton(
                controls_frame,
                text="Show More",
                width=120,
                height=32,
                command=self._toggle_filter_sidebar
            )
        self.extra_filter_toggle_btn.grid(row=0, column=1, sticky="e", padx=(10, 0))
        ToolTip(self.extra_filter_toggle_btn, "Toggle filter panel")
        
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
                command=self._toggle_tag_sidebar
            )
        self.tag_toggle_btn.grid(row=0, column=2, sticky="e", padx=(10, 0))
        ToolTip(self.tag_toggle_btn, "Toggle tag management panel")
        
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
                command=self._toggle_visualizations
            )
        self.viz_toggle_btn.grid(row=0, column=3, sticky="e", padx=(10, 0))
        ToolTip(self.viz_toggle_btn, "Toggle visualizations")
        
        # Filter sidebar
        self._create_filter_sidebar()
        
        # Search bar
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
        
        # Article list
        self.article_list_container = ctk.CTkScrollableFrame(
            self.article_frame,
            fg_color="transparent"
        )
        self.article_list_container.grid(row=2, column=0, padx=(2, 8), pady=0, sticky="nsew")
        self.article_list_container.grid_columnconfigure(0, weight=1)
    
    def _create_filter_sidebar(self):
        """Create the top filter sidebar for year range, sorting, and tag filtering - matches History View"""
        # Container for filter sidebar
        self.extra_filter_sidebar = ctk.CTkFrame(self.article_frame, corner_radius=8)
        # Don't grid it initially - will be gridded when toggled
        
        # Configure grid - 3 columns
        self.extra_filter_sidebar.grid_columnconfigure(0, weight=1)
        self.extra_filter_sidebar.grid_columnconfigure(1, weight=1)
        self.extra_filter_sidebar.grid_columnconfigure(2, weight=1)
        
        # Title
        title_label = ctk.CTkLabel(
            self.extra_filter_sidebar,
            text="Filter & Sort",
            font=ctk.CTkFont(size=13, weight="bold"),
            anchor="w"
        )
        title_label.grid(row=0, column=0, columnspan=3, padx=10, pady=(8, 5), sticky="w")
        
        # Create content frame
        content_frame = ctk.CTkFrame(self.extra_filter_sidebar, fg_color="transparent")
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
    
    def _create_tag_sidebar_stub(self):
        """Deprecated stub for tag sidebar (kept to avoid confusion)"""
        self.tag_sidebar = None
    
    def _toggle_tag_sidebar(self):
        """Toggle tag sidebar"""
        self.tag_sidebar_visible = not self.tag_sidebar_visible
        
        if self.tag_sidebar_visible:
            # Show tag sidebar at correct row based on filter sidebar visibility
            if self.filter_sidebar_visible:
                self.tag_sidebar.grid(row=4, column=0, padx=8, pady=(0, 5), sticky="ew")
            else:
                self.tag_sidebar.grid(row=3, column=0, padx=8, pady=(0, 5), sticky="ew")
            if self.icon_sidebar_b_act:
                self.tag_toggle_btn.configure(image=self.icon_sidebar_b_act)
            elif not self.icon_sidebar_b:
                self.tag_toggle_btn.configure(text="Hide Tags")
        else:
            # Hide tag sidebar
            self.tag_sidebar.grid_remove()
            if self.icon_sidebar_b:
                self.tag_toggle_btn.configure(image=self.icon_sidebar_b)
            elif not self.icon_sidebar_b:
                self.tag_toggle_btn.configure(text="Show Tags")
        
        # Update selected count label
        self._update_selected_count()
        
        # Refresh article list to show/hide checkboxes
        self._update_article_list()
    
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
        
        # Dropdown for tag selection
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
            text="Show selected",
            width=130,
            height=24,
            font=ctk.CTkFont(size=10),
            command=self._toggle_selected_status
        )
        self.selected_btn.pack(side="left", padx=3)
        
        # Corpus button (dynamic)
        self.corpus_btn = ctk.CTkButton(
            status_buttons_frame,
            text="Show corpus",
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
    
    def _create_visualizations(self):
        """Create visualizations panel - same as History"""
        self.viz_frame = ctk.CTkFrame(self, corner_radius=15)
        self.viz_frame.grid(row=0, column=2, sticky="nsew", padx=(5, 0), pady=0)
        self.viz_frame.grid_rowconfigure(3, weight=0, minsize=DOUGHNUT_CANVAS_PX)
        self.viz_frame.grid_rowconfigure(5, weight=0, minsize=YEAR_CONTAINER_HEIGHT)
        self.viz_frame.grid_rowconfigure(7, weight=1)
        self.viz_frame.grid_columnconfigure(0, weight=1)
        
        if not self.visualizations_visible:
            self.viz_frame.grid_remove()
        
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
        self.legend_visible = True

    
    
    # Toggle methods
    def _toggle_filter_panel(self):
        """Toggle filter panel"""
        self.filter_panel_visible = not self.filter_panel_visible
        
        if self.filter_panel_visible:
            self.filter_frame.grid()
            self.grid_columnconfigure(0, weight=0, minsize=360)
            if self.icon_sidebar_l_act:
                self.filter_toggle_btn.configure(image=self.icon_sidebar_l_act)
        else:
            self.filter_frame.grid_remove()
            self.grid_columnconfigure(0, weight=0, minsize=0)
            if self.icon_sidebar_l:
                self.filter_toggle_btn.configure(image=self.icon_sidebar_l)
    
    def _toggle_filter_sidebar(self):
        """Toggle additional filters"""
        self.filter_sidebar_visible = not self.filter_sidebar_visible
        
        if self.filter_sidebar_visible:
            self.extra_filter_sidebar.grid(row=2, column=0, padx=8, pady=(3, 0), sticky="ew")
            # Move article list down
            self.article_list_container.grid(row=3, column=0, padx=(2, 8), pady=(3, 0), sticky="nsew")
            self.article_frame.grid_rowconfigure(2, weight=0)
            self.article_frame.grid_rowconfigure(3, weight=1)
            if self.tag_sidebar_visible:
                self.tag_sidebar.grid(row=4, column=0, padx=8, pady=(0, 5), sticky="ew")
            if self.icon_sidebar_t_act:
                self.extra_filter_toggle_btn.configure(image=self.icon_sidebar_t_act)
        else:
            self.extra_filter_sidebar.grid_remove()
            # Move article list back up
            self.article_list_container.grid(row=2, column=0, padx=(2, 8), pady=0, sticky="nsew")
            self.article_frame.grid_rowconfigure(2, weight=1)
            self.article_frame.grid_rowconfigure(3, weight=0)
            if self.tag_sidebar_visible:
                self.tag_sidebar.grid(row=3, column=0, padx=8, pady=(0, 5), sticky="ew")
            if self.icon_sidebar_t:
                self.extra_filter_toggle_btn.configure(image=self.icon_sidebar_t)
    
    def _apply_year_filter(self):
        """Apply year range filter"""
        self._filter_articles()
    
    def _clear_year_filter(self):
        """Clear year range filter"""
        self.year_from_var.set("")
        self.year_to_var.set("")
        self._filter_articles()
    
    def _apply_tag_filter(self):
        """Apply tag filter from dropdown"""
        selected_tag = self.tag_filter_var.get()
        if selected_tag == "All":
            self.active_tag_filter = None
        else:
            # Convert display label back to color key
            self.active_tag_filter = self._tag_label_to_key.get(selected_tag, None)
        self._filter_articles()
    
    def _apply_sorting(self):
        """Apply sort order"""
        self._filter_articles()
    
    def _apply_status_filter(self):
        """Apply Selected/Corpus filter in addition to tag filter"""
        self._filter_articles()
    
    def _toggle_visualizations(self):
        """Toggle visualizations"""
        self.visualizations_visible = not self.visualizations_visible
        
        if self.visualizations_visible:
            self.viz_frame.grid()
            self.grid_columnconfigure(2, weight=0, minsize=620)
            if self.icon_sidebar_r_act:
                self.viz_toggle_btn.configure(image=self.icon_sidebar_r_act)
            self._update_visualizations()
        else:
            self.viz_frame.grid_remove()
            self.grid_columnconfigure(2, weight=0, minsize=0)
            if self.icon_sidebar_r:
                self.viz_toggle_btn.configure(image=self.icon_sidebar_r)
    
    # Article list methods
    def _update_article_list(self):
        """Update article list based on filter mode"""
        try:
            for widget in self.article_list_container.winfo_children():
                widget.destroy()
            
            filter_mode = self.corpus_filter_var.get()
            filtered_articles = []
            
            for article in self.all_articles:
                color_key, _, is_selected, is_corpus = self._get_article_tag_info(article)
                
                # Base filter from mode toggle (All / Selected / Corpus)
                if filter_mode == "all":
                    pass  # include for now, refine below
                elif filter_mode == "selected" and not is_selected:
                    continue
                elif filter_mode == "corpus" and not is_corpus:
                    continue

                # Apply tag dropdown filter if set (convert label->key earlier)
                if getattr(self, 'active_tag_filter', None) is not None:
                    if color_key != self.active_tag_filter:
                        continue

                # Apply top-panel checkbox filters if set
                if hasattr(self, 'filter_selected_var') and self.filter_selected_var.get() and not is_selected:
                    continue
                if hasattr(self, 'filter_corpus_var') and self.filter_corpus_var.get() and not is_corpus:
                    continue

                filtered_articles.append(article)
            
            # Apply search filter
            search_text = self.article_search_var.get().lower().strip() if hasattr(self, 'article_search_var') else ""
            if search_text:
                filtered_articles = [
                    a for a in filtered_articles
                    if search_text in a.get('title', '').lower() or
                       search_text in a.get('publicationName', '').lower()
                ]
            
            # Apply year filter
            year_from = self.year_from_var.get().strip() if hasattr(self, 'year_from_var') else ""
            year_to = self.year_to_var.get().strip() if hasattr(self, 'year_to_var') else ""
            
            if year_from or year_to:
                def get_year(article):
                    cover_date = article.get('coverDate', '') or article.get('date', '')
                    if cover_date:
                        try:
                            return int(cover_date.split('-')[0])
                        except:
                            return None
                    return None
                
                temp_filtered = []
                for a in filtered_articles:
                    year = get_year(a)
                    if year is not None:
                        if (not year_from or year >= int(year_from)) and (not year_to or year <= int(year_to)):
                            temp_filtered.append(a)
                filtered_articles = temp_filtered
            
            # Apply sort
            sort_order = self.sort_order_var.get() if hasattr(self, 'sort_order_var') else "newest"
            if sort_order == "newest":
                filtered_articles.reverse()
            elif sort_order == "year_desc":
                filtered_articles.sort(key=lambda a: a.get('coverDate', '') or a.get('date', ''), reverse=True)
            elif sort_order == "year_asc":
                filtered_articles.sort(key=lambda a: a.get('coverDate', '') or a.get('date', ''))
            
            self.filtered_results = filtered_articles
            self.current_page = 0
            
            # Update header count to reflect current filtered list
            try:
                self.article_header.configure(text=f"Articles ({len(self.filtered_results)})")
            except Exception:
                pass
            self._update_pagination()
            self._display_current_page()
            self._update_stats()
            self._update_visualizations()
        except Exception as e:
            print(f"Error updating article list: {e}")
            import traceback
            traceback.print_exc()
    
    def _filter_articles(self):
        """Apply article filters"""
        self._update_article_list()
    
    def _display_current_page(self):
        """Display current page articles"""
        for widget in self.article_list_container.winfo_children():
            widget.destroy()
        
        start_idx = self.current_page * self.articles_per_page
        end_idx = min(start_idx + self.articles_per_page, len(self.filtered_results))
        
        page_articles = self.filtered_results[start_idx:end_idx]
        
        for idx, article in enumerate(page_articles):
            self._create_article_card(article, start_idx + idx)
    
    def _create_article_card(self, article: Dict, idx: int):
        """Create a compact article card - dynamic height based on content"""
        # Get article data
        title = article.get('title', 'No title')
        authors = article.get('authors', 'Unknown')
        date = article.get('date', '') or article.get('coverDate', '')
        year = date[:4] if date else 'N/A'
        cited = article.get('citedby', '0')
        publication = article.get('publicationName', 'Unknown')
        doi = article.get('doi', '')
        
        # Get tag info (using corpus view format)
        color_key, tag_name, is_selected, is_corpus = self._get_article_tag_info(article)
        tag_color = self.tag_colors.get(color_key, '#e0e0e0') or '#e0e0e0'
        
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
        # Use a minimum row size instead of fixed frame height to avoid border artifacts
        card.grid_rowconfigure(0, minsize=130)
        
        # Highlight if selected
        if self.selected_article and article.get('eid') == self.selected_article.get('eid'):
            card.configure(fg_color=("gray85", "gray25"), border_width=3)
        
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
        if is_selected:
            status_text += "✅"
        if is_corpus:
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
        
        # Abstract availability indicator above the tag badge (same logic as History)
        # Resolve abstract from multiple possible keys and project-wide index
        abstract_text = ''
        for k in ['abstract', 'custom_abstract', 'dc:description', 'description']:
            val = article.get(k, '')
            if isinstance(val, str) and val.strip():
                abstract_text = val.strip()
                break
        if not abstract_text and hasattr(self, '_abstract_index'):
            eid_lookup = article.get('eid', '')
            abstract_text = (self._abstract_index.get(eid_lookup, '') or '').strip()
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
        if color_key != "None" and tag_name != "None":
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
                # Add, do not replace existing handlers (e.g., tag label edit)
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
    
    def _toggle_article_selection(self, eid: str, is_selected: bool):
        """Toggle article multi-selection"""
        if is_selected:
            self.selected_articles.add(eid)
        else:
            self.selected_articles.discard(eid)
        
        # Update selected count label and button states
        self._update_selected_count()
    
    def _mark_as_selected(self, article: Dict):
        """Mark article as selected"""
        eid = article.get('eid', '')
        if eid:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            # Write new key only
            self.global_tags[eid]['selected'] = True
            self._save_global_tags()
            self._update_article_list()
    
    def _mark_as_corpus(self, article: Dict):
        """Mark article as corpus"""
        eid = article.get('eid', '')
        if eid:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            # Write new key only
            self.global_tags[eid]['corpus'] = True
            self._save_global_tags()
            self._update_article_list()
    
    def _unmark_article(self, article: Dict):
        """Remove all marks"""
        eid = article.get('eid', '')
        if eid and eid in self.global_tags:
            # Remove new keys
            self.global_tags[eid].pop('selected', None)
            self.global_tags[eid].pop('corpus', None)
            self._save_global_tags()
            self._update_article_list()
    
    def _batch_mark_selected(self):
        """Mark all selected articles as Selected"""
        for eid in self.selected_articles:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            self.global_tags[eid]['selected'] = True
        self._save_global_tags()
        self._update_article_list()
        self.selected_articles.clear()
    
    def _batch_mark_corpus(self):
        """Add all selected articles to Corpus"""
        for eid in self.selected_articles:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            self.global_tags[eid]['corpus'] = True
        self._save_global_tags()
        self._update_article_list()
        self.selected_articles.clear()
    
    def _batch_unmark(self):
        """Remove all marks from selected articles"""
        for eid in self.selected_articles:
            if eid in self.global_tags:
                self.global_tags[eid].pop('selected', None)
                self.global_tags[eid].pop('corpus', None)
        self._save_global_tags()
        self._update_article_list()
        self.selected_articles.clear()
    
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
            count += 1
        
        # Save global tags
        self._save_global_tags()
        
        # Clear selection
        self.selected_articles.clear()
        
        # Refresh article list to show updated tags
        self._update_article_list()
        
        # Show confirmation
        messagebox.showinfo("Success", f"Tag '{tag_label}' assigned to {count} article(s).")
    
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
    
    def _get_article_tag_info_by_eid(self, eid: str) -> tuple:
        """Get tag information for an article by EID (articles use only new keys)"""
        if eid and eid in self.global_tags:
            tag_data = self.global_tags[eid]
            color = tag_data.get('color', 'None')
            tag = tag_data.get('tag', color)
            favorite = tag_data.get('selected', False)
            must_cite = tag_data.get('corpus', False)
            return color, tag, favorite, must_cite
        
        # Check if article exists in corpus
        for article in self.all_articles:
            if article.get('eid') == eid:
                return self._get_article_tag_info(article)
        
        return 'None', 'None', False, False
    
    def _mark_selected_articles(self, mark: bool):
        """Mark or unmark selected articles as 'Selected' (new keys only)"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        count = 0
        for eid in self.selected_articles:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            
            self.global_tags[eid]['selected'] = mark
            self.global_tags[eid]['last_modified'] = datetime.now().isoformat(timespec="seconds")
            count += 1
        
        self._save_global_tags()
        self.selected_articles.clear()
        self._update_article_list()
        
        action = "marked as Selected" if mark else "unmarked from Selected"
        messagebox.showinfo("Success", f"{count} article(s) {action}.")
    
    def _mark_corpus_articles(self, mark: bool):
        """Mark or unmark selected articles as 'Corpus' (new keys only)"""
        if not self.selected_articles:
            messagebox.showwarning("No Selection", "Please select at least one article.")
            return
        
        count = 0
        for eid in self.selected_articles:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            
            self.global_tags[eid]['corpus'] = mark
            self.global_tags[eid]['last_modified'] = datetime.now().isoformat(timespec="seconds")
            count += 1
        
        self._save_global_tags()
        self.selected_articles.clear()
        self._update_article_list()
        
        action = "added to Corpus" if mark else "removed from Corpus"
        messagebox.showinfo("Success", f"{count} article(s) {action}.")
    
    def _update_selected_count(self):
        """Update the selected articles count label and button states"""
        if not hasattr(self, 'selected_count_label'):
            return
        
        count = len(self.selected_articles)
        if count == 0:
            self.selected_count_label.configure(text="No articles selected")
            if hasattr(self, 'selected_btn'):
                self.selected_btn.configure(text="Add to Selected", state="disabled")
            if hasattr(self, 'corpus_btn'):
                self.corpus_btn.configure(text="Add to Corpus", state="disabled")
        elif count == 1:
            self.selected_count_label.configure(text="1 article selected")
            self._update_status_buttons()
        else:
            self.selected_count_label.configure(text=f"{count} articles selected")
            self._update_status_buttons()
    
    def _update_status_buttons(self):
        """Update Selected/Corpus button texts based on current selection status"""
        if not self.selected_articles or not hasattr(self, 'selected_btn'):
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
    
    def _batch_tag_articles(self, tag_name: str):
        """Apply tag to all selected articles"""
        for eid in self.selected_articles:
            if eid not in self.global_tags:
                self.global_tags[eid] = {}
            self.global_tags[eid]['tag'] = tag_name
        self._save_global_tags()
        self._update_article_list()
        self.selected_articles.clear()
    
    def _get_article_tag_info(self, article: Dict) -> tuple:
        """Get tag information and resolve tag name via current aliases"""
        eid = self._article_key(article)
        if eid in self.global_tags:
            tag_data = self.global_tags[eid]
            color_key = tag_data.get('color', 'None')  # Color key for lookup in tag_colors
            # Always resolve via alias map so renames apply
            tag_name = self._tag_label(color_key)
            is_selected = tag_data.get('selected', False)
            is_corpus = tag_data.get('corpus', False)
            return color_key, tag_name, is_selected, is_corpus
        # Fallback to article fields if present
        color_key = article.get('tag_color', 'None')
        tag_name = self._tag_label(color_key)
        is_selected = article.get('selected', False)
        is_corpus = article.get('corpus', False)
        return color_key, tag_name, is_selected, is_corpus

    def _article_key(self, article: Dict) -> str:
        """Robust key for an article (prefer EID, fall back to DOI or title)."""
        return (
            (article.get('eid') or '').strip()
            or (article.get('doi') or '').strip()
            or (article.get('title') or '').strip()
        )
    
    def _open_scopus_link(self, article: Dict):
        """Open article on Scopus"""
        eid = article.get('eid', '')
        if eid:
            url = f"https://www.scopus.com/record/display.uri?eid={eid}&origin=inward"
            webbrowser.open(url)
    
    # Pagination
    def _update_pagination(self):
        """Update pagination"""
        total_pages = max(1, (len(self.filtered_results) + self.articles_per_page - 1) // self.articles_per_page)
        self.page_label.configure(text=f"Page {self.current_page + 1} of {total_pages}")
    
    def _previous_page(self):
        """Go to previous page"""
        if self.current_page > 0:
            self.current_page -= 1
            self._update_pagination()
            self._display_current_page()
    
    def _next_page(self):
        """Go to next page"""
        total_pages = max(1, (len(self.filtered_results) + self.articles_per_page - 1) // self.articles_per_page)
        if self.current_page < total_pages - 1:
            self.current_page += 1
            self._update_pagination()
            self._display_current_page()
    
    # Visualizations
    def _update_visualizations(self):
        """Update visualizations"""
        if not self.visualizations_visible:
            return
        
        tag_data = self._collect_tag_data(self.filtered_results)
        # Keep a snapshot for popup legend window
        try:
            self._legend_data = dict(tag_data)
        except Exception:
            self._legend_data = tag_data
        self._create_doughnut_chart(self.filtered_results, tag_data)
        self._create_year_distribution(self.filtered_results, tag_data)
        self._create_shared_legend(tag_data)
    
    def _collect_tag_data(self, results: List[Dict]) -> Dict:
        """Collect tag data"""
        if not results:
            return {}
        
        tag_data = {}
        
        for article in results:
            color_key, tag_name, _, _ = self._get_article_tag_info(article)
            
            # Skip "None" tag if Show None is unchecked
            if tag_name == "None" and not self.show_unknown_year_var.get():
                continue
            
            if tag_name not in tag_data:
                color = self.tag_colors.get(color_key, '#e0e0e0') or '#e0e0e0'
                tag_data[tag_name] = {'color': color, 'count': 0}
            tag_data[tag_name]['count'] += 1
        
        return tag_data
    
    def _create_doughnut_chart(self, results: List[Dict], tag_data: Dict):
        """Create a doughnut chart showing tag distribution with dark mode support"""
        # Clear previous
        for widget in self.doughnut_container.winfo_children():
            widget.destroy()
        
        if not tag_data:
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
        
        labels = list(tag_data.keys())
        sizes = [tag_data[label]['count'] for label in labels]
        colors = [tag_data[label]['color'] for label in labels]
        
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
        """Create a bar chart showing year distribution with dark mode support"""
        # Clear previous
        for widget in self.year_container.winfo_children():
            widget.destroy()
        
        if not results:
            label = ctk.CTkLabel(
                self.year_container,
                text="No data available",
                font=ctk.CTkFont(size=12),
                text_color="gray"
            )
            label.pack(expand=True)
            return
        
        # Count by year and tag from global tags
        year_tag_counts = {}
        
        for article in results:
            date = article.get('date', '') or article.get('coverDate', '')
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
        
        # Apply year filter from filter panel
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
        
        # Fixed size for consistent display on smaller monitors
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
        
        # Styling (no legend) with dark mode support
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
            if tag_data is None:
                tag_data = self._collect_tag_data(getattr(self, 'filtered_results', []) or [])
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

    # Removed legend toggle; legend popup is provided via context menu
    
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
                    heights = [year_tag_counts[year].get(tag, 0) for year in years]
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
        """Create two-column legend with tag list and Selected/Corpus counts"""
        for widget in self.legend_container.winfo_children():
            widget.destroy()

        grid = ctk.CTkFrame(self.legend_container, fg_color="transparent")
        grid.pack(fill="both", expand=True)
        grid.grid_columnconfigure(0, weight=1)
        grid.grid_columnconfigure(1, weight=0, minsize=220)

        # Left column: tags
        row_idx = 0
        for tag_name, data in sorted(tag_data.items(), key=lambda x: x[1]['count'], reverse=True):
            legend_item = ctk.CTkFrame(grid, fg_color="transparent")
            legend_item.grid(row=row_idx, column=0, sticky="ew", padx=(0, 8), pady=2)

            color_box = ctk.CTkFrame(
                legend_item,
                width=20,
                height=20,
                fg_color=data['color'],
                corner_radius=5
            )
            color_box.pack(side="left", padx=(0, 8))
            color_box.pack_propagate(False)

            label = ctk.CTkLabel(
                legend_item,
                text=f"{tag_name}: {data['count']}",
                font=ctk.CTkFont(size=11),
                anchor="w"
            )
            label.pack(side="left", fill="x", expand=True)
            row_idx += 1

        # Right column: Selected/Corpus counts (left-aligned, not to the edge)
        right_col = ctk.CTkFrame(grid, fg_color="transparent")
        right_col.grid(row=0, column=1, rowspan=max(1, row_idx), padx=(12, 0), sticky="nw")
        right_col.grid_columnconfigure(0, weight=0)

        # Compute counts from current filter mode
        filter_mode = self.corpus_filter_var.get()
        if filter_mode == "selected":
            sel_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[2]])
            corp_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[3]])
        elif filter_mode == "corpus":
            sel_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[2]])
            corp_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[3]])
        else:
            sel_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[2]])
            corp_count = len([a for a in self.all_articles if self._get_article_tag_info(a)[3]])

        # Icons must match History view exactly and be in identical positions
        pin = "✅"
        star = "⭐"
        sel_row = ctk.CTkFrame(right_col, fg_color="transparent")
        sel_row.pack(anchor="w", pady=(2, 2))
        ctk.CTkLabel(sel_row, text=pin, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
        ctk.CTkLabel(sel_row, text=f"Selected: {sel_count}", font=ctk.CTkFont(size=11), anchor="w").pack(side="left")
        corp_row = ctk.CTkFrame(right_col, fg_color="transparent")
        corp_row.pack(anchor="w", pady=(2, 2))
        ctk.CTkLabel(corp_row, text=star, font=ctk.CTkFont(size=16), width=24, anchor="w").pack(side="left", padx=(0, 6))
        ctk.CTkLabel(corp_row, text=f"Corpus: {corp_count}", font=ctk.CTkFont(size=11), anchor="w").pack(side="left")
    
    def _highlight_article_card(self, selected_card):
        """Highlight the selected article card"""
        for card, article in self.article_widgets:
            # Reset all cards first
            color_key, _, _, _ = self._get_article_tag_info(article)
            tag_color = self.tag_colors.get(color_key, '#e0e0e0') or '#e0e0e0'
            card.configure(border_color=tag_color, border_width=2, fg_color=("gray95", "gray20"))
            
            # Highlight selected card
            if card == selected_card:
                card.configure(border_width=3, fg_color=("gray85", "gray25"))
    
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
        from utils.mb_shim import messagebox
        messagebox.showinfo("DOI Not Available", "No DOI available for this article.")

    def _open_article_in_scopus(self, article: Dict):
        eid = (article.get('eid') or '').strip()
        if eid:
            try:
                webbrowser.open(f"https://www.scopus.com/record/display.uri?eid={eid}&origin=resultslist")
                return
            except Exception as e:
                print(f"Error opening Scopus URL: {e}")
        from utils.mb_shim import messagebox
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
        
        # Resolve current flags
        _, _, is_selected, is_corpus = self._get_article_tag_info(article)

        # Show Abstract option
        menu.add_command(label="Show Abstract", command=lambda: self._show_article_abstract(article))

        # Helper to close the menu before running an action
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
                try:
                    self.update_idletasks()
                except Exception:
                    pass
                self.after(1, action_fn)
            except Exception:
                action_fn()

        # Selected toggle
        menu.add_separator()
        if is_selected:
            menu.add_command(label="Remove from Selected", command=lambda: _menu_action(lambda: self._toggle_single_flag(article, 'selected', False)))
        else:
            menu.add_command(label="Add to Selected", command=lambda: _menu_action(lambda: self._toggle_single_flag(article, 'selected', True)))

        # Corpus toggle
        if is_corpus:
            menu.add_command(label="Remove from Corpus", command=lambda: _menu_action(lambda: self._toggle_single_flag(article, 'corpus', False)))
        else:
            menu.add_command(label="Add to Corpus", command=lambda: _menu_action(lambda: self._toggle_single_flag(article, 'corpus', True)))

        # Export submenu for single article
        export_menu = Menu(menu, tearoff=0)
        # Ensure dark mode compatibility for submenu too
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
        # Schedule opening after the menu closes to avoid Tk callback issues
        menu.add_command(label="Open via DOI", command=lambda a=article: self.after(0, lambda: self._open_article_via_doi(a)))
        menu.add_command(label="Open in Scopus", command=lambda a=article: self.after(0, lambda: self._open_article_in_scopus(a)))
        
        # Show menu at cursor position
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _export_single_article(self, article: Dict, format: str):
        """Export a single article from corpus list (ris, bib, csv)"""
        from datetime import datetime
        from utils.mb_shim import messagebox
        import csv
        results_folder = self.workspace_path / "results"
        results_folder.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        def _resolve_abs(a: Dict) -> str:
            for k in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                v = (a.get(k) or '').strip()
                if v:
                    return v
            return ''

        try:
            if format == 'ris':
                filename = results_folder / f"article_{timestamp}.ris"
                lines = ["TY  - JOUR"]
                t = article.get('title', '')
                if t:
                    lines.append(f"TI  - {t}")
                authors = article.get('authors', '')
                for author in [x.strip() for x in str(authors).replace(' and ', ';').split(';') if x.strip()]:
                    lines.append(f"AU  - {author}")
                date = article.get('date', '') or article.get('coverDate', '')
                if date:
                    lines.append(f"PY  - {str(date)[:4]}")
                j = article.get('publicationName', '')
                if j:
                    lines.append(f"JO  - {j}")
                eid = article.get('eid', '')
                if eid:
                    lines.append(f"ID  - {eid}")
                doi = article.get('doi', '')
                if doi:
                    lines.append(f"DO  - {doi}")
                ab = _resolve_abs(article)
                if ab:
                    lines.append(f"AB  - {ab}")
                lines.append("ER  - ")
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write("\r\n".join(lines) + "\r\n")
                messagebox.showinfo("Export Successful", f"Exported article to:\n{filename}")
            elif format == 'bib':
                filename = results_folder / f"article_{timestamp}.bib"
                def _s(v):
                    try:
                        return str(v if v is not None else '').strip()
                    except Exception:
                        return ''
                def _esc(x: str) -> str:
                    return x.replace('{', '(').replace('}', ')')
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
                abstract = _esc(_s(_resolve_abs(article)))
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
            else:
                filename = results_folder / f"article_{timestamp}.csv"
                preferred = ['title','authors','publicationName','date','doi','eid','abstract','comment','selected','corpus','tag','tag_color','citedby']
                row = dict(article)
                # Normalize abstract from multiple possible sources
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
                fields = [k for k in preferred if k in row.keys()] + [k for k in row.keys() if k not in preferred]
                with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                    writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore', delimiter=';')
                    writer.writeheader()
                    writer.writerow(row)
                messagebox.showinfo("Export Successful", f"Exported article to:\n{filename}")
        except Exception as e:
            messagebox.showerror("Export Error", f"Failed to export article as {format}:\n{e}")
    
    def _show_article_abstract(self, article: Dict):
        """Display article abstract with edit/copy/save (no API fetch here)"""
        # Resolve abstract across known keys, then fallback to index
        abstract_text = ""
        try:
            for k in ['abstract', 'custom_abstract', 'dc:description', 'description']:
                val = article.get(k, '')
                if isinstance(val, str) and val.strip():
                    abstract_text = val.strip()
                    break
        except Exception:
            abstract_text = ""
        if not abstract_text and hasattr(self, '_abstract_index'):
            eid_lookup = article.get('eid', '')
            abstract_text = (self._abstract_index.get(eid_lookup, '') or '').strip()
        self._display_abstract_dialog(article, abstract_text)

    def _toggle_single_flag(self, article: Dict, flag: str, value: bool):
        """Toggle a single article's selected/corpus flag and refresh list"""
        try:
            eid = self._article_key(article)
            if not eid:
                return
            if eid not in self.global_tags:
                self.global_tags[eid] = {'color': 'None', 'tag': 'None', 'selected': False, 'corpus': False}
            self.global_tags[eid][flag] = value
            article[flag] = value
            # Persist immediately so other views (history) see changes
            self._save_global_tags()
            # Update header counts
            try:
                self._update_stats()
            except Exception:
                pass
            # Refresh only this card to avoid heavy list rebuilds
            try:
                self._refresh_article_card_by_eid(eid)
            except Exception:
                # Fallback to light page redraw if needed
                self.after(1, self._display_current_page)
            # Debounced charts/legend refresh
            self._schedule_viz_update()
        except Exception as e:
            print(f"Error toggling {flag} for {eid}: {e}")

    def _refresh_article_card_by_eid(self, eid: str):
        """Rebuild only the article card with the given EID on the current page."""
        if not eid:
            return
        # Locate article in current filtered list
        absolute_idx = None
        article = None
        for i, a in enumerate(self.filtered_results):
            if (a.get('eid') or '').strip() == eid:
                absolute_idx = i
                article = a
                break
        if absolute_idx is None or article is None:
            return
        # Ensure it's visible on the current page
        start_idx = self.current_page * self.articles_per_page
        end_idx = start_idx + self.articles_per_page
        if not (start_idx <= absolute_idx < end_idx):
            return
        rel_idx = absolute_idx - start_idx
        # Get old card and replace it
        try:
            old_card, _ = self.article_widgets[rel_idx]
        except Exception:
            return
        try:
            old_card.grid_forget()
            old_card.destroy()
        except Exception:
            pass
        # Recreate card in the same position
        self._create_article_card(article, absolute_idx)

    def _schedule_viz_update(self, delay_ms: int = 120):
        """Debounce visualization refresh to keep UI responsive during rapid toggles."""
        try:
            if self._viz_after_id is not None:
                self.after_cancel(self._viz_after_id)
        except Exception:
            pass
        self._viz_after_id = self.after(delay_ms, self._update_visualizations)
    
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
        date = article.get('date', '') or article.get('coverDate', '')
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
                search_log_path = self.search_log_path
                if search_log_path.exists():
                    with open(search_log_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    changed = False
                    for query in data if isinstance(data, list) else []:
                        for a in query.get('results', []):
                            if a.get('eid') == article.get('eid'):
                                if a.get('abstract', '') != new_text:
                                    a['abstract'] = new_text
                                    changed = True
                    if changed:
                        with open(search_log_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        # Also refresh our cached list
                        for a in self.all_articles:
                            if a.get('eid') == article.get('eid'):
                                a['abstract'] = new_text
                        self._update_article_list()
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
            tag_badge.configure(text=new_tag.strip())
            
            # Update visualizations
        self._update_visualizations()

    # Helper methods
    def _copy_doi_to_clipboard(self, doi: str):
        """Copy DOI string to clipboard and notify user (matches history behavior)."""
        doi = (doi or '').strip()
        if not doi:
            try:
                messagebox.showinfo("Copy DOI", "No DOI available for this article.")
            except Exception:
                pass
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(doi)
            messagebox.showinfo("Copy DOI", "DOI copied to clipboard.")
        except Exception as e:
            try:
                messagebox.showerror("Copy DOI", f"Failed to copy DOI: {e}")
            except Exception:
                pass

    def _is_dark_color(self, hex_color: str) -> bool:
        """Check if color is dark"""
        if not hex_color or hex_color == "":
            return False
        hex_color = hex_color.lstrip('#')
        r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        luminance = (0.299 * r + 0.587 * g + 0.114 * b)
        return luminance < 128
    
    def _adjust_color_brightness(self, hex_color: str, factor: float) -> str:
        """Adjust color brightness"""
        if not hex_color or hex_color == "":
            return "#808080"
        hex_color = hex_color.lstrip('#')
        r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        r = int(r * factor)
        g = int(g * factor)
        b = int(b * factor)
        return f"#{r:02x}{g:02x}{b:02x}"
