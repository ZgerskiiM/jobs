"""Conservative, rate-limited revalidation of old vacancy URLs."""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from .models import Job
from .storage import record_event

LOGGER = logging.getLogger(__name__)

MAX_REDIRECTS = 5
MAX_BODY_BYTES = 96 * 1024
CLOSED_PAGE_MARKERS = re.compile(
    r"вакансия\s+(?:уже\s+)?(?:закрыта|не найдена|снята с публикации|больше не доступна)"
    r"|(?:эта|данная)\s+вакансия\s+не актуальна"
    r"|(?:this\s+)?job\s+(?:is\s+)?(?:no longer available|not found|has been filled|closed)"
    r"|position\s+(?:is\s+)?(?:no longer available|has been filled|closed)",
    re.IGNORECASE,
)


def _public_host(host: str, port: int) -> bool:
    try:
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            addresses = [
                ipaddress.ip_address(item[4][0].split("%", 1)[0])
                for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            ]
        return bool(addresses) and all(address.is_global for address in addresses)
    except (OSError, ValueError, UnicodeError):
        return False


def _public_http_url(value: str) -> bool:
    """Reject non-web, credentialed, local, and non-public destinations."""
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username is not None or parsed.password is not None:
            return False
        host = parsed.hostname.rstrip(".").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".localhost")):
            return False
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        return _public_host(host, port)
    except (ValueError, UnicodeError):
        return False


def check_vacancy_url(
    url: str,
    timeout: int,
    client: httpx.Client,
    limiter: Any = None,
) -> str | None:
    """Return active/closed, or None when the result is inconclusive."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not _public_http_url(current):
            return None
        try:
            if limiter is None:
                response = _get(client, current, timeout)
            else:
                with limiter.acquire(current):
                    response = _get(client, current, timeout)
        except (httpx.HTTPError, OSError, TimeoutError):
            return None

        status, location, snippet = response
        if status in {301, 302, 303, 307, 308}:
            if not location:
                return None
            current = urljoin(current, location)
            continue
        if 200 <= status < 300:
            return "closed" if CLOSED_PAGE_MARKERS.search(snippet) else "active"
        if status in {404, 410}:
            return "closed"
        return None
    return None


def _get(client: httpx.Client, url: str, timeout: int) -> tuple[int, str | None, str]:
    request = client.build_request("GET", url, timeout=timeout)
    response = client.send(request, stream=True, follow_redirects=False)
    try:
        status = response.status_code
        location = response.headers.get("location")
        if not 200 <= status < 300:
            return status, location, ""
        body = bytearray()
        for chunk in response.iter_bytes():
            remaining = MAX_BODY_BYTES - len(body)
            if remaining <= 0:
                break
            body.extend(chunk[:remaining])
            if len(body) >= MAX_BODY_BYTES:
                break
        encoding = response.encoding or "utf-8"
        return status, location, bytes(body).decode(encoding, errors="replace")
    finally:
        response.close()


def recheck_old_vacancies(
    db: sqlite3.Connection,
    now: str,
    client: httpx.Client,
    limiter: Any = None,
    *,
    batch_size: int = 250,
    interval_days: int = 7,
    min_age_days: int = 7,
    confirm_missing_runs: int = 2,
    timeout: int = 20,
    workers: int = 6,
    source_keys: set[str] | None = None,
) -> dict[str, int]:
    """Check a rotating batch; transient failures never close or hide a job."""
    batch_size = max(0, batch_size)
    if batch_size == 0:
        return {"checked": 0, "closed": 0, "restored": 0}

    current = datetime.fromisoformat(now.replace("Z", "+00:00"))
    checked_before = (current - timedelta(days=max(1, interval_days))).astimezone(timezone.utc).isoformat()
    old_before = (current - timedelta(days=max(0, min_age_days))).astimezone(timezone.utc).isoformat()
    query = """
        SELECT source_key, external_id, company, title, url, stale, link_missing_runs
        FROM jobs
        WHERE active=1 AND url != ''
          AND COALESCE(julianday(posted_at), julianday(first_seen_at)) <= julianday(?)
          AND (last_link_check_at IS NULL OR julianday(last_link_check_at) <= julianday(?)
               OR link_missing_runs > 0)
    """
    params: list[Any] = [old_before, checked_before]
    if source_keys is not None:
        if not source_keys:
            return {"checked": 0, "closed": 0, "restored": 0}
        query += f" AND source_key IN ({', '.join('?' for _ in source_keys)})"
        params.extend(sorted(source_keys))
    query += " ORDER BY link_missing_runs DESC, last_link_check_at ASC, first_seen_at ASC LIMIT ?"
    params.append(batch_size)
    rows = db.execute(query, params).fetchall()
    if not rows:
        return {"checked": 0, "closed": 0, "restored": 0}

    max_workers = max(1, min(workers, len(rows)))

    def safe_check(row: sqlite3.Row) -> str | None:
        try:
            return check_vacancy_url(row["url"], timeout, client, limiter)
        except Exception as exc:
            # One malformed URL or unexpected transport failure must not abort catalog sync.
            LOGGER.warning(
                "Проверка вакансии источника %s пропущена (%s)",
                row["source_key"], type(exc).__name__,
            )
            return None

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        outcomes = list(executor.map(safe_check, rows))

    totals = {"checked": len(rows), "closed": 0, "restored": 0}
    with db:
        for row, outcome in zip(rows, outcomes):
            source_key, external_id = row["source_key"], row["external_id"]
            db.execute(
                "UPDATE jobs SET last_link_check_at=? WHERE source_key=? AND external_id=?",
                (now, source_key, external_id),
            )
            if outcome == "active":
                if row["stale"]:
                    db.execute(
                        "UPDATE jobs SET stale=0, stale_at=NULL, link_missing_runs=0 "
                        "WHERE source_key=? AND external_id=?",
                        (source_key, external_id),
                    )
                    record_event(db, _event_job(row), "restored", now)
                    totals["restored"] += 1
                else:
                    db.execute(
                        "UPDATE jobs SET link_missing_runs=0 WHERE source_key=? AND external_id=?",
                        (source_key, external_id),
                    )
            elif outcome == "closed":
                missing_runs = row["link_missing_runs"] + 1
                if missing_runs >= max(1, confirm_missing_runs):
                    db.execute(
                        "UPDATE jobs SET active=0, stale=0, stale_at=NULL, closed_at=?, "
                        "link_missing_runs=?, missing_runs=0 WHERE source_key=? AND external_id=?",
                        (now, missing_runs, source_key, external_id),
                    )
                    record_event(db, _event_job(row), "closed", now)
                    totals["closed"] += 1
                else:
                    db.execute(
                        "UPDATE jobs SET link_missing_runs=? WHERE source_key=? AND external_id=?",
                        (missing_runs, source_key, external_id),
                    )
    return totals


def _event_job(row: sqlite3.Row) -> Job:
    return Job(
        row["source_key"], row["external_id"], row["company"], row["title"],
        "", "", "", "", row["url"], "", "",
    )

