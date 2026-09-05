#!/usr/bin/env bash
set -euo pipefail

: "${API_IMAGE:?API_IMAGE is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"

ENV_FILE="${ENV_FILE:-deploy/.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE on the deployment host." >&2
  exit 1
fi

"${COMPOSE[@]}" pull db redis api worker web caddy
"${COMPOSE[@]}" up -d --no-build db redis api worker web caddy

for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api python manage.py check >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    echo "API did not become ready in time." >&2
    "${COMPOSE[@]}" logs --tail=100 api >&2 || true
    exit 1
  fi
  sleep 2
done

"${COMPOSE[@]}" exec -T api python manage.py migrate --noinput
"${COMPOSE[@]}" ps
