#!/usr/bin/env bash
set -Eeuo pipefail

# Back up Safety Auth data and deployment config without deleting or stopping volumes.
#
# Optional:
#   export BACKUP_DIR="/home/ubuntu/safety-backups"

BACKUP_ROOT="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
DEST="$BACKUP_ROOT/safety-backup-$STAMP"

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

mkdir -p "$DEST"

if [ ! -f docker-compose.yml ]; then
  echo "Run this script from the project root containing docker-compose.yml." >&2
  exit 1
fi

log "Saving deployment config"
cp docker-compose.yml "$DEST/docker-compose.yml"
[ -f .env ] && cp .env "$DEST/.env"
[ -f .env.example ] && cp .env.example "$DEST/.env.example"
[ -d nginx ] && tar -czf "$DEST/nginx.tgz" nginx
[ -d certs ] && tar -czf "$DEST/certs.tgz" certs
[ -f safety-web/.env ] && cp safety-web/.env "$DEST/safety-web.env"
[ -f safety-web/.env.example ] && cp safety-web/.env.example "$DEST/safety-web.env.example"

log "Saving Docker Compose rendered config"
docker compose config > "$DEST/docker-compose.rendered.yml"

log "Backing up Postgres logical dump"
POSTGRES_USER="$(sed -n 's/^POSTGRES_USER=//p' .env | tail -n 1)"
POSTGRES_DB="$(sed -n 's/^POSTGRES_DB=//p' .env | tail -n 1)"
POSTGRES_USER="${POSTGRES_USER:-safety_user}"
POSTGRES_DB="${POSTGRES_DB:-safety_db}"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists > "$DEST/postgres.dump.sql"

log "Backing up Redis RDB"
REDIS_PASSWORD="$(sed -n 's/^REDIS_PASSWORD=//p' .env | tail -n 1)"
if [ -n "$REDIS_PASSWORD" ]; then
  docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE || true
else
  docker compose exec -T redis redis-cli BGSAVE || true
fi
sleep 3
docker cp safety-redis:/data/dump.rdb "$DEST/redis.dump.rdb"

log "Saving Docker volume metadata"
docker volume inspect project_postgres_data project_redis_data > "$DEST/docker-volumes.inspect.json" 2>/dev/null || true

log "Creating archive"
tar -czf "$BACKUP_ROOT/safety-backup-$STAMP.tgz" -C "$BACKUP_ROOT" "safety-backup-$STAMP"

log "Backup complete: $BACKUP_ROOT/safety-backup-$STAMP.tgz"
