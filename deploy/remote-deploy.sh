#!/usr/bin/env bash
set -euo pipefail

: "${API_IMAGE:?API_IMAGE is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"
: "${CRAWLER_IMAGE:?CRAWLER_IMAGE is required}"

ENV_FILE="${ENV_FILE:-deploy/.env}"
DEPLOY_MODE="${DEPLOY_MODE:-https}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
SERVICES=(db redis api worker crawler web)

case "$DEPLOY_MODE" in
  http)
    echo "Deploying HTTP staging on the web container port."
    ;;
  https)
    COMPOSE+=( -f docker-compose.prod.yml )
    SERVICES+=( caddy )
    ;;
  *)
    echo "DEPLOY_MODE must be http or https." >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE on the deployment host." >&2
  exit 1
fi

"${COMPOSE[@]}" pull "${SERVICES[@]}"
"${COMPOSE[@]}" up -d --no-build "${SERVICES[@]}"

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
