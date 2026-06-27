#!/usr/bin/env bash
# Обновление Training Recorder на сервере: git pull + docker compose rebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "FAIL: нет .env в $ROOT (скопируйте .env.example и задайте OPENAI_API_KEY)" >&2
  exit 1
fi

git pull --ff-only origin main

docker compose up -d --build
docker compose ps

curl -fsS "http://127.0.0.1:${API_PORT:-8012}/health"
echo ""
echo "OK: Training Recorder обновлён ($(git rev-parse --short HEAD))"
