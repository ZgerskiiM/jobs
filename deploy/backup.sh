#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="${ENV_FILE:-deploy/.env}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/.env.example and fill in the values." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

"${COMPOSE[@]}" exec -T db pg_dump -U "${POSTGRES_USER:?POSTGRES_USER is required}" -d "${POSTGRES_DB:?POSTGRES_DB is required}" \
  | gzip > "$BACKUP_DIR/postgres-$STAMP.sql.gz"

"${COMPOSE[@]}" exec -T api tar czf - -C /app/media . \
  > "$BACKUP_DIR/media-$STAMP.tar.gz"

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Created backup $STAMP in $BACKUP_DIR"
