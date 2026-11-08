#!/usr/bin/env bash
# Nightly: dump the database and copy it to S3 (the bucket keeps 30 days; see infra/aws/README.md).
set -euo pipefail
set -a; . /etc/ams/env; set +a
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
file=/tmp/ams-${stamp}.dump
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$file"
aws s3 cp --only-show-errors --region "$AWS_REGION" "$file" "s3://${AMS_BACKUP_BUCKET}/db/ams-${stamp}.dump"
rm -f "$file"
echo "[ams-backup] ${stamp} ok"
