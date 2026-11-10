#!/usr/bin/env bash
# Send an alert email through the SNS topic created by provision.sh (ams-alerts). Run as root on the server:
#   ams-alert "<subject>" "<message>"
# The topic comes from AMS_ALERT_TOPIC_ARN (environment, or /etc/ams/env). The owner receives it once they
# have confirmed the subscription email AWS sent when provision.sh subscribed ALERT_EMAIL.
# Every alert is also written to the system log (journalctl -t ams-alert). Exits non-zero if it could not be sent.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
AWS=/usr/local/bin/aws
[ -x "$AWS" ] || AWS=$(command -v aws || echo /usr/local/bin/aws)

subject="${1:-alert}"
message="${2:-${1:-alert}}"
host=$(hostname 2>/dev/null || echo server)

# Read the topic without sourcing the file, so a broken /etc/ams/env cannot stop the alert.
topic="${AMS_ALERT_TOPIC_ARN:-}"
if [ -z "$topic" ] && [ -r /etc/ams/env ]; then
  topic=$(sed -n 's/^AMS_ALERT_TOPIC_ARN=//p' /etc/ams/env | tail -n 1 | tr -d "\"' ")
fi

logger -t ams-alert -p user.err "${subject}: ${message}" 2>/dev/null || true

if [ -z "$topic" ]; then
  logger -t ams-alert -p user.err "alert NOT sent: AMS_ALERT_TOPIC_ARN is not set in /etc/ams/env (rerun provision.sh)" 2>/dev/null || true
  echo "[ams-alert] not sent: AMS_ALERT_TOPIC_ARN is not set in /etc/ams/env" >&2
  exit 2
fi

# arn:aws:sns:<region>:<account>:ams-alerts
region=$(echo "$topic" | cut -d: -f4)
# SNS subjects: one line of printable ASCII, under 100 characters.
full_subject=$(printf '[ams %s] %s' "$host" "$subject" | tr -c '[:print:]' ' ' | cut -c1-99)
body=$(printf '%s\n\nServer: %s\nTime (UTC): %s\n' "$message" "$host" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

if timeout 60 "$AWS" sns publish --region "$region" --topic-arn "$topic" --subject "$full_subject" --message "$body" --output text --query MessageId >/dev/null; then
  echo "[ams-alert] sent: ${full_subject}"
  exit 0
fi
logger -t ams-alert -p user.err "alert NOT sent: sns publish to ${topic} failed" 2>/dev/null || true
echo "[ams-alert] not sent: sns publish to ${topic} failed" >&2
exit 1
