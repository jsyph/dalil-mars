#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
GUI_DIR="$ROOT_DIR/GUI"
VENV_DIR="$BACKEND_DIR/.venv"

BACKEND_PORT="${BACKEND_PORT:-8000}"
GUI_PORT="${GUI_PORT:-5173}"

cleanup() {
  echo ""
  echo "[dalil-mars] Shutting down services..."
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${GUI_PID:-}" ]] && kill -0 "$GUI_PID" 2>/dev/null; then
    kill "$GUI_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 1. Setup Python backend virtualenv if needed
if [[ ! -x "$VENV_DIR/bin/uvicorn" ]]; then
  echo "[dalil-mars] Setting up backend Python virtual environment..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install fastapi "uvicorn[standard]" numpy python-dotenv
fi

# 2. Setup GUI node_modules if needed
if [[ ! -d "$GUI_DIR/node_modules" ]]; then
  echo "[dalil-mars] Installing GUI dependencies..."
  (cd "$GUI_DIR" && npm install --force)
fi

# 3. Start FastAPI backend
echo "[dalil-mars] Starting Dalil-Mars Engine API on http://127.0.0.1:$BACKEND_PORT ..."
(
  cd "$BACKEND_DIR"
  exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

# Wait for backend health check
echo "[dalil-mars] Waiting for engine initialization..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/engine/status" >/dev/null 2>&1; then
    echo "[dalil-mars] Engine API online!"
    break
  fi
  sleep 0.5
done

# 4. Start Vite GUI dev server
echo "[dalil-mars] Starting GUI dev server on http://127.0.0.1:$GUI_PORT ..."
(
  cd "$GUI_DIR"
  exec npm run dev -- --host 127.0.0.1 --port "$GUI_PORT"
) &
GUI_PID=$!

echo "[dalil-mars] All services running. Press Ctrl+C to stop."
wait
