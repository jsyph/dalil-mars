#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_DIR="$ROOT_DIR/website"

WEBSITE_HOST="${WEBSITE_HOST:-0.0.0.0}"
WEBSITE_PORT="${WEBSITE_PORT:-8080}"

echo "[dalil-mars] Serving static website on http://$WEBSITE_HOST:$WEBSITE_PORT ..."
exec python3 -m http.server "$WEBSITE_PORT" --bind "$WEBSITE_HOST" --directory "$WEBSITE_DIR" "$@"
