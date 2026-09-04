"""SQLite schema and transactional persistence for normalized vacancies."""

from __future__ import annotations

import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import Iterable

from .models import Job


def connect_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS jobs (
            source_key TEXT NOT NULL, external_id TEXT NOT NULL, company TEXT NOT NULL,
            title TEXT NOT NULL, location TEXT NOT NULL, team TEXT NOT NULL,
            workplace_type TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL,
            posted_at TEXT NOT NULL, source_updated_at TEXT NOT NULL, fingerprint TEXT NOT NULL,
            first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            missing_runs INTEGER NOT NULL DEFAULT 0, closed_at TEXT, stale INTEGER NOT NULL DEFAULT 0,
            stale_at TEXT, PRIMARY KEY (source_key, external_id)
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL,
            external_id TEXT NOT NULL, event_type TEXT NOT NULL, happened_at TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL,
            started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL,
            jobs_received INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS notifier_state (
            name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vacancy_feature_index (
            source_key TEXT NOT NULL, external_id TEXT NOT NULL,
            taxonomy_version TEXT NOT NULL, indexed_at TEXT NOT NULL,
            content_hash TEXT NOT NULL, features TEXT NOT NULL,
            PRIMARY KEY (source_key, external_id)
        );
    """)
    columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}
    if "stale" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN stale INTEGER NOT NULL DEFAULT 0")
    if "stale_at" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN stale_at TEXT")
    return db


def record_event(db: sqlite3.Connection, job: Job, event_type: str, now: str) -> None:
    db.execute(
        "INSERT INTO events(source_key, external_id, event_type, happened_at) VALUES (?, ?, ?, ?)",
        (job.source_key, job.external_id, event_type, now),
    )


def persist_source(
    db: sqlite3.Connection, jobs: Iterable[Job], source_key: str, close_after: int,
    now: str, authoritative: bool = True,
) -> dict[str, int]:
    jobs = list(jobs)
    seen_ids = {job.external_id for job in jobs}
    counts = {"new": 0, "updated": 0, "reopened": 0, "restored": 0, "closed": 0, "active": len(jobs)}
    for job in jobs:
        old = db.execute(
            "SELECT fingerprint, active, stale FROM jobs WHERE source_key=? AND external_id=?",
            (source_key, job.external_id),
        ).fetchone()
        values = asdict(job)
        if old is None:
            db.execute("""
                INSERT INTO jobs(source_key, external_id, company, title, location, team,
                    workplace_type, description, url, posted_at, source_updated_at, fingerprint,
                    first_seen_at, last_seen_at, active, missing_runs, closed_at)
                VALUES (:source_key, :external_id, :company, :title, :location, :team,
                    :workplace_type, :description, :url, :posted_at, :source_updated_at, :fingerprint,
                    :now, :now, 1, 0, NULL)
            """, values | {"fingerprint": job.fingerprint, "now": now})
            record_event(db, job, "new", now)
            counts["new"] += 1
            continue
        event = None
        if not old["active"]:
            event, counts["reopened"] = "reopened", counts["reopened"] + 1
        elif old["stale"]:
            event, counts["restored"] = "restored", counts["restored"] + 1
        elif old["fingerprint"] != job.fingerprint:
            event, counts["updated"] = "updated", counts["updated"] + 1
        db.execute("""
            UPDATE jobs SET company=:company, title=:title, location=:location, team=:team,
                workplace_type=:workplace_type, description=:description, url=:url,
                posted_at=:posted_at, source_updated_at=:source_updated_at, fingerprint=:fingerprint,
                last_seen_at=:now, active=1, stale=0, stale_at=NULL, missing_runs=0, closed_at=NULL
            WHERE source_key=:source_key AND external_id=:external_id
        """, values | {"fingerprint": job.fingerprint, "now": now})
        if event:
            record_event(db, job, event, now)

    active_rows = db.execute(
        "SELECT external_id FROM jobs WHERE source_key=? AND active=1", (source_key,)
    ).fetchall() if authoritative else []
    for external_id in (row["external_id"] for row in active_rows if row["external_id"] not in seen_ids):
        db.execute(
            "UPDATE jobs SET missing_runs=missing_runs+1 WHERE source_key=? AND external_id=?",
            (source_key, external_id),
        )
        row = db.execute(
            "SELECT missing_runs, company, title FROM jobs WHERE source_key=? AND external_id=?",
            (source_key, external_id),
        ).fetchone()
        if row["missing_runs"] >= close_after:
            db.execute(
                "UPDATE jobs SET active=0, stale=0, stale_at=NULL, closed_at=? WHERE source_key=? AND external_id=?",
                (now, source_key, external_id),
            )
            record_event(db, Job(source_key, external_id, row["company"], row["title"], "", "", "", "", "", "", ""), "closed", now)
            counts["closed"] += 1
    return counts
