#!/usr/bin/env bash
# Ручной деплой на Railway (автоматический путь — GitHub Actions Release workflow).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

ENV_RAILWAY="${ROOT}/.env.railway"
if [[ -f "${ENV_RAILWAY}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(RAILWAY_|PROD_HEALTH_URL=)' "${ENV_RAILWAY}" | sed 's/\r$//')
  set +a
fi

SERVICE="${RAILWAY_SERVICE:-training-recorder}"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
PROJECT_ID="${RAILWAY_PROJECT_ID:-}"
HEALTH_URL="${PROD_HEALTH_URL:-}"

if [[ -z "${RAILWAY_API_TOKEN:-}" ]]; then
  echo "ERROR: export RAILWAY_API_TOKEN (Railway → Account Settings → Tokens)" >&2
  exit 1
fi

export RAILWAY_API_TOKEN
unset RAILWAY_TOKEN || true

echo "==> make check"
make check

RAILWAY_ARGS=(--detach --yes --service "${SERVICE}" --environment "${ENVIRONMENT}")
if [[ -n "${PROJECT_ID}" ]]; then
  RAILWAY_ARGS+=(--project "${PROJECT_ID}")
fi

echo "==> railway up (${SERVICE})"
npx --yes @railway/cli@5.23.1 up "${RAILWAY_ARGS[@]}"

if [[ -z "${HEALTH_URL}" ]]; then
  echo "WARN: PROD_HEALTH_URL не задан — пропуск health smoke"
  exit 0
fi

health="${HEALTH_URL%/}/health"
echo "==> wait for ${health}"
for attempt in $(seq 1 36); do
  if curl -sfSL --max-time 15 "${health}"; then
    echo ""
    echo "OK: Railway health"
    exit 0
  fi
  echo "not ready (${attempt}/36), sleep 10s..."
  sleep 10
done

echo "ERROR: health check failed" >&2
exit 1
