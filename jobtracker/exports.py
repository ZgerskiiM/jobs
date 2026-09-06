"""Read-only projections of the SQLite vacancy catalog."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from .models import utc_now
from .storage import connect_db
from .vacancy_scoring import (
    DEFAULT_TAXONOMY_PATH,
    TaxonomyConfigLoader,
    VacancyFeatureRepository,
    VacancyFeatures,
    VacancyIndexingService,
)


TECHNOLOGY_PATTERNS: tuple[tuple[str, str], ...] = (
    ("Java", r"(?<![\w])java(?!script|\w)"), ("Kotlin", r"\bkotlin\b"),
    ("Python", r"\bpython\b"), ("Go", r"\bgolang\b|\bgo[- ](?:developer|engineer|разработчик)\b"),
    ("JavaScript", r"\bjavascript\b|\bjs\b"), ("TypeScript", r"\btypescript\b"),
    ("C# / .NET", r"(?<!\w)c#(?!\w)|\.net\b|\bdotnet\b"),
    ("C / C++", r"(?<!\w)c\+\+(?!\w)|\bcpp\b|\bс\+\+\b"), ("PHP", r"\bphp\b"),
    ("Ruby", r"\bruby\b"), ("Scala", r"\bscala\b"), ("Rust", r"\brust\b"),
    ("1С", r"(?<!\w)1[сc](?!\w)|1[сc][:-]?предприятие|1c[:-]?enterprise"),
    ("Bitrix24", r"\bbitrix24\b|битрикс24"), ("BPMSoft", r"\bbpmsoft\b"),
    ("Axapta / Dynamics AX", r"\b(?:axapta|dynamics ax)\b"), ("Optimacros", r"\boptimacros\b"),
    ("SQL", r"\bsql\b|postgres(?:ql)?|clickhouse"),
    ("Data / ML", r"\bmachine learning\b|\bdata science\b|\bml[- /]|\bllm\b|\bai[- /]|машинн\w+ обучен"),
    ("DevOps / SRE", r"\bdevops\b|\bsre\b|kubernetes|\bk8s\b|terraform"),
    ("QA", r"\bqa\b|тестиров\w+|quality assurance"),
)


def detect_technologies(*values: str) -> list[str]:
    text = " ".join(value for value in values if value)
    return [name for name, pattern in TECHNOLOGY_PATTERNS if re.search(pattern, text, re.IGNORECASE)]


def export_csv(db_path: Path, output_path: Path, include_closed: bool) -> None:
    db = connect_db(db_path)
    where = "" if include_closed else "WHERE active=1 AND stale=0"
    rows = db.execute(f"""
        SELECT company, title, location, team, workplace_type, url, posted_at,
               first_seen_at, last_seen_at, active, stale, stale_at, closed_at, source_key
        FROM jobs {where} ORDER BY active DESC, company, title
    """).fetchall()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(rows[0].keys() if rows else [
            "company", "title", "location", "team", "workplace_type", "url", "posted_at",
            "first_seen_at", "last_seen_at", "active", "stale", "stale_at", "closed_at", "source_key",
        ])
        writer.writerows(tuple(row) for row in rows)
    db.close()
    print(f"Экспортировано вакансий: {len(rows)} -> {output_path}")


def export_site_data(
    db_path: Path, output_path: Path, taxonomy_path: Path = DEFAULT_TAXONOMY_PATH,
) -> None:
    """Export active vacancies with a precomputed compact scoring index."""
    db = connect_db(db_path)
    taxonomy = TaxonomyConfigLoader.load(taxonomy_path)
    index_repository = VacancyFeatureRepository(db)
    indexed = VacancyIndexingService(taxonomy, index_repository).reindex_outdated()
    db.commit()
    rows = db.execute("""
        SELECT external_id AS id, company, title, location, team, workplace_type,
               description, url, posted_at, first_seen_at, source_key, feature.features
        FROM jobs
        JOIN vacancy_feature_index feature USING (source_key, external_id)
        WHERE active=1 AND stale=0 ORDER BY first_seen_at DESC, company, title
    """).fetchall()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = []
    for row in rows:
        item = dict(row)
        features = VacancyFeatures.from_dict(json.loads(item.pop("features")))
        item["scoring_features"] = features.to_compact_dict()
        item["technologies"] = detect_technologies(item.get("title", ""), item.get("team", ""), item.get("description", ""))
        data.append(item)
    payload = (
        "window.VACANCIES_META = " + json.dumps({"updated_at": utc_now(), "count": len(data)}, ensure_ascii=False, indent=2)
        + ";\nwindow.VACANCIES = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    )
    output_path.write_text(payload, encoding="utf-8")
    db.close()
    print(f"Данные для сайта: {len(rows)} вакансий, переиндексировано {indexed} -> {output_path}")


def show_stats(db_path: Path) -> None:
    db = connect_db(db_path)
    rows = db.execute("""
        SELECT company, COUNT(*) total, SUM(active) active, SUM(active AND stale) stale,
               SUM(active AND NOT stale) fresh, SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) closed
        FROM jobs GROUP BY company ORDER BY company
    """).fetchall()
    if not rows:
        print("База пока пуста.")
    else:
        print(f"{'Компания':30} {'Всего':>8} {'Свежие':>8} {'Устар.':>8} {'Закрыто':>8}")
        for row in rows:
            print(f"{row['company'][:30]:30} {row['total']:8} {row['fresh']:8} {row['stale']:8} {row['closed']:8}")
    db.close()


def export_refresh_report(db_path: Path, output_path: Path, limit: int = 12) -> None:
    """Export the latest synchronisation runs for the admin operational dashboard."""
    db = connect_db(db_path)
    latest = db.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    if latest is None:
        payload = {"available": False, "message": "Обновления ещё не запускались", "runs": [], "sources": []}
    else:
        latest_id = latest["id"]
        sources = db.execute(
            "SELECT * FROM runs WHERE sync_id = ? ORDER BY CASE WHEN status = 'error' THEN 0 ELSE 1 END, company COLLATE NOCASE",
            (latest_id,),
        ).fetchall()
        history = db.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", (max(1, limit),)).fetchall()
        payload = {
            "available": True,
            "latest": dict(latest),
            "sources": [dict(row) for row in sources],
            "runs": [dict(row) for row in history],
        }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    db.close()
    print(f"Отчёт обновления: {output_path}")
