#!/usr/bin/env bash
# Install the server's own files from the checkout in /opt/ams, so a fix in infra/aws reaches existing servers.
# Used by server-setup.sh (first boot) and deploy.sh (every deploy); safe to run any number of times:
#   sudo bash /opt/ams/infra/aws/install-server-files.sh
# Installs: the ams-* commands in /usr/local/bin, the backup cron file, the systemd unit (then daemon-reload)
# and the Caddyfile (validated with `caddy validate` before it replaces the live one and Caddy reloads).
# It does not restart the API; deploy.sh does that.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP_DIR="${APP_DIR:-/opt/ams}"
SRC="$APP_DIR/infra/aws"
ENV_FILE=/etc/ams/env

log() { echo "[ams-install] $*"; }
die() { echo "[ams-install] $*" >&2; logger -t ams-install -p user.err "$*" 2>/dev/null || true; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -d "$SRC" ] || die "${SRC} not found"
[ -r "$ENV_FILE" ] || die "${ENV_FILE} not found (run server-setup.sh first)"
set -a; . "$ENV_FILE"; set +a
: "${AMS_DOMAIN:?missing in /etc/ams/env}"

# Write to a temporary file next to the target, then rename: a script that is running (ams-deploy runs
# this) keeps reading its old copy, and nothing ever sees a half-written file.
install_file() { # <mode> <source> <target>
  local tmp
  tmp=$(mktemp "${3}.new.XXXXXX")
  install -m "$1" -o root -g root "$2" "$tmp"
  mv -f "$tmp" "$3"
}

log "commands"
install_file 755 "$SRC/backup.sh" /usr/local/bin/ams-backup
install_file 755 "$SRC/restore.sh" /usr/local/bin/ams-restore
install_file 755 "$SRC/deploy.sh" /usr/local/bin/ams-deploy
install_file 755 "$SRC/alert.sh" /usr/local/bin/ams-alert
install_file 755 "$SRC/create-platform-admin.sh" /usr/local/bin/ams-create-platform-admin
install_file 755 "$SRC/set-platform-admin-password.sh" /usr/local/bin/ams-set-platform-admin-password

log "backup cron"
# cron starts jobs with PATH=/usr/bin:/bin, which does not include /usr/local/bin where the AWS CLI lives.
cron_tmp=$(mktemp)
cat > "$cron_tmp" <<'EOF'
# Nightly database backup to S3 at 02:30 server time (UTC). Installed by infra/aws/install-server-files.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
30 2 * * * root /usr/local/bin/ams-backup >> /var/log/ams-backup.log 2>&1
EOF
install_file 644 "$cron_tmp" /etc/cron.d/ams-backup
rm -f "$cron_tmp"

log "systemd unit"
install_file 644 "$SRC/ams-api.service" /etc/systemd/system/ams-api.service
systemctl daemon-reload

log "Caddyfile"
mkdir -p /etc/caddy
caddy_new=$(mktemp /etc/caddy/Caddyfile.new.XXXXXX)
sed "s|{\$AMS_DOMAIN}|${AMS_DOMAIN}|g" "$SRC/Caddyfile" > "$caddy_new"
chmod 644 "$caddy_new"
validate_log=$(mktemp)
if ! caddy validate --config "$caddy_new" --adapter caddyfile >"$validate_log" 2>&1; then
  cat "$validate_log" >&2
  rm -f "$caddy_new" "$validate_log"
  die "the new Caddyfile does not validate; the live one was left unchanged"
fi
rm -f "$validate_log"
if [ -f /etc/caddy/Caddyfile ] && cmp -s "$caddy_new" /etc/caddy/Caddyfile; then
  rm -f "$caddy_new"
  log "Caddyfile unchanged"
else
  if [ -f /etc/caddy/Caddyfile ]; then cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.previous; fi
  mv -f "$caddy_new" /etc/caddy/Caddyfile
  if ! systemctl reload-or-restart caddy; then
    if [ -f /etc/caddy/Caddyfile.previous ]; then
      cp -p /etc/caddy/Caddyfile.previous /etc/caddy/Caddyfile
      systemctl reload-or-restart caddy || true
    fi
    die "Caddy did not accept the new Caddyfile; the previous one was put back (journalctl -u caddy)"
  fi
  log "Caddy reloaded"
fi
log "done"
