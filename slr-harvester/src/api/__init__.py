"""Scopus API integration for SLR Harvester."""

from .client import ScopusAPIClient, SEARCH_URL, ABSTRACT_EID_URL, ABSTRACT_DOI_URL, AUTHOR_URL

__all__ = [
    "ScopusAPIClient",
    "SEARCH_URL",
    "ABSTRACT_EID_URL",
    "ABSTRACT_DOI_URL",
    "AUTHOR_URL",
]
