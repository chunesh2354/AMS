#!/usr/bin/env bash
# Restore a named backup from S3 into the database. This REPLACES the current data.
# Run as root on the server:
#   ams-restore --list                                     list the dumps in the bucket
#   ams-restore ams-2026-11-08T023001Z.dump                 dry run: says what it would do, changes nothing
#   ams-restore ams-2026-11-08T023001Z.dump --yes-replace-database
# Steps:
#   1. download and check the dump; take a safety dump of the current database to /var/backups/ams
#   2. pg_restore into a NEW temporary database while the API keeps running on the current one
#   3. only if that succeeded: stop the API, rename the current database to <db>_before_restore_<time>,
#      rename the temporary one to <db>, start the API (migrations run on start) and check health
# The previous data is kept as database <db>_before_restore_<time> until you drop it.
# On any failure it puts the previous database back if it had been moved, starts the API again, prints the
# exact recovery steps and sends an alert (ams-alert). It never leaves the API stopped without saying so.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
AWS=/usr/local/bin/aws
[ -x "$AWS" ] || AWS=$(command -v aws || echo /usr/local/bin/aws)
set -a; . /etc/ams/env; set +a
log() { echo "[ams-restore] $*"; logger -t ams-restore "$*" || true; }
die() { echo "[ams-restore] $*" >&2; logger -t ams-restore -p user.err "$*" || true; exit 1; }

usage="usage: ams-restore --list | ams-restore <dump name, e.g. ams-2026-11-08T023001Z.dump> [--yes-replace-database]"
[ $# -ge 1 ] || die "$usage"

if [ "$1" = "--list" ]; then
  "$AWS" s3 ls --region "$AWS_REGION" "s3://${AMS_BACKUP_BUCKET}/db/"
  exit 0
fi

name="${1#db/}"
case "$name" in
  ams-*.dump) ;;
  *) die "unexpected dump name '${name}'. $usage" ;;
esac
confirm="${2:-}"

# Database name and URLs for the maintenance database ('postgres') and the temporary database, same server.
db=$(echo "$AMS_OWNER_URL" | sed -E 's|^.*/([^/?]+)(\?.*)?$|\1|')
case "$db" in
  *[!a-zA-Z0-9_]*|"") die "unexpected database name '${db}' in AMS_OWNER_URL" ;;
esac
url_for() { echo "$AMS_OWNER_URL" | sed -E "s|/${db}(\\?.*)?$|/${1}\\1|"; }
maint_url=$(url_for postgres)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stamp_lc=$(echo "$stamp" | tr 'A-Z' 'a-z')
tmp_db="${db}_restoring_${stamp_lc}"
old_db="${db}_before_restore_${stamp_lc}"
tmp_url=$(url_for "$tmp_db")
src="s3://${AMS_BACKUP_BUCKET}/db/${name}"
port="${PORT:-3000}"

"$AWS" s3 ls --region "$AWS_REGION" "$src" >/dev/null || die "${src} was not found (try: ams-restore --list)"

if [ "$confirm" != "--yes-replace-database" ]; then
  echo "[ams-restore] dry run. This would replace database '${db}' with ${src}."
  echo "[ams-restore] a safety dump of the current data is taken first, to /var/backups/ams/."
  echo "[ams-restore] the dump is restored into a temporary database '${tmp_db}' first; the current database"
  echo "[ams-restore] is only swapped out (kept as '${old_db}') after that succeeds."
  echo "[ams-restore] to go ahead: ams-restore ${name} --yes-replace-database"
  exit 0
fi

sql() { psql "$maint_url" -v ON_ERROR_STOP=1 -qtA -c "$1"; }
db_exists() { [ "$(sql "select 1 from pg_database where datname = '$1'")" = "1" ]; }
kick() { sql "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$1' and pid <> pg_backend_pid()" >/dev/null; }
api_healthy() { curl -fsS "http://127.0.0.1:${port}/api/v1/health" >/dev/null 2>&1; }

work=$(mktemp -d)
safety=""
step="start"
api_stopped=0   # 1 once this script has stopped the API
swapped=0       # 1 once the current database was renamed to $old_db
done_ok=0

on_exit() {
  local code=$?
  rm -rf "$work"
  [ "$done_ok" -eq 1 ] && exit 0
  [ "$code" -eq 0 ] && code=1
  trap - EXIT
  set +e
  echo "[ams-restore] FAILED during: ${step} (exit ${code})" >&2
  logger -t ams-restore -p user.err "restore of ${name} FAILED during: ${step}" || true

  # Put the previous database back if this script had moved it and the restored one is not in place.
  local rolled_back="no"
  if [ "$swapped" -eq 1 ] && db_exists "$old_db"; then
    if db_exists "$db"; then
      : # the restored database is in place; leave it, the steps below say how to go back
    else
      kick "$old_db"
      if sql "alter database \"${old_db}\" rename to \"${db}\"" >/dev/null; then
        rolled_back="yes"; swapped=0
        echo "[ams-restore] the previous database was put back as '${db}'" >&2
      fi
    fi
  fi
  # Drop the half-restored temporary database (never the live one).
  if db_exists "$tmp_db"; then
    kick "$tmp_db"
    sql "drop database if exists \"${tmp_db}\"" >/dev/null && echo "[ams-restore] removed the temporary database '${tmp_db}'" >&2
  fi
  # Never leave the API stopped.
  local api_state="running and healthy"
  if [ "$api_stopped" -eq 1 ] || ! systemctl is-active --quiet ams-api; then
    echo "[ams-restore] starting the API again" >&2
    systemctl start ams-api
    api_state="started again and healthy"
  fi
  for _ in $(seq 1 30); do api_healthy && break; sleep 2; done
  if ! api_healthy; then
    if systemctl is-active --quiet ams-api; then api_state="running but NOT HEALTHY"; else api_state="STOPPED"; fi
  fi

  local report
  report=$({
    echo "[ams-restore] ---------------------------------------------------------------------------"
    echo "[ams-restore] State now: API ${api_state}; database '${db}' $(db_exists "$db" && echo exists || echo 'is MISSING')."
    [ "$rolled_back" = "yes" ] && echo "[ams-restore] The previous data was put back; nothing was replaced."
    [ "$swapped" -eq 1 ] && echo "[ams-restore] '${db}' holds the RESTORED data; the previous data is database '${old_db}'."
    [ -n "$safety" ] && echo "[ams-restore] Safety dump of the data before the restore: ${safety}"
    echo "[ams-restore] Recovery steps (as root), only those that apply:"
    if [ "$swapped" -eq 1 ]; then
      echo "  # go back to the previous data:"
      echo "  systemctl stop ams-api"
      echo "  sudo -u postgres psql -c 'alter database \"${db}\" rename to \"${db}_failed_restore_${stamp_lc}\"'"
      echo "  sudo -u postgres psql -c 'alter database \"${old_db}\" rename to \"${db}\"'"
    elif ! db_exists "$db"; then
      if db_exists "$old_db"; then
        echo "  # the previous database still exists under another name; put it back:"
        echo "  sudo -u postgres psql -c 'alter database \"${old_db}\" rename to \"${db}\"'"
      elif [ -n "$safety" ]; then
        echo "  # recreate the database from the safety dump:"
        echo "  sudo -u postgres createdb -O ams_owner -E UTF8 -l C.UTF-8 -T template0 ${db}"
        echo "  set -a; . /etc/ams/env; set +a; pg_restore --no-owner --exit-on-error --dbname=\"\$AMS_OWNER_URL\" ${safety}"
      fi
    fi
    echo "  systemctl start ams-api"
    echo "  curl -fsS http://127.0.0.1:${port}/api/v1/health"
    echo "  journalctl -u ams-api -n 100 --no-pager     # if it is not healthy"
    echo "[ams-restore] ---------------------------------------------------------------------------"
  })
  echo "$report" >&2
  echo "$report" | logger -t ams-restore -p user.err || true
  [ -x /usr/local/bin/ams-alert ] && /usr/local/bin/ams-alert "restore FAILED (${step})" \
    "ams-restore ${name} failed during: ${step}. API: ${api_state}. Recovery steps are in the command output and in journalctl -t ams-restore." >/dev/null 2>&1
  exit "$code"
}
trap on_exit EXIT

step="download ${src}"
log "downloading ${src}"
"$AWS" s3 cp --only-show-errors --region "$AWS_REGION" "$src" "$work/restore.dump"
step="check the download"
pg_restore --list "$work/restore.dump" >/dev/null || die "the download is not a valid pg_dump archive"

step="safety dump"
mkdir -p /var/backups/ams && chmod 700 /var/backups/ams
safety="/var/backups/ams/before-restore-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
log "safety dump of the current database to ${safety}"
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$safety"

# The API keeps serving the current database while the dump is restored next to it.
step="create the temporary database ${tmp_db}"
log "restoring ${name} into the temporary database ${tmp_db} (the API keeps running)"
sql "create database \"${tmp_db}\" owner ams_owner encoding 'UTF8' locale 'C.UTF-8' template template0" >/dev/null
step="pg_restore into ${tmp_db}"
pg_restore --no-owner --exit-on-error --dbname="$tmp_url" "$work/restore.dump"

step="stop the API"
log "restore succeeded; stopping the API to swap databases"
api_stopped=1
systemctl stop ams-api

step="rename ${db} to ${old_db}"
kick "$db"
sql "alter database \"${db}\" rename to \"${old_db}\"" >/dev/null
swapped=1
step="rename ${tmp_db} to ${db}"
kick "$tmp_db"
sql "alter database \"${tmp_db}\" rename to \"${db}\"" >/dev/null
log "swapped: '${db}' now holds ${name}; the previous data is database '${old_db}'"

step="start the API and wait for /api/v1/health"
log "starting the API"
systemctl start ams-api
api_stopped=0
for _ in $(seq 1 30); do
  if api_healthy; then
    done_ok=1
    log "restored ${name}; API healthy. Previous data kept as database '${old_db}' and in ${safety}"
    log "when you are satisfied: sudo -u postgres dropdb ${old_db}"
    exit 0
  fi
  sleep 2
done
die "restored ${name} but the API did not become healthy: journalctl -u ams-api -n 50"
