#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${OCI_APP_DIR:-/home/ubuntu/project_meenakshi}"
ARCHIVE_PATH="${DEPLOY_ARCHIVE:-/tmp/project_meenakshi-deploy/project_meenakshi.tar.gz}"
SOURCE_DIR="${SOURCE_DIR:-}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if command -v docker >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker is not installed on the server or not available in PATH." >&2
  exit 127
fi

mkdir -p "$APP_DIR"

if [ -n "$SOURCE_DIR" ]; then
  cp -a "$SOURCE_DIR"/. "$TMP_DIR"/
else
  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
fi

find "$APP_DIR" -mindepth 1 -maxdepth 1 \
  ! -name ".env" \
  ! -name ".env.local" \
  -exec rm -rf {} +

cp -a "$TMP_DIR"/. "$APP_DIR"/

cd "$APP_DIR"

"${COMPOSE_CMD[@]}" up -d --build
