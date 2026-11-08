#!/usr/bin/env bash
# Pull the configured branch, install, build the live web app and restart the API. Run as root on the server:
#   sudo ams-deploy            (or remotely: infra/aws/deploy-remote.ps1)
# Migrations run when the API starts (src/main.ts). A failed health check exits non-zero.
set -euo pipefail
APP_DIR=/opt/ams
set -a; . /etc/ams/env; set +a
as_ams() { sudo -u ams -H env HOME=/home/ams "$@"; }

echo "[ams-deploy] updating to origin/${AMS_BRANCH}"
as_ams git -C "$APP_DIR" fetch --quiet origin "$AMS_BRANCH"
as_ams git -C "$APP_DIR" checkout --quiet -B "$AMS_BRANCH" "origin/$AMS_BRANCH"
as_ams git -C "$APP_DIR" reset --quiet --hard "origin/$AMS_BRANCH"
echo "[ams-deploy] at $(git -C "$APP_DIR" log --oneline -1)"

echo "[ams-deploy] installing API dependencies"
# /etc/ams/env sets NODE_ENV=production; the API runs through tsx, so dev dependencies are needed too.
(cd "$APP_DIR/apps/api" && as_ams npm ci --include=dev --no-audit --no-fund --loglevel=error)

echo "[ams-deploy] building the web app (live mode)"
(cd "$APP_DIR/apps/web" && as_ams env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --include=dev --no-audit --no-fund --loglevel=error && as_ams npm run build:live --silent)

echo "[ams-deploy] restarting the API"
systemctl restart ams-api
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
    echo "[ams-deploy] healthy"
    exit 0
  fi
  sleep 2
done
echo "[ams-deploy] the API did not become healthy; recent log:" >&2
journalctl -u ams-api -n 40 --no-pager >&2
exit 1
