#!/usr/bin/env bash
set -euo pipefail

# Backs up the Postgres database running in the "postgres" container.
# Defaults match the current VPS deployment (container "postgres",
# user "root", db "app"). Override via env vars if the deployment
# switches to docker-compose.prod.yml naming/credentials.
CONTAINER="${POSTGRES_CONTAINER:-postgres}"
DB_USER="${POSTGRES_USER:-root}"
DB_NAME="${POSTGRES_DB:-app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${BACKUP_DIR}/trading-os-${TIMESTAMP}.sql.gz"
TMP_FILE="${OUT_FILE}.tmp"

echo "$(date -Iseconds) Starting backup: container=${CONTAINER} user=${DB_USER} db=${DB_NAME}"

if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$TMP_FILE"; then
  echo "$(date -Iseconds) ERROR: pg_dump failed" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  echo "$(date -Iseconds) ERROR: backup file is empty, aborting" >&2
  rm -f "$TMP_FILE"
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"
echo "$(date -Iseconds) Backup OK: ${OUT_FILE} ($(du -h "$OUT_FILE" | cut -f1))"

find "$BACKUP_DIR" -type f -name 'trading-os-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
echo "$(date -Iseconds) Retention cleanup done (older than ${RETENTION_DAYS}d removed)"
