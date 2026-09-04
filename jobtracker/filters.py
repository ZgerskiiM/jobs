"""Explicit source-level filters for the shared vacancy catalog."""

from __future__ import annotations

from typing import Any

from .models import Job


def matches_filters(job: Job, filters: dict[str, Any]) -> bool:
    title_words = [str(v).casefold() for v in filters.get("title_keywords", [])]
    excluded_title_words = [str(v).casefold() for v in filters.get("exclude_title_keywords", [])]
    excluded_title_prefixes = [str(v).casefold() for v in filters.get("exclude_title_prefixes", [])]
    excluded_team_words = [str(v).casefold() for v in filters.get("exclude_team_keywords", [])]
    locations = [str(v).casefold() for v in filters.get("locations", [])]
    normalized_title = job.title.casefold()
    title_ok = not title_words or any(word in normalized_title for word in title_words)
    title_ok = title_ok and not any(word in normalized_title for word in excluded_title_words)
    title_ok = title_ok and not any(
        normalized_title == prefix or normalized_title.startswith(prefix + " (")
        for prefix in excluded_title_prefixes
    )
    location_ok = not locations or any(word in job.location.casefold() for word in locations)
    team_ok = not excluded_team_words or not any(word in job.team.casefold() for word in excluded_team_words)
    return title_ok and location_ok and team_ok


def source_filters(global_filters: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Apply global exclusions even when a source has its own include filter."""
    local_filters = source.get("filters", {})
    result = dict(global_filters)
    for key in ("title_keywords", "locations"):
        if key in local_filters:
            result[key] = local_filters[key]
    result["exclude_title_keywords"] = [
        *global_filters.get("exclude_title_keywords", []), *local_filters.get("exclude_title_keywords", []),
    ]
    result["exclude_title_prefixes"] = [
        *global_filters.get("exclude_title_prefixes", []), *local_filters.get("exclude_title_prefixes", []),
    ]
    result["exclude_team_keywords"] = [
        *global_filters.get("exclude_team_keywords", []), *local_filters.get("exclude_team_keywords", []),
    ]
    return result
