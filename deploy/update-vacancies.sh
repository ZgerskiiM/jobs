#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="${ENV_FILE:-deploy/.env}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
LOCK_FILE="${LOCK_FILE:-/tmp/jobs-dev-vacancies.lock}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/.env.example and fill in the values." >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another vacancy refresh is already running."; exit 3; }

"$PYTHON_BIN" job_tracker.py --db data/jobs.sqlite3 sync --config config.direct.json
"$PYTHON_BIN" job_tracker.py --db data/jobs.sqlite3 export --output data/jobs.csv
"$PYTHON_BIN" job_tracker.py --db data/jobs.sqlite3 site-data --output data/vacancies.js

"${COMPOSE[@]}" build web
"${COMPOSE[@]}" up -d --no-deps web
echo "Vacancy catalog refreshed and web container restarted."
