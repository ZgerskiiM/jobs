"""Telegram delivery and notification filtering for the vacancy catalog."""

from __future__ import annotations

import html
import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from .exports import detect_technologies
from .models import text_value, utc_now
from .storage import connect_db


def site_job_id(source_key: str, external_id: str) -> int:
    """Match the signed 32-bit hash used by the frontend for catalog jobs."""
    value = f"{source_key}:{external_id}"
    result = 0
    for char in value:
        result = ((result * 31 + ord(char)) & 0xFFFFFFFF)
    signed = result - 0x100000000 if result & 0x80000000 else result
    return abs(signed)


def initialize_cursor(db_path: Path, force: bool = False) -> None:
    db = connect_db(db_path)
    existing = db.execute("SELECT value FROM notifier_state WHERE name='telegram_event_cursor'").fetchone()
    if existing and not force:
        print(f"Telegram уже инициализирован (курсор событий: {existing['value']}).")
        db.close()
        return
    last_event_id = int(db.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()[0])
    db.execute("""INSERT INTO notifier_state(name, value, updated_at) VALUES ('telegram_event_cursor', ?, ?)
        ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""", (str(last_event_id), utc_now()))
    db.commit()
    db.close()
    print(f"Telegram-уведомления начнутся со следующей новой вакансии (текущий курсор: {last_event_id}).")


def send_api(token: str, chat_id: str, message: str, request: Callable[..., Any], user_agent: str, timeout: int = 30) -> None:
    payload = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML", "disable_web_page_preview": True}, ensure_ascii=False).encode("utf-8")
    try:
        result = request("POST", f"https://api.telegram.org/bot{token}/sendMessage", timeout, 0,
            {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": user_agent}, payload).json()
    except (RuntimeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Telegram API недоступен: {exc}") from None
    if not result.get("ok"):
        raise RuntimeError(f"Telegram отклонил сообщение: {text_value(result.get('description'))}")


def print_message(message: str) -> None:
    encoding = sys.stdout.encoding or "utf-8"
    print(message.encode(encoding, "replace").decode(encoding))


def matches_filter(job: sqlite3.Row, settings: dict[str, Any]) -> bool:
    selected = {text_value(value).casefold() for value in (settings.get("filter") or {}).get("technologies", []) if value}
    technologies = detect_technologies(job["title"], job["team"], job["description"])
    if selected and not any(value.casefold() in selected for value in technologies): return False
    selected_filter = settings.get("filter") or {}
    haystack = " ".join(text_value(job[key]) for key in ("company", "title", "location", "team", "workplace_type", "description")).casefold()
    title_choices = [text_value(item).casefold() for item in selected_filter.get("titleKeywords", []) if item]
    if title_choices and not any(choice in text_value(job["title"]).casefold() for choice in title_choices):
        return False
    for key, value in (
        ("keywords", haystack),
        ("companies", text_value(job["company"]).casefold()),
        ("locations", text_value(job["location"]).casefold()),
        ("roles", text_value(job["title"]).casefold()),
        ("levels", text_value(job["title"]).casefold()),
        ("formats", " ".join((text_value(job["workplace_type"]), text_value(job["location"]))).casefold()),
    ):
        choices = [text_value(item).casefold() for item in selected_filter.get(key, []) if item]
        if choices and not any(choice in value for choice in choices): return False
    minimum = settings.get("matchScore")
    if minimum:
        try:
            if settings.get("relevanceScore") is None or float(settings["relevanceScore"]) < float(minimum):
                return False
        except (TypeError, ValueError):
            return False
    return True


def _score_events_for_subscriber(events: list[sqlite3.Row], subscriber: dict[str, Any]) -> dict[str, float]:
    """Use the same JS scorer as the site for a subscriber's active resume."""
    account = subscriber.get("scoringAccount")
    if not account or not events:
        return {}
    script = Path(__file__).resolve().parents[1] / "frontend" / "scripts" / "scoring-api.mjs"
    if not script.is_file():
        return {}
    items = [{
        "id": f"{event['source_key']}:{event['external_id']}",
        "title": event["title"] or "",
        "description": event["description"] or "",
        "posted_at": event["posted_at"] if "posted_at" in event.keys() else "",
    } for event in events]
    try:
        completed = subprocess.run(
            ["node", str(script)], input=json.dumps({"account": account, "items": items, "compact": True}, ensure_ascii=False),
            text=True, encoding="utf-8", capture_output=True, timeout=90,
            cwd=script.parents[2], check=True,
        )
        payload = json.loads(completed.stdout)
        scores = {}
        for result in payload.get("scores", []):
            vacancy_id = str(result.get("vacancyId", ""))
            if vacancy_id.startswith("catalog:"):
                scores[vacancy_id[len("catalog:"):]] = float(result.get("score", 0))
        return scores
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"Telegram: не удалось рассчитать релевантность для подписчика: {exc}", file=sys.stderr)
        return {}


def send_new(db_path: Path, token: str, chat_id: str, settings: dict[str, Any], dry_run: bool, sender: Callable[..., None], printer: Callable[[str], None]) -> int:
    db = connect_db(db_path); state = db.execute("SELECT value FROM notifier_state WHERE name='telegram_event_cursor'").fetchone()
    if not state:
        db.close(); initialize_cursor(db_path); print("Исторические вакансии не отправлены. Повторите команду после следующего обновления."); return 0
    cursor, sent, filtered = int(state["value"]), 0, 0
    events = db.execute("""SELECT e.id, e.event_type, j.company, j.title, j.location, j.team, j.workplace_type, j.description, j.url
        FROM events e LEFT JOIN jobs j ON j.source_key=e.source_key AND j.external_id=e.external_id WHERE e.id > ? ORDER BY e.id""", (cursor,)).fetchall()
    for event in events:
        if event["event_type"] == "new" and event["title"]:
            if not matches_filter(event, settings): filtered += 1
            else:
                meta = [value for value in (event["location"], event["workplace_type"], ", ".join(detect_technologies(event["title"], event["team"], event["description"]))) if value]
                message = f"🆕 <b>Новая вакансия</b>\n\n<b>{html.escape(event['company'])}</b>\n{html.escape(event['title'])}"
                if meta: message += "\n" + html.escape(" · ".join(meta))
                if event["url"]: message += f'\n\n<a href="{html.escape(event["url"], quote=True)}">Открыть вакансию</a>'
                if dry_run: printer(message)
                else: sender(token, chat_id, message); time.sleep(0.08)
                sent += 1
        cursor = int(event["id"])
        if not dry_run:
            db.execute("UPDATE notifier_state SET value=?, updated_at=? WHERE name='telegram_event_cursor'", (str(cursor), utc_now())); db.commit()
    db.close(); print(f"Telegram: отправлено новых вакансий: {sent}; не подошло под фильтр: {filtered}."); return sent


def send_new_to_subscribers(
    db_path: Path, token: str, subscribers: list[dict[str, Any]], site_url: str,
    dry_run: bool, sender: Callable[..., None], printer: Callable[[str], None],
) -> dict[str, int]:
    """Deliver new vacancy events to each user's saved Telegram filter."""
    db = connect_db(db_path)
    state = db.execute("SELECT value FROM notifier_state WHERE name='telegram_event_cursor'").fetchone()
    if not state:
        db.close()
        initialize_cursor(db_path)
        return {"sent": 0, "matched": 0, "failed": 0}
    cursor = int(state["value"])
    events = db.execute("""
        SELECT e.id, e.source_key, e.external_id, e.event_type, j.company, j.title, j.location,
               j.team, j.workplace_type, j.description, j.url, j.posted_at
        FROM events e LEFT JOIN jobs j ON j.source_key=e.source_key AND j.external_id=e.external_id
        WHERE e.id > ? AND e.event_type = 'new' ORDER BY e.id
    """, (cursor,)).fetchall()
    sent = matched = failed = 0
    site_origin = site_url.rstrip("/")
    score_cache: dict[str, dict[str, float]] = {}
    for event in events:
        for subscriber in subscribers:
            chat_id = str(subscriber.get("chatId") or "")
            selected_filter = subscriber.get("filter") or {}
            minimum = selected_filter.get("minMatchScore") or 0
            relevance_score = None
            if minimum:
                cache_key = json.dumps(subscriber.get("scoringAccount") or {}, ensure_ascii=False, sort_keys=True)
                if cache_key not in score_cache:
                    score_cache[cache_key] = _score_events_for_subscriber(events, subscriber)
                event_key = f"{event['source_key']}:{event['external_id']}"
                relevance_score = score_cache[cache_key].get(event_key)
            if not chat_id or not matches_filter(event, {"filter": selected_filter, "matchScore": minimum, "relevanceScore": relevance_score}):
                continue
            matched += 1
            delivery = db.execute("SELECT status FROM telegram_deliveries WHERE event_id=? AND chat_id=?", (event["id"], chat_id)).fetchone()
            if delivery and delivery["status"] == "sent":
                continue
            vacancy_url = f"{site_origin}/jobs/{site_job_id(event['source_key'], event['external_id'])}"
            message = f"🆕 <b>Новая вакансия</b>\n\n<b>{html.escape(event['company'] or 'Компания')}</b>\n{html.escape(event['title'] or 'Без названия')}\n\n<a href=\"{html.escape(vacancy_url, quote=True)}\">Открыть на jobs.dev</a>"
            if relevance_score is not None:
                message = message.replace("\n\n<a href", f"\n🎯 Релевантность резюме: <b>{relevance_score:.0f}%</b>\n\n<a href")
            try:
                if dry_run:
                    printer(f"[{chat_id}] {message}")
                else:
                    sender(token, chat_id, message)
                db.execute("INSERT OR REPLACE INTO telegram_deliveries(event_id, chat_id, status, error, sent_at) VALUES (?, ?, 'sent', '', ?)", (event["id"], chat_id, utc_now()))
                sent += 1
            except Exception as exc:
                failed += 1
                db.execute("INSERT OR REPLACE INTO telegram_deliveries(event_id, chat_id, status, error, sent_at) VALUES (?, ?, 'error', ?, NULL)", (event["id"], chat_id, str(exc)))
        cursor = int(event["id"])
    if not dry_run:
        db.execute("UPDATE notifier_state SET value=?, updated_at=? WHERE name='telegram_event_cursor'", (str(cursor), utc_now()))
        db.commit()
    db.close()
    return {"sent": sent, "matched": matched, "failed": failed}


def send_digest(db_path: Path, token: str, chat_id: str, settings: dict[str, Any], limit: int, offset: int, dry_run: bool, sender: Callable[..., None], printer: Callable[[str], None]) -> int:
    db = connect_db(db_path); rows = db.execute("SELECT source_key, external_id, company, title, location, team, workplace_type, description, posted_at FROM jobs WHERE active=1 AND stale=0 ORDER BY first_seen_at DESC, company, title").fetchall(); db.close()
    selected_filter = settings.get("filter") or {}
    base_settings = {"filter": {key: value for key, value in selected_filter.items() if key != "minMatchScore"}}
    candidates = [row for row in rows if matches_filter(row, base_settings)]
    minimum = selected_filter.get("minMatchScore") or 0
    score_map = _score_events_for_subscriber(candidates, settings) if minimum and settings.get("scoringAccount") else {}
    if minimum:
        candidates = [row for row in candidates if score_map.get(f"{row['source_key']}:{row['external_id']}") is not None and score_map[f"{row['source_key']}:{row['external_id']}"] >= float(minimum)]
    selected = candidates[max(0, offset):max(0, offset) + max(1, limit)]
    if not selected: print("Telegram-подборка: подходящих активных вакансий не найдено."); return 0
    messages, current = [], f"☕ <b>Подборка вакансий</b>\n\nНайдено позиций: {len(selected)}"
    site_origin = str(settings.get("siteUrl") or "https://devver.ru").rstrip("/")
    for index, job in enumerate(selected, 1):
        vacancy_url = f"{site_origin}/jobs/{site_job_id(job['source_key'], job['external_id'])}"
        title = f'<a href="{html.escape(vacancy_url, quote=True)}">{html.escape(job["title"])}</a>'
        meta = " · ".join(value for value in (text_value(job["location"]), text_value(job["workplace_type"])) if value)
        score = score_map.get(f"{job['source_key']}:{job['external_id']}")
        score_line = f"\n🎯 Релевантность резюме: <b>{score:.0f}%</b>" if score is not None else ""
        block = f"\n\n{index}. <b>{html.escape(job['company'])}</b>\n{title}" + (f"\n{html.escape(meta)}" if meta else "") + score_line
        if len(current) + len(block) > 3800: messages.append(current); current = block.lstrip()
        else: current += block
    messages.append(current)
    for message in messages:
        if dry_run: printer(message)
        else: sender(token, chat_id, message); time.sleep(0.08)
    print(f"Telegram-подборка: отправлено вакансий: {len(selected)}."); return len(selected)
