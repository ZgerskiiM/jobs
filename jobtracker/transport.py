"""Reusable HTTP transport primitives for source adapters."""

from __future__ import annotations

import random
import threading
import time
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import urlparse

import httpx


class DomainRequestLimiter:
    """Bound concurrent requests to the same remote host."""

    def __init__(self, max_per_domain: int) -> None:
        self.max_per_domain = max(1, max_per_domain)
        self._lock = threading.Lock()
        self._semaphores: dict[str, threading.BoundedSemaphore] = {}

    @contextmanager
    def acquire(self, url: str) -> Iterator[None]:
        domain = urlparse(url).netloc.casefold() or "unknown"
        with self._lock:
            semaphore = self._semaphores.setdefault(domain, threading.BoundedSemaphore(self.max_per_domain))
        semaphore.acquire()
        try:
            yield
        finally:
            semaphore.release()


def retry_delay(error: Exception, attempt: int) -> float:
    """Use server retry guidance and avoid synchronized retry bursts."""
    delay = min(2 ** attempt, 4) + random.uniform(0, 0.25)
    retry_after = error.response.headers.get("Retry-After") if isinstance(error, httpx.HTTPStatusError) else None
    if retry_after:
        try:
            delay = max(delay, float(retry_after))
        except ValueError:
            pass
    return delay


def create_client(timeout: int, max_connections: int, user_agent: str) -> httpx.Client:
    limits = httpx.Limits(
        max_connections=max(1, max_connections),
        max_keepalive_connections=max(1, max_connections),
        keepalive_expiry=30.0,
    )
    return httpx.Client(
        timeout=httpx.Timeout(timeout), limits=limits, follow_redirects=True,
        headers={"User-Agent": user_agent},
    )


def send_request(
    method: str, url: str, timeout: int, retries: int, headers: dict[str, str] | None,
    content: bytes | None, client: httpx.Client | None, limiter: DomainRequestLimiter | None,
) -> httpx.Response:
    """Send one request with retries, using an optional shared client and limiter."""
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            if limiter is None:
                response = _request(method, url, timeout, headers, content, client)
            else:
                with limiter.acquire(url):
                    response = _request(method, url, timeout, headers, content, client)
            response.raise_for_status()
            return response
        except (httpx.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(retry_delay(exc, attempt))
    raise RuntimeError(f"Не удалось получить {url}: {last_error}")


def _request(
    method: str, url: str, timeout: int, headers: dict[str, str] | None,
    content: bytes | None, client: httpx.Client | None,
) -> httpx.Response:
    if client is not None:
        return client.request(method, url, headers=headers, content=content)
    with httpx.Client(timeout=httpx.Timeout(timeout), follow_redirects=True) as temporary_client:
        return temporary_client.request(method, url, headers=headers, content=content)
