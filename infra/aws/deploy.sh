#!/usr/bin/env bash
# Deploy AMS_BRANCH. Run as root on the server:
#   sudo ams-deploy            (or remotely: infra/aws/deploy-remote.ps1)
#
# Trust boundary (see infra/aws/README.md, "Who can change what"): root never executes a file the ams user can
# modify. Root fetches the code into the root-owned checkout /opt/ams/src, copies infra/aws into the root-owned
# /usr/local/lib/ams and continues from that copy. npm ci and the builds run as ams in /opt/ams/build. Root only
# COPIES the results (never runs them) into root-owned release directories: /opt/ams/app (the API, which systemd
# runs as ams, read-only to it) and /opt/ams/web/dist-live (what Caddy serves).
#
# Stage 1 (whatever started the deploy): lock, convert a legacy layout, fetch, copy infra/aws, re-exec stage 2.
# Stage 2 (/usr/local/lib/ams/deploy.sh): install server files, build as ams, dump the database, swap the
# releases in (the previous ones stay as *.prev), restart the API, wait for /api/v1/health.
# If the API is not healthy, the previous API release and web build are put back and the API restarted.
#
# Migrations run when the API starts (apps/api/src/main.ts), one file per transaction: a migration that fails
# leaves the schema as it was, so rolling the code back is enough. A migration that SUCCEEDS followed by an app
# that fails leaves the new schema under the old code; the pre-deploy dump (/var/backups/ams/pre-deploy-*.dump)
# is then the way back, and the deploy prints the exact restore commands.
# Any failed step exits non-zero and alerts through ams-alert (the ams-alerts SNS topic) naming the step.
set -eEuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022

ROOT=/opt/ams
SRC=$ROOT/src                 # root-owned git checkout
BUILD=$ROOT/build             # ams-owned: npm ci and builds run here, as ams
APP=$ROOT/app                 # root-owned API release (systemd runs it as ams)
WEB=$ROOT/web                 # root-owned web releases: dist-live (served), dist-live.prev
LIB=/usr/local/lib/ams        # root-owned copy of infra/aws that root runs
DUMPS=/var/backups/ams
ALERT=/usr/local/bin/ams-alert
DEFAULT_REPO=https://github.com/chunesh2354/AMS.git

stamp=$(date -u +%Y%m%dT%H%M%SZ)
step=start
swapped=0
log() { echo "[ams-deploy] $*"; }
as_ams() { sudo -u ams -H env HOME=/home/ams "$@"; }

alert() { # <subject> <message>
  if [ -x "$ALERT" ]; then
    "$ALERT" "$1" "$2" || log "the alert could not be sent (journalctl -t ams-alert)" >&2
  else
    log "no alert sent: ${ALERT} is not installed" >&2
  fi
}

on_err() {
  local code=$? line=$1
  # set -E hands this trap to subshells too: let the main shell report, once.
  if [ "${BASHPID:-$$}" != "$$" ]; then exit "$code"; fi
  trap - ERR
  set +e
  log "FAILED at step '${step}' (exit ${code}, line ${line})" >&2
  logger -t ams-deploy -p user.err "deploy FAILED at step '${step}' (exit ${code})" 2>/dev/null
  if [ "$swapped" = 1 ]; then
    rollback "step '${step}' failed"
  else
    alert "deploy FAILED (${step})" "ams-deploy (branch ${AMS_BRANCH:-?}) failed at step '${step}' (exit ${code}) before the new release was swapped in. The site still runs the previous release. Look at the deploy output (deploy-remote.ps1 prints it) and journalctl -t ams-deploy. Fix and rerun: sudo ams-deploy."
  fi
  exit "$code"
}
trap 'on_err $LINENO' ERR

[ "$(id -u)" -eq 0 ] || { log "run as root" >&2; exit 1; }
step="read /etc/ams/env"
set -a; . /etc/ams/env; set +a
: "${AMS_BRANCH:?missing in /etc/ams/env}" "${PORT:?missing in /etc/ams/env}" "${AMS_OWNER_URL:?missing in /etc/ams/env}"

healthy() { # waits up to 60 s
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
applied_migrations() { psql "$AMS_OWNER_URL" -tAqc 'select count(*) from schema_migration' 2>/dev/null || echo "?"; }

# The commands that put the pre-deploy dump back, printed (never run) when new migrations were applied.
restore_hint() { # <dump file>
  local db
  db=$(echo "$AMS_OWNER_URL" | sed -E 's|^.*/([^/?]+)(\?.*)?$|\1|')
  cat <<EOF
  Only if the old code cannot run on the new schema, put the pre-deploy database back (as root):
    sudo systemctl stop ams-api
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c 'alter database ${db} rename to ${db}_failed_deploy_$(echo "$stamp" | tr 'A-Z' 'a-z')' -c "create database ${db} owner ams_owner encoding 'UTF8' locale 'C.UTF-8' template template0"
    set -a; . /etc/ams/env; set +a; pg_restore --no-owner --exit-on-error --dbname="\$AMS_OWNER_URL" ${1}
    sudo systemctl start ams-api
  The failed database is kept as ${db}_failed_deploy_* until you drop it.
EOF
}

# ---------------------------------------------------------------- stage 1
if [ "${AMS_DEPLOY_STAGE:-1}" != 2 ]; then
  # One deploy at a time. The descriptor survives the exec into stage 2, so the lock is held to the end.
  exec 9>/run/ams-deploy.lock
  flock -n 9 || { log "another deploy is running" >&2; exit 1; }
  step="install rsync"
  command -v rsync >/dev/null || apt-get install -y -q rsync

  # Legacy layout: /opt/ams was a git checkout owned by ams, run directly by root. Build the new root-owned
  # layout next to it (seeded with the running release so a rollback target exists), then swap the directories.
  if [ -d "$ROOT/.git" ]; then
    step="convert the legacy /opt/ams checkout"
    log "converting the legacy ams-owned checkout in ${ROOT} to the root-owned layout"
    new=${ROOT}.new-${stamp}
    install -d -m 755 -o root -g root "$new" "$new/web"
    git clone --quiet --branch "$AMS_BRANCH" "${AMS_REPO:-$DEFAULT_REPO}" "$new/src"
    # Root only reads (copies) the ams-owned files here; nothing from them is executed.
    rsync -rlt --no-D --delete --chown=root:root --chmod=ug-s,go-w --exclude=/.git --exclude=/apps/web "$ROOT/" "$new/app/"
    if [ -d "$ROOT/apps/web/dist-live" ]; then
      rsync -rlt --no-D --delete --chown=root:root --chmod=ug-s,go-w "$ROOT/apps/web/dist-live/" "$new/web/dist-live/"
    fi
    mv "$ROOT" "${ROOT}.legacy-${stamp}"
    mv "$new" "$ROOT"
    git config --system --unset-all safe.directory "^${ROOT}\$" 2>/dev/null || true
    log "the old checkout is kept as ${ROOT}.legacy-${stamp}; delete it once this deploy is healthy"
  fi

  step="prepare ${ROOT}"
  install -d -m 755 -o root -g root "$ROOT" "$WEB"
  install -d -m 755 -o ams -g ams "$BUILD"
  [ -d "$SRC/.git" ] || git clone --quiet --branch "$AMS_BRANCH" "${AMS_REPO:-$DEFAULT_REPO}" "$SRC"
  # Refuse to continue from a checkout ams could have changed.
  [ "$(stat -c %U "$SRC")" = root ] && [ "$(stat -c %U "$SRC/.git")" = root ] || { log "${SRC} is not owned by root" >&2; false; }

  step="fetch origin/${AMS_BRANCH}"
  prev=$(git -C "$SRC" rev-parse --verify --quiet HEAD || true)
  log "updating to origin/${AMS_BRANCH}"
  git -C "$SRC" fetch --quiet origin "$AMS_BRANCH"
  git -C "$SRC" checkout --quiet --force -B "$AMS_BRANCH" "origin/$AMS_BRANCH"
  git -C "$SRC" clean -qfdx
  log "at $(git -C "$SRC" log --oneline -1)"

  step="copy infra/aws to ${LIB}"
  next_lib=$(mktemp -d "${LIB}.new.XXXXXX")
  cp -p "$SRC"/infra/aws/* "$next_lib/"
  chown -R root:root "$next_lib"; chmod 755 "$next_lib"; chmod go-w "$next_lib"/*
  rm -rf "${LIB}.old"
  [ ! -d "$LIB" ] || mv "$LIB" "${LIB}.old"
  mv "$next_lib" "$LIB"
  rm -rf "${LIB}.old"

  log "continuing with ${LIB}/deploy.sh"
  export AMS_DEPLOY_STAGE=2 AMS_DEPLOY_PREV="$prev" AMS_DEPLOY_STAMP="$stamp"
  exec bash "$LIB/deploy.sh"
fi

# ---------------------------------------------------------------- stage 2
stamp=${AMS_DEPLOY_STAMP:-$stamp}
prev=${AMS_DEPLOY_PREV:-}
commit=$(git -C "$SRC" log --oneline -1)

rollback() { # <reason>
  set +e
  log "rolling back: $1" >&2
  local failed_api="" new_migrations="$(applied_migrations)" back=1
  if [ -d "${APP}.prev" ]; then
    rm -rf "${APP}.failed"; mv "$APP" "${APP}.failed"; mv "${APP}.prev" "$APP"
  else
    back=0; log "no previous API release (${APP}.prev) to put back" >&2
  fi
  if [ -d "$WEB/dist-live.prev" ]; then
    rm -rf "$WEB/dist-live.failed"; mv "$WEB/dist-live" "$WEB/dist-live.failed"; mv "$WEB/dist-live.prev" "$WEB/dist-live"
  fi
  # The checkout goes back to the previous commit too, so /opt/ams/src matches what runs.
  [ -z "$prev" ] || git -C "$SRC" checkout --quiet --force --detach "$prev"
  systemctl restart ams-api
  if [ "$back" = 1 ] && healthy; then failed_api="the previous release is back and healthy"; else failed_api="the previous release did NOT come back healthy: the site is probably down"; fi
  local hint=""
  if [ "$new_migrations" = "?" ] || [ "$migrations_before" = "?" ]; then
    hint="Could not count schema_migration rows, so it is unknown whether new migrations were applied.
$(restore_hint "$dump")"
  elif [ "$new_migrations" != "$migrations_before" ]; then
    hint="New migrations were applied (schema_migration ${migrations_before} -> ${new_migrations}); the old code now runs on the new schema.
$(restore_hint "$dump")"
  else
    hint="No new migration was applied (schema_migration count ${migrations_before}), so the schema is as it was."
  fi
  log "$failed_api" >&2
  echo "$hint" >&2
  journalctl -u ams-api -n 40 --no-pager >&2
  alert "deploy FAILED and rolled back" "ams-deploy of ${commit} (branch ${AMS_BRANCH}) failed: $1. Rolled back to ${prev:-the previous release}: ${failed_api}.
${hint}
The failed release is kept in ${APP}.failed and ${WEB}/dist-live.failed. Logs: journalctl -u ams-api -n 100."
  exit 1
}

step="install server files"
log "reinstalling server files (commands, backup cron, systemd unit, Caddyfile)"
SRC_DIR="$LIB" bash "$LIB/install-server-files.sh"

step="sync ${SRC} to ${BUILD}"
# As ams: ams reads the root-owned checkout and writes only its own directory.
as_ams rsync -rlt --delete --exclude=/.git --exclude=node_modules/ --exclude='/apps/web/dist-live*' "$SRC/" "$BUILD/"

step="npm ci (API)"
log "installing API dependencies"
# /etc/ams/env sets NODE_ENV=production; the API runs through tsx, so dev dependencies are needed too.
(cd "$BUILD/apps/api" && as_ams npm ci --include=dev --no-audit --no-fund --loglevel=error)

step="build the web app"
log "building the web app (live mode)"
(cd "$BUILD/apps/web" && as_ams env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --include=dev --no-audit --no-fund --loglevel=error && as_ams npm run build:live --silent)
[ -f "$BUILD/apps/web/dist-live/index.html" ] || { log "the build produced no dist-live/index.html" >&2; false; }

step="stage the releases"
# Root copies (never runs) the ams-built files into root-owned directories that ams cannot change.
rm -rf "${APP}.next" "$WEB/dist-live.next"
rsync -rlt --no-D --delete --chown=root:root --chmod=ug-s,go-w --exclude=/apps/web "$BUILD/" "${APP}.next/"
rsync -rlt --no-D --delete --chown=root:root --chmod=ug-s,go-w "$BUILD/apps/web/dist-live/" "$WEB/dist-live.next/"
chmod 755 "${APP}.next" "$WEB/dist-live.next"

step="pg_dump before migrations"
install -d -m 700 -o root -g root "$DUMPS"
dump="$DUMPS/pre-deploy-${stamp}.dump"
log "dumping the database to ${dump}"
pg_dump --format=custom --no-owner --dbname="$AMS_OWNER_URL" --file="$dump"
chmod 600 "$dump"
# Keep the five most recent pre-deploy dumps.
ls -1t "$DUMPS"/pre-deploy-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f || true
migrations_before=$(applied_migrations)

step="swap the releases in"
# Each swap is two renames: the served directory is never empty or half-written.
rm -rf "${APP}.prev" "$WEB/dist-live.prev"
swapped=1
[ ! -d "$APP" ] || mv "$APP" "${APP}.prev"
mv "${APP}.next" "$APP"
[ ! -d "$WEB/dist-live" ] || mv "$WEB/dist-live" "$WEB/dist-live.prev"
mv "$WEB/dist-live.next" "$WEB/dist-live"

step="restart the API"
log "restarting the API"
systemctl restart ams-api
if healthy; then
  log "healthy at ${commit}"
  log "previous release kept as ${APP}.prev and ${WEB}/dist-live.prev; database dump ${dump}"
  exit 0
fi
trap - ERR
rollback "the API did not answer /api/v1/health within 60 seconds of the restart"
