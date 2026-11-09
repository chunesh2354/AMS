#!/usr/bin/env bash
# Nightly: dump the database and copy it to S3 (the bucket keeps 30 days; see infra/aws/README.md).
# On any failure (including a missing setting) it exits non-zero and writes one line to the system log:
#   journalctl -t ams-backup
set -euo pipefail
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
file=/tmp/ams-${stamp}.dump
step=start

finish() {
  local code=$?
  rm -f "$file"
  if [ "$code" -ne 0 ]; then
    local msg="[ams-backup] ${stamp} FAILED at step '${step}' (exit ${code}); no new backup was stored"
    logger -t ams-backup -p user.err "$msg" || true
    echo "$msg" >&2
  fi
  exit "$code"
}
trap finish EXIT

step="read /etc/ams/env"
set -a; . /etc/ams/env; set +a
: "${AMS_OWNER_URL:?missing in /etc/ams/env}" "${AMS_BACKUP_BUCKET:?missing in /etc/ams/env}" "${AWS_REGION:?missing in /etc/ams/env}"
step="pg_dump"
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$file"
step="upload to s3://${AMS_BACKUP_BUCKET}/db/"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$file" "s3://${AMS_BACKUP_BUCKET}/db/ams-${stamp}.dump"
logger -t ams-backup "[ams-backup] ${stamp} ok: s3://${AMS_BACKUP_BUCKET}/db/ams-${stamp}.dump" || true
echo "[ams-backup] ${stamp} ok"
