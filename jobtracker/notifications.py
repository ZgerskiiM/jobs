"""Telegram delivery and notification filtering for the vacancy catalog."""

from __future__ import annotations

import html
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from .exports import detect_technologies
from .models import text_value, utc_now
from .storage import connect_db


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
    for key, value in (("keywords", haystack), ("companies", text_value(job["company"]).casefold()), ("locations", text_value(job["location"]).casefold())):
        choices = [text_value(item).casefold() for item in selected_filter.get(key, []) if item]
        if choices and not any(choice in value for choice in choices): return False
    return True


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


def send_digest(db_path: Path, token: str, chat_id: str, settings: dict[str, Any], limit: int, offset: int, dry_run: bool, sender: Callable[..., None], printer: Callable[[str], None]) -> int:
    db = connect_db(db_path); rows = db.execute("SELECT company, title, location, team, workplace_type, description, url FROM jobs WHERE active=1 AND stale=0 ORDER BY first_seen_at DESC, company, title").fetchall(); db.close()
    selected = [row for row in rows if matches_filter(row, settings)][max(0, offset):max(0, offset) + max(1, limit)]
    if not selected: print("Telegram-подборка: подходящих активных вакансий не найдено."); return 0
    messages, current = [], f"☕ <b>Подборка вакансий</b>\n\nНайдено позиций: {len(selected)}"
    for index, job in enumerate(selected, 1):
        title = html.escape(job["title"]); title = f'<a href="{html.escape(job["url"], quote=True)}">{title}</a>' if job["url"] else title
        meta = " · ".join(value for value in (text_value(job["location"]), text_value(job["workplace_type"])) if value)
        block = f"\n\n{index}. <b>{html.escape(job['company'])}</b>\n{title}" + (f"\n{html.escape(meta)}" if meta else "")
        if len(current) + len(block) > 3800: messages.append(current); current = block.lstrip()
        else: current += block
    messages.append(current)
    for message in messages:
        if dry_run: printer(message)
        else: sender(token, chat_id, message); time.sleep(0.08)
    print(f"Telegram-подборка: отправлено вакансий: {len(selected)}."); return len(selected)
