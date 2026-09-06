"""Run the vacancy synchronizer on the staging host and publish its catalog."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHARED = Path(os.getenv("CRAWLER_SHARED_PATH", "/shared"))
DB_PATH = SHARED / "jobs.sqlite3"
CONFIG_PATH = ROOT / "config.direct.json"
RUNTIME_CONFIG = Path("/tmp/config.runtime.json")


def runtime_config() -> Path:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    http = config.setdefault("http", {})
    http["timeout_seconds"] = int(os.getenv("CRAWLER_TIMEOUT_SECONDS", "20"))
    http["retries"] = int(os.getenv("CRAWLER_RETRIES", "1"))
    RUNTIME_CONFIG.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    return RUNTIME_CONFIG


def run_once() -> None:
    SHARED.mkdir(parents=True, exist_ok=True)
    config = runtime_config()
    started = time.monotonic()
    print(f"[crawler] sync started at {datetime.now(timezone.utc).isoformat()}", flush=True)
    sync_timeout = int(os.getenv("CRAWLER_SYNC_TIMEOUT_SECONDS", "3300"))
    try:
        result = subprocess.run(
            ["python", "job_tracker.py", "--db", str(DB_PATH), "sync", "--config", str(config)],
            check=False,
            timeout=sync_timeout,
        )
        print(f"[crawler] sync exited with code {result.returncode}", flush=True)
    except subprocess.TimeoutExpired:
        print(f"[crawler] sync exceeded {sync_timeout}s; publishing the last completed state", flush=True)

    # Export into the image filesystem first, then atomically publish files to
    # the shared volume consumed by nginx and Django.
    subprocess.run(["python", "job_tracker.py", "--db", str(DB_PATH), "export", "--output", str(ROOT / "data/jobs.csv")], check=True)
    subprocess.run(["python", "job_tracker.py", "--db", str(DB_PATH), "site-data", "--output", str(ROOT / "data/vacancies.js")], check=True)
    subprocess.run(["node", "frontend/scripts/prepare-vacancy-data.mjs"], cwd=ROOT / "frontend", check=True)
    report = ROOT / "frontend/public/vacancy-refresh.json"
    subprocess.run(["python", "job_tracker.py", "--db", str(DB_PATH), "refresh-report", "--output", str(report)], check=True)

    for source, target_name in (
        (ROOT / "frontend/public/vacancies.json", "vacancies.json"),
        (report, "vacancy-refresh.json"),
    ):
        temporary = SHARED / f".{target_name}.tmp"
        shutil.copyfile(source, temporary)
        os.replace(temporary, SHARED / target_name)
    print(f"[crawler] published catalog in {time.monotonic() - started:.1f}s", flush=True)


def seconds_until_next_run() -> float:
    # 05:00 UTC-3 == 08:00 UTC.
    now = datetime.now(timezone.utc)
    target = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


while True:
    try:
        run_once()
    except Exception as exc:  # keep the long-running service alive for the next run
        print(f"[crawler] failed: {exc}", flush=True)
    delay = max(60.0, seconds_until_next_run())
    print(f"[crawler] next run in {delay / 3600:.2f}h", flush=True)
    time.sleep(delay)
