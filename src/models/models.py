"""Data models for SLR Harvester."""

from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime


@dataclass
class Article:
    """Represents a scientific article/publication."""
    title: str
    authors: str = ""
    journal: str = ""
    date: str = ""  # YYYY-MM-DD format
    eid: Optional[str] = None  # Scopus EID
    doi: Optional[str] = None
    abstract: str = ""
    cited_by_count: int = 0
    scopus_url: Optional[str] = None
    
    # Annotations (global tags)
    tag: str = "None"  # Color tag name
    selected: bool = False
    corpus: bool = False
    comment: str = ""
    
    def __post_init__(self):
        """Normalize dates to YYYY-MM-DD."""
        if self.date and len(self.date) > 10:
            try:
                self.date = self.date[:10]
            except Exception:
                pass
    
    @property
    def article_id(self) -> Optional[str]:
        """Get stable article identifier (EID or DOI)."""
        if self.eid:
            return self.eid
        return self.doi


@dataclass
class Query:
    """Represents a saved search query."""
    query_string: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat(timespec='seconds'))
    results: List[Article] = field(default_factory=list)
    
    # Query annotations
    name: str = ""  # Custom name for the query
    notes: str = ""  # User notes
    # UI-only: favorite queries remain, but article annotations moved
    
    # Metadata
    max_results: int = 500
    scope: str = "Custom"  # Custom, Title, Journal, Author
    result_count: int = 0
    
    @property
    def query_id(self) -> str:
        """Unique identifier based on timestamp."""
        return self.timestamp.replace(':', '').replace('-', '').replace('T', '_')


@dataclass
class ProjectTask:
    """Represents a project task/milestone."""
    title: str
    task_id: str = field(default_factory=lambda: f"t{int(datetime.now().timestamp()*1000)}")
    completed: bool = False
    note: str = ""
    
    # Dates
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None
    milestone_date: Optional[str] = None
    
    def __post_init__(self):
        """Ensure task has an ID."""
        if not self.task_id or self.task_id.startswith('t0'):
            self.task_id = f"t{int(datetime.now().timestamp()*1000)}"


@dataclass
class ProjectMetadata:
    """Metadata for the research project."""
    title: str = "Research Project"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    personal_deadline: Optional[str] = None
    tasks: List[ProjectTask] = field(default_factory=list)
    
    def add_task(self, task: ProjectTask) -> None:
        """Add a task to the project."""
        self.tasks.append(task)
    
    def remove_task(self, task_id: str) -> bool:
        """Remove a task by ID. Returns True if found."""
        initial_len = len(self.tasks)
        self.tasks = [t for t in self.tasks if t.task_id != task_id]
        return len(self.tasks) < initial_len
    
    def get_task(self, task_id: str) -> Optional[ProjectTask]:
        """Get a task by ID."""
        for t in self.tasks:
            if t.task_id == task_id:
                return t
        return None
