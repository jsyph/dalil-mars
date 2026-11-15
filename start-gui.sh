#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUI_DIR="$ROOT_DIR/GUI"

GUI_HOST="${GUI_HOST:-0.0.0.0}"
GUI_PORT="${GUI_PORT:-5173}"

if [[ ! -d "$ROOT_DIR/node_modules" && ! -d "$GUI_DIR/node_modules" ]]; then
  echo "[dalil-mars] Installing GUI dependencies..."
  (cd "$GUI_DIR" && npm install --force)
fi

echo "[dalil-mars] Starting GUI dev server on http://$GUI_HOST:$GUI_PORT ..."
cd "$GUI_DIR"
exec npm run dev -- --host "$GUI_HOST" --port "$GUI_PORT" "$@"
