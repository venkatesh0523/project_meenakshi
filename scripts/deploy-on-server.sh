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

docker compose up -d --build
