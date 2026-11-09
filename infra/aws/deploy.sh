#!/usr/bin/env bash
# Pull the configured branch, reinstall the server files, install, build the live web app and restart the API.
# Run as root on the server:
#   sudo ams-deploy            (or remotely: infra/aws/deploy-remote.ps1)
# Every deploy reinstalls the ams-* commands, the backup cron file, the systemd unit and the Caddyfile from the
# new checkout (install-server-files.sh), so infra fixes reach existing servers.
# Migrations run when the API starts (src/main.ts). A failed step or health check exits non-zero and, for a
# failed health check, emails the owner through the ams-alerts SNS topic (ams-alert).
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP_DIR=/opt/ams
set -a; . /etc/ams/env; set +a
as_ams() { sudo -u ams -H env HOME=/home/ams "$@"; }

echo "[ams-deploy] updating to origin/${AMS_BRANCH}"
as_ams git -C "$APP_DIR" fetch --quiet origin "$AMS_BRANCH"
as_ams git -C "$APP_DIR" checkout --quiet -B "$AMS_BRANCH" "origin/$AMS_BRANCH"
as_ams git -C "$APP_DIR" reset --quiet --hard "origin/$AMS_BRANCH"
echo "[ams-deploy] at $(git -C "$APP_DIR" log --oneline -1)"

# If this deploy script itself changed, run the new one so the rest of the deploy is the new version.
if [ -z "${AMS_DEPLOY_REEXEC:-}" ] && ! cmp -s "$APP_DIR/infra/aws/deploy.sh" "${BASH_SOURCE[0]}"; then
  echo "[ams-deploy] deploy.sh changed; continuing with the new version"
  export AMS_DEPLOY_REEXEC=1
  exec bash "$APP_DIR/infra/aws/deploy.sh"
fi

echo "[ams-deploy] reinstalling server files (commands, backup cron, systemd unit, Caddyfile)"
bash "$APP_DIR/infra/aws/install-server-files.sh"

echo "[ams-deploy] installing API dependencies"
# /etc/ams/env sets NODE_ENV=production; the API runs through tsx, so dev dependencies are needed too.
(cd "$APP_DIR/apps/api" && as_ams npm ci --include=dev --no-audit --no-fund --loglevel=error)

echo "[ams-deploy] building the web app (live mode)"
(cd "$APP_DIR/apps/web" && as_ams env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --include=dev --no-audit --no-fund --loglevel=error && as_ams npm run build:live --silent)

echo "[ams-deploy] restarting the API"
systemctl restart ams-api
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
    echo "[ams-deploy] healthy"
    exit 0
  fi
  sleep 2
done
echo "[ams-deploy] the API did not become healthy; recent log:" >&2
journalctl -u ams-api -n 40 --no-pager >&2 || true
commit=$(git -C "$APP_DIR" log --oneline -1 2>/dev/null || echo unknown)
/usr/local/bin/ams-alert "deploy FAILED: API not healthy" \
  "ams-deploy restarted the API at ${commit} (branch ${AMS_BRANCH}) and /api/v1/health did not answer within 60 seconds. The site is probably down. Look at: journalctl -u ams-api -n 100. Then: sudo systemctl restart ams-api, or deploy a fix with sudo ams-deploy." \
  || echo "[ams-deploy] the alert could not be sent (journalctl -t ams-alert)" >&2
exit 1
