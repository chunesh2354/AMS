#!/usr/bin/env bash
# Restore a named backup from S3 into the database. This REPLACES the current data.
# Run as root on the server:
#   ams-restore --list                                     list the dumps in the bucket
#   ams-restore ams-2026-11-08T023001Z.dump                 dry run: says what it would do, changes nothing
#   ams-restore ams-2026-11-08T023001Z.dump --yes-replace-database
# Steps: download the dump, take a safety dump of the current database to /var/backups/ams, stop the API,
# drop and recreate the database, pg_restore, start the API (migrations run on start), check health.
set -euo pipefail
set -a; . /etc/ams/env; set +a
log() { echo "[ams-restore] $*"; logger -t ams-restore "$*" || true; }
die() { echo "[ams-restore] $*" >&2; logger -t ams-restore -p user.err "$*" || true; exit 1; }

usage="usage: ams-restore --list | ams-restore <dump name, e.g. ams-2026-11-08T023001Z.dump> [--yes-replace-database]"
[ $# -ge 1 ] || die "$usage"

if [ "$1" = "--list" ]; then
  aws s3 ls --region "$AWS_REGION" "s3://${AMS_BACKUP_BUCKET}/db/"
  exit 0
fi

name="${1#db/}"
case "$name" in
  ams-*.dump) ;;
  *) die "unexpected dump name '${name}'. $usage" ;;
esac
confirm="${2:-}"

# Database name and the maintenance URL (same server, database 'postgres').
db=$(echo "$AMS_OWNER_URL" | sed -E 's|^.*/([^/?]+)(\?.*)?$|\1|')
maint_url=$(echo "$AMS_OWNER_URL" | sed -E "s|/${db}(\\?.*)?$|/postgres\\1|")
src="s3://${AMS_BACKUP_BUCKET}/db/${name}"

aws s3 ls --region "$AWS_REGION" "$src" >/dev/null || die "${src} was not found (try: ams-restore --list)"

if [ "$confirm" != "--yes-replace-database" ]; then
  echo "[ams-restore] dry run. This would replace database '${db}' with ${src}."
  echo "[ams-restore] a safety dump of the current data is taken first, to /var/backups/ams/."
  echo "[ams-restore] to go ahead: ams-restore ${name} --yes-replace-database"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
log "downloading ${src}"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$src" "$work/restore.dump"
pg_restore --list "$work/restore.dump" >/dev/null || die "the download is not a valid pg_dump archive"

mkdir -p /var/backups/ams && chmod 700 /var/backups/ams
safety="/var/backups/ams/before-restore-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
log "safety dump of the current database to ${safety}"
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$safety"

log "stopping the API"
systemctl stop ams-api
restore_failed() {
  echo "[ams-restore] FAILED. The data before the restore is in ${safety}." >&2
  echo "[ams-restore] To put it back: pg_restore --no-owner --dbname=\"\$AMS_OWNER_URL\" ${safety} (after recreating the database)." >&2
  logger -t ams-restore -p user.err "restore of ${name} FAILED; safety dump ${safety}" || true
}
trap 'restore_failed; rm -rf "$work"' ERR

log "recreating database ${db}"
psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()" >/dev/null
psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"${db}\""
psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "create database \"${db}\" owner ams_owner encoding 'UTF8' locale 'C.UTF-8' template template0"

log "restoring ${name}"
pg_restore --no-owner --exit-on-error --dbname="$AMS_OWNER_URL" "$work/restore.dump"

log "starting the API"
systemctl start ams-api
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
    log "restored ${name}; API healthy. Safety dump kept at ${safety}"
    exit 0
  fi
  sleep 2
done
die "restored ${name} but the API did not become healthy: journalctl -u ams-api -n 50. Safety dump: ${safety}"
