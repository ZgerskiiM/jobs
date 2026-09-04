"""Adapters for standard public Greenhouse and Lever APIs."""

from __future__ import annotations

from typing import Any, Callable

from .models import Job, plain_text, text_value


def greenhouse_jobs(source: dict[str, Any], timeout: int, retries: int, fetch_json: Callable[..., Any]) -> list[Job]:
    payload = fetch_json(
        f"https://boards-api.greenhouse.io/v1/boards/{source['token']}/jobs?content=true",
        timeout, retries,
    )
    return [Job(source["key"], str(item["id"]), source["company"], text_value(item.get("title")),
        text_value((item.get("location") or {}).get("name")),
        ", ".join(d.get("name", "") for d in item.get("departments", []) if d.get("name")), "",
        plain_text(item.get("content")), text_value(item.get("absolute_url")), "", text_value(item.get("updated_at")))
        for item in payload.get("jobs", [])]


def lever_jobs(source: dict[str, Any], timeout: int, retries: int, fetch_json: Callable[..., Any]) -> list[Job]:
    from datetime import datetime, timezone
    from urllib.parse import urlencode
    host = "api.eu.lever.co" if source.get("region", "global") == "eu" else "api.lever.co"
    result: list[Job] = []; skip, limit = 0, 100
    for _page in range(max(1, int(source.get("max_pages", 100)))):
        payload = fetch_json(f"https://{host}/v0/postings/{source['site']}?{urlencode({'mode':'json','skip':skip,'limit':limit})}", timeout, retries)
        if not isinstance(payload, list): raise RuntimeError(f"Lever вернул неожиданный ответ для {source['key']}")
        for item in payload:
            categories = item.get("categories") or {}
            parts = [text_value(item.get("descriptionPlain")), text_value(item.get("additionalPlain"))]
            for section in item.get("lists", []) or []: parts.extend([text_value(section.get("text")), plain_text(section.get("content"))])
            created = item.get("createdAt")
            posted = datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat() if isinstance(created, (int, float)) else ""
            result.append(Job(source["key"], str(item["id"]), source["company"], text_value(item.get("text")),
                text_value(categories.get("location")), text_value(categories.get("team") or categories.get("department")),
                text_value(item.get("workplaceType")), plain_text(" ".join(parts)),
                text_value(item.get("hostedUrl") or item.get("applyUrl")), posted, ""))
        if len(payload) < limit: break
        skip += limit
    else: raise RuntimeError(f"Lever превысил лимит страниц ({source.get('max_pages', 100)}) для {source['key']}")
    return result
