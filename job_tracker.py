#!/usr/bin/env python3
"""Small dependency-free job board tracker for hh.ru, Greenhouse and Lever."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlencode, urljoin, urlparse

import httpx

from jobtracker.models import Job, plain_text, text_value, utc_now
from jobtracker.filters import matches_filters, source_filters
from jobtracker.exports import detect_technologies, export_csv, export_refresh_report, export_site_data, show_stats
from jobtracker import notifications
from jobtracker.storage import connect_db, persist_source, record_event
from jobtracker.adapters_standard import greenhouse_jobs as greenhouse_adapter, lever_jobs as lever_adapter
from jobtracker.adapter_registry import build_registry
from jobtracker.transport import DomainRequestLimiter, create_client, send_request
from jobtracker.vacancy_scoring import (
    DEFAULT_TAXONOMY_PATH,
    VacancyFeatureRepository,
    VacancyIndexingService,
    TaxonomyConfigLoader,
)


USER_AGENT = "job-tracker-mvp/1.0 (+personal job research)"
HH_USER_AGENT = "JobTracker/1.0 (YOUR_EMAIL@example.com)"


HTTP_REQUEST_LIMITER: DomainRequestLimiter | None = None
HTTP_CLIENT: httpx.Client | None = None
HH_ROLE_CACHE: dict[str, list[str]] = {}
HH_ROLE_CACHE_LOCK = threading.Lock()


@contextmanager
def configured_request_limiter(max_per_domain: int):
    global HTTP_REQUEST_LIMITER
    previous = HTTP_REQUEST_LIMITER
    HTTP_REQUEST_LIMITER = DomainRequestLimiter(max_per_domain)
    try:
        yield
    finally:
        HTTP_REQUEST_LIMITER = previous


@contextmanager
def configured_http_client(timeout: int, max_connections: int):
    """Share one connection pool across all source and detail worker threads."""
    global HTTP_CLIENT
    previous = HTTP_CLIENT
    with create_client(timeout, max_connections, USER_AGENT) as client:
        HTTP_CLIENT = client
        try:
            yield
        finally:
            HTTP_CLIENT = previous


def send_http_request(
    method: str, url: str, timeout: int, retries: int,
    headers: dict[str, str] | None = None, content: bytes | None = None,
    client: httpx.Client | None = None,
) -> httpx.Response:
    """Compatibility wrapper around the shared transport layer."""
    return send_request(
        method, url, timeout, retries, headers, content, client or HTTP_CLIENT,
        HTTP_REQUEST_LIMITER,
    )


class SyncAlreadyRunningError(RuntimeError):
    pass


class SyncLock:
    """Cross-process advisory lock for one database synchronization."""

    def __init__(self, db_path: Path) -> None:
        self.path = db_path.with_name(db_path.name + ".sync.lock")
        self.handle: Any | None = None

    def __enter__(self) -> "SyncLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            if os.name == "nt":
                import msvcrt

                self.handle.seek(0)
                if not self.handle.read(1):
                    self.handle.seek(0)
                    self.handle.write("0")
                    self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.handle.close()
            self.handle = None
            raise SyncAlreadyRunningError("Синхронизация уже выполняется в другом процессе.") from exc
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
        if self.handle is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None


def fetch_json(url: str, timeout: int, retries: int, headers: dict[str, str] | None = None) -> Any:
    request_headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    request_headers.update(headers or {})
    response = send_http_request("GET", url, timeout, retries, request_headers)
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Не удалось разобрать JSON от {url}: {exc}") from exc


def post_json(
    url: str, payload: Any, timeout: int, retries: int,
    headers: dict[str, str] | None = None,
) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_headers = {
        "Accept": "application/json", "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    request_headers.update(headers or {})
    response = send_http_request("POST", url, timeout, retries, request_headers, body)
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Не удалось разобрать JSON от {url}: {exc}") from exc


def fetch_text(
    url: str, timeout: int, retries: int, headers: dict[str, str] | None = None,
) -> tuple[str, str]:
    request_headers = {"Accept": "text/html", "User-Agent": USER_AGENT}
    request_headers.update(headers or {})
    response = send_http_request("GET", url, timeout, retries, request_headers)
    return response.text, str(response.url)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "a" and self._href is not None:
            self.links.append((self._href, plain_text(" ".join(self._text))))
            self._href = None
            self._text = []


# Generic career pages often place navigation links alongside vacancy cards. Those
# links can share the same URL prefix as a position, so their text is not a title.
NON_JOB_HTML_LINK_TITLES = {
    "вакансии", "ключевые продукты", "контакты", "согласие", "подробнее",
    "отправить резюме", "как мы живем", "как мы живём", "отзывы сотрудников",
    "стажировка",
}


def is_probable_html_job_title(title: str) -> bool:
    """Return whether a generic HTML-link label can safely be shown as a vacancy."""
    normalized = re.sub(r"\s+", " ", title).strip().casefold()
    return len(normalized) >= 3 and normalized not in NON_JOB_HTML_LINK_TITLES


def clean_html_job_title(source_key: str, title: str) -> str:
    """Remove action labels accidentally appended to titles by career cards."""
    if source_key in {"orionsoft-direct", "tmk-direct"}:
        return re.sub(r"\s+подробнее\s*$", "", title, flags=re.IGNORECASE).strip()
    if source_key == "reksoft-direct":
        # На карточках Рексофта в anchor-текст попадают направление и фильтры вакансии.
        title = re.sub(r"^\s*Промышленная автоматизация\s+", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s+формат\s+.*$", "", title, flags=re.IGNORECASE)
        return title.strip()
    return title.strip()


class FragmentTextParser(HTMLParser):
    BLOCKS = {"p", "div", "section", "h1", "h2", "h3", "h4", "ul", "ol"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.BLOCKS:
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKS or tag == "li":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


def fragment_text(fragment: str) -> str:
    parser = FragmentTextParser()
    parser.feed(fragment)
    return parser.text()


def balanced_element_body(document: str, start_pattern: str, tag: str = "div") -> str:
    start = re.search(start_pattern, document, re.IGNORECASE | re.DOTALL)
    if not start:
        return ""
    open_end = document.find(">", start.start())
    if open_end < 0:
        return ""
    depth = 1
    token_pattern = re.compile(rf"</?{re.escape(tag)}\b[^>]*>", re.IGNORECASE)
    for token in token_pattern.finditer(document, open_end + 1):
        if token.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                return document[open_end + 1:token.start()]
        else:
            depth += 1
    return ""


def first_text(document: str, pattern: str) -> str:
    match = re.search(pattern, document, re.IGNORECASE | re.DOTALL)
    return fragment_text(match.group(1)) if match else ""


def jobposting_jsonld(document: str) -> dict[str, Any]:
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        document, re.IGNORECASE | re.DOTALL,
    )
    for script in scripts:
        try:
            value = json.loads(html.unescape(script).strip())
        except json.JSONDecodeError:
            continue
        candidates = value if isinstance(value, list) else [value]
        if isinstance(value, dict) and isinstance(value.get("@graph"), list):
            candidates.extend(value["@graph"])
        for candidate in candidates:
            if isinstance(candidate, dict) and candidate.get("@type") == "JobPosting":
                return candidate
    return {}


def next_f_json(document: str, key: str) -> Any:
    """Extract a JSON value embedded in a Next.js flight-data script."""
    marker = f'"{key}":'
    decoder = json.JSONDecoder()
    scripts = re.findall(
        r'self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)',
        document,
        re.IGNORECASE | re.DOTALL,
    )
    for encoded in scripts:
        try:
            chunk = json.loads(encoded)
        except json.JSONDecodeError:
            continue
        start = chunk.find(marker)
        if start < 0:
            continue
        try:
            value, _ = decoder.raw_decode(chunk, start + len(marker))
            return value
        except json.JSONDecodeError:
            continue
    return None


def next_data(document: str) -> dict[str, Any]:
    match = re.search(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        document, re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return {}
    try:
        return json.loads(html.unescape(match.group(1)))
    except json.JSONDecodeError:
        return {}


def compiled_mdx_text(value: Any) -> str:
    source = value.get("compiledSource", "") if isinstance(value, dict) else ""
    parts: list[str] = []
    for encoded in re.findall(r'children:\s*"((?:\\.|[^"\\])*)"', source):
        try:
            text = json.loads(f'"{encoded}"')
        except json.JSONDecodeError:
            continue
        if text and text not in parts:
            parts.append(text)
    return "\n".join(parts)


def jsonld_location(posting: dict[str, Any]) -> str:
    locations = posting.get("jobLocation") or []
    locations = locations if isinstance(locations, list) else [locations]
    result: list[str] = []
    for place in locations:
        if not isinstance(place, dict):
            continue
        address = place.get("address") or {}
        if isinstance(address, str):
            result.append(address)
        elif isinstance(address, dict):
            value = address.get("addressLocality") or address.get("addressRegion") or address.get("streetAddress")
            if value:
                result.append(text_value(value))
    if posting.get("jobLocationType") == "TELECOMMUTE":
        result.append("Удалённо")
    return ", ".join(dict.fromkeys(result))


def detailed_sections(document: str) -> str:
    sections: list[str] = []
    title_pattern = re.compile(
        r'<h2[^>]+class="[^"]*details_sectionTitle[^"]*"[^>]*>(.*?)</h2>',
        re.IGNORECASE | re.DOTALL,
    )
    for title_match in title_pattern.finditer(document):
        tail = document[title_match.end():]
        body = balanced_element_body(tail, r'<div[^>]+class="[^"]*details_text[^"]*"[^>]*>')
        text = fragment_text(body)
        if text:
            sections.append(f"{fragment_text(title_match.group(1))}\n{text}")
    return "\n".join(sections)


def generic_job_description(document: str, title: str) -> str:
    """Extract the body of a vacancy page when a source has no structured markup."""
    cleaned = re.sub(
        r"<(?:script|style|noscript|header|nav|footer|aside|form)\b[^>]*>.*?</(?:script|style|noscript|header|nav|footer|aside|form)>",
        "", document, flags=re.IGNORECASE | re.DOTALL,
    )
    candidates = [
        balanced_element_body(cleaned, rf"<{tag}[^>]*>", tag=tag)
        for tag in ("article", "main")
    ]
    candidates.append(cleaned)
    for body in candidates:
        text = fragment_text(body)
        if title:
            matches = list(re.finditer(re.escape(title), text, re.IGNORECASE))
            if matches:
                text = text[matches[-1].end():].strip()
        if len(text) >= 120:
            return text
    return ""


def enrich_direct_job(job: Job, timeout: int, retries: int) -> Job:
    document, _ = fetch_text(job.url, timeout, retries)
    host = urlparse(job.url).hostname or ""
    title, location, team = job.title, job.location, job.team
    workplace_type, description = job.workplace_type, job.description

    posting = jobposting_jsonld(document)
    if posting:
        title = text_value(posting.get("title")) or title
        description = fragment_text(text_value(posting.get("description"))) or description
        location = jsonld_location(posting) or location
        identifier = posting.get("identifier") or {}
        if isinstance(identifier, dict):
            team = text_value(identifier.get("name")) or team
        workplace_type = text_value(posting.get("employmentType")) or workplace_type

    if not description:
        description = generic_job_description(document, title)

    if host == "team.vk.company":
        title = first_text(document, r'<div[^>]+itemprop="title"[^>]*>(.*?)</div>') or title
        description = fragment_text(balanced_element_body(document, r'<div[^>]+itemprop="description"[^>]*>'))
        location = first_text(document, r'<meta[^>]+itemprop="addressLocality"[^>]+content="([^"]+)"') or location
        team = first_text(document, r'<meta[^>]+itemprop="name"[^>]+content="([^"]+)"') or team
        workplace_type = first_text(
            document, r'Формат работы</h4>.*?<div class="vacancy-tag">(.*?)</div>'
        ) or workplace_type
    elif host == "careers.kaspersky.ru":
        title = first_text(document, r'<h1[^>]+data-testid="vacancy-title"[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(document, r'<div[^>]+data-testid="vacancy-body"[^>]*>'))
        category = first_text(document, r'<span[^>]+data-testid="vacancy-tag-category-[^"]+"[^>]*>(.*?)</span>')
        cities = [fragment_text(value) for value in re.findall(
            r'<span[^>]+data-testid="vacancy-tag-city-[^"]+"[^>]*>(.*?)</span>', document, re.IGNORECASE | re.DOTALL
        )]
        team = category or team
        location = ", ".join(dict.fromkeys(value for value in cities if value)) or location
    elif host == "www.aviasales.ru":
        main = fragment_text(balanced_element_body(document, r'<main[^>]*>', tag="main"))
        lines = main.splitlines()
        if "Все вакансии" in lines:
            start = lines.index("Все вакансии") + 1
            title = lines[start] if len(lines) > start else title
            team = lines[start + 1] if len(lines) > start + 1 else team
        description = main or description
        workplace_type = "Удалённо"
    elif host == "hr.tochka.com":
        tags = [fragment_text(value) for value in re.findall(
            r'<[^>]+class="[^"]*main-info_tagText[^"]*"[^>]*>(.*?)</[^>]+>',
            document, re.IGNORECASE | re.DOTALL,
        )]
        tags = [value for value in tags if value]
        team = tags[0] if tags else team
        location_tag = next((value for value in tags if "удал" in value.casefold() or "гибрид" in value.casefold()), "")
        location = location_tag or location
        workplace_type = location_tag or workplace_type
        description = detailed_sections(document) or description
    elif host == "digital.alfabank.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        encoded_description = re.search(
            r'"descriptionText":"((?:\\.|[^"\\])*)"', document, re.IGNORECASE | re.DOTALL
        )
        if encoded_description:
            try:
                description = json.loads(f'"{encoded_description.group(1)}"') or description
            except json.JSONDecodeError:
                pass
        city = re.search(
            r'"city":\{"name":"((?:\\.|[^"\\])*)"', document, re.IGNORECASE | re.DOTALL
        )
        if city:
            try:
                location = json.loads(f'"{city.group(1)}"') or location
            except json.JSONDecodeError:
                pass
    elif host == "bft.ru":
        title = first_text(
            document, r'<h2[^>]+class=["\'][^"\']*vacanciesHeader-contnet__subtitle[^"\']*["\'][^>]*>(.*?)</h2>'
        ) or title
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class=["\'][^"\']*text-content[^"\']*["\'][^>]*>'
        )) or description
    elif host == "vkusvill.ru":
        title = first_text(
            document,
            r'<h1[^>]+class="[^"]*VV21_VacancyDetail__Title[^"]*"[^>]*>(.*?)</h1>',
        ) or title
        location = first_text(document, r'data-address="([^"]+)"') or location
        team = first_text(document, r'data-group="([^"]+)"') or team
        description = fragment_text(balanced_element_body(
            document,
            r'<section[^>]+class="[^"]*VV21_VacancyDetail__Section[^"]*_desc[^"]*"[^>]*>',
            tag="section",
        )) or description
        if location:
            title = re.sub(rf"\s*[-—]\s*{re.escape(location)}\s*$", "", title).strip()
    elif host == "x5.tech":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*VacancyPage_vacancyContent[^"]*"[^>]*>',
        )) or description
        badges = balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*VacancyPage_formatBadge[^"]*"[^>]*>',
        )
        values = [fragment_text(value) for value in re.findall(
            r'<span[^>]*>(.*?)</span>', badges, re.IGNORECASE | re.DOTALL,
        )]
        work_values = {"офис", "гибрид", "удаленно", "удалённо"}
        workplace_type = next(
            (value for value in values if value.casefold() in work_values), workplace_type
        )
        location = next(
            (value for value in values if value.casefold() not in work_values), location
        )
    elif host == "ptsecurity.com":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<article[^>]*>', tag="article",
        )) or description
    elif host == "job.nexign.com":
        title = first_text(
            document,
            r'<div[^>]+class="[^"]*vacancy-details__title[^"]*"[^>]*>\s*<h2[^>]*>(.*?)</h2>',
        ) or title
        location_block = balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancy-details__location[^"]*"[^>]*>',
        )
        location = fragment_text(location_block) or location
        intro = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancy-details__description[^"]*"[^>]*>',
        ))
        content = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancy-details__content[^"]*"[^>]*>',
        ))
        description = "\n".join(value for value in (intro, content) if value) or description
        if "/jobs/java/" in job.url:
            team = "Разработка Java"
    elif host == "jet.su":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        metadata = {
            plain_text(label).rstrip(":"): plain_text(value)
            for label, value in re.findall(
                r'<div[^>]+class="[^"]*vacancies-detailed-base__title[^"]*"[^>]*>(.*?)</div>'
                r'.*?<div[^>]+class="[^"]*vacancies-detailed-base__desc[^"]*"[^>]*>(.*?)</div>',
                document, re.IGNORECASE | re.DOTALL,
            )
        }
        team = metadata.get("Направление", team)
        location = metadata.get("Город", location)
        description = fragment_text(balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*vacancies-detailed-main[^"]*"[^>]*>',
        )) or description
    elif host == "sberdevices.ru":
        title = first_text(
            document,
            r'<div[^>]+class="[^"]*TitleVacancy__Title[^"]*"[^>]*>(.*?)</div>\s*</div>',
        ) or title
        title = re.sub(r"^Я\s*[—-]\s*", "", title, flags=re.IGNORECASE).strip()
        about = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*Vacancy__StyledInSberdevices[^"]*"[^>]*>',
        ))
        details = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*VacancyInfo__StyledVacancyInfo[^"]*"[^>]*>',
        ))
        description = "\n".join(value for value in (about, details) if value) or description
    elif host == "career.infotecs.ru":
        title = first_text(
            document, r'<h1[^>]+class="[^"]*b-vacancy__title[^"]*"[^>]*>(.*?)</h1>',
        ) or title
        location = first_text(
            document, r'<div[^>]+class="[^"]*b-vacancy__city[^"]*"[^>]*>(.*?)</div>',
        ) or location
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*b-vacancy__text[^"]*"[^>]*>',
        )) or description
    elif host == "career.gazprom-neft.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        article = balanced_element_body(
            document, r'<article[^>]+class="[^"]*article[^"]*"[^>]*>', tag="article",
        )
        description = fragment_text(article) or description
        location = first_text(
            article, r'<li[^>]+class="[^"]*location[^"]*"[^>]*>(.*?)</li>',
        ) or location
        workplace_type = first_text(
            article, r'<li[^>]+class="[^"]*contract[^"]*"[^>]*>(.*?)</li>',
        ) or workplace_type
    elif host == "careers.croc.ru":
        title = first_text(
            document, r'<div[^>]+class="[^"]*vacancy-detail__content-main[^"]*"[^>]*>.*?<h1[^>]*>(.*?)</h1>',
        ) or title
        description = fragment_text(balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*vacancy-detail__content-main-text-block[^"]*"[^>]*>',
        )) or description
        team = first_text(
            document, r'<a[^>]+class="[^"]*vacancy-detail__breadcrumbs[^"]*"[^>]*>(.*?)</a>',
        ) or team
        tags = [fragment_text(value) for value in re.findall(
            r'<li[^>]+class="[^"]*bg-color-light_blue[^"]*"[^>]*>(.*?)</li>',
            document, re.IGNORECASE | re.DOTALL,
        )]
        locations = [value for value in tags if value in {"Москва", "Санкт-Петербург", "Удаленно по РФ"}]
        location = ", ".join(dict.fromkeys(locations)) or location
        workplace_type = ", ".join(
            value for value in tags if "занятост" in value.casefold() or "удален" in value.casefold()
        ) or workplace_type
    elif host == "ibs.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*job__description[^"]*"[^>]*>',
        )) or description
        location = first_text(
            document, r'<div[^>]+class="[^"]*content-date[^"]*"[^>]*>(.*?)</div>',
        ) or location
        tags_block = balanced_element_body(
            document, r'<div[^>]+class="[^"]*job__tags[^"]*"[^>]*>',
        )
        tags = [fragment_text(value) for value in re.findall(
            r'<span[^>]*>(.*?)</span>', tags_block, re.IGNORECASE | re.DOTALL,
        )]
        if tags:
            team = ", ".join(value for value in tags if value and value not in {"·", location}) or team
        if "удален" in location.casefold():
            workplace_type = "Удалённо"
    elif host == "gazprom-auto.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        team = first_text(
            document,
            r'<main[^>]+class="[^"]*styles_root__qmjSq[^"]*"[^>]*>.*?'
            r'<button[^>]*>.*?</button>\s*<span[^>]*>(.*?)</span>',
        ) or team
        sections = [fragment_text(value) for value in re.findall(
            r'<div[^>]+data-scrape="rich"[^>]*>(.*?)</div>',
            document, re.IGNORECASE | re.DOTALL,
        )]
        description = "\n".join(value for value in sections if value) or description
    elif host == "career.domclick.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        encoded_description = re.search(
            r'"description":"((?:\\.|[^"\\])*)","branded_description"',
            document, re.IGNORECASE | re.DOTALL,
        )
        if encoded_description:
            try:
                full_description = json.loads(f'"{encoded_description.group(1)}"')
                description = fragment_text(full_description) or description
            except json.JSONDecodeError:
                pass
        badges = [fragment_text(value) for value in re.findall(
            r'<span[^>]+class="[^"]*bdg-[^"]*"[^>]*>(.*?)</span>',
            document, re.IGNORECASE | re.DOTALL,
        )]
        workplace_values = [
            value for value in badges if value.casefold() in {"офис", "удалёнка", "удаленка", "гибрид"}
        ]
        workplace_type = ", ".join(dict.fromkeys(workplace_values)) or workplace_type
    elif host == "career.nlmk.com":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*specialist__right-block-text[^"]*"[^>]*>',
        )) or description
        metadata = {
            fragment_text(label).rstrip(":"): fragment_text(value)
            for label, value in re.findall(
                r'<span[^>]+class="[^"]*specialist__span-left[^"]*"[^>]*>(.*?)</span>'
                r'.*?<span[^>]+class="[^"]*specialist__span-right[^"]*"[^>]*>(.*?)</span>',
                document, re.IGNORECASE | re.DOTALL,
            )
        }
        enterprise = metadata.get("Предприятие", "")
        if enterprise:
            location = enterprise.split(",", 1)[0].strip() or location
            team = enterprise.split(",", 1)[-1].strip() or team
        workplace_type = metadata.get("График", workplace_type)
    elif host == "vacancies.skyeng.ru":
        title = first_text(
            document, r'<h1[^>]+class="[^"]*vacancy-page-title[^"]*"[^>]*>(.*?)</h1>',
        ) or title
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancy-content[^"]*"[^>]*>',
        )) or description
        workplace_type = first_text(
            document, r'<[^>]+class="[^"]*vacancy-info[^"]*"[^>]*>.*?(Удал[её]нно|Гибрид|Офис)',
        ) or workplace_type
    elif host == "icl.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document,
            r'<div[^>]+class="[^"]*user-content--vacancy[^"]*"[^>]*>',
        )) or description
        location = first_text(
            document,
            r'<[^>]+class="[^"]*vacancy-about__info-salary-city[^"]*"[^>]*>(.*?)</[^>]+>',
        ) or location
        location = re.sub(r"^Город\s*", "", location, flags=re.IGNORECASE).strip()
    elif host == "team.rt-solar.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancies-details-body[^"]*"[^>]*>',
        )) or description
    elif host == "job.haulmont.ru":
        vacancy_block = balanced_element_body(
            document, r'<div[^>]+class="[^"]*vacancy-slug[^"]*"[^>]*>',
        )
        title = first_text(vacancy_block, r'<h2[^>]+class="[^"]*title[^"]*"[^>]*>(.*?)</h2>') or title
        team = first_text(vacancy_block, r'<h3[^>]+class="[^"]*sub-title[^"]*"[^>]*>(.*?)</h3>') or team
        location = first_text(
            vacancy_block, r'<img[^>]+alt="Адрес"[^>]*>.*?<span[^>]*>(.*?)</span>',
        ) or location
        description = fragment_text(vacancy_block) or description
    elif host == "www.simbirsoft.com":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<section[^>]+class="[^"]*is-style[^"]*"[^>]*>', tag="section",
        )) or description
        location = first_text(
            document,
            r'<div[^>]+class="[^"]*l-key[^"]*"[^>]*>\s*Местоположение\s*</div>'
            r'.*?<div[^>]+class="[^"]*l-value[^"]*"[^>]*>(.*?)</div>',
        ) or location
        if "удал" in location.casefold():
            workplace_type = "Удалённо"
    elif host == "softline.ru":
        title = first_text(
            document, r'<div[^>]+class=["\'][^"\']*vacancy__title[^"\']*["\'][^>]*>.*?<h2[^>]*>(.*?)</h2>',
        ) or title
        description = fragment_text(balanced_element_body(
            document, r'<div[^>]+class=["\'][^"\']*vacancy__text[^"\']*["\'][^>]*>',
        )) or description
        location = first_text(
            document, r'<div[^>]+class=["\'][^"\']*city-wrapper[^"\']*["\'][^>]*>.*?<p[^>]*>(.*?)</p>',
        ) or location
        team = first_text(
            document, r'<div[^>]+class=["\'][^"\']*vacancy__tags[^"\']*["\'][^>]*>.*?<span[^>]+class=["\'][^"\']*search-term__text[^"\']*["\'][^>]*>(.*?)</span>',
        ) or team
    elif host == "job.glowbyteconsulting.com":
        page_title = first_text(document, r'<title[^>]*>(.*?)</title>')
        page_title = re.sub(r"^GlowByte\s*[-—]\s*", "", page_title).strip()
        title = page_title or first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        without_code = re.sub(
            r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', "", document,
            flags=re.IGNORECASE | re.DOTALL,
        )
        page_text = fragment_text(without_code)
        start = page_text.casefold().find(title.casefold()) if title else -1
        if start >= 0:
            page_text = page_text[start + len(title):].strip()
        end_markers = ("Присоединяйся к команде GlowByte", "ПОДПИСЫВАЙТЕСЬ")
        end_positions = [page_text.find(marker) for marker in end_markers if marker in page_text]
        if end_positions:
            page_text = page_text[:min(end_positions)].strip()
        description = page_text or description
    elif host == "bellintegrator.ru":
        title = first_text(document, r'<h1[^>]+class=["\'][^"\']*fs-1[^"\']*["\'][^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<article[^>]+class=["\'][^"\']*node--type-vakansiya[^"\']*["\'][^>]*>'
        )) or description
    elif host == "rabota.grandline.ru":
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or title
        description = fragment_text(balanced_element_body(
            document, r'<section[^>]+id=["\']content["\'][^>]*>', tag="section",
        )) or description
        location = first_text(
            document, r'<dt>\s*Город\s*</dt>\s*<dd[^>]*>(.*?)</dd>',
        ) or location

    if not description:
        return job
    return Job(
        source_key=job.source_key, external_id=job.external_id, company=job.company,
        title=title, location=location, team=team, workplace_type=workplace_type,
        description=description, url=job.url, posted_at=job.posted_at,
        source_updated_at=job.source_updated_at,
    )


def jet_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    base = source.get("url", "https://jet.su/career/vacancies/")
    summaries: dict[str, Job] = {}
    for page in range(1, max(2, int(source.get("max_pages", 10))) + 1):
        url = base if page == 1 else f"{base}?page={page}"
        document, final_url = fetch_text(url, timeout, retries)
        page_ids: set[str] = set()
        for href in re.findall(
            r'<a\b[^>]+href=["\']([^"\']+/career/vacancies/[^"\']+/|/career/vacancies/[^"\']+/)["\']',
            document, re.IGNORECASE,
        ):
            absolute = urljoin(final_url, href)
            external_id = urlparse(absolute).path.rstrip("/").rsplit("/", 1)[-1]
            if external_id in {"vacancies", ""}:
                continue
            page_ids.add(external_id)
            summaries[external_id] = Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=external_id, location="", team="", workplace_type="", description="",
                url=absolute, posted_at="", source_updated_at="",
            )
        if not page_ids or page > 1 and page_ids.issubset(set(summaries) - page_ids):
            break
        if f"?page={page + 1}" not in document and page >= 3:
            break

    minimum = max(1, int(source.get("min_expected_jobs", 10)))
    if len(summaries) < minimum:
        raise RuntimeError(f"Jet вернул {len(summaries)} вакансий, меньше защитного порога {minimum}")

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in summaries.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек Jet осталось {len(result)} вакансий")
    return result


def sibur_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    base = source.get("url", "https://career.sibur.ru/vacancies/")
    document, _ = fetch_text(base, timeout, retries)
    documents = [document]
    for page in range(2, max(2, int(source.get("max_pages", 20))) + 1):
        payload = fetch_json(
            f"{base}?show-more={page}", timeout, retries,
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        content = text_value((payload.get("body") or {}).get("content"))
        if not re.search(r'class="[^"]*vacancy-card', content, re.IGNORECASE):
            break
        documents.append(content)
    summaries: dict[str, Job] = {}
    for content in documents:
        for href in re.findall(
            r'<a\b[^>]+class="[^"]*vacancy-card__main-link[^"]*"[^>]+href="([^"]+)"',
            content, re.IGNORECASE,
        ):
            absolute = urljoin(base, href)
            external_id = urlparse(absolute).path.rstrip("/").rsplit("/", 1)[-1]
            summaries[external_id] = Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=external_id, location="", team="", workplace_type="", description="",
                url=absolute, posted_at="", source_updated_at="",
            )
    minimum = max(1, int(source.get("min_expected_jobs", 30)))
    if len(summaries) < minimum:
        raise RuntimeError(f"СИБУР вернул {len(summaries)} вакансий, меньше защитного порога {minimum}")
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in summaries.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек СИБУРа осталось {len(result)} вакансий")
    return result


def cft_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    base = source.get("url", "https://job.cft.ru/")
    document, _ = fetch_text(base, timeout, retries)
    props = ((next_data(document).get("props") or {}).get("pageProps") or {})
    summaries: list[dict[str, Any]] = []
    for block in props.get("blocks", []):
        data = block.get("data") or {}
        if isinstance(data.get("vacancies"), list):
            summaries.extend(data["vacancies"])
    summaries = list({text_value(item.get("id")): item for item in summaries}.values())
    minimum = max(1, int(source.get("min_expected_jobs", 1)))
    if len(summaries) < minimum:
        raise RuntimeError(f"ЦФТ вернул {len(summaries)} вакансий, меньше защитного порога {minimum}")

    def load(summary: dict[str, Any]) -> Job:
        external_id = text_value(summary.get("id"))
        detail_url = urljoin(base, external_id)
        detail_document, _ = fetch_text(detail_url, timeout, retries)
        detail_props = ((next_data(detail_document).get("props") or {}).get("pageProps") or {})
        vacancy: dict[str, Any] = {}
        for block in detail_props.get("blocks", []):
            if block.get("__typename") == "ComponentBlocksVacancyContent":
                vacancy = block.get("data") or {}
                break
        attributes = vacancy.get("attributes") or summary.get("attributes") or {}
        city = ((attributes.get("city") or {}).get("data") or {}).get("attributes") or {}
        field = ((attributes.get("professionalField") or {}).get("data") or {}).get("attributes") or {}
        specialization = ((field.get("specialization") or {}).get("data") or {}).get("attributes") or {}
        grade = ((attributes.get("grade") or {}).get("data") or {}).get("attributes") or {}
        description_parts = []
        for key in ("mdxAboutUs", "mdxTechnologyStack", "mdxSkills", "mdxResponsibilities", "mdxBenefits"):
            value = compiled_mdx_text(attributes.get(key))
            if value:
                description_parts.append(value)
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(attributes.get("title")), location=text_value(city.get("name")),
            team=text_value(specialization.get("title") or specialization.get("name")),
            workplace_type=text_value(grade.get("title") or grade.get("name")),
            description="\n".join(description_parts), url=detail_url,
            posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 4)))) as executor:
        futures = [executor.submit(load, item) for item in summaries]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек ЦФТ осталось {len(result)} вакансий")
    return result


def itone_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://www.it-one.ru/api/entities/vacancy")
    take = max(1, int(source.get("take", 200)))
    items = fetch_json(f"{api}?skip=0&take={take}", timeout, retries)
    if len(items) >= take:
        raise RuntimeError("IT_ONE достиг лимита одной страницы; требуется пагинация")
    minimum = max(1, int(source.get("min_expected_jobs", 30)))
    if len(items) < minimum:
        raise RuntimeError(f"IT_ONE вернул {len(items)} вакансий, меньше защитного порога {minimum}")

    def load(item: dict[str, Any]) -> Job:
        detail_url = urljoin("https://www.it-one.ru/", text_value(item.get("url")))
        document, final_url = fetch_text(detail_url, timeout, retries)
        title = first_text(document, r'<h1[^>]*>(.*?)</h1>') or text_value(item.get("name"))
        article = balanced_element_body(
            document, r'<section[^>]+class="[^"]*article[^"]*card[^"]*"[^>]*>', tag="section",
        )
        description = fragment_text(balanced_element_body(
            article, r'<div[^>]+class="[^"]*body[^"]*"[^>]*>',
        )) or text_value(item.get("preview"))
        return Job(
            source_key=source["key"], external_id=text_value(item.get("id")),
            company=source["company"], title=title,
            location=text_value(item.get("city")), team=text_value(item.get("specialization")),
            workplace_type=text_value(item.get("position")), description=description,
            url=final_url, posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(load, item) for item in items]
        for future in as_completed(futures):
            job = future.result()
            if job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек IT_ONE осталось {len(result)} вакансий")
    return result


def sberdevices_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://sberdevices.ru/career/")
    document, final_url = fetch_text(listing_url, timeout, retries)
    jobs: dict[str, Job] = {}
    for href in re.findall(r'href=["\']([^"\']*/career/[^"\']+/)["\']', document, re.IGNORECASE):
        absolute = urljoin(final_url, html.unescape(href))
        path = urlparse(absolute).path.rstrip("/")
        external_id = path.rsplit("/", 1)[-1]
        if not external_id or external_id.casefold() == "career" or path.endswith("/interview"):
            continue
        jobs[external_id] = Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=external_id, location="", team="", workplace_type="", description="",
            url=absolute, posted_at="", source_updated_at="",
        )
    minimum = max(1, int(source.get("min_expected_jobs", 5)))
    if len(jobs) < minimum:
        raise RuntimeError(
            f"SberDevices вернул {len(jobs)} вакансий, меньше защитного порога {minimum}"
        )
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 6)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in jobs.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек SberDevices осталось {len(result)} вакансий")
    return result


def infotecs_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://career.infotecs.ru/")
    jobs: dict[str, Job] = {}
    for page in range(1, max(2, int(source.get("max_pages", 10))) + 1):
        url = listing_url if page == 1 else f"{listing_url}?PAGEN_1={page}"
        document, final_url = fetch_text(url, timeout, retries)
        rows = re.findall(
            r'<tr[^>]+class="[^"]*b-career-vacancy-list__row[^"]*"[^>]*>(.*?)</tr>',
            document, re.IGNORECASE | re.DOTALL,
        )
        page_count = 0
        for row in rows:
            href_match = re.search(r'href=["\']([^"\']*/vacancy/[^"\']+/)["\']', row, re.IGNORECASE)
            if not href_match:
                continue
            absolute = urljoin(final_url, href_match.group(1))
            external_id = urlparse(absolute).path.rstrip("/").rsplit("/", 1)[-1]
            title = first_text(
                row, r'<td[^>]+class="[^"]*b-career-vacancy-list__name[^"]*"[^>]*>(.*?)</td>',
            )
            location = first_text(
                row, r'<td[^>]+class="[^"]*b-career-vacancy-list__city[^"]*"[^>]*>(.*?)</td>',
            )
            team = first_text(
                row, r'<td[^>]+class="[^"]*b-career-vacancy-list__direction[^"]*"[^>]*>(.*?)</td>',
            )
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=title or external_id, location=location, team=team,
                workplace_type="", description="", url=absolute,
                posted_at="", source_updated_at="",
            )
            page_count += 1
        quantity_match = re.search(
            r'class="paginator__quantity"[^>]*>\s*(\d+)', document, re.IGNORECASE,
        )
        page_total = int(quantity_match.group(1)) if quantity_match else 1
        if not page_count or page >= page_total:
            break
    minimum = max(1, int(source.get("min_expected_jobs", 15)))
    if len(jobs) < minimum:
        raise RuntimeError(f"ИнфоТеКС вернул {len(jobs)} вакансий, меньше порога {minimum}")
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in jobs.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек ИнфоТеКС осталось {len(result)} вакансий")
    return result


def nornickel_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://career.nornickel.ru/api/vacancies/get/")
    jobs: dict[str, Job] = {}
    page = 1
    while page <= max(1, int(source.get("max_pages", 20))):
        payload = {
            "q": "", "sort": "desc", "page": page,
            "filter": {
                "AreaActivity": ["it"],
                "OrganizationUnits": [source.get("organization_unit", "sputnik")],
            },
        }
        response = post_json(api, payload, timeout, retries)
        items = response.get("items") or []
        for item in items:
            detail_url = urljoin("https://career.nornickel.ru/", text_value(item.get("url")))
            external_id = urlparse(detail_url).path.rstrip("/").split("/")[-1]
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id,
                company=source["company"], title=plain_text(item.get("title")),
                location=plain_text(item.get("location")), team="IT",
                workplace_type=plain_text(item.get("timetable")), description="",
                url=detail_url, posted_at=text_value(item.get("date")), source_updated_at="",
            )
        count = int(response.get("count") or 0)
        if not items or len(jobs) >= count:
            break
        page += 1
    return list(jobs.values())


def croc_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://careers.croc.ru/vacancies/")
    document, final_url = fetch_text(listing_url, timeout, retries)
    section_ids = list(dict.fromkeys(re.findall(
        r'<option[^>]+value=["\']?(\d+)["\']?[^>]*>', document, re.IGNORECASE,
    )))
    documents = [document]
    for section_id in section_ids:
        section_document, _ = fetch_text(f"{listing_url}?sections={section_id}", timeout, retries)
        documents.append(section_document)
    jobs: dict[str, Job] = {}
    for page in documents:
        for href in re.findall(
            r'href=["\'](/vacancies/([^"\'/?#]+)/?)["\']', page, re.IGNORECASE,
        ):
            external_id = href[1]
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id,
                company=source["company"], title=external_id, location="", team="",
                workplace_type="", description="", url=urljoin(final_url, href[0]),
                posted_at="", source_updated_at="",
            )
    minimum = max(1, int(source.get("min_expected_jobs", 40)))
    if len(jobs) < minimum:
        raise RuntimeError(f"КРОК вернул {len(jobs)} вакансий, меньше порога {minimum}")
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in jobs.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек КРОК осталось {len(result)} вакансий")
    return result


def mts_bank_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://job.mtsbank.ru/api/career/vacancies")
    limit = max(1, int(source.get("limit", 500)))
    query = urlencode([
        ("sort", "publishedAt:desc"),
        ("pagination[start]", 0),
        ("pagination[limit]", limit),
        ("populate", "name"),
        ("populate", "externalPublicationDate"),
        ("populate", "vacancy"),
        ("populate", "location"),
        ("populate", "specialization"),
    ])
    payload = fetch_json(f"{api}/compact?{query}", timeout, retries)
    items = payload.get("data") or []
    total = int((payload.get("meta") or {}).get("total") or 0)
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(items) < minimum or len(items) < total:
        raise RuntimeError(
            f"МТС Финтех вернул {len(items)} из {total} вакансий, "
            f"защитный порог {minimum}"
        )

    def load_detail(item: dict[str, Any]) -> Job:
        external_id = text_value(item.get("id"))
        detail = fetch_json(f"{api}/{external_id}?populate=*", timeout, retries)
        attributes = ((detail.get("data") or {}).get("attributes") or {})
        location_data = item.get("location") or {}
        specialization = item.get("specialization") or {}
        description = "\n".join(
            text_value(attributes.get(key))
            for key in ("introduction", "duties", "requirements", "conditions")
            if attributes.get(key)
        )
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(attributes.get("name")) or text_value(item.get("name")),
            location=text_value(location_data.get("shortName")) or text_value(location_data.get("name")),
            team=text_value(specialization.get("name")), workplace_type="",
            description=description, url=f"https://job.mtsbank.ru/vacancies/{external_id}",
            posted_at=text_value(attributes.get("externalPublicationDate"))
                or text_value(item.get("externalPublicationDate")),
            source_updated_at=text_value(attributes.get("updatedAt")),
        )

    jobs: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(load_detail, item) for item in items]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                jobs.append(job)
    if len(jobs) < minimum:
        raise RuntimeError(f"После загрузки карточек МТС Финтех осталось {len(jobs)} вакансий")
    return jobs


def nlmk_it_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://career.nlmk.com/vacancy/list.php")
    document, final_url = fetch_text(listing_url, timeout, retries)
    enterprise_name = source.get("enterprise", "НЛМК-Информационные технологии")
    jobs: dict[str, Job] = {}
    for block in document.split('<div class="vacancies-item">')[1:]:
        link_match = re.search(
            r'href="(/vacancy/detail/([^"/#?]+)/?)"[^>]*>\s*<h5[^>]*>(.*?)</h5>',
            block, re.IGNORECASE | re.DOTALL,
        )
        if not link_match:
            continue
        values = [fragment_text(value) for value in re.findall(
            r'<div[^>]+class="[^"]*vacancies-item__elem[^"]*"[^>]*>(.*?)</div>',
            block, re.IGNORECASE | re.DOTALL,
        )[:3]]
        if len(values) < 2 or values[1] != enterprise_name:
            continue
        external_id = link_match.group(2)
        jobs[external_id] = Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=fragment_text(link_match.group(3)), location=values[0], team=values[1],
            workplace_type="", description="", url=urljoin(final_url, link_match.group(1)),
            posted_at=values[2] if len(values) > 2 else "", source_updated_at="",
        )
    minimum = max(1, int(source.get("min_expected_jobs", 3)))
    if len(jobs) < minimum:
        raise RuntimeError(f"НЛМК ИТ вернул {len(jobs)} вакансий, меньше порога {minimum}")
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in jobs.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек НЛМК ИТ осталось {len(result)} вакансий")
    return result


def astra_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://astra.ru/about/career/vacancies/")
    document, _ = fetch_text(listing_url, timeout, retries)
    array_start = document.find("items:[{")
    array_end = document.find("\n  });", array_start)
    if array_start < 0 or array_end < 0:
        raise RuntimeError("Группа Астра: встроенный список вакансий не найден")
    payload = document[array_start + len("items:"):array_end]
    positions = [match.start() for match in re.finditer(r"\{'ID':'", payload)]

    def field(record: str, name: str) -> str:
        match = re.search(
            rf"'{re.escape(name)}':'((?:\\.|[^'\\])*)'", record, re.DOTALL,
        )
        if not match:
            return ""
        value = match.group(1)
        value = value.replace(r"\/", "/").replace(r"\'", "'")
        value = value.replace(r"\r", "\r").replace(r"\n", "\n").replace(r"\t", "\t")
        value = value.replace(r"\\", "\\")
        return html.unescape(value)

    jobs: list[Job] = []
    for index, position in enumerate(positions):
        end = positions[index + 1] if index + 1 < len(positions) else len(payload)
        record = payload[position:end]
        external_id = field(record, "ID")
        title = field(record, "NAME")
        description = fragment_text(field(record, "DETAIL_TEXT"))
        area_match = re.search(
            r"'area':\{'id':'[^']*','name':'((?:\\.|[^'\\])*)'", record, re.DOTALL,
        )
        subdir_match = re.search(
            r"'subDir':\{'id':'[^']*','name':'((?:\\.|[^'\\])*)'", record, re.DOTALL,
        )
        direction_match = re.search(
            r"'Dir':\{'id':'[^']*','name':'((?:\\.|[^'\\])*)'", record, re.DOTALL,
        )
        team = " / ".join(
            html.unescape(match.group(1))
            for match in (direction_match, subdir_match) if match
        )
        if external_id and title and description:
            jobs.append(Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=title, location=html.unescape(area_match.group(1)) if area_match else field(record, "city"),
                team=team, workplace_type="", description=description,
                url=listing_url, posted_at=field(record, "date"), source_updated_at="",
            ))
    minimum = max(1, int(source.get("min_expected_jobs", 40)))
    if len(jobs) < minimum:
        raise RuntimeError(f"Группа Астра вернула {len(jobs)} вакансий, меньше порога {minimum}")
    return jobs


def simbirsoft_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://www.simbirsoft.com/vacancies/")
    api_url = source.get("api_url", "https://www.simbirsoft.com/ajax/vacancy/")
    jobs: dict[str, Job] = {}
    for page in range(1, max(2, int(source.get("max_pages", 5))) + 1):
        url = f"{api_url}?{urlencode({'page': page})}"
        document, _ = fetch_text(url, timeout, retries, {
            "Accept": "text/html", "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest", "Referer": listing_url,
        })
        page_jobs = 0
        for href, slug, title in re.findall(
            r'<a[^>]+class="[^"]*l-item[^"]*"[^>]+href="(/vacancies/([^"/]+)/)"[^>]*>'
            r'.*?<div[^>]+class="[^"]*l-item-name[^"]*"[^>]*>(.*?)</div>',
            document, re.IGNORECASE | re.DOTALL,
        ):
            external_id = slug
            if external_id not in jobs:
                page_jobs += 1
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=fragment_text(title), location="", team="", workplace_type="",
                description="", url=urljoin(listing_url, href), posted_at="", source_updated_at="",
            )
        if page > 1 and page_jobs == 0:
            break
    minimum = max(1, int(source.get("min_expected_jobs", 10)))
    if len(jobs) < minimum:
        raise RuntimeError(f"SimbirSoft вернул {len(jobs)} вакансий, меньше порога {minimum}")
    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(enrich_direct_job, job, timeout, retries) for job in jobs.values()]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                result.append(job)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек SimbirSoft осталось {len(result)} вакансий")
    return result


def lemana_tech_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get(
        "api_url", "https://rabota-api.lemanapro.ru/api/rest/vacancy/vacancies",
    )
    limit = max(1, int(source.get("limit", 100)))
    response = fetch_json(f"{api}?typeOfWork=IT&skip=0&limit={limit}", timeout, retries)
    items = response.get("entries") or []
    count = int(response.get("count") or 0)
    if count > limit or len(items) < min(count, int(source.get("min_expected_jobs", 1))):
        raise RuntimeError(f"Лемана Тех: получено {len(items)} из {count} вакансий")
    result: list[Job] = []
    for item in items:
        data = item.get("data") or {}
        workplace = ((item.get("workPlace") or {}).get("data") or {})
        geo = workplace.get("geo") or {}
        description = "\n".join(
            fragment_text(text_value(data.get(key)))
            for key in ("description", "duties", "requirements", "conditions")
            if data.get(key)
        )
        result.append(Job(
            source_key=source["key"], external_id=text_value(item.get("id")),
            company=source["company"], title=text_value(data.get("title")),
            location=text_value(geo.get("city")), team="IT",
            workplace_type=text_value(data.get("schedule")), description=description,
            url=f"https://rabota.lemanapro.ru/vacancy/{item.get('id')}",
            posted_at=text_value(item.get("publishedAt")),
            source_updated_at=text_value(item.get("updatedAt")),
        ))
    return result


def sber_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://developers.sber.ru/kak-v-sbere/vacancies")
    document, final_url = fetch_text(listing_url, timeout, retries)
    links: dict[str, str] = {}
    for href in re.findall(
        r'href=["\'](/kak-v-sbere/vacancies/([^"\'/?#]+))["\']', document, re.IGNORECASE,
    ):
        links[href[1]] = urljoin(final_url, href[0])
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(links) < minimum:
        raise RuntimeError(f"Сбер вернул {len(links)} карточек, меньше порога {minimum}")

    def load(external_id: str, url: str) -> Job:
        detail, detail_url = fetch_text(url, timeout, retries)
        props = ((next_data(detail).get("props") or {}).get("pageProps") or {})
        raw = props.get("raw") or props.get("page") or {}
        competencies = ((raw.get("VacancyDescription") or {}).get("Competencies") or [])
        stack = [text_value(value.get("Title")) for value in raw.get("tech_stacks") or []]
        description_parts = [text_value(raw.get("Description"))]
        description_parts.extend(text_value(value.get("Text")) for value in competencies)
        if stack:
            description_parts.append("Стек: " + ", ".join(stack))
        cities = [text_value(value.get("CityTitle")) for value in raw.get("vacancies_cities") or []]
        categories = [text_value(value.get("CategoryTitle")) for value in raw.get("vacancy_categories") or []]
        return Job(
            source_key=source["key"],
            external_id=text_value(raw.get("VacancyID")) or external_id,
            company=source["company"], title=text_value(raw.get("Title")) or external_id,
            location=", ".join(value for value in cities if value),
            team=", ".join(value for value in categories if value),
            workplace_type=text_value(raw.get("Graphic")),
            description="\n".join(value for value in description_parts if value),
            url=detail_url, posted_at=text_value(raw.get("publishedAt")), source_updated_at="",
        )

    result: dict[str, Job] = {}
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = [executor.submit(load, key, url) for key, url in links.items()]
        for future in as_completed(futures):
            job = future.result()
            if job.title and job.description:
                result[job.external_id] = job
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек Сбера осталось {len(result)} вакансий")
    return list(result.values())


def gazprom_neft_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get(
        "api_url", "https://career.gazprom-neft.ru/api2/v1/vacancies/list/",
    )
    jobs: dict[str, Job] = {}
    for page in range(1, max(2, int(source.get("max_pages", 40))) + 1):
        payload = {
            "search": "", "cities": [], "schedule": [], "spec": [],
            "worktype": [], "pagination": page,
        }
        response = post_json(api, payload, timeout, retries)
        items = response.get("data") or []
        total = int((response.get("response") or {}).get("count") or 0)
        for item in items:
            external_id = text_value(item.get("id_sap") or item.get("id"))
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id,
                company=source["company"], title=plain_text(item.get("title")),
                location=plain_text(item.get("city")), team="",
                workplace_type=plain_text(item.get("worktype")),
                description="\n".join(value for value in (
                    plain_text(item.get("title")), plain_text(item.get("city")),
                    plain_text(item.get("worktype")), plain_text(item.get("schedule")),
                ) if value),
                url=text_value(item.get("detail")), posted_at=text_value(item.get("date")),
                source_updated_at="",
            )
        if not items or len(jobs) >= total:
            break
    minimum = max(1, int(source.get("min_expected_jobs", 100)))
    if len(jobs) < minimum:
        raise RuntimeError(f"Газпром нефть вернул {len(jobs)} вакансий, меньше порога {minimum}")
    return list(jobs.values())


def twogis_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    base = source.get("api_url", "https://job.2gis.ru/api/v1/vacancies")
    first = fetch_json(f"{base}?page=1", timeout, retries)
    pages = max(1, int(first.get("totalPages", 1)))
    items = list(first.get("items", []))
    for page in range(2, pages + 1):
        payload = fetch_json(f"{base}?page={page}", timeout, retries)
        items.extend(payload.get("items", []))
    result: list[Job] = []
    for summary in items:
        external_id = text_value(summary.get("id"))
        detail = fetch_json(f"{base}/{external_id}", timeout, retries)
        direction = detail.get("direction") or {}
        city = detail.get("city") or {}
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("title")), location=text_value(city.get("name")),
            team=text_value(direction.get("name")),
            workplace_type="Удалённо" if detail.get("isRemote") else "",
            description=fragment_text(text_value(detail.get("description") or detail.get("shortDescription"))),
            url=f"https://job.2gis.ru/vacancies/{direction.get('slug', 'job')}/{external_id}",
            posted_at="", source_updated_at="",
        ))
    return result


def dodo_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://career-api.dodoteam.ru/api/v1")
    payload = fetch_json(f"{api}/vacancies", timeout, retries)
    allowed_brands = {text_value(value).casefold() for value in source.get("brands", [])}
    summaries: dict[str, dict[str, Any]] = {}
    for group in payload.get("data", []):
        for item in group.get("items", []):
            if allowed_brands and text_value(item.get("brand")).casefold() not in allowed_brands:
                continue
            summaries[text_value(item.get("id"))] = item
    result: list[Job] = []
    for external_id, summary in summaries.items():
        detail = fetch_json(f"{api}/pages/vacancy/{external_id}", timeout, retries)
        content = ((detail.get("data") or {}).get("page") or {}).get("content", [])
        blocks = {block.get("type"): block.get("data") or {} for block in content}
        main = blocks.get("vacancy_main") or summary
        description_parts: list[str] = []
        for block_type in ("vacancy_text", "vacancy_expectation", "vacancy_you_will", "vacancy_benefits"):
            block = blocks.get(block_type) or {}
            title = plain_text(text_value(block.get("title")))
            text = fragment_text(text_value(block.get("text")))
            if text:
                description_parts.append(f"{title}\n{text}" if title else text)
        work_format = main.get("work_format") or []
        if isinstance(work_format, list):
            work_format = ", ".join(text_value(value) for value in work_format)
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(main.get("position")), location=text_value(main.get("vacancy_location")),
            team=text_value(main.get("subspeciality") or main.get("speciality")),
            workplace_type=text_value(work_format), description="\n".join(description_parts),
            url=f"https://dodoteam.ru/vacancy?vacancyId={external_id}",
            posted_at="", source_updated_at="",
        ))
    return result


def selectel_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get(
        "api_url",
        "https://api.selectel.ru/proxy/public/employee/api/public/vacancies",
    )
    query = urlencode({"per_page": 1000, "page": 1, "brand": source.get("brand", "selectel")})
    payload = fetch_json(f"{api}?{query}", timeout, retries)
    items = payload.get("items", [])
    expected = int(payload.get("item_count", len(items)))
    if len(items) != expected:
        raise RuntimeError(f"Selectel API вернул {len(items)} из {expected} вакансий")
    result: list[Job] = []
    for summary in items:
        external_id = text_value(summary.get("id"))
        detail = fetch_json(f"{api}/{external_id}", timeout, retries)
        city = detail.get("city") or {}
        tag = detail.get("tag") or {}
        timetable = detail.get("timetable_mode") or {}
        work_parts = [text_value(timetable.get("name"))]
        if detail.get("is_remote_available"):
            work_parts.append("Удалённо")
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("title")), location=text_value(city.get("name")),
            team=text_value(tag.get("description") or tag.get("name")),
            workplace_type=", ".join(value for value in work_parts if value),
            description=fragment_text(text_value(detail.get("detailed_desc") or detail.get("short_desc"))),
            url=f"https://selectel.ru/careers/all/vacancy/{external_id}/",
            posted_at=text_value(detail.get("published_at")), source_updated_at="",
        ))
    return result


def x5_tech_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get(
        "api_url", "https://prod-lkk-back.x5.ru/api/v2/x5-tech/vacancies/",
    )
    first = fetch_json(f"{api}?{urlencode({'page': 1})}", timeout, retries)
    pages = max(1, int(first.get("page_count", 1)))
    expected = int(first.get("total_count", 0))
    items = list(first.get("items", []))
    for page in range(2, pages + 1):
        payload = fetch_json(f"{api}?{urlencode({'page': page})}", timeout, retries)
        items.extend(payload.get("items", []))
    if len(items) != expected:
        raise RuntimeError(f"X5 Tech API вернул {len(items)} из {expected} вакансий")

    work_formats = {
        "office": "Офис", "hybrid": "Гибрид", "remote": "Удалённо",
    }
    result: list[Job] = []
    for item in items:
        external_id = text_value(item.get("id"))
        data = item.get("data") or {}
        description = "\n".join(text_value(data.get(field)) for field in (
            "main_responsibilities", "professional_skills", "software_skills",
            "personal_qualities", "working_conditions", "experience", "schedule",
        ) if data.get(field))
        category = item.get("category") or {}
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(item.get("name")), location=text_value(item.get("city")),
            team=f"IT · направление {text_value(category.get('id'))}",
            workplace_type=work_formats.get(text_value(item.get("work_format")), ""),
            description=plain_text(description),
            url=f"https://x5.tech/vacancy/{external_id}", posted_at="", source_updated_at="",
        ))
    return result


def cloud_ru_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://cloud.ru/career/vacancies")
    document, _ = fetch_text(listing_url, timeout, retries)
    summaries = next_f_json(document, "vacanciesData") or []
    summaries = [item for item in summaries if isinstance(item, dict) and not item.get("isClosed")]
    minimum = max(1, int(source.get("min_expected_jobs", 50)))
    if len(summaries) < minimum:
        raise RuntimeError(
            f"Cloud.ru вернул {len(summaries)} вакансий, меньше защитного порога {minimum}"
        )

    def load(summary: dict[str, Any]) -> Job:
        external_id = text_value(summary.get("id"))
        url = f"https://cloud.ru/career/vacancies/{external_id}"
        detail_document, _ = fetch_text(url, timeout, retries)
        hero = next_f_json(detail_document, "heroProps") or {}
        content = next_f_json(detail_document, "vacancyInfoContentProps") or {}
        description_parts: list[str] = []
        for section in content.values() if isinstance(content, dict) else []:
            if not isinstance(section, dict):
                continue
            title = text_value(section.get("title"))
            body = fragment_text(text_value(section.get("html")))
            if body:
                description_parts.append(f"{title}\n{body}" if title else body)
        if not description_parts:
            raise RuntimeError("карточка не содержит описания")
        work_format = summary.get("work_format") or {}
        unit = summary.get("unit") or {}
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(hero.get("title") or summary.get("position")).strip(),
            location="", team=text_value(unit.get("name")),
            workplace_type=text_value(work_format.get("name")),
            description="\n".join(description_parts), url=url,
            posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load, summary): summary for summary in summaries}
        for future in as_completed(futures):
            try:
                result.append(future.result())
            except Exception as exc:
                failures += 1
                summary = futures[future]
                print(f"ПРЕДУПРЕЖДЕНИЕ Cloud.ru {summary.get('id')}: {exc}", file=sys.stderr)
    if len(result) < minimum:
        raise RuntimeError(f"После проверки карточек Cloud.ru осталось {len(result)} вакансий")
    if failures:
        print(f"ПРЕДУПРЕЖДЕНИЕ Cloud.ru: не загружено карточек: {failures}", file=sys.stderr)
    return result


def yandex_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api_url = source.get(
        "api_url", "https://yandex.ru/jobs/api/jobs/publications?page_size=100",
    )
    foreign_cities = {
        text_value(value).casefold() for value in source.get(
            "foreign_cities", ["Минск", "Белград", "Ереван", "Ташкент", "Алматы", "Астана"],
        )
    }
    items: dict[str, dict[str, Any]] = {}
    url = api_url
    for _page in range(max(1, int(source.get("max_pages", 20)))):
        payload = fetch_json(url, timeout, retries)
        for item in payload.get("results", []):
            items[text_value(item.get("id"))] = item
        next_url = text_value(payload.get("next"))
        if not next_url:
            break
        parsed = urlparse(next_url)
        path = parsed.path.removeprefix("/_api")
        url = f"https://yandex.ru/jobs/api{path}"
        if parsed.query:
            url += f"?{parsed.query}"
    else:
        raise RuntimeError("Яндекс превысил защитный лимит страниц")

    minimum = max(1, int(source.get("min_expected_jobs", 500)))
    if len(items) < minimum:
        raise RuntimeError(
            f"Яндекс вернул {len(items)} вакансий, меньше защитного порога {minimum}"
        )

    result: list[Job] = []
    for external_id, item in items.items():
        vacancy = item.get("vacancy") or {}
        cities = [
            text_value(city.get("name")) for city in vacancy.get("cities", []) if city.get("name")
        ]
        if cities and all(city.casefold() in foreign_cities for city in cities):
            continue
        skills = [
            text_value(skill.get("name")) for skill in vacancy.get("skills", []) if skill.get("name")
        ]
        modes = [
            text_value(mode.get("name")) for mode in vacancy.get("work_modes", []) if mode.get("name")
        ]
        service = item.get("public_service") or {}
        description_parts = [text_value(item.get("short_summary"))]
        if skills:
            description_parts.append(f"Технологии: {', '.join(skills)}")
        slug = text_value(item.get("publication_slug_url"))
        detail_url = text_value(item.get("redirect_url")) or (
            f"https://yandex.ru/jobs/vacancies/{slug or external_id}"
        )
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(item.get("title")), location=", ".join(cities),
            team=text_value(service.get("name")), workplace_type=", ".join(modes),
            description="\n".join(value for value in description_parts if value),
            url=detail_url, posted_at="", source_updated_at="",
        ))
    return result


def lamoda_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://job.lamoda.ru/api/hr/vacancies")
    query = urlencode({"pagination[start]": 0, "pagination[limit]": 1000})
    payload = fetch_json(f"{api}/compact?{query}", timeout, retries)
    summaries = payload.get("data", [])
    expected = int((payload.get("meta") or {}).get("total", len(summaries)))
    if len(summaries) != expected:
        raise RuntimeError(f"Lamoda API вернул {len(summaries)} из {expected} вакансий")

    def load(summary: dict[str, Any]) -> Job:
        external_id = text_value(summary.get("id"))
        payload = fetch_json(f"{api}/{external_id}", timeout, retries)
        detail = (payload.get("data") or {}).get("attributes") or payload.get("data") or {}
        location = detail.get("location") or summary.get("location") or {}
        department = detail.get("department") or summary.get("department") or {}
        direction = detail.get("direction") or summary.get("direction") or {}
        description_parts = [
            text_value(detail.get("introduction")), text_value(detail.get("duties")),
            text_value(detail.get("requirements")), text_value(detail.get("conditions")),
            text_value(detail.get("common")), text_value(detail.get("shortInfo")),
            text_value(summary.get("shortInfo")), text_value(department.get("introduction")),
            text_value(department.get("conditions")), text_value(direction.get("introduction")),
            text_value(direction.get("conditions")),
        ]
        slug = text_value(detail.get("slug") or summary.get("slug"))
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("name") or summary.get("name")),
            location=text_value(location.get("fullName") or location.get("name")),
            team=text_value(direction.get("name") or department.get("name")),
            workplace_type="", description=fragment_text("\n".join(description_parts)),
            url=f"https://job.lamoda.ru/vacancies/{slug}",
            posted_at=text_value(detail.get("externalPublicationDate") or summary.get("externalPublicationDate")),
            source_updated_at="",
        )

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load, summary): summary for summary in summaries}
        for future in as_completed(futures):
            result.append(future.result())
    return result


def tbank_description(document: str) -> dict[str, Any]:
    match = re.search(
        r'<script[^>]+id=["\']__TRAMVAI_STATE__["\'][^>]*>(.*?)</script>',
        document, re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return {}
    try:
        state = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}
    stores = state.get("stores") or {}
    return (stores.get("vacancyDescriptionStore") or {}).get("vacancyDescription") or {}


def tbank_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://www.tbank.ru/pfpjobs/papi/getVacancies")
    pagination: dict[str, Any] = {
        "job": {"offset": 0, "isFinished": False},
        "back_office": {"offset": 0, "isFinished": True},
        "it": {"offset": 0, "isFinished": True},
    }
    summaries: dict[str, dict[str, Any]] = {}
    for _page in range(max(1, int(source.get("max_pages", 100)))):
        body = {
            "filters": {"generatedGraphQL": {
                "type": "T_CAREER", "status": "ACTIVE", "searchFiasIds": [],
                "includeSeoAndPcPublications": False, "includeInternshipPublications": True,
                "userGroup": {"groups": ["Control"], "type": "SPECIFIC"},
                "collapsePredstavitelPublications": False,
                "or": [{"category": "tcareer_it"}],
            }},
            "pagination": pagination,
        }
        response = post_json(api, body, timeout, retries)
        payload = response.get("payload") or {}
        for item in payload.get("vacancies", []):
            if text_value(item.get("subtitle")).casefold() == "минск":
                continue
            summaries[text_value(item.get("urlSlug"))] = item
        pagination = payload.get("nextPagination") or {}
        if (pagination.get("job") or {}).get("isFinished"):
            break
    else:
        raise RuntimeError("Т-Банк превысил защитный лимит страниц")

    def load(summary: dict[str, Any]) -> Job:
        external_id = text_value(summary.get("urlSlug"))
        seo_slug = text_value(summary.get("seoSlug"))
        listing_url = "https://www.tbank.ru/career/vacancies/it/"
        detail = {}
        final_url = listing_url
        if seo_slug.strip():
            url = (
                "https://www.tbank.ru/career/it/vacancy/moscow/"
                f"{quote(seo_slug.strip(), safe='')}/{external_id}/"
            )
            try:
                document, final_url = fetch_text(url, timeout, retries)
                detail = tbank_description(document)
            except Exception:
                # Некоторые активные публикации есть в официальной выдаче, но их
                # отдельная страница временно недоступна. Карточку всё равно показываем.
                final_url = listing_url
        sections: list[str] = []
        for section in detail.get("description", []) or []:
            title = text_value(section.get("title"))
            content = section.get("content")
            if isinstance(content, list):
                body = "\n".join(
                    f"• {text_value(item.get('description'))}" for item in content if item.get("description")
                )
            else:
                body = fragment_text(text_value(content))
            if body:
                sections.append(f"{title}\n{body}" if title else body)
        tags = [text_value(tag.get("text")) for tag in detail.get("tags", []) if tag.get("text")]
        workplace = ", ".join(tag for tag in tags if tag in {"Удаленный", "Офис", "Гибрид"})
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("title") or summary.get("title")),
            location=text_value(detail.get("subtitle") or summary.get("subtitle") or "Любой город"),
            team="Работа в ИТ", workplace_type=workplace,
            description="\n".join(sections) or fragment_text(text_value(summary.get("shortDescription"))),
            url=final_url, posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load, summary): summary for summary in summaries.values()}
        for future in as_completed(futures):
            try:
                result.append(future.result())
            except Exception as exc:
                failures += 1
                summary = futures[future]
                print(f"ПРЕДУПРЕЖДЕНИЕ Т-Банк {summary.get('urlSlug')}: {exc}", file=sys.stderr)
    minimum = max(1, int(source.get("min_expected_jobs", 100)))
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек Т-Банка осталось {len(result)} вакансий")
    if failures:
        print(f"ПРЕДУПРЕЖДЕНИЕ Т-Банк: не загружено карточек: {failures}", file=sys.stderr)
    return result


def alfa_bank_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://job.alfabank.ru/api/vacancies")
    options = fetch_json(f"{api}/options?listId=business_lines&take=5000", timeout, retries)
    business_lines = {
        text_value(item.get("id")): text_value(item.get("text"))
        for item in ((options.get("optionLists") or {}).get("business_lines") or [])
    }
    cities_payload = fetch_json(f"{api}/options?listId=cities&take=5000", timeout, retries)
    cities = {
        text_value(item.get("id")): text_value(item.get("text"))
        for item in ((cities_payload.get("optionLists") or {}).get("cities") or [])
    }
    payload = fetch_json(f"{api}?take={int(source.get('take', 5000))}", timeout, retries)
    items = payload.get("items", [])
    expected = int(payload.get("total", len(items)))
    if len(items) != expected:
        raise RuntimeError(f"Альфа-Банк API вернул {len(items)} из {expected} вакансий")

    excluded_codes: set[str] = set()
    exclude_url = text_value(source.get("exclude_codes_url"))
    if exclude_url:
        document, _ = fetch_text(exclude_url, timeout, retries)
        excluded_codes.update(re.findall(r'/vacancies/[^"?#]*[_-]{2}([0-9]+)', document))

    result: list[Job] = []
    for item in items:
        if text_value(item.get("code")) in excluded_codes:
            continue
        external_id = text_value(item.get("id"))
        slug = text_value(item.get("slug"))
        workplace = "Удалённо" if "remote-job" in slug else ""
        result.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(item.get("name")), location=cities.get(text_value(item.get("cityId")), ""),
            team=business_lines.get(text_value(item.get("businessLineId")), ""),
            workplace_type=workplace,
            description=text_value(item.get("descriptionText")) or fragment_text(text_value(item.get("description"))),
            url=f"https://job.alfabank.ru/vacancies{slug}",
            posted_at=text_value(item.get("createdAt")), source_updated_at=text_value(item.get("updatedAt")),
        ))
    return result


def html_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    body, final_url = fetch_text(source["url"], timeout, retries)
    parser = LinkParser()
    parser.feed(body)
    pattern = re.compile(source["job_url_pattern"], re.IGNORECASE)
    jobs: dict[str, Job] = {}
    for href, title in parser.links:
        absolute_url = urljoin(final_url, href)
        if source.get("force_https") and absolute_url.startswith("http://"):
            absolute_url = "https://" + absolute_url[len("http://"):]
        match = pattern.search(absolute_url)
        if not match or (not title and not source.get("allow_empty_titles")):
            continue
        if title and not is_probable_html_job_title(title):
            continue
        location = ""
        workplace_type = ""
        if source["key"] == "digital-clouds-direct":
            suffix = re.search(r"\s+(Гибрид|Офис|Удал[её]нн(?:о|ая))\s*,?\s*офис\s+([^|]+)$", title, re.IGNORECASE)
            if suffix:
                title = title[:suffix.start()].strip()
                workplace_type = suffix.group(1).capitalize()
                location = suffix.group(2).strip()
        external_id = match.groupdict().get("id") if match.groupdict() else None
        if not external_id:
            path = urlparse(absolute_url).path.rstrip("/")
            external_id = path.rsplit("/", 1)[-1] or hashlib.sha256(absolute_url.encode()).hexdigest()[:20]
        if source["key"] == "korus-consulting-direct":
            title = clean_korus_title(title)
        title = clean_html_job_title(source["key"], title)
        jobs[external_id] = Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=title or external_id, location=location, team="", workplace_type=workplace_type, description="",
            url=absolute_url, posted_at="", source_updated_at="",
        )
    minimum = max(1, int(source.get("min_expected_jobs", 1)))
    if len(jobs) < minimum:
        raise RuntimeError(
            f"Прямой сайт вернул {len(jobs)} вакансий, меньше защитного порога {minimum}; "
            "возможна смена разметки"
        )
    result = list(jobs.values())
    if source.get("fetch_details", True):
        enriched: list[Job] = []
        workers = max(1, int(source.get("detail_workers", 1)))

        def load_detail(job: Job) -> Job | None:
            try:
                detailed = enrich_direct_job(job, timeout, retries)
                if source.get("require_details") and not detailed.description:
                    print(
                        f"ПРЕДУПРЕЖДЕНИЕ {job.company} {job.external_id}: "
                        "карточка недоступна или не содержит описания, вакансия пропущена",
                        file=sys.stderr,
                    )
                    return None
                return detailed
            except Exception as exc:
                print(f"ПРЕДУПРЕЖДЕНИЕ {job.company} {job.external_id}: детали не загружены: {exc}", file=sys.stderr)
                if not source.get("require_details"):
                    return job
                return None

        if workers == 1:
            enriched = [detailed for job in result if (detailed := load_detail(job)) is not None]
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = [executor.submit(load_detail, job) for job in result]
                for future in as_completed(futures):
                    detailed = future.result()
                    if detailed is not None:
                        enriched.append(detailed)
        result = enriched
        if len(result) < minimum:
            raise RuntimeError(
                f"После проверки карточек осталось {len(result)} вакансий, "
                f"меньше защитного порога {minimum}"
            )
    excluded_locations = [text_value(value).casefold() for value in source.get("exclude_locations", [])]
    if excluded_locations:
        result = [
            job for job in result
            if not any(value in job.location.casefold() for value in excluded_locations)
        ]
    return result


def magnit_tech_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://magnit.tech/api/v1").rstrip("/")
    per_page = max(1, int(source.get("per_page", 100)))
    max_pages = max(1, int(source.get("max_pages", 10)))
    summaries: dict[str, dict[str, Any]] = {}
    for page in range(1, max_pages + 1):
        payload = fetch_json(
            f"{api}/vacancy?{urlencode({'page': page, 'per_page': per_page})}",
            timeout, retries,
        )
        rows = payload.get("results") or []
        for row in rows:
            if row.get("id") is not None:
                summaries[str(row["id"])] = row
        meta = payload.get("meta") or {}
        if not meta.get("has_more_pages") or not rows:
            break
    else:
        raise RuntimeError(f"Магнит Тех превысил защитный лимит страниц ({max_pages})")

    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(summaries) < minimum:
        raise RuntimeError(
            f"Магнит Тех вернул {len(summaries)} вакансий, меньше порога {minimum}"
        )

    base_url = source.get("url", "https://magnit.tech").rstrip("/")

    def load_detail(item: dict[str, Any]) -> Job:
        external_id = str(item["id"])
        payload = fetch_json(f"{api}/vacancy/{external_id}", timeout, retries)
        detail = payload.get("results") or item
        description_parts: list[str] = []
        for label, key in (
            ("О вакансии", "description"),
            ("О продукте", "about_product"),
            ("Задачи", "tasks"),
            ("Требования", "skills"),
            ("Будет плюсом", "extra_skills"),
            ("Мы предлагаем", "offer"),
        ):
            value = fragment_text(text_value(detail.get(key)))
            if value:
                description_parts.append(f"{label}\n{value}")
        technologies = ", ".join(
            text_value(value.get("name"))
            for value in detail.get("technologies") or []
            if value.get("name")
        )
        if technologies:
            description_parts.append(f"Технологии\n{technologies}")
        direction = text_value((detail.get("direction") or {}).get("name"))
        speciality = text_value((detail.get("speciality") or {}).get("name"))
        team = ", ".join(dict.fromkeys(value for value in (direction, speciality) if value))
        workplace_type = ", ".join(dict.fromkeys(
            text_value(value.get("name"))
            for value in detail.get("work_formats") or []
            if value.get("name")
        ))
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("title")) or text_value(item.get("title")),
            location=text_value(detail.get("location")) or text_value(item.get("location")),
            team=team, workplace_type=workplace_type,
            description="\n".join(description_parts),
            url=f"{base_url}/vacancies/{external_id}",
            posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load_detail, item): item for item in summaries.values()}
        for future in as_completed(futures):
            item = futures[future]
            try:
                result.append(future.result())
            except Exception as exc:
                print(
                    f"ПРЕДУПРЕЖДЕНИЕ Магнит Тех {item.get('id')}: детали не загружены: {exc}",
                    file=sys.stderr,
                )
    if len(result) < minimum:
        raise RuntimeError(
            f"После загрузки карточек Магнит Тех осталось {len(result)} вакансий"
        )
    return result


def psb_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    api = source.get("api_url", "https://job.psbank.ru/api/v1/content").rstrip("/")
    per_page = max(1, min(100, int(source.get("per_page", 100))))
    max_pages = max(1, int(source.get("max_pages", 10)))
    summaries: dict[str, dict[str, Any]] = {}
    for page in range(1, max_pages + 1):
        payload = fetch_json(
            f"{api}/vacancies?{urlencode({'page': page, 'per_page': per_page})}",
            timeout, retries,
        )
        rows = payload.get("data") or []
        total_count = int(payload.get("total_count") or len(rows))
        for row in rows:
            if row.get("id") is not None and text_value(row.get("type")).casefold() == "it":
                summaries[str(row["id"])] = row
        if not rows or page * per_page >= total_count:
            break
    else:
        raise RuntimeError(f"ПСБ превысил защитный лимит страниц ({max_pages})")

    minimum = max(1, int(source.get("min_expected_jobs", 10)))
    if len(summaries) < minimum:
        raise RuntimeError(f"ПСБ вернул {len(summaries)} IT-вакансий, меньше порога {minimum}")

    listing_url = source.get("url", "https://job.psbank.ru/vacancies/it-specialists").rstrip("/")

    def load_detail(item: dict[str, Any]) -> Job:
        external_id = str(item["id"])
        detail = fetch_json(f"{api}/vacancies/{external_id}", timeout, retries)
        description_parts: list[str] = []
        for label, key in (
            ("Требования", "req"),
            ("Задачи", "duty"),
            ("Условия", "cond"),
        ):
            value = fragment_text(text_value(detail.get(key) or item.get(key)))
            if value:
                description_parts.append(f"{label}\n{value}")
        salary = text_value(detail.get("salary") or item.get("salary"))
        if salary and salary != "0":
            description_parts.append(f"Зарплата\n{salary}")
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("title") or item.get("title")),
            location=text_value(detail.get("locationName")),
            team=text_value(detail.get("profGroupName") or item.get("profGroupName")),
            workplace_type=text_value(detail.get("workTypeName") or item.get("workTypeName")),
            description="\n".join(description_parts),
            url=f"{listing_url}/{external_id}", posted_at="",
            source_updated_at=text_value(detail.get("update_date") or item.get("update_date")),
        )

    result: list[Job] = []
    workers = max(1, int(source.get("detail_workers", 8)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(load_detail, item): item for item in summaries.values()}
        for future in as_completed(futures):
            item = futures[future]
            try:
                result.append(future.result())
            except Exception as exc:
                print(
                    f"ПРЕДУПРЕЖДЕНИЕ ПСБ {item.get('id')}: детали не загружены: {exc}",
                    file=sys.stderr,
                )
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек ПСБ осталось {len(result)} IT-вакансий")
    return result


def lanit_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    payload = fetch_json(
        source.get("api_url", "https://job.lanit.ru/_vti_bin/Lanit.Job.Redesign/WebService.svc/GetVacancyForWidget"),
        timeout, retries,
    )
    minimum = max(1, int(source.get("min_expected_jobs", 10)))
    jobs: list[Job] = []
    for item in payload:
        if not item.get("Id") or not item.get("IsPublished", True):
            continue
        description = "\n".join(
            f"{label}\n{fragment_text(text_value(item.get(key)))}"
            for label, key in (("О вакансии", "ActivityDescription"), ("Задачи", "JobResponsibilities"),
                               ("Требования", "Requirements"), ("Условия", "SocialPackage"))
            if fragment_text(text_value(item.get(key)))
        )
        jobs.append(Job(
            source_key=source["key"], external_id=str(item["Id"]), company=source["company"],
            title=text_value(item.get("Title")), location=text_value(item.get("City")),
            team=", ".join(value for value in (text_value(item.get("Department")), text_value(item.get("Division"))) if value),
            workplace_type="", description=description,
            url=text_value(item.get("Url")) or f"https://job.lanit.ru/Pages/vacancy.aspx?ItemId={item['Id']}",
            posted_at="", source_updated_at="",
        ))
    if len(jobs) < minimum:
        raise RuntimeError(f"ЛАНИТ вернул {len(jobs)} вакансий, меньше порога {minimum}")
    return jobs


def one_c_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    base = source.get("url", "https://1c.ru/rus/firm1c/vacan/search")
    directions = source.get("directions", list(range(1, 16)))
    jobs: dict[str, Job] = {}
    pattern = re.compile(r"/vacan/vacancy/(?P<id>\d+)", re.IGNORECASE)
    for direction in directions:
        body, final_url = fetch_text(f"{base}?{urlencode({'direction': direction})}", timeout, retries)
        parser = LinkParser()
        parser.feed(body)
        for href, title in parser.links:
            url = urljoin(final_url, href)
            match = pattern.search(url)
            if match:
                external_id = match.group("id")
                jobs[external_id] = Job(
                    source["key"], external_id, source["company"],
                    clean_one_c_title(title) or external_id, "", "", "", "", url, "", "",
                )
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(jobs) < minimum:
        raise RuntimeError(f"1С вернул {len(jobs)} вакансий, меньше порога {minimum}")
    # В официальной выдаче 1С уже есть название и подробный текст карточки;
    # отдельные страницы используют устаревшую разметку без извлекаемого текста.
    return [Job(**{**job.__dict__, "description": job.title}) for job in jobs.values()]


def clean_one_c_title(value: str) -> str:
    """The 1C listing nests a card description inside its vacancy link."""
    value = re.sub(r"\s+", " ", value).strip()
    duplicate_product = re.search(
        r"(?P<product>1[СC]:[^\s]+)\s+(?P=product)\s*[-–]", value, re.IGNORECASE,
    )
    if duplicate_product:
        return (value[:duplicate_product.start()] + duplicate_product.group("product")).strip()
    narrative_starts = re.compile(
        r"\s+(?=(?:В отдел|В команду|Чем предстоит|Обязанности:|Мы (?:разрабатываем|ищем|работаем|постоянно)|"
        r"Мы [—-]|Фирма [«\"]?1С|Помогите |Команда разработки|Работы по|Учебный центр|"
        r"Ищем сотрудника|Наша цель|"
        r"1С:[^ ]+(?: [^ ]+){0,2} помогает))",
        re.IGNORECASE,
    )
    return narrative_starts.split(value, maxsplit=1)[0].strip()


def clean_korus_title(value: str) -> str:
    """Keep only the role from KORUS catalogue cards, excluding company and department labels."""
    value = re.sub(r"\s+(?:Офис|Удал[её]нно|Гибрид)(?:,\s*(?:Офис|Удал[её]нно|Гибрид))*$", "", value).strip()
    role_start = re.compile(
        r"(?:Ведущий|Руководитель|Функциональный|Старший|Младший|Консультант|Разработчик|"
        r"Менеджер|Технический|Бизнес-аналитик|Дежурный|Специалист|Директор|Коммерческий)\b",
        re.IGNORECASE,
    )
    if value.casefold().startswith(("департамент ", "компания ", "sales community ")):
        match = role_start.search(value)
        if match:
            value = value[match.start():]
    return value


def samolet_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    """Load the public vacancy feed embedded in the official Samolet career site."""
    api_url = source.get(
        "api_url", "https://career.samolet.ru/api/integrations/skillaz/vacancies/"
    )
    payload = fetch_json(f"{api_url}?{urlencode({'limit': 100})}", timeout, retries)
    rows = payload.get("results") or []
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(rows) < minimum:
        raise RuntimeError(f"Самолёт вернул {len(rows)} вакансий, меньше порога {minimum}")

    jobs: list[Job] = []
    for item in rows:
        external_id = text_value(item.get("uuid") or item.get("id"))
        title = text_value(item.get("name"))
        if not external_id or not title:
            continue
        description_parts = [
            fragment_text(text_value(item.get(key)))
            for key in ("description", "responsibilities", "requirements", "conditions", "whySamolet")
            if fragment_text(text_value(item.get(key)))
        ]
        jobs.append(Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=title,
            location=text_value((item.get("region") or {}).get("name")),
            team=text_value((item.get("specialization") or {}).get("name")),
            workplace_type=text_value((item.get("workplaceType") or {}).get("name")),
            description="\n".join(description_parts),
            url=text_value(item.get("externalUrl")) or f"https://career.samolet.ru/vakansii/view/{external_id}/",
            posted_at=text_value(item.get("publishedAt") or item.get("createdAt")),
            source_updated_at=text_value(item.get("updatedAt")),
        ))
    if len(jobs) < minimum:
        raise RuntimeError(f"Самолёт вернул только {len(jobs)} корректных вакансий")
    return jobs


def rwb_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    """Load the public vacancy feed used by the official RWB career site."""
    base = source.get("api_url", "https://career.rwb.ru/crm-api/api/v1/pub/vacancies").rstrip("/")
    limit = max(1, min(100, int(source.get("per_page", 100))))
    max_pages = max(1, int(source.get("max_pages", 10)))
    summaries: dict[str, dict[str, Any]] = {}
    total = None
    offset = 0
    for page in range(max_pages):
        payload = fetch_json(f"{base}?{urlencode({'limit': limit, 'offset': offset})}", timeout, retries)
        data = payload.get("data") or {}
        rows = data.get("items") or []
        result_range = data.get("range") or {}
        total = int(result_range.get("count") or len(rows))
        for item in rows:
            if item.get("id") is not None:
                summaries[str(item["id"])] = item
        if not rows or len(summaries) >= total:
            break
        # API may return fewer rows than the advertised limit (currently 50 vs 100).
        offset += len(rows)
    else:
        raise RuntimeError(f"RWB превысил защитный лимит страниц ({max_pages})")

    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(summaries) < minimum:
        raise RuntimeError(f"RWB вернул {len(summaries)} вакансий, меньше порога {minimum}")

    def load_detail(item: dict[str, Any]) -> Job:
        external_id = str(item["id"])
        detail = (fetch_json(f"{base}/{external_id}", timeout, retries).get("data") or item)
        description_parts = [fragment_text(text_value(detail.get("description")))]
        for label, key in (("Задачи", "duties_arr"), ("Требования", "requirements_arr"), ("Условия", "conditions_arr")):
            values = [text_value(value) for value in detail.get(key) or [] if text_value(value)]
            if values:
                description_parts.append(f"{label}\n" + "\n".join(values))
        workplace = ", ".join(
            text_value(value.get("title")) for value in detail.get("employment_types_list") or item.get("employment_types") or []
            if text_value(value.get("title"))
        )
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=text_value(detail.get("name") or item.get("name")),
            location=text_value(detail.get("office_location_city_title") or item.get("city_title")),
            team=text_value(detail.get("direction_name") or item.get("direction_title")),
            workplace_type=workplace, description="\n".join(filter(None, description_parts)),
            url=f"https://career.rwb.ru/vacancies/{external_id}", posted_at="", source_updated_at="",
        )

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load_detail, item): item for item in summaries.values()}
        for future in as_completed(futures):
            try:
                result.append(future.result())
            except Exception as exc:
                print(f"ПРЕДУПРЕЖДЕНИЕ RWB: детали не загружены: {exc}", file=sys.stderr)
    if len(result) < minimum:
        raise RuntimeError(f"После загрузки карточек RWB осталось {len(result)} вакансий")
    return result


def rshb_digital_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    """Load IT roles exposed by the official RSHB.Digital vacancy API."""
    base = source.get("api_url", "https://rshbdigital.ru/api/v1/owb-ms-plt-app/vacancies").rstrip("/")
    field_ids = source.get("field_ids") or [150, 155, 156, 113, 114, 116, 96, 10, 160, 165, 121, 124, 126, 73, 104, 148, 107]
    size = max(1, min(100, int(source.get("per_page", 100))))
    max_pages = max(1, int(source.get("max_pages", 10)))
    jobs: list[Job] = []
    total_pages = 1
    for page in range(max_pages):
        query = urlencode({
            "city": "", "sort": "date", "companies": "", "fields": ",".join(map(str, field_ids)),
            "employments": "", "experiences": "", "size": size, "page": page,
        })
        payload = fetch_json(f"{base}?{query}", timeout, retries)
        total_pages = int(payload.get("totalPages") or 1)
        for item in payload.get("content") or []:
            external_id = text_value(item.get("id"))
            if not external_id:
                continue
            detail = fetch_json(f"{base}/{external_id}", timeout, retries)
            description = fragment_text(text_value(detail.get("descriptionHtml") or detail.get("description")))
            jobs.append(Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=text_value(item.get("title")), location=text_value(item.get("city")),
                team=text_value(item.get("company")), workplace_type="", description=description,
                url=text_value(item.get("url")) or "https://rshbdigital.ru/vacancies",
                posted_at=text_value(item.get("publishDate")), source_updated_at="",
            ))
        if page + 1 >= total_pages:
            break
    else:
        raise RuntimeError(f"РСХБ.цифра превысил защитный лимит страниц ({max_pages})")
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(jobs) < minimum:
        raise RuntimeError(f"РСХБ.цифра вернул {len(jobs)} IT-вакансий, меньше порога {minimum}")
    return jobs


def ertelecom_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    """Load the official ER-Telecom career API, including full vacancy text."""
    api = source.get("api_url", "https://job.ertelecom.ru/api/vacancy").rstrip("/")
    page_url = f"{api}/list/"
    jobs: list[Job] = []
    seen: set[str] = set()
    max_pages = max(1, int(source.get("max_pages", 20)))
    for _ in range(max_pages):
        payload = fetch_json(page_url, timeout, retries)
        for item in payload.get("results") or []:
            external_id = text_value(item.get("id"))
            if not external_id or external_id in seen:
                continue
            seen.add(external_id)
            detail = fetch_json(f"{api}/{external_id}/", timeout, retries)
            cities = [text_value(city.get("name")) for city in detail.get("city") or []]
            scopes = [text_value(scope.get("name")) for scope in detail.get("scope_activity") or []]
            employment = [text_value(value.get("name")) for value in detail.get("employment") or []]
            jobs.append(Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=text_value(detail.get("name")), location=", ".join(filter(None, cities)),
                team=", ".join(filter(None, scopes)), workplace_type=", ".join(filter(None, employment)),
                description=fragment_text(text_value(detail.get("content"))),
                url=f"https://job.ertelecom.ru/vacancies/vacancy{external_id}",
                posted_at="", source_updated_at=text_value(detail.get("date_update")),
            ))
        next_url = text_value(payload.get("next"))
        if not next_url:
            break
        page_url = next_url
    else:
        raise RuntimeError(f"ЭР-Телеком превысил защитный лимит страниц ({max_pages})")
    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(jobs) < minimum:
        raise RuntimeError(f"ЭР-Телеком вернул {len(jobs)} вакансий, меньше порога {minimum}")
    return jobs


def aston_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    """Load every vacancy embedded by the official ASTON career catalogue."""
    listing_url = source.get("url", "https://career.astondevs.ru/vacancy").rstrip("/")
    document, _ = fetch_text(listing_url, timeout, retries)
    ids = sorted(set(re.findall(r"\b500\d{6}\b", document)))
    minimum = max(1, int(source.get("min_expected_jobs", 50)))
    if len(ids) < minimum:
        raise RuntimeError(f"ASTON вернул {len(ids)} идентификаторов, меньше порога {minimum}")

    def load_detail(external_id: str) -> Job:
        url = f"{listing_url}/{external_id}"
        page, _ = fetch_text(url, timeout, retries)
        page_title = first_text(page, r"<title[^>]*>(.*?)</title>")
        title = re.split(r"\s+[—-]\s+", page_title, maxsplit=1)[0].strip()
        cleaned = re.sub(r"<(?:script|style)\b[^>]*>.*?</(?:script|style)>", "", page, flags=re.IGNORECASE | re.DOTALL)
        text = fragment_text(cleaned)
        start = text.find(title) if title else -1
        if start >= 0:
            text = text[start + len(title):].strip()
        end_positions = [text.find(marker) for marker in ("Рекомендовать на вакансию", "Горячие вакансии") if marker in text]
        if end_positions:
            text = text[:min(end_positions)].strip()
        if not title or len(text) < 80:
            raise RuntimeError(f"неполная карточка {external_id}")
        return Job(
            source_key=source["key"], external_id=external_id, company=source["company"],
            title=title, location="Россия", team="", workplace_type="",
            description=text, url=url, posted_at="", source_updated_at="",
        )

    jobs: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load_detail, external_id): external_id for external_id in ids}
        for future in as_completed(futures):
            try:
                jobs.append(future.result())
            except Exception as exc:
                print(f"ПРЕДУПРЕЖДЕНИЕ ASTON {futures[future]}: {exc}", file=sys.stderr)
    if len(jobs) < minimum:
        raise RuntimeError(f"После загрузки карточек ASTON осталось {len(jobs)} вакансий")
    return jobs


def vkusvill_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    listing_url = source.get("url", "https://vkusvill.ru/job/office/")
    api_url = source.get("api_url", "https://vkusvill.ru/ajax/job/hh_list_filter.php")
    page_size = max(1, int(source.get("page_size", 10)))
    max_pages = max(1, int(source.get("max_pages", 50)))
    user_agent = source.get(
        "user_agent",
        "Mozilla/5.0 (compatible; job-tracker-mvp/1.0; personal job research)",
    )
    session = HTTP_CLIENT
    owns_session = session is None
    if session is None:
        session = httpx.Client(timeout=httpx.Timeout(timeout), follow_redirects=True)

    def open_request(
        method: str, url: str, headers: dict[str, str], content: bytes | None = None,
    ) -> bytes:
        assert session is not None
        return send_http_request(method, url, timeout, retries, headers, content, client=session).content

    listing = open_request("GET", listing_url, {"User-Agent": user_agent}).decode("utf-8", "replace")
    sessid_match = re.search(
        r'<input[^>]+id=["\']sessid["\'][^>]+value=["\']([^"\']+)',
        listing, re.IGNORECASE,
    )
    if not sessid_match:
        raise RuntimeError("ВкусВилл не отдал идентификатор сессии для списка вакансий")
    sessid = sessid_match.group(1)

    jobs: dict[str, Job] = {}
    for page_number in range(1, max_pages + 1):
        form = urlencode({
            "nextPage": page_number,
            "pageSize": page_size,
            "searchText": "",
            "teamId": "",
            "cityId": "",
            "action": "filterVacancies",
            "sessid": sessid,
        }).encode("utf-8")
        try:
            payload = json.loads(open_request(
                "POST", api_url,
                {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": listing_url,
                "User-Agent": user_agent,
                "X-Requested-With": "XMLHttpRequest",
            },
                form,
            ).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError("ВкусВилл вернул некорректный JSON списка вакансий") from exc
        if payload.get("success") != "Y":
            raise RuntimeError("ВкусВилл отклонил запрос списка вакансий")
        fragment = text_value((payload.get("data") or {}).get("vacancies"))
        page_jobs = 0
        for match in re.finditer(
            r'<a[^>]+href=["\'](?P<href>/job/vacancys/[^"\']+)["\'][^>]*>(?P<body>.*?)</a>',
            fragment, re.IGNORECASE | re.DOTALL,
        ):
            href, body = match.group("href"), match.group("body")
            id_match = re.search(r'_([0-9]+)\.html$', href)
            if not id_match:
                continue
            external_id = id_match.group(1)
            title = first_text(
                body, r'<div[^>]+class="[^"]*_Name[^"]*"[^>]*>(.*?)</div>',
            )
            team = first_text(
                body, r'<div[^>]+class="[^"]*_team[^"]*"[^>]*>(.*?)</div>',
            )
            location = first_text(
                body, r'<div[^>]+class="[^"]*_city[^"]*"[^>]*>.*?<div[^>]*>(.*?)</div>',
            )
            if not title:
                continue
            jobs[external_id] = Job(
                source_key=source["key"], external_id=external_id, company=source["company"],
                title=title, location=location, team=team, workplace_type="", description="",
                url=urljoin(listing_url, href), posted_at="", source_updated_at="",
            )
            page_jobs += 1
        if page_jobs < page_size:
            break
    else:
        raise RuntimeError(f"ВкусВилл превысил защитный лимит страниц ({max_pages})")

    minimum = max(1, int(source.get("min_expected_jobs", 20)))
    if len(jobs) < minimum:
        raise RuntimeError(f"ВкусВилл вернул {len(jobs)} вакансий, меньше порога {minimum}")

    def load_detail(job: Job) -> Job:
        return enrich_direct_job(job, timeout, retries)

    result: list[Job] = []
    with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
        futures = {executor.submit(load_detail, job): job for job in jobs.values()}
        for future in as_completed(futures):
            detailed = future.result()
            if not detailed.description:
                raise RuntimeError(f"ВкусВилл не отдал описание вакансии {detailed.external_id}")
            result.append(detailed)
    if owns_session:
        session.close()
    return result


def greenhouse_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    return greenhouse_adapter(source, timeout, retries, fetch_json)


def greenhouse_jobs_legacy(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    token = source["token"]
    query = urlencode({"content": "true"})
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?{query}"
    payload = fetch_json(url, timeout, retries)
    result = []
    for item in payload.get("jobs", []):
        departments = ", ".join(d.get("name", "") for d in item.get("departments", []) if d.get("name"))
        result.append(Job(
            source_key=source["key"],
            external_id=str(item["id"]),
            company=source["company"],
            title=text_value(item.get("title")),
            location=text_value((item.get("location") or {}).get("name")),
            team=departments,
            workplace_type="",
            description=plain_text(item.get("content")),
            url=text_value(item.get("absolute_url")),
            posted_at="",
            source_updated_at=text_value(item.get("updated_at")),
        ))
    return result


def lever_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    return lever_adapter(source, timeout, retries, fetch_json)


def lever_jobs_legacy(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    site = source["site"]
    region = source.get("region", "global")
    host = "api.eu.lever.co" if region == "eu" else "api.lever.co"
    result: list[Job] = []
    skip, limit = 0, 100
    max_pages = max(1, int(source.get("max_pages", 100)))
    for _page in range(max_pages):
        url = f"https://{host}/v0/postings/{site}?{urlencode({'mode': 'json', 'skip': skip, 'limit': limit})}"
        payload = fetch_json(url, timeout, retries)
        if not isinstance(payload, list):
            raise RuntimeError(f"Lever вернул неожиданный ответ для {source['key']}")
        for item in payload:
            categories = item.get("categories") or {}
            description_parts = [text_value(item.get("descriptionPlain")), text_value(item.get("additionalPlain"))]
            for section in item.get("lists", []) or []:
                description_parts.extend([text_value(section.get("text")), plain_text(section.get("content"))])
            created = item.get("createdAt")
            posted_at = ""
            if isinstance(created, (int, float)):
                posted_at = datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat()
            result.append(Job(
                source_key=source["key"],
                external_id=str(item["id"]),
                company=source["company"],
                title=text_value(item.get("text")),
                location=text_value(categories.get("location")),
                team=text_value(categories.get("team") or categories.get("department")),
                workplace_type=text_value(item.get("workplaceType")),
                description=plain_text(" ".join(description_parts)),
                url=text_value(item.get("hostedUrl") or item.get("applyUrl")),
                posted_at=posted_at,
                source_updated_at="",
            ))
        if len(payload) < limit:
            break
        skip += limit
    else:
        raise RuntimeError(f"Lever превысил лимит страниц ({max_pages}) для {source['key']}")
    return result


def hh_role_ids(category_name: str, timeout: int, retries: int, user_agent: str) -> list[str]:
    cache_key = category_name.casefold()
    with HH_ROLE_CACHE_LOCK:
        cached = HH_ROLE_CACHE.get(cache_key)
        if cached is not None:
            return list(cached)
        payload = fetch_json(
            "https://api.hh.ru/professional_roles", timeout, retries,
            {"HH-User-Agent": user_agent, "User-Agent": user_agent},
        )
        for category in payload.get("categories", []):
            if text_value(category.get("name")).casefold() == cache_key:
                roles = [text_value(role.get("id")) for role in category.get("roles", []) if role.get("id")]
                HH_ROLE_CACHE[cache_key] = roles
                return list(roles)
        available = ", ".join(text_value(c.get("name")) for c in payload.get("categories", []))
        raise RuntimeError(f"Категория hh.ru «{category_name}» не найдена. Доступны: {available}")


def hh_jobs(source: dict[str, Any], timeout: int, retries: int) -> list[Job]:
    user_agent = source.get("user_agent", HH_USER_AGENT)
    if "YOUR_EMAIL" in user_agent or "example.com" in user_agent or "ВАША_ПОЧТА" in user_agent:
        raise ValueError(
            "Для hh.ru укажите настоящую контактную почту в поле hh_user_agent файла config.json, "
            "например: JobTracker/1.0 (name@domain.ru)"
        )
    base_params: list[tuple[str, Any]] = [
        ("employer_id", source["employer_id"]),
        ("area", source.get("area", "113")),
        ("per_page", 100),
        ("page", 0),
    ]
    role_ids = [text_value(v) for v in source.get("professional_roles", [])]
    category_name = text_value(source.get("professional_role_category"))
    if category_name:
        role_ids.extend(hh_role_ids(category_name, timeout, retries, user_agent))
    role_ids = list(dict.fromkeys(role_ids))
    if source.get("text"):
        base_params.append(("text", source["text"]))

    # hh.ru rejects very long query strings with many repeated role parameters.
    # Split a category into small OR-groups, then merge overlapping vacancies by ID.
    role_groups = [role_ids[i:i + 10] for i in range(0, len(role_ids), 10)] or [[]]
    result: dict[str, Job] = {}
    for role_group in role_groups:
        params = base_params + [("professional_role", role_id) for role_id in role_group]
        page = 0
        while True:
            page_params = [(key, page if key == "page" else value) for key, value in params]
            url = f"https://api.hh.ru/vacancies?{urlencode(page_params)}"
            payload = fetch_json(
                url, timeout, retries,
                {"HH-User-Agent": user_agent, "User-Agent": user_agent},
            )
            found = int(payload.get("found", 0))
            if found > 2000:
                raise RuntimeError(
                    f"hh.ru нашёл {found} вакансий (API отдаёт максимум 2000). "
                    "Добавьте professional_roles или text для сужения выборки."
                )
            for item in payload.get("items", []):
                snippet = item.get("snippet") or {}
                roles = ", ".join(
                    text_value(role.get("name")) for role in item.get("professional_roles", []) if role.get("name")
                )
                work_formats = ", ".join(
                    text_value(value.get("name")) for value in item.get("work_format", []) if value.get("name")
                )
                schedule = text_value((item.get("schedule") or {}).get("name"))
                workplace_type = ", ".join(value for value in (work_formats, schedule) if value)
                description = plain_text(
                    " ".join((text_value(snippet.get("responsibility")), text_value(snippet.get("requirement"))))
                )
                job = Job(
                    source_key=source["key"],
                    external_id=text_value(item["id"]),
                    company=source["company"],
                    title=text_value(item.get("name")),
                    location=text_value((item.get("area") or {}).get("name")),
                    team=roles,
                    workplace_type=workplace_type,
                    description=description,
                    url=text_value(item.get("alternate_url")),
                    posted_at=text_value(item.get("published_at")),
                    source_updated_at=text_value(item.get("created_at")),
                )
                result[job.external_id] = job
            pages = int(payload.get("pages", 0))
            page += 1
            if page >= pages:
                break
    jobs = list(result.values())
    if source.get("fetch_details"):
        def load_detail(job: Job) -> Job:
            detail = fetch_json(
                f"https://api.hh.ru/vacancies/{job.external_id}", timeout, retries,
                {"HH-User-Agent": user_agent, "User-Agent": user_agent},
            )
            roles = ", ".join(
                text_value(role.get("name"))
                for role in detail.get("professional_roles", []) if role.get("name")
            )
            work_formats = ", ".join(
                text_value(value.get("name"))
                for value in detail.get("work_format", []) if value.get("name")
            )
            schedule = text_value((detail.get("schedule") or {}).get("name"))
            return Job(
                source_key=job.source_key, external_id=job.external_id, company=job.company,
                title=text_value(detail.get("name")) or job.title,
                location=text_value((detail.get("area") or {}).get("name")) or job.location,
                team=roles or job.team,
                workplace_type=", ".join(value for value in (work_formats, schedule) if value)
                    or job.workplace_type,
                description=fragment_text(text_value(detail.get("description"))) or job.description,
                url=text_value(detail.get("alternate_url")) or job.url,
                posted_at=text_value(detail.get("published_at")) or job.posted_at,
                source_updated_at=text_value(detail.get("created_at")) or job.source_updated_at,
            )

        detailed: list[Job] = []
        with ThreadPoolExecutor(max_workers=max(1, int(source.get("detail_workers", 8)))) as executor:
            futures = {executor.submit(load_detail, job): job for job in jobs}
            for future in as_completed(futures):
                try:
                    detailed.append(future.result())
                except Exception as exc:
                    job = futures[future]
                    print(f"ПРЕДУПРЕЖДЕНИЕ hh.ru {job.external_id}: детали не загружены: {exc}", file=sys.stderr)
                    detailed.append(job)
        jobs = detailed
    return jobs


SOURCE_ADAPTERS: dict[str, Any] = build_registry({
    "greenhouse": greenhouse_jobs,
    "lever": lever_jobs,
    "hh": hh_jobs,
    "html": html_jobs,
    "vkusvill": vkusvill_jobs,
    "twogis": twogis_jobs,
    "dodo": dodo_jobs,
    "selectel": selectel_jobs,
    "x5_tech": x5_tech_jobs,
    "cloud_ru": cloud_ru_jobs,
    "yandex": yandex_jobs,
    "jet": jet_jobs,
    "sibur": sibur_jobs,
    "cft": cft_jobs,
    "itone": itone_jobs,
    "sberdevices": sberdevices_jobs,
    "infotecs": infotecs_jobs,
    "nornickel": nornickel_jobs,
    "croc": croc_jobs,
    "mts_bank": mts_bank_jobs,
    "nlmk_it": nlmk_it_jobs,
    "astra": astra_jobs,
    "simbirsoft": simbirsoft_jobs,
    "lemana_tech": lemana_tech_jobs,
    "sber": sber_jobs,
    "gazprom_neft": gazprom_neft_jobs,
    "lamoda": lamoda_jobs,
    "tbank": tbank_jobs,
    "alfa_bank": alfa_bank_jobs,
    "magnit_tech": magnit_tech_jobs,
    "psb": psb_jobs,
    "lanit": lanit_jobs,
    "one_c": one_c_jobs,
    "samolet": samolet_jobs,
    "rwb": rwb_jobs,
    "rshb_digital": rshb_digital_jobs,
    "aston": aston_jobs,
    "ertelecom": ertelecom_jobs,
})


def fetch_source_jobs(
    source: dict[str, Any], config: dict[str, Any], timeout: int, retries: int,
) -> list[Job]:
    """Fetch one source without touching the database; safe to run in a worker thread."""
    adapter = SOURCE_ADAPTERS.get(source["type"])
    if adapter is None:
        raise ValueError(f"Неизвестный тип источника: {source['type']}")
    # Resolve by name so tests and local overrides can replace an adapter dynamically.
    adapter = globals().get(adapter.__name__, adapter)
    adapter_source = dict(source)
    if source["type"] == "hh" and config.get("hh_user_agent"):
        adapter_source.setdefault("user_agent", config["hh_user_agent"])
    return adapter(adapter_source, timeout, retries)


def is_authoritative_source(source: dict[str, Any]) -> bool:
    """Return whether a complete source can safely close missing vacancies."""
    return bool(source.get("authoritative", source["type"] != "html"))


def mark_stale_jobs(
    db: sqlite3.Connection,
    sources: Iterable[dict[str, Any]],
    stale_after_days: int,
    now: str,
) -> int:
    """Hide long-unseen jobs from non-authoritative sources without closing them."""
    cutoff = datetime.fromisoformat(now).timestamp() - stale_after_days * 24 * 60 * 60
    cutoff_at = datetime.fromtimestamp(cutoff, timezone.utc).isoformat()
    stale_sources = [source["key"] for source in sources if not is_authoritative_source(source)]
    if not stale_sources:
        return 0
    placeholders = ", ".join("?" for _ in stale_sources)
    rows = db.execute(f"""
        SELECT source_key, external_id, company, title
        FROM jobs
        WHERE active=1 AND stale=0 AND last_seen_at < ?
          AND source_key IN ({placeholders})
    """, (cutoff_at, *stale_sources)).fetchall()
    for row in rows:
        db.execute(
            "UPDATE jobs SET stale=1, stale_at=? WHERE source_key=? AND external_id=?",
            (now, row["source_key"], row["external_id"]),
        )
        record_event(
            db,
            Job(row["source_key"], row["external_id"], row["company"], row["title"], "", "", "", "", "", "", ""),
            "stale",
            now,
        )
    return len(rows)


def prune_excluded_jobs(db_path: Path, config_path: Path) -> int:
    """Immediately remove active jobs that no longer meet the feed quality filters."""
    config = load_config(config_path)
    filters_by_source = {
        source["key"]: source_filters(config.get("filters", {}), source)
        for source in config.get("sources", [])
    }
    db = connect_db(db_path)
    rows = db.execute("SELECT * FROM jobs WHERE active=1").fetchall()
    now = utc_now()
    removed = 0
    for row in rows:
        filters = filters_by_source.get(row["source_key"])
        source = next((item for item in config.get("sources", []) if item["key"] == row["source_key"]), None)
        should_apply_html_guard = bool(source and source.get("type") == "html")
        if not filters or not (
            filters.get("exclude_title_keywords") or filters.get("exclude_title_prefixes")
            or filters.get("exclude_team_keywords") or should_apply_html_guard
        ):
            continue
        job = Job(
            source_key=row["source_key"], external_id=row["external_id"],
            company=row["company"], title=row["title"], location=row["location"],
            team=row["team"], workplace_type=row["workplace_type"],
            description=row["description"], url=row["url"], posted_at=row["posted_at"],
            source_updated_at=row["source_updated_at"],
        )
        passes_stop_words = matches_filters(job, {
            "exclude_title_keywords": filters.get("exclude_title_keywords", []),
            "exclude_title_prefixes": filters.get("exclude_title_prefixes", []),
            "exclude_team_keywords": filters.get("exclude_team_keywords", []),
        })
        if (not should_apply_html_guard or is_probable_html_job_title(job.title)) and passes_stop_words:
            continue
        db.execute(
            "UPDATE jobs SET active=0, stale=0, stale_at=NULL, missing_runs=0, closed_at=? "
            "WHERE source_key=? AND external_id=?",
            (now, job.source_key, job.external_id),
        )
        record_event(db, job, "filtered", now)
        removed += 1
    db.commit()
    db.close()
    print(f"Исключено из активной выдачи: {removed}")
    return removed


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        config = json.load(handle)
    keys: set[str] = set()
    for source in config.get("sources", []):
        required = {"key", "company", "type"}
        missing = required - source.keys()
        if missing:
            raise ValueError(f"В источнике отсутствуют поля: {', '.join(sorted(missing))}")
        if source["key"] in keys:
            raise ValueError(f"Повторяющийся key источника: {source['key']}")
        keys.add(source["key"])
    return config


def reindex_vacancies(
    db_path: Path, taxonomy_path: Path = DEFAULT_TAXONOMY_PATH,
    force: bool = False,
) -> int:
    """Index active vacancies whose text or taxonomy version has changed."""
    taxonomy = TaxonomyConfigLoader.load(taxonomy_path)
    db = connect_db(db_path)
    try:
        service = VacancyIndexingService(taxonomy, VacancyFeatureRepository(db))
        indexed = service.reindex_outdated(force=force)
        db.commit()
    finally:
        db.close()
    print(f"Индекс вакансий: обработано новых/изменённых: {indexed}")
    return indexed


def _run_sync(config_path: Path, db_path: Path, only_keys: set[str] | None = None) -> int:
    config = load_config(config_path)
    db = connect_db(db_path)
    sync_started = utc_now()
    timeout = int(config.get("http", {}).get("timeout_seconds", 20))
    retries = int(config.get("http", {}).get("retries", 2))
    source_workers = max(1, min(16, int(config.get("http", {}).get("source_workers", 6))))
    per_domain_workers = max(1, min(8, int(config.get("http", {}).get("per_domain_workers", 2))))
    close_after = max(1, int(config.get("close_after_missing_runs", 2)))
    stale_after_days = max(1, int(config.get("stale_after_days", 7)))
    filters = config.get("filters", {})
    failures = 0
    enabled = [
        s for s in config.get("sources", [])
        if s.get("enabled", True) and (only_keys is None or s["key"] in only_keys)
    ]
    if not enabled:
        print("Нет включённых источников. Отредактируйте config.json.")
        db.close()
        return 0

    sync_cursor = db.execute(
        "INSERT INTO sync_runs(started_at, total_sources) VALUES (?, ?)",
        (sync_started, len(enabled)),
    )
    sync_id = sync_cursor.lastrowid
    db.commit()
    totals = {"succeeded": 0, "failed": 0, "jobs_received": 0, "jobs_accepted": 0,
              "new_jobs": 0, "updated_jobs": 0, "reopened_jobs": 0, "restored_jobs": 0,
              "closed_jobs": 0}

    def fetch_one(source: dict[str, Any]) -> tuple[str, list[Job] | None, Exception | None]:
        started = utc_now()
        try:
            return started, fetch_source_jobs(source, config, timeout, retries), None
        except Exception as exc:
            return started, None, exc

    pool_connections = min(64, max(8, source_workers * per_domain_workers * 2))
    with configured_request_limiter(per_domain_workers), configured_http_client(timeout, pool_connections):
        with ThreadPoolExecutor(max_workers=min(source_workers, len(enabled))) as executor:
            futures = {executor.submit(fetch_one, source): source for source in enabled}
            for future in as_completed(futures):
                source = futures[future]
                started, fetched, fetch_error = future.result()
                try:
                    if fetch_error is not None:
                        raise fetch_error
                    assert fetched is not None
                    filters_for_source = source_filters(filters, source)
                    jobs = [job for job in fetched if matches_filters(job, filters_for_source)]
                    now = utc_now()
                    authoritative = is_authoritative_source(source)
                    source_close_after = max(1, int(source.get("close_after_missing_runs", close_after)))
                    with db:
                        counts = persist_source(db, jobs, source["key"], source_close_after, now, authoritative)
                        db.execute(
                            "INSERT INTO runs(source_key, company, sync_id, started_at, finished_at, status, jobs_received, jobs_accepted, new_jobs, updated_jobs, reopened_jobs, restored_jobs, closed_jobs) VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?)",
                            (source["key"], source["company"], sync_id, started, now, len(fetched), len(jobs), counts["new"], counts["updated"], counts["reopened"], counts["restored"], counts["closed"]),
                        )
                    totals["succeeded"] += 1
                    totals["jobs_received"] += len(fetched)
                    totals["jobs_accepted"] += len(jobs)
                    for key in ("new", "updated", "reopened", "restored", "closed"):
                        totals[f"{key}_jobs"] += counts[key]
                    print(f"{source['company']}: получено {len(fetched)}, подходит {len(jobs)}, "
                          f"новых {counts['new']}, изменено {counts['updated']}, "
                          f"переоткрыто {counts['reopened']}, восстановлено {counts['restored']}, "
                          f"закрыто {counts['closed']}")
                except Exception as exc:
                    failures += 1
                    now = utc_now()
                    with db:
                        db.execute(
                            "INSERT INTO runs(source_key, company, sync_id, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?, 'error', ?)",
                            (source["key"], source["company"], sync_id, started, now, str(exc)),
                        )
                    totals["failed"] += 1
                    print(f"ОШИБКА {source['company']}: {exc}", file=sys.stderr)
    now = utc_now()
    with db:
        stale_count = mark_stale_jobs(db, config.get("sources", []), stale_after_days, now)
        db.execute(
            "UPDATE sync_runs SET finished_at=?, status=?, succeeded_sources=?, failed_sources=?, jobs_received=?, jobs_accepted=?, new_jobs=?, updated_jobs=?, reopened_jobs=?, restored_jobs=?, closed_jobs=?, stale_jobs=? WHERE id=?",
            (now, "error" if failures else "ok", totals["succeeded"], totals["failed"], totals["jobs_received"], totals["jobs_accepted"], totals["new_jobs"], totals["updated_jobs"], totals["reopened_jobs"], totals["restored_jobs"], totals["closed_jobs"], stale_count, sync_id),
        )
    db.close()
    if stale_count:
        print(f"Помечено устаревшими: {stale_count} (не подтверждались более {stale_after_days} дн.)")
    return 1 if failures else 0


def run_sync(config_path: Path, db_path: Path, only_keys: set[str] | None = None) -> int:
    """Synchronize sources while preventing competing processes from changing one database."""
    try:
        with SyncLock(db_path):
            return _run_sync(config_path, db_path, only_keys)
    except SyncAlreadyRunningError as exc:
        print(exc, file=sys.stderr)
        return 3


def initialize_telegram_cursor(db_path: Path, force: bool = False) -> None:
    notifications.initialize_cursor(db_path, force)


def telegram_api_send(token: str, chat_id: str, message: str, timeout: int = 30) -> None:
    notifications.send_api(token, chat_id, message, send_http_request, USER_AGENT, timeout)


def print_console_message(message: str) -> None:
    notifications.print_message(message)


def matches_notification_filter(job: sqlite3.Row, settings: dict[str, Any]) -> bool:
    return notifications.matches_filter(job, settings)

    # Legacy implementation kept temporarily below during the adapter refactor.
    notification_filter = settings.get("filter") or {}
    technologies = detect_technologies(job["title"], job["team"], job["description"])
    selected_technologies = {
        text_value(value).casefold() for value in notification_filter.get("technologies", []) if value
    }
    if selected_technologies and not any(
        value.casefold() in selected_technologies for value in technologies
    ):
        return False

    haystack = " ".join(text_value(job[key]) for key in (
        "company", "title", "location", "team", "workplace_type", "description",
    )).casefold()
    for key, field in (
        ("keywords", haystack),
        ("companies", text_value(job["company"]).casefold()),
        ("locations", text_value(job["location"]).casefold()),
    ):
        values = [text_value(value).casefold() for value in notification_filter.get(key, []) if value]
        if values and not any(value in field for value in values):
            return False
    return True


def send_telegram_notifications(
    db_path: Path, token: str, chat_id: str,
    settings: dict[str, Any] | None = None, dry_run: bool = False,
) -> int:
    return notifications.send_new(
        db_path, token, chat_id, settings or {}, dry_run,
        telegram_api_send, print_console_message,
    )


def send_telegram_user_notifications(
    db_path: Path, token: str, subscribers_url: str, sync_token: str,
    site_url: str, dry_run: bool = False,
) -> dict[str, int]:
    payload = fetch_json(subscribers_url, 30, 2, {"Authorization": f"Bearer {sync_token}"})
    subscribers = payload.get("subscribers") if isinstance(payload, dict) else None
    if not isinstance(subscribers, list):
        raise RuntimeError("Сервис не вернул список подписчиков Telegram")
    return notifications.send_new_to_subscribers(
        db_path, token, subscribers, site_url, dry_run,
        telegram_api_send, print_console_message,
    )

    # Legacy implementation kept temporarily below during the adapter refactor.
    settings = settings or {}
    db = connect_db(db_path)
    state = db.execute(
        "SELECT value FROM notifier_state WHERE name='telegram_event_cursor'"
    ).fetchone()
    if not state:
        db.close()
        initialize_telegram_cursor(db_path)
        print("Исторические вакансии не отправлены. Повторите команду после следующего обновления.")
        return 0
    cursor = int(state["value"])
    events = db.execute("""
        SELECT e.id, e.event_type, j.company, j.title, j.location, j.team,
               j.workplace_type, j.description, j.url
        FROM events e
        LEFT JOIN jobs j ON j.source_key=e.source_key AND j.external_id=e.external_id
        WHERE e.id > ? ORDER BY e.id
    """, (cursor,)).fetchall()
    sent = 0
    filtered_out = 0
    for event in events:
        if event["event_type"] == "new" and event["title"]:
            if not matches_notification_filter(event, settings):
                filtered_out += 1
                cursor = int(event["id"])
                if not dry_run:
                    db.execute(
                        "UPDATE notifier_state SET value=?, updated_at=? WHERE name='telegram_event_cursor'",
                        (str(cursor), utc_now()),
                    )
                    db.commit()
                continue
            technologies = detect_technologies(
                event["title"], event["team"], event["description"],
            )
            meta = [value for value in (
                event["location"], event["workplace_type"],
                ", ".join(technologies),
            ) if value]
            message = (
                "🆕 <b>Новая вакансия</b>\n\n"
                f"<b>{html.escape(event['company'])}</b>\n"
                f"{html.escape(event['title'])}"
            )
            if meta:
                message += "\n" + html.escape(" · ".join(meta))
            if event["url"]:
                message += f'\n\n<a href="{html.escape(event["url"], quote=True)}">Открыть вакансию</a>'
            if dry_run:
                print_console_message(message)
            else:
                telegram_api_send(token, chat_id, message)
                time.sleep(0.08)
            sent += 1
        cursor = int(event["id"])
        if not dry_run:
            db.execute(
                "UPDATE notifier_state SET value=?, updated_at=? WHERE name='telegram_event_cursor'",
                (str(cursor), utc_now()),
            )
            db.commit()
    db.close()
    print(
        f"Telegram: отправлено новых вакансий: {sent}; "
        f"не подошло под фильтр: {filtered_out}."
    )
    return sent


def send_telegram_digest(
    db_path: Path, token: str, chat_id: str,
    settings: dict[str, Any] | None = None, limit: int = 10,
    offset: int = 0, dry_run: bool = False,
) -> int:
    return notifications.send_digest(
        db_path, token, chat_id, settings or {}, limit, offset, dry_run,
        telegram_api_send, print_console_message,
    )

    # Legacy implementation kept temporarily below during the adapter refactor.
    """Send a fresh selection of active vacancies matching the notification filter."""
    settings = settings or {}
    db = connect_db(db_path)
    rows = db.execute("""
        SELECT company, title, location, team, workplace_type, description, url
        FROM jobs WHERE active=1 AND stale=0
        ORDER BY first_seen_at DESC, company, title
    """).fetchall()
    matching = [row for row in rows if matches_notification_filter(row, settings)]
    offset = max(0, offset)
    selected = matching[offset:offset + max(1, limit)]
    db.close()
    if not selected:
        print("Telegram-подборка: подходящих активных вакансий не найдено.")
        return 0

    messages: list[str] = []
    current = f"☕ <b>Подборка вакансий</b>\n\nНайдено позиций: {len(selected)}"
    for index, job in enumerate(selected, 1):
        title = html.escape(job["title"])
        if job["url"]:
            title = f'<a href="{html.escape(job["url"], quote=True)}">{title}</a>'
        meta = " · ".join(value for value in (
            text_value(job["location"]), text_value(job["workplace_type"]),
        ) if value)
        block = f"\n\n{index}. <b>{html.escape(job['company'])}</b>\n{title}"
        if meta:
            block += f"\n{html.escape(meta)}"
        if len(current) + len(block) > 3800:
            messages.append(current)
            current = block.lstrip()
        else:
            current += block
    messages.append(current)
    for message in messages:
        if dry_run:
            print_console_message(message)
        else:
            telegram_api_send(token, chat_id, message)
            time.sleep(0.08)
    print(f"Telegram-подборка: отправлено вакансий: {len(selected)}.")
    return len(selected)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Агрегатор вакансий hh.ru, Greenhouse и Lever")
    parser.add_argument("--db", type=Path, default=Path("data/jobs.sqlite3"))
    sub = parser.add_subparsers(dest="command", required=True)
    sync = sub.add_parser("sync", help="загрузить и обновить вакансии")
    sync.add_argument("--config", type=Path, default=Path("config.json"))
    sync.add_argument("--only", nargs="+", help="обновить только указанные ключи источников")
    export = sub.add_parser("export", help="выгрузить вакансии в CSV")
    export.add_argument("--output", type=Path, default=Path("data/jobs.csv"))
    export.add_argument("--all", action="store_true", help="включить закрытые и устаревшие")
    site_data = sub.add_parser("site-data", help="выгрузить активные вакансии с индексом релевантности")
    site_data.add_argument("--output", type=Path, default=Path("data/vacancies.js"))
    site_data.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY_PATH)
    refresh_report = sub.add_parser("refresh-report", help="выгрузить отчёт последнего обновления")
    refresh_report.add_argument("--output", type=Path, default=Path("frontend/public/vacancy-refresh.json"))
    refresh_report.add_argument("--limit", type=int, default=12)
    reindex = sub.add_parser("reindex", help="построить/обновить индекс релевантности вакансий")
    reindex.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY_PATH)
    reindex.add_argument("--force", action="store_true", help="переиндексировать все активные вакансии")
    prune = sub.add_parser(
        "prune-excluded", help="сразу убрать из выдачи вакансии, не прошедшие фильтры качества",
    )
    prune.add_argument("--config", type=Path, default=Path("config.json"))
    sub.add_parser("stats", help="показать статистику")
    telegram_init = sub.add_parser(
        "telegram-init", help="включить уведомления без отправки старых вакансий",
    )
    telegram_init.add_argument("--force", action="store_true", help="перенести курсор на текущее событие")
    telegram_notify = sub.add_parser(
        "telegram-notify", help="отправить новые вакансии из очереди в Telegram",
    )
    telegram_notify.add_argument("--dry-run", action="store_true", help="показать сообщения без отправки")
    telegram_notify.add_argument(
        "--settings", type=Path, help="JSON с chat_id и фильтром уведомлений",
    )
    telegram_users = sub.add_parser("telegram-notify-users", help="отправить новые вакансии по фильтрам пользователей")
    telegram_users.add_argument("--subscribers-url", required=True)
    telegram_users.add_argument("--sync-token", required=True)
    telegram_users.add_argument("--site-url", required=True)
    telegram_users.add_argument("--dry-run", action="store_true")
    telegram_digest = sub.add_parser(
        "telegram-digest", help="отправить подборку активных вакансий по фильтру",
    )
    telegram_digest.add_argument("--limit", type=int, default=10)
    telegram_digest.add_argument("--offset", type=int, default=0)
    telegram_digest.add_argument("--dry-run", action="store_true")
    telegram_digest.add_argument(
        "--settings", type=Path, help="JSON с chat_id и фильтром уведомлений",
    )
    sub.add_parser("telegram-test", help="отправить тестовое сообщение в Telegram")
    args = parser.parse_args(argv)
    if args.command == "sync":
        return run_sync(args.config, args.db, set(args.only) if args.only else None)
    if args.command == "export":
        export_csv(args.db, args.output, args.all)
        return 0
    if args.command == "site-data":
        export_site_data(args.db, args.output, args.taxonomy)
        return 0
    if args.command == "refresh-report":
        export_refresh_report(args.db, args.output, args.limit)
        return 0
    if args.command == "reindex":
        reindex_vacancies(args.db, args.taxonomy, args.force)
        return 0
    if args.command == "prune-excluded":
        prune_excluded_jobs(args.db, args.config)
        return 0
    if args.command == "telegram-init":
        initialize_telegram_cursor(args.db, args.force)
        return 0
    if args.command in {"telegram-notify", "telegram-digest", "telegram-test", "telegram-notify-users"}:
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        dry_run = bool(getattr(args, "dry_run", False))
        if not dry_run and not token:
            print(
                "Для отправки задайте TELEGRAM_BOT_TOKEN.",
                file=sys.stderr,
            )
            return 2
        if args.command == "telegram-notify-users":
            result = send_telegram_user_notifications(args.db, token, args.subscribers_url, args.sync_token, args.site_url, dry_run)
            print(f"Telegram пользователям: отправлено: {result['sent']}; совпадений: {result['matched']}; ошибок: {result['failed']}.")
            return 0 if not result["failed"] else 1
        if not dry_run and not chat_id:
            print("Для этого режима задайте TELEGRAM_CHAT_ID.", file=sys.stderr)
            return 2
        if args.command == "telegram-test":
            telegram_api_send(
                token, chat_id,
                "✅ <b>Job Tracker подключён</b>\n\nНовые вакансии будут приходить сюда после автоматического обновления.",
            )
            print("Тестовое сообщение отправлено.")
            return 0
        settings: dict[str, Any] = {}
        settings_path = getattr(args, "settings", None)
        if settings_path:
            with settings_path.open(encoding="utf-8-sig") as handle:
                settings = json.load(handle)
        if args.command == "telegram-digest":
            send_telegram_digest(
                args.db, token, chat_id, settings,
                limit=max(1, int(args.limit)), offset=max(0, int(args.offset)),
                dry_run=dry_run,
            )
        else:
            send_telegram_notifications(args.db, token, chat_id, settings, dry_run)
        return 0
    show_stats(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
