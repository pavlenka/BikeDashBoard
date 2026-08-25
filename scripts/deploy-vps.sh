#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${PROJECT_ROOT}/.deploy.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/.deploy.env"
  set +a
fi

: "${BIKE_DEPLOY_HOST:?Set BIKE_DEPLOY_HOST or create .deploy.env}"
: "${BIKE_DOMAIN:?Set BIKE_DOMAIN or create .deploy.env}"

readonly DEPLOY_HOST="${BIKE_DEPLOY_HOST}"
readonly DEPLOY_ROOT="${BIKE_DEPLOY_ROOT:-/srv/bike-dashboard}"
readonly TRAEFIK_NETWORK_NAME="${TRAEFIK_NETWORK:-traefik}"
readonly APP_ROOT="${DEPLOY_ROOT}/app"

cd "${PROJECT_ROOT}"

ssh "${DEPLOY_HOST}" "mkdir -p '${APP_ROOT}' '${DEPLOY_ROOT}/data' '${DEPLOY_ROOT}/backups' && chmod 700 '${DEPLOY_ROOT}/data' '${DEPLOY_ROOT}/backups'"

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude data \
  --exclude backups \
  --exclude .env \
  --exclude .deploy.env \
  --exclude .git \
  --exclude .DS_Store \
  ./ "${DEPLOY_HOST}:${APP_ROOT}/"

ssh "${DEPLOY_HOST}" "cd '${APP_ROOT}' && BIKE_DOMAIN='${BIKE_DOMAIN}' TRAEFIK_NETWORK='${TRAEFIK_NETWORK_NAME}' docker compose build --pull && BIKE_DOMAIN='${BIKE_DOMAIN}' TRAEFIK_NETWORK='${TRAEFIK_NETWORK_NAME}' docker compose up -d && docker compose ps"
