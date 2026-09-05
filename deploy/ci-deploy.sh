#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${API_IMAGE:?API_IMAGE is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"
: "${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY is required}"
: "${SSH_KNOWN_HOSTS:?SSH_KNOWN_HOSTS is required}"
: "${CI_REGISTRY:?CI_REGISTRY is required}"
: "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
: "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"

eval "$(ssh-agent -s)"
printf '%s' "$SSH_PRIVATE_KEY" | tr -d '\r' | ssh-add -
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
chmod 600 "$HOME/.ssh/known_hosts"

REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
ssh "$REMOTE" "mkdir -p '$DEPLOY_PATH/deploy'"
scp docker-compose.yml docker-compose.prod.yml "$REMOTE:$DEPLOY_PATH/"
scp deploy/Caddyfile deploy/remote-deploy.sh "$REMOTE:$DEPLOY_PATH/deploy/"

printf '%s' "$CI_REGISTRY_PASSWORD" | ssh "$REMOTE" \
  "docker login '$CI_REGISTRY' --username '$CI_REGISTRY_USER' --password-stdin"

ssh "$REMOTE" "cd '$DEPLOY_PATH' && API_IMAGE='$API_IMAGE' WEB_IMAGE='$WEB_IMAGE' bash deploy/remote-deploy.sh"
