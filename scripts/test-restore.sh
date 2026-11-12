#!/usr/bin/env bash
# Restore-test : restaure le dernier dump dans un Postgres éphémère et vérifie
# que les tables clés sont lisibles. À lancer périodiquement (cron mensuel).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
CONTAINER=trading-os-restore-test
PORT=5544
DUM=$(ls -t "$BACKUP_DIR"/trading-os-*.sql.gz 2>/dev/null | head -1)

if [ -z "$DUM" ]; then
  echo "ERROR: aucun backup trouvé dans $BACKUP_DIR"
  exit 1
fi
echo "==> Backup testé: $DUM ($(du -h "$DUM" | cut -f1))"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=app -p 127.0.0.1:$PORT:5432 postgres:16 >/dev/null
for i in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres -d app >/dev/null 2>&1 && break
  sleep 2
done

echo "==> Restauration…"
gunzip -c "$DUM" | docker exec -i "$CONTAINER" psql -U postgres -d app -v ON_ERROR_STOP=0 >/dev/null 2>&1 || true

echo "==> Vérification des tables clés"
FAIL=0
for t in signals signal_logs scan_history candles strategies positions notifications; do
  n=$(docker exec "$CONTAINER" psql -U postgres -d app -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo "MISSING")
  echo "  $t: $n lignes"
  [ "$n" = "MISSING" ] && FAIL=1
done

if [ "$FAIL" = "0" ]; then
  echo "==> RESTORE TEST: OK"
else
  echo "==> RESTORE TEST: ÉCHEC — tables manquantes"
  exit 1
fi
