#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

if [[ ! -x "$VENV_DIR/bin/uvicorn" ]]; then
  echo "[dalil-mars] Setting up backend Python virtual environment..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

echo "[dalil-mars] Starting Dalil-Mars Engine API on http://$BACKEND_HOST:$BACKEND_PORT ..."
cd "$BACKEND_DIR"
exec "$VENV_DIR/bin/uvicorn" main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" "$@"
