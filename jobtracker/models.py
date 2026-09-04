"""Shared value objects and text helpers used by every application layer."""

from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def plain_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def text_value(value: Any) -> str:
    return "" if value is None else str(value)


@dataclass(frozen=True)
class Job:
    """Normalized vacancy returned by every source adapter."""

    source_key: str
    external_id: str
    company: str
    title: str
    location: str
    team: str
    workplace_type: str
    description: str
    url: str
    posted_at: str
    source_updated_at: str

    @property
    def fingerprint(self) -> str:
        tracked = {
            "title": self.title,
            "location": self.location,
            "team": self.team,
            "workplace_type": self.workplace_type,
            "description": self.description,
            "url": self.url,
            "source_updated_at": self.source_updated_at,
        }
        encoded = json.dumps(tracked, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()
