#!/bin/sh
set -eu

DATA_ROOT="${RAILWAY_DATA_ROOT:-/data}"
mkdir -p "${DATA_ROOT}/storage"

export DATABASE_URL="${DATABASE_URL:-sqlite:///${DATA_ROOT}/training_recorder.db}"
export STORAGE_ROOT="${STORAGE_ROOT:-${DATA_ROOT}/storage}"

exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
