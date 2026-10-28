"""
Search View for SLR Harvester Dashboard
Provides query building with search term history and boolean operators
"""

import sys
from pathlib import Path

# Add src directory to path for imports (when run directly)
src_dir = Path(__file__).parent.parent
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

import customtkinter as ctk
import json
from typing import List, Dict, Optional
import tkinter as tk
from utils.mb_shim import messagebox
import threading
import requests
from datetime import datetime
from utils.tooltip import ToolTip


class SearchView(ctk.CTkFrame):
    """
    Search View with:
    - Query editor
    - Boolean operators panel (hideable)
    - Search term history (hideable)
    """
    
    def __init__(self, parent, workspace_path: str, project_folder: str = ""):
        super().__init__(parent, corner_radius=0, fg_color="transparent")
        
        self.workspace_path = Path(workspace_path)
        self.project_folder = project_folder
        
        # Project-specific paths
        self.project_path = self.workspace_path / "projects" / project_folder
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.query_history_path = self.project_path / "query_history.json"
        
        # Migrate old data for legacy default project only
        if project_folder == "bachelor_thesis" and not self.query_history_path.exists():
            old_query_history = self.workspace_path / "query_history.json"
            if old_query_history.exists():
                import shutil
                shutil.copy2(old_query_history, self.query_history_path)
                print(f"Migrated query_history.json to {self.query_history_path}")
        
        # UI State
        self.terms_visible: bool = True  # Show terms history by default
        self.fieldcodes_visible: bool = True  # Show field codes by default
        
        # Data
        self.saved_terms: List[str] = []
        
        # Load data
        self._load_saved_terms()
        self._load_icons()
        
        # Setup UI
        self._setup_ui()
    
    def _load_saved_terms(self):
        """Load saved search terms from JSON file"""
        try:
            if self.query_history_path.exists():
                with open(self.query_history_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.saved_terms = data.get("terms", [])
        except Exception as e:
            print(f"Error loading search terms: {e}")
            self.saved_terms = []
    
    def _load_icons(self):
        """Load icons for toggle buttons"""
        try:
            from PIL import Image, ImageChops
            from utils.ui_helpers import get_assets_icons_dir
            icons_path = get_assets_icons_dir()
            
            def invert_with_alpha(img):
                """Invert image colors while preserving transparency"""
                img = img.convert('RGBA')
                r, g, b, a = img.split()
                r = ImageChops.invert(r)
                g = ImageChops.invert(g)
                b = ImageChops.invert(b)
                return Image.merge('RGBA', (r, g, b, a))
            
            # Load sidebar icons
            sidebar_l_img_light = Image.open(icons_path / "sidebar-l.png").convert('RGBA')
            sidebar_l_act_img_light = Image.open(icons_path / "sidebar-l-act.png").convert('RGBA')
            sidebar_r_img_light = Image.open(icons_path / "sidebar-r.png").convert('RGBA')
            sidebar_r_act_img_light = Image.open(icons_path / "sidebar-r-act.png").convert('RGBA')
            
            # Create inverted versions for dark mode
            sidebar_l_img_dark = invert_with_alpha(sidebar_l_img_light)
            sidebar_l_act_img_dark = invert_with_alpha(sidebar_l_act_img_light)
            sidebar_r_img_dark = invert_with_alpha(sidebar_r_img_light)
            sidebar_r_act_img_dark = invert_with_alpha(sidebar_r_act_img_light)
            
            # Create CTkImage objects (20x20)
            self.icon_sidebar_l = ctk.CTkImage(light_image=sidebar_l_img_light, dark_image=sidebar_l_img_dark, size=(20, 20))
            self.icon_sidebar_l_act = ctk.CTkImage(light_image=sidebar_l_act_img_light, dark_image=sidebar_l_act_img_dark, size=(20, 20))
            self.icon_sidebar_r = ctk.CTkImage(light_image=sidebar_r_img_light, dark_image=sidebar_r_img_dark, size=(20, 20))
            self.icon_sidebar_r_act = ctk.CTkImage(light_image=sidebar_r_act_img_light, dark_image=sidebar_r_act_img_dark, size=(20, 20))
        except Exception as e:
            print(f"Error loading icons: {e}")
            self.icon_sidebar_l = None
            self.icon_sidebar_l_act = None
            self.icon_sidebar_r = None
            self.icon_sidebar_r_act = None
    
    def _save_terms(self):
        """Save search terms to JSON file"""
        try:
            data = {"terms": self.saved_terms}
            with open(self.query_history_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving search terms: {e}")
    
    def _get_exclusion_keywords(self) -> set:
        """Get set of keywords that should not be saved as search terms (operators and field codes)"""
        exclusions = set()
        
        # Try to get from all_fieldcodes if available
        if hasattr(self, 'all_fieldcodes'):
            for fc in self.all_fieldcodes:
                code = fc["code"].upper()
                exclusions.add(code)
                # Also add without parentheses for wrap operators
                if code in ['""', '{}']:
                    continue
                exclusions.add(code.replace('(', '').replace(')', ''))
        else:
            # Fallback: manually defined list of all operators and field codes
            # Boolean operators
            exclusions.update(['AND', 'OR', 'NOT'])
            
            # Wildcards and proximity
            exclusions.update(['*', '?', '#', 'W/N', 'PRE/N'])
            
            # Limit operators
            exclusions.update(['BEF', 'AFT', 'IS'])
            
            # Content fields
            exclusions.update(['ABS', 'ALL', 'TITLE', 'TITLE-ABS', 'TITLE-ABS-KEY', 
                              'TITLE-ABS-KEY-AUTH', 'KEY', 'AUTHKEY', 'INDEXTERMS'])
            
            # Author fields
            exclusions.update(['AUTH', 'AUTHCOLLAB', 'AUTHFIRST', 'AU-ID', 'AUTHLASTNAME',
                              'AUTHOR-NAME', 'FIRSTAUTH', 'ORCID', 'EDITOR', 'EDFIRST', 'EDLASTNAME'])
            
            # Affiliation fields
            exclusions.update(['AFFIL', 'AFFILCITY', 'AFFILCOUNTRY', 'AF-ID', 'AFFILORG'])
            
            # Chemical/Sequence fields
            exclusions.update(['SEQBANK', 'SEQNUMBER', 'CASREGNUMBER', 'CHEM', 'CHEMNAME',
                              'MANUFACTURER', 'TRADENAME'])
            
            # Conference fields
            exclusions.update(['CONF', 'CONFLOC', 'CONFNAME', 'CONFSPONSORS'])
            
            # Document fields
            exclusions.update(['OA', 'INDEX', 'DOCTYPE', 'DOI', 'EID', 'ARTNUM', 'PAGEFIRST',
                              'PAGELAST', 'PAGES', 'LANGUAGE', 'LOAD-DATE'])
            
            # Funding fields
            exclusions.update(['FUND-ALL', 'FUND-SPONSOR', 'FUND-NO', 'FUND-ACR'])
            
            # Source/Publication fields
            exclusions.update(['BOOKPUB', 'CODEN', 'PUBDATETXT', 'EISSN', 'EXACTSRCTITLE',
                              'ISBN', 'ISSN', 'ISSNP', 'PMID', 'ISSUE', 'VOLUME', 'SRCID',
                              'SRCTITLE', 'SRCTYPE', 'PUBYEAR', 'WEBSITE'])
            
            # Reference fields
            exclusions.update(['REF', 'REFARTNUM', 'REFAUTH', 'REFPAGEFIRST', 'REFPAGE',
                              'REFPUBYEAR', 'REFSRCTITLE', 'REFTITLE'])
            
            # Subject area fields
            exclusions.update(['SUBJAREA', 'MEDI', 'NURS', 'VETE', 'DENT', 'HEAL', 'MULT',
                              'AGRI', 'BIOC', 'IMMU', 'NEUR', 'PHAR', 'CENG', 'COMP', 'EART',
                              'ENER', 'ENGI', 'ENVI', 'MATE', 'MATH', 'PHYS', 'ARTS', 'BUSI',
                              'DECI', 'ECON', 'PSYC', 'SOCI'])
        
        return exclusions
    
    def _extract_and_save_search_terms(self, query: str):
        """Extract search terms from query and save them to history"""
        try:
            import re
            
            # Get exclusion list
            exclusions = self._get_exclusion_keywords()
            
            # Extract quoted strings and individual words
            # Pattern matches: "quoted text" or individual words
            quoted_pattern = r'"([^"]+)"'
            quoted_terms = re.findall(quoted_pattern, query)
            
            # Also extract words in curly braces {}
            brace_pattern = r'\{([^}]+)\}'
            brace_terms = re.findall(brace_pattern, query)
            
            # Combine all extracted terms
            extracted_terms = quoted_terms + brace_terms
            
            # Clean and filter terms
            new_terms = []
            for term in extracted_terms:
                # Clean term
                cleaned = term.strip()
                
                # Skip empty, very short terms, or exclusions
                if not cleaned or len(cleaned) < 2:
                    continue
                
                # Skip if it's an operator or field code
                if cleaned.upper() in exclusions:
                    continue
                
                # Check if term contains only field codes/operators (e.g., "AND OR")
                words = cleaned.split()
                if all(word.upper() in exclusions for word in words):
                    continue
                
                # Add if not already in saved_terms and not in new_terms
                if cleaned not in self.saved_terms and cleaned not in new_terms:
                    new_terms.append(cleaned)
            
            # Add new terms to saved_terms
            if new_terms:
                self.saved_terms.extend(new_terms)
                self._save_terms()
                # Refresh the terms list display
                self._populate_terms_list()
                print(f"Added {len(new_terms)} new search term(s) to history")
            
        except Exception as e:
            print(f"Error extracting search terms: {e}")
    
    def _create_progress_overlay(self):
        """Create a full-screen progress overlay"""
        # Semi-transparent overlay covering only the Search view area (keeps app sidebar visible)
        self.progress_overlay = ctk.CTkFrame(
            self,
            fg_color=("gray85", "gray15")
        )
        # Use place to overlay on top of everything
        self.progress_overlay.place(relx=0, rely=0, relwidth=1, relheight=1)
        self.progress_overlay.lift()
        
        # Center container
        center_frame = ctk.CTkFrame(
            self.progress_overlay,
            corner_radius=20,
            fg_color=("white", "gray20"),
            border_width=2,
            border_color=("#1f6aa5", "#5dade2")
        )
        center_frame.place(relx=0.5, rely=0.5, anchor="center")
        
        # Title
        ctk.CTkLabel(
            center_frame,
            text="Searching Scopus Database",
            font=ctk.CTkFont(size=18, weight="bold")
        ).pack(padx=40, pady=(30, 10))
        
        # Progress bar
        self.progress_bar = ctk.CTkProgressBar(
            center_frame,
            width=300,
            height=20,
            mode="determinate"
        )
        self.progress_bar.pack(padx=40, pady=10)
        self.progress_bar.set(0)
        
        # Status label
        self.progress_status = ctk.CTkLabel(
            center_frame,
            text="Initializing search...",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        self.progress_status.pack(padx=40, pady=(5, 30))
    
    def _hide_progress_overlay(self):
        """Hide the progress overlay"""
        if hasattr(self, 'progress_overlay'):
            self.progress_overlay.place_forget()
            self.progress_overlay.destroy()
            delattr(self, 'progress_overlay')
    
    def _setup_ui(self):
        """Setup the main UI layout"""
        # Configure grid - 3 columns: field codes (left), query editor (middle), saved terms (right)
        self.grid_rowconfigure(0, weight=1)
        self._update_grid_layout()
        
        # Left: Field Codes (hideable)
        self._create_fieldcodes_panel()
        
        # Middle: Query editor
        self._create_query_editor()
        
        # Right: Search terms history (hideable)
        self._create_terms_panel()
    
    def _update_grid_layout(self):
        """Update grid layout based on panel visibility"""
        # Field codes panel (left) - FIXED WIDTH to prevent resizing
        if self.fieldcodes_visible:
            self.grid_columnconfigure(0, weight=0, minsize=350)  # Fixed 350px
        else:
            self.grid_columnconfigure(0, weight=0, minsize=0)
        
        # Query editor always has weight (middle) - takes remaining space
        self.grid_columnconfigure(1, weight=1)
        
        # Terms panel (right) - FIXED WIDTH to prevent resizing
        if self.terms_visible:
            self.grid_columnconfigure(2, weight=0, minsize=350)  # Fixed 350px
        else:
            self.grid_columnconfigure(2, weight=0, minsize=0)
    
    def _create_query_editor(self):
        """Create the query editor section"""
        # Container
        editor_frame = ctk.CTkFrame(self, corner_radius=15)
        editor_frame.grid(row=0, column=1, sticky="nsew", padx=5, pady=0)
        editor_frame.grid_rowconfigure(1, weight=1)  # Query textbox row expands
        editor_frame.grid_columnconfigure(0, weight=1)
        
        # Header frame
        header_frame = ctk.CTkFrame(editor_frame, fg_color="transparent")
        header_frame.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")
        header_frame.grid_columnconfigure(0, weight=1)
        
        # Header
        header = ctk.CTkLabel(
            header_frame,
            text="Build Search Query",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, sticky="w")
        
        # Toggle field codes button (left sidebar) as icon
        if self.icon_sidebar_l_act:
            self.fieldcodes_toggle_btn = ctk.CTkLabel(
                header_frame,
                image=self.icon_sidebar_l_act,
                text="",
                cursor="hand2"
            )
            self.fieldcodes_toggle_btn.bind("<Button-1>", lambda e: self._toggle_fieldcodes())
            self.fieldcodes_toggle_btn.bind("<Enter>", lambda e: self.fieldcodes_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.fieldcodes_toggle_btn.bind("<Leave>", lambda e: self.fieldcodes_toggle_btn.configure(fg_color="transparent"))
        else:
            self.fieldcodes_toggle_btn = ctk.CTkButton(
                header_frame,
                text="Hide Field Codes",
                width=140,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_fieldcodes
            )
        self.fieldcodes_toggle_btn.grid(row=0, column=1, sticky="e", padx=(10, 5))
        ToolTip(self.fieldcodes_toggle_btn, "Toggle field codes sidebar to show/hide Scopus search field codes")
        
        # Toggle terms button (right sidebar) as icon
        if self.icon_sidebar_r_act:
            self.terms_toggle_btn = ctk.CTkLabel(
                header_frame,
                image=self.icon_sidebar_r_act,
                text="",
                cursor="hand2"
            )
            self.terms_toggle_btn.bind("<Button-1>", lambda e: self._toggle_terms())
            self.terms_toggle_btn.bind("<Enter>", lambda e: self.terms_toggle_btn.configure(fg_color=("gray70", "gray30")))
            self.terms_toggle_btn.bind("<Leave>", lambda e: self.terms_toggle_btn.configure(fg_color="transparent"))
        else:
            self.terms_toggle_btn = ctk.CTkButton(
                header_frame,
                text="📝 Hide Terms",
                width=120,
                height=32,
                font=ctk.CTkFont(size=12),
                command=self._toggle_terms
            )
        self.terms_toggle_btn.grid(row=0, column=2, sticky="e", padx=(5, 0))
        ToolTip(self.terms_toggle_btn, "Toggle search terms sidebar to show/hide term history and favorites")
        
        # Query text editor (operators moved to separate panel)
        query_container = ctk.CTkFrame(editor_frame, fg_color="transparent")
        query_container.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="nsew")
        query_container.grid_rowconfigure(0, weight=1)
        query_container.grid_columnconfigure(0, weight=1)
        
        self.query_textbox = ctk.CTkTextbox(
            query_container,
            font=ctk.CTkFont(size=16),
            wrap="word"
        )
        self.query_textbox.grid(row=0, column=0, sticky="nsew")
        
        # Action buttons and settings
        actions_frame = ctk.CTkFrame(editor_frame, fg_color="transparent")
        actions_frame.grid(row=2, column=0, padx=20, pady=(0, 20), sticky="ew")
        actions_frame.grid_columnconfigure(3, weight=1)
        
        self.search_btn = ctk.CTkButton(
            actions_frame,
            text="Search",
            width=120,
            height=40,
            font=ctk.CTkFont(size=12),
            command=self._execute_search
        )
        self.search_btn.grid(row=0, column=0, sticky="w")
        
        ctk.CTkButton(
            actions_frame,
            text="Copy Query",
            width=120,
            height=40,
            font=ctk.CTkFont(size=12),
            command=self._copy_query
        ).grid(row=0, column=1, padx=(10, 0), sticky="w")
        
        ctk.CTkButton(
            actions_frame,
            text="Clear",
            width=100,
            height=40,
            font=ctk.CTkFont(size=12),
            fg_color="gray",
            hover_color="gray30",
            command=self._clear_query
        ).grid(row=0, column=2, padx=(10, 0), sticky="w")
        
        # Max results setting
        max_results_frame = ctk.CTkFrame(actions_frame, fg_color="transparent")
        max_results_frame.grid(row=0, column=4, sticky="e")
        
        ctk.CTkLabel(
            max_results_frame,
            text="Max Results:",
            font=ctk.CTkFont(size=12)
        ).grid(row=0, column=0, padx=(0, 5))
        
        self.var_max_results = ctk.StringVar(value="100")
        self.entry_max_results = ctk.CTkEntry(
            max_results_frame,
            textvariable=self.var_max_results,
            width=60,
            height=28,
            font=ctk.CTkFont(size=12)
        )
        self.entry_max_results.grid(row=0, column=1)
    
    def _create_fieldcodes_panel(self):
        """Create the field codes panel with all operators and field codes"""
        # Container
        self.fieldcodes_frame = ctk.CTkFrame(self, corner_radius=15)
        self.fieldcodes_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 5), pady=0)
        self.fieldcodes_frame.grid_rowconfigure(2, weight=1)
        self.fieldcodes_frame.grid_columnconfigure(0, weight=1)
        
        # Hide if not visible
        if not self.fieldcodes_visible:
            self.fieldcodes_frame.grid_remove()
        
        # Header
        header = ctk.CTkLabel(
            self.fieldcodes_frame,
            text="Field Codes",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="w")
        
        # Search/Filter for field codes
        self.fieldcodes_search_var = ctk.StringVar()
        self.fieldcodes_search_var.trace_add("write", lambda *_: self._filter_fieldcodes())
        fieldcodes_search = ctk.CTkEntry(
            self.fieldcodes_frame,
            placeholder_text="Filter field codes...",
            textvariable=self.fieldcodes_search_var,
            height=28
        )
        fieldcodes_search.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="ew")
        
        # Field codes list (scrollable)
        self.fieldcodes_list_container = ctk.CTkScrollableFrame(
            self.fieldcodes_frame,
            fg_color="transparent"
        )
        self.fieldcodes_list_container.grid(row=2, column=0, padx=10, pady=(0, 10), sticky="nsew")
        self.fieldcodes_list_container.grid_columnconfigure(0, weight=1)
        
        # Define all field codes with categories
        self.all_fieldcodes = [
            # Operators
            {"code": "AND", "category": "Operators", "type": "operator"},
            {"code": "OR", "category": "Operators", "type": "operator"},
            {"code": "NOT", "category": "Operators", "type": "operator"},
            {"code": "(", "category": "Operators", "type": "operator"},
            {"code": ")", "category": "Operators", "type": "operator"},
            {"code": '*', "category": "Wildcards", "type": "operator"},
            {"code": '?', "category": "Wildcards", "type": "operator"},
            {"code": '#', "category": "Wildcards", "type": "operator"},
            {"code": "W/n", "category": "Proximity", "type": "operator"},
            {"code": "PRE/n", "category": "Proximity", "type": "operator"},
            {"code": '""', "category": "Operators", "type": "wrap"},
            {"code": '{}', "category": "Operators", "type": "wrap"},
            
            # Content Fields
            {"code": "ABS", "category": "Content", "type": "text"},
            {"code": "ALL", "category": "Content", "type": "text"},
            {"code": "TITLE", "category": "Content", "type": "text"},
            {"code": "TITLE-ABS", "category": "Content", "type": "text"},
            {"code": "TITLE-ABS-KEY", "category": "Content", "type": "text"},
            {"code": "TITLE-ABS-KEY-AUTH", "category": "Content", "type": "text"},
            {"code": "KEY", "category": "Content", "type": "text"},
            {"code": "AUTHKEY", "category": "Content", "type": "text"},
            {"code": "INDEXTERMS", "category": "Content", "type": "text"},
            
            # Author Fields
            {"code": "AUTH", "category": "Author", "type": "text"},
            {"code": "AUTHCOLLAB", "category": "Author", "type": "text"},
            {"code": "AUTHFIRST", "category": "Author", "type": "text"},
            {"code": "AU-ID", "category": "Author", "type": "text"},
            {"code": "AUTHLASTNAME", "category": "Author", "type": "text"},
            {"code": "AUTHOR-NAME", "category": "Author", "type": "text"},
            {"code": "FIRSTAUTH", "category": "Author", "type": "text"},
            {"code": "ORCID", "category": "Author", "type": "text"},
            {"code": "EDITOR", "category": "Author", "type": "text"},
            {"code": "EDFIRST", "category": "Author", "type": "text"},
            {"code": "EDLASTNAME", "category": "Author", "type": "text"},
            
            # Affiliation Fields
            {"code": "AFFIL", "category": "Affiliation", "type": "text"},
            {"code": "AFFILCITY", "category": "Affiliation", "type": "text"},
            {"code": "AFFILCOUNTRY", "category": "Affiliation", "type": "text"},
            {"code": "AF-ID", "category": "Affiliation", "type": "text"},
            {"code": "AFFILORG", "category": "Affiliation", "type": "text"},
            
            # Chemical/Sequence Fields
            {"code": "SEQBANK", "category": "Chemical", "type": "text"},
            {"code": "SEQNUMBER", "category": "Chemical", "type": "text"},
            {"code": "CASREGNUMBER", "category": "Chemical", "type": "text"},
            {"code": "CHEM", "category": "Chemical", "type": "text"},
            {"code": "CHEMNAME", "category": "Chemical", "type": "text"},
            {"code": "MANUFACTURER", "category": "Chemical", "type": "text"},
            {"code": "TRADENAME", "category": "Chemical", "type": "text"},
            
            # Conference Fields
            {"code": "CONF", "category": "Conference", "type": "text"},
            {"code": "CONFLOC", "category": "Conference", "type": "text"},
            {"code": "CONFNAME", "category": "Conference", "type": "text"},
            {"code": "CONFSPONSORS", "category": "Conference", "type": "text"},
            
            # Document Fields
            {"code": "OA", "category": "Document", "type": "text"},
            {"code": "INDEX", "category": "Document", "type": "text"},
            {"code": "DOCTYPE", "category": "Document", "type": "text"},
            {"code": "DOI", "category": "Document", "type": "text"},
            {"code": "EID", "category": "Document", "type": "text"},
            {"code": "ARTNUM", "category": "Document", "type": "text"},
            {"code": "PAGEFIRST", "category": "Document", "type": "text"},
            {"code": "PAGELAST", "category": "Document", "type": "text"},
            {"code": "PAGES", "category": "Document", "type": "text"},
            {"code": "LANGUAGE", "category": "Document", "type": "text"},
            {"code": "LOAD-DATE", "category": "Document", "type": "text"},
            
            # Funding Fields
            {"code": "FUND-ALL", "category": "Funding", "type": "text"},
            {"code": "FUND-SPONSOR", "category": "Funding", "type": "text"},
            {"code": "FUND-NO", "category": "Funding", "type": "text"},
            {"code": "FUND-ACR", "category": "Funding", "type": "text"},
            
            # Source/Publication Fields
            {"code": "BOOKPUB", "category": "Source", "type": "text"},
            {"code": "CODEN", "category": "Source", "type": "text"},
            {"code": "PUBDATETXT", "category": "Source", "type": "text"},
            {"code": "EISSN", "category": "Source", "type": "text"},
            {"code": "EXACTSRCTITLE", "category": "Source", "type": "text"},
            {"code": "ISBN", "category": "Source", "type": "text"},
            {"code": "ISSN", "category": "Source", "type": "text"},
            {"code": "ISSNP", "category": "Source", "type": "text"},
            {"code": "PMID", "category": "Source", "type": "text"},
            {"code": "ISSUE", "category": "Source", "type": "text"},
            {"code": "VOLUME", "category": "Source", "type": "text"},
            {"code": "SRCID", "category": "Source", "type": "text"},
            {"code": "SRCTITLE", "category": "Source", "type": "text"},
            {"code": "SRCTYPE", "category": "Source", "type": "text"},
            {"code": "PUBYEAR", "category": "Source", "type": "numeric"},
            {"code": "WEBSITE", "category": "Source", "type": "text"},
            
            # Reference Fields
            {"code": "REF", "category": "References", "type": "text"},
            {"code": "REFARTNUM", "category": "References", "type": "text"},
            {"code": "REFAUTH", "category": "References", "type": "text"},
            {"code": "REFPAGEFIRST", "category": "References", "type": "text"},
            {"code": "REFPAGE", "category": "References", "type": "text"},
            {"code": "REFPUBYEAR", "category": "References", "type": "text"},
            {"code": "REFSRCTITLE", "category": "References", "type": "text"},
            {"code": "REFTITLE", "category": "References", "type": "text"},
            
            # Subject Area Fields
            {"code": "SUBJAREA", "category": "Subject Area", "type": "text"},
            {"code": "MEDI", "category": "Subject Area", "type": "text"},
            {"code": "NURS", "category": "Subject Area", "type": "text"},
            {"code": "VETE", "category": "Subject Area", "type": "text"},
            {"code": "DENT", "category": "Subject Area", "type": "text"},
            {"code": "HEAL", "category": "Subject Area", "type": "text"},
            {"code": "MULT", "category": "Subject Area", "type": "text"},
            {"code": "AGRI", "category": "Subject Area", "type": "text"},
            {"code": "BIOC", "category": "Subject Area", "type": "text"},
            {"code": "IMMU", "category": "Subject Area", "type": "text"},
            {"code": "NEUR", "category": "Subject Area", "type": "text"},
            {"code": "PHAR", "category": "Subject Area", "type": "text"},
            {"code": "CENG", "category": "Subject Area", "type": "text"},
            {"code": "COMP", "category": "Subject Area", "type": "text"},
            {"code": "EART", "category": "Subject Area", "type": "text"},
            {"code": "ENER", "category": "Subject Area", "type": "text"},
            {"code": "ENGI", "category": "Subject Area", "type": "text"},
            {"code": "ENVI", "category": "Subject Area", "type": "text"},
            {"code": "MATE", "category": "Subject Area", "type": "text"},
            {"code": "MATH", "category": "Subject Area", "type": "text"},
            {"code": "PHYS", "category": "Subject Area", "type": "text"},
            {"code": "ARTS", "category": "Subject Area", "type": "text"},
            {"code": "BUSI", "category": "Subject Area", "type": "text"},
            {"code": "DECI", "category": "Subject Area", "type": "text"},
            {"code": "ECON", "category": "Subject Area", "type": "text"},
            {"code": "PSYC", "category": "Subject Area", "type": "text"},
            {"code": "SOCI", "category": "Subject Area", "type": "text"},
            
            # Limit Operators
            {"code": "BEF", "category": "Limits", "type": "operator"},
            {"code": "AFT", "category": "Limits", "type": "operator"},
            {"code": "IS", "category": "Limits", "type": "operator"},
        ]
        
        # Stats
        self.fieldcodes_stats_label = ctk.CTkLabel(
            self.fieldcodes_frame,
            text=f"Total: {len(self.all_fieldcodes)} codes",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        self.fieldcodes_stats_label.grid(row=3, column=0, padx=20, pady=(0, 20), sticky="w")
        
        # Populate the list
        self._populate_fieldcodes_list()
    
    def _populate_fieldcodes_list(self, filter_text: str = ""):
        """Populate the field codes list with optional filtering"""
        # Clear existing
        for widget in self.fieldcodes_list_container.winfo_children():
            widget.destroy()
        
        # Filter codes
        filter_lower = filter_text.lower().strip()
        filtered_codes = []
        
        for fc in self.all_fieldcodes:
            code_lower = fc["code"].lower()
            category_lower = fc["category"].lower()
            if not filter_lower or filter_lower in code_lower or filter_lower in category_lower:
                filtered_codes.append(fc)
        
        # Group by category
        categories = {}
        for fc in filtered_codes:
            cat = fc["category"]
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(fc)
        
        # Add codes by category
        row_idx = 0
        for category in ["Operators", "Wildcards", "Proximity", "Content", "Author", "Affiliation", 
                         "Chemical", "Conference", "Document", "Funding", "Source", "References", 
                         "Subject Area", "Limits"]:
            if category not in categories:
                continue
            
            # Category header
            cat_label = ctk.CTkLabel(
                self.fieldcodes_list_container,
                text=category,
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=("gray30", "gray70"),
                anchor="w"
            )
            cat_label.grid(row=row_idx, column=0, padx=5, pady=(10, 3), sticky="ew")
            row_idx += 1
            
            # Add codes in this category
            for fc in categories[category]:
                code_card = ctk.CTkFrame(
                    self.fieldcodes_list_container,
                    corner_radius=6,
                    height=30,
                    fg_color=("gray90", "gray20")
                )
                code_card.grid(row=row_idx, column=0, padx=5, pady=2, sticky="ew")
                code_card.grid_propagate(False)
                
                code_label = ctk.CTkLabel(
                    code_card,
                    text=fc["code"],
                    font=ctk.CTkFont(size=11),
                    anchor="w"
                )
                code_label.pack(fill="both", expand=True, padx=10, pady=5)
                
                # Make clickable
                def make_click_handler(field_code):
                    return lambda e=None: self._insert_fieldcode(field_code)
                
                click_handler = make_click_handler(fc)
                code_card.bind("<Button-1>", click_handler)
                code_label.bind("<Button-1>", click_handler)
                
                # Hover effect
                def on_enter(e, card=code_card):
                    card.configure(fg_color=("gray75", "gray30"))
                
                def on_leave(e, card=code_card):
                    card.configure(fg_color=("gray90", "gray20"))
                
                code_card.bind("<Enter>", on_enter)
                code_card.bind("<Leave>", on_leave)
                code_label.bind("<Enter>", on_enter)
                code_label.bind("<Leave>", on_leave)
                
                row_idx += 1
        
        # Update stats
        if filter_text.strip():
            self.fieldcodes_stats_label.configure(
                text=f"Showing: {len(filtered_codes)} of {len(self.all_fieldcodes)} codes"
            )
        else:
            self.fieldcodes_stats_label.configure(
                text=f"Total: {len(self.all_fieldcodes)} codes"
            )
    
    def _filter_fieldcodes(self):
        """Filter field codes based on search text"""
        filter_text = self.fieldcodes_search_var.get()
        self._populate_fieldcodes_list(filter_text)
    
    def _insert_fieldcode(self, fieldcode: dict):
        """Insert a field code into the query"""
        try:
            code = fieldcode["code"]
            fc_type = fieldcode["type"]
            
            if fc_type == "text":
                # Text field - wrap selection or insert with quotes
                try:
                    selected_text = self.query_textbox.get("sel.first", "sel.last")
                    self.query_textbox.delete("sel.first", "sel.last")
                    self.query_textbox.insert("insert", f'{code}("{selected_text}")')
                except:
                    self.query_textbox.insert("insert", f'{code}("")')
                    self.query_textbox.mark_set("insert", "insert-2c")
            elif fc_type == "numeric":
                # Numeric field
                self.query_textbox.insert("insert", f"{code} = ")
            elif fc_type == "wrap":
                # Wrapping characters like "" or {}
                if code == '""':
                    self._wrap_selection('"', '"')
                elif code == '{}':
                    self._wrap_selection('{', '}')
            else:
                # Operator - insert with spaces if needed
                if code in ["AND", "OR", "NOT"]:
                    self.query_textbox.insert("insert", f" {code} ")
                elif code in ["W/n", "PRE/n"]:
                    op = code.replace("n", "")
                    self.query_textbox.insert("insert", f" {op}")
                else:
                    self.query_textbox.insert("insert", code)
            
            self.query_textbox.focus_set()
        except Exception as e:
            print(f"Error inserting field code: {e}")
    
    def _toggle_fieldcodes(self):
        """Toggle visibility of the field codes panel"""
        self.fieldcodes_visible = not self.fieldcodes_visible
        
        if self.fieldcodes_visible:
            self.fieldcodes_frame.grid()
            if self.icon_sidebar_l_act:
                self.fieldcodes_toggle_btn.configure(image=self.icon_sidebar_l_act)
            else:
                self.fieldcodes_toggle_btn.configure(text="Hide Field Codes")
        else:
            self.fieldcodes_frame.grid_remove()
            if self.icon_sidebar_l:
                self.fieldcodes_toggle_btn.configure(image=self.icon_sidebar_l)
            else:
                self.fieldcodes_toggle_btn.configure(text="Show Field Codes")
        
        # Update grid layout
        self._update_grid_layout()
    
    def _create_terms_panel(self):
        """Create the search terms history panel"""
        # Container
        self.terms_frame = ctk.CTkFrame(self, corner_radius=15)
        self.terms_frame.grid(row=0, column=2, sticky="nsew", padx=(5, 0), pady=0)
        self.terms_frame.grid_rowconfigure(2, weight=1)
        self.terms_frame.grid_columnconfigure(0, weight=1)
        
        # Hide if not visible
        if not self.terms_visible:
            self.terms_frame.grid_remove()
        
        # Header
        header = ctk.CTkLabel(
            self.terms_frame,
            text="Saved Terms",
            font=ctk.CTkFont(size=18, weight="bold"),
            anchor="w"
        )
        header.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="w")
        
        # Search/Filter for terms
        self.terms_search_var = ctk.StringVar()
        self.terms_search_var.trace_add("write", lambda *_: self._filter_terms())
        terms_search = ctk.CTkEntry(
            self.terms_frame,
            placeholder_text="Filter terms...",
            textvariable=self.terms_search_var,
            height=28
        )
        terms_search.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="ew")
        
        # Terms list (scrollable)
        self.terms_list_container = ctk.CTkScrollableFrame(
            self.terms_frame,
            fg_color="transparent"
        )
        self.terms_list_container.grid(row=2, column=0, padx=10, pady=(0, 10), sticky="nsew")
        self.terms_list_container.grid_columnconfigure(0, weight=1)
        
        # Stats (create before populating list)
        self.terms_stats_label = ctk.CTkLabel(
            self.terms_frame,
            text=f"Total: {len(self.saved_terms)} terms",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        self.terms_stats_label.grid(row=3, column=0, padx=20, pady=(0, 20), sticky="w")
        
        # Now populate the list
        self._populate_terms_list()
    
    def _populate_terms_list(self, filter_text: str = ""):
        """Populate the terms list with optional filtering, grouped by first letter"""
        # Clear existing
        for widget in self.terms_list_container.winfo_children():
            widget.destroy()
        
        # Filter terms
        filter_lower = filter_text.lower().strip()
        filtered_terms = []
        
        for term in self.saved_terms:
            if not filter_lower or filter_lower in term.lower():
                filtered_terms.append(term)
        
        # Sort terms alphabetically (case-insensitive)
        filtered_terms.sort(key=lambda x: x.lower())
        
        # Group terms by first letter
        grouped_terms = {}
        for term in filtered_terms:
            first_char = term[0].upper() if term else '#'
            # Group numbers and special characters under '#'
            if not first_char.isalpha():
                first_char = '#'
            if first_char not in grouped_terms:
                grouped_terms[first_char] = []
            grouped_terms[first_char].append(term)
        
        # Get sorted letters (# first, then A-Z)
        letters = sorted(grouped_terms.keys())
        if '#' in letters:
            letters.remove('#')
            letters.insert(0, '#')
        
        # Add terms by letter group
        row_idx = 0
        for letter in letters:
            terms_in_group = grouped_terms[letter]
            
            # Letter header
            letter_label = ctk.CTkLabel(
                self.terms_list_container,
                text=letter,
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=("gray30", "gray70"),
                anchor="w"
            )
            letter_label.grid(row=row_idx, column=0, padx=5, pady=(10, 3), sticky="ew")
            row_idx += 1
            
            # Add terms in this group
            for term in terms_in_group:
                term_card = ctk.CTkFrame(
                    self.terms_list_container,
                    corner_radius=6,
                    height=30,
                    fg_color=("gray90", "gray20")
                )
                term_card.grid(row=row_idx, column=0, padx=5, pady=2, sticky="ew")
                term_card.grid_propagate(False)
                
                term_label = ctk.CTkLabel(
                    term_card,
                    text=term,
                    font=ctk.CTkFont(size=11),
                    anchor="w"
                )
                term_label.pack(fill="both", expand=True, padx=10, pady=5)
                
                # Make clickable (left click to insert)
                def make_click_handler(t):
                    return lambda e=None: self._insert_term(t)
                
                click_handler = make_click_handler(term)
                term_card.bind("<Button-1>", click_handler)
                term_label.bind("<Button-1>", click_handler)
                
                # Right click to delete
                def make_right_click_handler(t):
                    return lambda e=None: self._show_term_context_menu(e, t)
                
                right_click_handler = make_right_click_handler(term)
                term_card.bind("<Button-3>", right_click_handler)
                term_label.bind("<Button-3>", right_click_handler)
                
                # Hover effect
                def on_enter(e, card=term_card):
                    card.configure(fg_color=("gray75", "gray30"))
                
                def on_leave(e, card=term_card):
                    card.configure(fg_color=("gray90", "gray20"))
                
                term_card.bind("<Enter>", on_enter)
                term_card.bind("<Leave>", on_leave)
                term_label.bind("<Enter>", on_enter)
                term_label.bind("<Leave>", on_leave)
                
                row_idx += 1
        
        # Update stats
        if filter_text.strip():
            self.terms_stats_label.configure(
                text=f"Showing: {len(filtered_terms)} of {len(self.saved_terms)} terms"
            )
        else:
            self.terms_stats_label.configure(
                text=f"Total: {len(self.saved_terms)} terms"
            )
        
        return len(filtered_terms)
    
    def _filter_terms(self):
        """Filter terms based on search text"""
        filter_text = self.terms_search_var.get()
        self._populate_terms_list(filter_text)
    
    def _show_term_context_menu(self, event, term: str):
        """Show context menu for term (right-click)"""
        try:
            # Create context menu
            menu = tk.Menu(self, tearoff=0)
            
            # Dark mode support
            if ctk.get_appearance_mode() == 'Dark':
                menu.configure(bg='#2b2b2b', fg='white', activebackground='#404040', activeforeground='white')
            else:
                menu.configure(bg='white', fg='black', activebackground='#e0e0e0', activeforeground='black')
            
            menu.add_command(label=f"🗑️    Delete '{term}'", command=lambda: self._delete_term(term))
            
            # Show at cursor position
            menu.post(event.x_root, event.y_root)
        except Exception as e:
            print(f"Error showing context menu: {e}")
    
    def _delete_term(self, term: str):
        """Delete a term from the search history"""
        try:
            if term in self.saved_terms:
                # Ask for confirmation
                result = messagebox.askyesno(
                    "Delete Term",
                    f"Are you sure you want to delete '{term}' from the search history?"
                )
                
                if result:
                    self.saved_terms.remove(term)
                    self._save_terms()
                    self._populate_terms_list()
                    print(f"Deleted term: {term}")
        except Exception as e:
            print(f"Error deleting term: {e}")
            messagebox.showerror("Error", f"Failed to delete term: {e}")
    
    def _toggle_terms(self):
        """Toggle visibility of the terms panel"""
        self.terms_visible = not self.terms_visible
        
        if self.terms_visible:
            self.terms_frame.grid()
            if self.icon_sidebar_r_act:
                self.terms_toggle_btn.configure(image=self.icon_sidebar_r_act)
            else:
                self.terms_toggle_btn.configure(text="📝 Hide Terms")
        else:
            self.terms_frame.grid_remove()
            if self.icon_sidebar_r:
                self.terms_toggle_btn.configure(image=self.icon_sidebar_r)
            else:
                self.terms_toggle_btn.configure(text="📝 Show Terms")
        
        # Update grid layout
        self._update_grid_layout()
    
    def _insert_operator(self, operator: str):
        """Insert an operator at cursor position"""
        try:
            self.query_textbox.insert("insert", operator)
            self.query_textbox.focus_set()
        except Exception as e:
            print(f"Error inserting operator: {e}")
    
    def _wrap_selection(self, prefix: str, suffix: str):
        """Wrap selected text or insert at cursor"""
        try:
            # Check if there's a selection
            try:
                selected_text = self.query_textbox.get("sel.first", "sel.last")
                # Replace selection with wrapped text
                self.query_textbox.delete("sel.first", "sel.last")
                self.query_textbox.insert("insert", f"{prefix}{selected_text}{suffix}")
            except:
                # No selection, just insert the prefix and suffix
                self.query_textbox.insert("insert", f"{prefix}{suffix}")
                # Move cursor between them
                self.query_textbox.mark_set("insert", "insert-1c")
            
            self.query_textbox.focus_set()
        except Exception as e:
            print(f"Error wrapping text: {e}")
    
    def _insert_term(self, term: str):
        """Insert a search term from history into the query"""
        try:
            # Insert only the term in quotes, no OR prefix
            term_to_insert = f'"{term}"'
            self.query_textbox.insert("insert", term_to_insert)
            self.query_textbox.focus_set()
            
        except Exception as e:
            print(f"Error inserting term: {e}")
    
    def _execute_search(self):
        """Execute the search query"""
        query = self.query_textbox.get("1.0", "end-1c").strip()
        if not query:
            messagebox.showwarning("Input", "Please enter a search query.")
            return
        
        # Extract and save search terms from the query
        self._extract_and_save_search_terms(query)
        
        # Resolve API credentials from app root only (consistent EXE/dev)
        try:
            from utils.config import load_existing_config
            api_key, inst_token, _view = load_existing_config()
        except Exception as e:
            messagebox.showerror("Configuration", f"Error loading API configuration: {e}")
            return
        
        # Normalize API key: allow comma/newline separated, pick the first
        if api_key:
            parts = [p.strip() for p in api_key.replace("\r", "\n").replace("\n", ",").split(",")]
            api_key = next((p for p in parts if p), "")

        if not api_key:
            messagebox.showerror("Configuration", "No API key configured. Please set API Key under Settings.")
            return
        
        # Get max results from user input
        try:
            max_results = int(self.var_max_results.get())
            if max_results <= 0:
                messagebox.showwarning("Input", "Max results must be a positive number.")
                return
        except ValueError:
            messagebox.showwarning("Input", "Max results must be a valid number.")
            return
        
        print(f"Executing search: {query}")
        print(f"Max results: {max_results}")
        
        # Show progress overlay and disable search button
        self.search_btn.configure(state="disabled")
        self._create_progress_overlay()
        
        # Run search in background thread
        def run_search():
            try:
                # API endpoint and headers
                SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
                headers = {
                    "Accept": "application/json",
                    "X-ELS-APIKey": api_key
                }
                if inst_token:
                    headers["X-ELS-Insttoken"] = inst_token
                
                # Fetch results
                all_results = []
                start = 0
                count = 25
                total_results = None
                
                while True:
                    params = {
                        "query": query,
                        "start": start,
                        "count": count,
                        "view": "STANDARD"
                    }
                    
                    response = requests.get(SEARCH_URL, headers=headers, params=params, timeout=30)
                    
                    if response.status_code >= 400:
                        self.after(0, lambda msg=f"API Error: {response.status_code}": messagebox.showerror("Search Error", msg))
                        return
                    
                    # Parse response
                    data = {}
                    if response.status_code < 400:
                        try:
                            if response.headers.get("Content-Type", "").startswith("application/json"):
                                data = response.json()
                        except Exception:
                            data = {}
                    
                    # Extract total results
                    try:
                        total_results_current = int(data.get("search-results", {}).get("opensearch:totalResults", 0))
                        if total_results is None:
                            total_results = total_results_current
                            # Update progress bar max once we know total
                            if total_results > 0:
                                self.after(0, lambda: self.progress_status.configure(
                                    text=f"Found {total_results} total results. Fetching..."
                                ))
                    except Exception:
                        if total_results is None:
                            total_results = 0
                    
                    # Extract entries
                    entries = data.get("search-results", {}).get("entry", []) if data else []
                    
                    if not entries:
                        break
                    
                    # Track if we found valid entries in this batch
                    batch_count_before = len(all_results)
                    
                    # Process entries
                    for idx, entry in enumerate(entries):
                        # Debug: Show first entry structure
                        if len(all_results) == 0 and idx == 0:
                            print(f"\n=== SEARCH API - First Entry Structure ===")
                            print(f"Entry has {len(entry)} keys: {list(entry.keys())[:20]}...")
                            if 'dc:description' in entry:
                                desc = entry.get('dc:description', '')
                                print(f"  ✓ dc:description found! Length: {len(desc) if desc else 0}")
                                if desc:
                                    print(f"    First 100 chars: {desc[:100]}")
                            else:
                                print(f"  ✗ NO dc:description in entry!")
                                # Check for other possible abstract fields
                                abstract_fields = [k for k in entry.keys() if 'abstract' in k.lower() or 'description' in k.lower()]
                                if abstract_fields:
                                    print(f"  Found possible abstract fields: {abstract_fields}")
                                    for field in abstract_fields:
                                        val = entry.get(field, '')
                                        print(f"    {field}: {val[:100] if val else 'empty'}")
                            print(f"=== END SEARCH API DEBUG ===\n")
                        
                        # Extract authors
                        authors = self._extract_authors(entry)
                        
                        result = {
                            "eid": entry.get("eid", ""),
                            "title": entry.get("dc:title") or entry.get("dc:title-original") or "",
                            "authors": authors,
                            "date": entry.get("prism:coverDate", ""),
                            "citedby": entry.get("citedby-count") or entry.get("citedby_count") or "",
                            "doi": entry.get("prism:doi", ""),
                            "publicationName": entry.get("prism:publicationName", ""),
                            "abstract": entry.get("dc:description", "")
                        }
                        all_results.append(result)
                        
                        # Update progress
                        if max_results > 0:
                            progress = min(len(all_results) / max_results, 1.0)
                            self.after(0, lambda p=progress: self.progress_bar.set(p))
                            self.after(0, lambda c=len(all_results), m=max_results: self.progress_status.configure(
                                text=(f"Retrieved {c} of {m} requested articles..." if m > 0 else f"Retrieved {c} articles...")
                            ))
                        elif total_results and total_results > 0:
                            progress = min(len(all_results) / total_results, 1.0)
                            self.after(0, lambda p=progress: self.progress_bar.set(p))
                            self.after(0, lambda c=len(all_results), t=total_results: self.progress_status.configure(
                                text=(f"Retrieved {c} of {t} articles..." if t and t > 0 else f"Retrieved {c} articles...")
                            ))
                        
                        if max_results > 0 and len(all_results) >= max_results:
                            break
                    
                    # Check if we should continue
                    if max_results > 0 and len(all_results) >= max_results:
                        break
                    
                    start += count
                    
                    # Stop if we've reached the total (check for None and 0 separately)
                    if total_results is not None and start >= total_results:
                        break
                
                # Use actual total or count of results (ensure 0 if no entries)
                if total_results is None:
                    final_total = len(all_results)
                else:
                    try:
                        final_total = int(total_results)
                    except Exception:
                        final_total = len(all_results)
                
                # Use actual total or count of results
                final_total = total_results if total_results is not None else len(all_results)
                
                # Save to search_log.json
                self._save_search_to_log(query, all_results, final_total)
                
                # Hide progress overlay and re-enable button
                self.after(0, self._hide_progress_overlay)
                self.after(0, lambda: self.search_btn.configure(state="normal"))
                
                # Show success message
                self.after(0, lambda: messagebox.showinfo(
                    "Search Complete", 
                    f"Found {final_total} results. Retrieved {len(all_results)} articles.\n\nResults saved to search history."
                ))
                
            except Exception as e:
                # Hide progress overlay and re-enable button on error
                self.after(0, self._hide_progress_overlay)
                self.after(0, lambda: self.search_btn.configure(state="normal"))
                self.after(0, lambda msg=str(e): messagebox.showerror("Search Error", f"Error during search: {msg}"))
        
        # Start search thread
        thread = threading.Thread(target=run_search, daemon=True)
        thread.start()
    
    def _extract_authors(self, entry: dict) -> str:
        """Extract author names from Scopus entry"""
        try:
            auth_list = entry.get('author')
            if isinstance(auth_list, dict):
                auth_list = [auth_list]
            
            names = []
            if isinstance(auth_list, list):
                for a in auth_list:
                    if not isinstance(a, dict):
                        continue
                    name = a.get('authname') or ''
                    if not name:
                        pref = a.get('preferred-name') or {}
                        name = (
                            pref.get('ce:indexed-name') or
                            (pref.get('surname', '') + ' ' + pref.get('given-name', '')).strip()
                        )
                    if not name:
                        name = a.get('ce:indexed-name') or (
                            (a.get('surname', '') + ' ' + a.get('given-name', '')).strip()
                        )
                    if name:
                        names.append(name)
            
            if not names:
                single = entry.get('dc:creator') or ''
                if isinstance(single, str):
                    return single
            
            # Deduplicate while preserving order
            out = []
            seen = set()
            for n in names:
                k = n.strip()
                if k and k not in seen:
                    out.append(k)
                    seen.add(k)
            return ', '.join(out)
        except Exception:
            return str(entry.get('dc:creator') or '')
    
    def _save_search_to_log(self, query: str, results: list, total_count: int):
        """Save search results to search_log.json"""
        try:
            search_log_path = self.project_path / "search_log.json"
            
            # Load existing log
            search_log = []
            if search_log_path.exists():
                try:
                    with open(search_log_path, "r", encoding="utf-8") as f:
                        search_log = json.load(f)
                except Exception:
                    search_log = []
            
            # Create new search entry
            search_entry = {
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "query": query,
                "view": "STANDARD",
                "count": total_count,
                "results": results
            }
            
            # Add to beginning of log (most recent first)
            search_log.insert(0, search_entry)
            
            # Save back to file
            with open(search_log_path, "w", encoding="utf-8") as f:
                json.dump(search_log, f, ensure_ascii=False, indent=2)
            
            print(f"Search saved to {search_log_path}")
            
        except Exception as e:
            print(f"Error saving search to log: {e}")
    
    def _copy_query(self):
        """Copy query to clipboard"""
        try:
            query = self.query_textbox.get("1.0", "end-1c").strip()
            if query:
                self.clipboard_clear()
                self.clipboard_append(query)
                print("Query copied to clipboard")
        except Exception as e:
            print(f"Error copying query: {e}")
    
    def _clear_query(self):
        """Clear the query editor"""
        self.query_textbox.delete("1.0", "end")


if __name__ == "__main__":
    # Test the view
    root = ctk.CTk()
    root.geometry("1400x900")
    ctk.set_appearance_mode("dark")
    
    # Get workspace path dynamically (two levels up from this file)
    workspace = str(Path(__file__).parent.parent.parent)
    view = SearchView(root, workspace)
    view.pack(fill="both", expand=True, padx=20, pady=20)
    
    root.mainloop()
