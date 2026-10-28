"""Scopus API client for SLR Harvester."""

import requests
from typing import Optional, Dict, Any, List

# Handle both relative and absolute imports
try:
    from ..models import Article
except ImportError:
    from models import Article


# API Endpoints
SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
ABSTRACT_EID_URL = "https://api.elsevier.com/content/abstract/eid/"
ABSTRACT_DOI_URL = "https://api.elsevier.com/content/article/doi/"
AUTHOR_URL = "https://api.elsevier.com/content/author/author_id/"


class ScopusAPIClient:
    """Wrapper around Scopus API with authentication and error handling."""
    
    def __init__(self, api_key: str, inst_token: str = ""):
        """Initialize API client.
        
        Args:
            api_key: Elsevier API key
            inst_token: Optional institutional token
        """
        self.api_key = api_key.strip()
        self.inst_token = inst_token.strip()
    
    def _headers(self) -> Dict[str, str]:
        """Get request headers with authentication."""
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "utf-8",
            "X-ELS-APIKey": self.api_key,
        }
        if self.inst_token:
            headers["X-ELS-Insttoken"] = self.inst_token
        return headers
    
    def search(
        self,
        query: str,
        max_results: int = 500,
        view: str = "STANDARD",
        start: int = 0
    ) -> Dict[str, Any]:
        """Execute a Scopus search query.
        
        Args:
            query: Scopus query string
            max_results: Maximum results to retrieve
            view: "STANDARD" or "COMPLETE"
            start: Starting result offset
        
        Returns:
            API response dict
        
        Raises:
            requests.RequestException: On network/API errors
        """
        params = {
            "query": query,
            "count": min(max_results, 100),
            "start": start,
            "view": view,
        }
        response = requests.get(SEARCH_URL, params=params, headers=self._headers())
        response.raise_for_status()
        return response.json()
    
    def get_abstract(self, eid: str, view: str = "META") -> Dict[str, Any]:
        """Fetch abstract details by EID.
        
        Args:
            eid: Scopus EID
            view: API view mode (META, FULL, STANDARD, COMPLETE)
        
        Returns:
            API response dict
        
        Raises:
            requests.RequestException: On network/API errors
        """
        url = f"{ABSTRACT_EID_URL}{eid}"
        # Try with specified view parameter
        params = {"view": view} if view else {}
        response = requests.get(url, headers=self._headers(), params=params)
        response.raise_for_status()
        return response.json()
    
    def get_abstract_by_doi(self, doi: str) -> Dict[str, Any]:
        """Fetch abstract details by DOI.
        
        Args:
            doi: Digital Object Identifier
        
        Returns:
            API response dict
        
        Raises:
            requests.RequestException: On network/API errors
        """
        url = f"{ABSTRACT_DOI_URL}{doi}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json()
    
    def get_author(self, author_id: str) -> Dict[str, Any]:
        """Fetch author information by author ID.
        
        Args:
            author_id: Scopus author ID
        
        Returns:
            API response dict
        
        Raises:
            requests.RequestException: On network/API errors
        """
        url = f"{AUTHOR_URL}{author_id}"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json()
    
    @staticmethod
    def parse_search_result(entry: Dict[str, Any]) -> Article:
        """Parse a single search result entry into an Article object.
        
        Args:
            entry: Raw search result entry from API
        
        Returns:
            Article instance
        """
        def safe_get(d: Dict, keys: List[str], default="") -> str:
            """Safely get nested dict value."""
            val = d
            for k in keys:
                if isinstance(val, dict):
                    val = val.get(k)
                else:
                    return default
            return str(val) if val is not None else default
        
        return Article(
            title=safe_get(entry, ["dc:title"], ""),
            authors=safe_get(entry, ["dc:creator"], ""),
            journal=safe_get(entry, ["prism:publicationName"], ""),
            date=safe_get(entry, ["prism:coverDate"], ""),
            eid=safe_get(entry, ["eid"], ""),
            doi=safe_get(entry, ["prism:doi"], ""),
            cited_by_count=int(safe_get(entry, ["citedby-count"], "0")) or 0,
            abstract=safe_get(entry, ["dc:description"], ""),
        )
