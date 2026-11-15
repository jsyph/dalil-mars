#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPROCESSING_DIR="$ROOT_DIR/preprocessing"
VENV_PYTHON="$ROOT_DIR/backend/.venv/bin/python"

VIEWER_PORT="${VIEWER_PORT:-8050}"

if [[ -x "$VENV_PYTHON" ]]; then
  PYTHON_BIN="$VENV_PYTHON"
else
  PYTHON_BIN="python3"
fi

echo "[dalil-mars] Starting 3D Stage Visualizer on http://0.0.0.0:$VIEWER_PORT ..."
cd "$PREPROCESSING_DIR"
exec "$PYTHON_BIN" visualizer.py --port "$VIEWER_PORT" "$@"
