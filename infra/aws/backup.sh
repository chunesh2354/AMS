#!/usr/bin/env bash
# Nightly: dump the database and copy it to S3 (the bucket keeps 30 days; see infra/aws/README.md).
# On any failure (including a missing setting) it exits non-zero, writes one line to the system log
#   journalctl -t ams-backup
# and emails the owner through the ams-alerts SNS topic (ams-alert, AMS_ALERT_TOPIC_ARN in /etc/ams/env).
set -euo pipefail
# cron starts jobs with a minimal PATH; the AWS CLI is in /usr/local/bin. Call it by absolute path as well.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
AWS=/usr/local/bin/aws
ALERT=/usr/local/bin/ams-alert
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
    if [ -x "$ALERT" ]; then
      "$ALERT" "backup FAILED (${step})" "${msg}. Details: journalctl -t ams-backup, /var/log/ams-backup.log. Run one by hand: sudo ams-backup" \
        || logger -t ams-backup -p user.err "[ams-backup] ${stamp} the failure alert could not be sent" || true
    else
      logger -t ams-backup -p user.err "[ams-backup] ${stamp} no alert sent: ${ALERT} is not installed" || true
    fi
  fi
  exit "$code"
}
trap finish EXIT

step="read /etc/ams/env"
set -a; . /etc/ams/env; set +a
: "${AMS_OWNER_URL:?missing in /etc/ams/env}" "${AMS_BACKUP_BUCKET:?missing in /etc/ams/env}" "${AWS_REGION:?missing in /etc/ams/env}"
step="find the AWS CLI at ${AWS}"
[ -x "$AWS" ]
step="pg_dump"
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$file"
step="upload to s3://${AMS_BACKUP_BUCKET}/db/"
"$AWS" s3 cp --only-show-errors --region "$AWS_REGION" "$file" "s3://${AMS_BACKUP_BUCKET}/db/ams-${stamp}.dump"
logger -t ams-backup "[ams-backup] ${stamp} ok: s3://${AMS_BACKUP_BUCKET}/db/ams-${stamp}.dump" || true
echo "[ams-backup] ${stamp} ok"
