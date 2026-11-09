#!/usr/bin/env bash
# One-time setup of the single staging server (Ubuntu 24.04, arm64). Run as root, usually from EC2 user data.
# Installs PostgreSQL, Node 22 and Caddy, creates the database and secrets, installs the server files
# (install-server-files.sh, the same step every deploy runs), then calls deploy.sh.
# The code lives in the root-owned checkout /opt/ams/src; root runs infra scripts only from the root-owned
# copy in /usr/local/lib/ams (infra/aws/README.md, "Who can change what").
# Safe to run again: every step checks what already exists.
#
# Required environment: AMS_DOMAIN, AMS_BACKUP_BUCKET, AWS_REGION.
# Optional: AMS_REPO, AMS_BRANCH, AMS_ALERT_TOPIC_ARN (the ams-alerts SNS topic from provision.sh).
set -euo pipefail

: "${AMS_DOMAIN:?set AMS_DOMAIN, e.g. app.csdv.in}"
: "${AMS_BACKUP_BUCKET:?set AMS_BACKUP_BUCKET}"
: "${AWS_REGION:?set AWS_REGION}"
AMS_REPO="${AMS_REPO:-https://github.com/chunesh2354/AMS.git}"
# core-path until its PR merges; switch this default back to main after the merge.
AMS_BRANCH="${AMS_BRANCH:-core-path}"
SRC_DIR=/opt/ams/src
LIB=/usr/local/lib/ams
ENV_FILE=/etc/ams/env
export DEBIAN_FRONTEND=noninteractive

log() { echo "[ams-setup] $*"; }

# Set KEY=VALUE in /etc/ams/env, replacing an existing line for KEY.
set_env() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp "${ENV_FILE}.new.XXXXXX")
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  echo "${key}=${value}" >> "$tmp"
  chown root:ams "$tmp" && chmod 640 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# 2 GB swap so npm install and the web build fit on a 2 GB instance.
if ! swapon --show | grep -q /swapfile; then
  log "adding swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "installing packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git rsync unzip postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

if ! command -v aws >/dev/null; then
  arch=$(uname -m)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscliv2.zip
  unzip -qo /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update
fi

id ams >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/ams --shell /usr/sbin/nologin ams

# Secrets are generated on the server and never leave it (the platform admin password goes to SSM, encrypted).
mkdir -p /etc/ams
if [ ! -f "$ENV_FILE" ]; then
  log "generating secrets"
  owner_pw=$(openssl rand -hex 24)
  app_pw=$(openssl rand -hex 24)
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
AMS_OWNER_URL=postgres://ams_owner:${owner_pw}@127.0.0.1:5432/ams
AMS_APP_PASSWORD=${app_pw}
AMS_DOMAIN=${AMS_DOMAIN}
AMS_BACKUP_BUCKET=${AMS_BACKUP_BUCKET}
AWS_REGION=${AWS_REGION}
AMS_BRANCH=${AMS_BRANCH}
EOF
  umask 022
fi
chown root:ams "$ENV_FILE" && chmod 640 "$ENV_FILE"
# Where backup and deploy failures are sent (ams-alert). Also set on existing servers by rerunning provision.sh.
if [ -n "${AMS_ALERT_TOPIC_ARN:-}" ]; then
  set_env AMS_ALERT_TOPIC_ARN "$AMS_ALERT_TOPIC_ARN"
elif ! grep -q '^AMS_ALERT_TOPIC_ARN=' "$ENV_FILE"; then
  log "WARNING: AMS_ALERT_TOPIC_ARN is not set; backup and deploy failures will only be logged (rerun provision.sh)"
fi
# ams-deploy clones from here when it converts a legacy /opt/ams checkout.
set_env AMS_REPO "$AMS_REPO"
set -a; . "$ENV_FILE"; set +a
owner_pw=$(echo "$AMS_OWNER_URL" | sed -E 's|^postgres://ams_owner:([^@]+)@.*$|\1|')

# The owner role runs migrations and owns the SECURITY DEFINER functions, as postgres does in development.
# It is reachable only on 127.0.0.1; the app itself connects as the restricted ams_app role.
log "configuring PostgreSQL"
systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'ams_owner') then
    create role ams_owner login superuser password '${owner_pw}';
  end if;
end \$\$;
SQL
sudo -u postgres psql -tAc "select 1 from pg_database where datname = 'ams'" | grep -q 1 || sudo -u postgres createdb -O ams_owner -E UTF8 -l C.UTF-8 -T template0 ams

log "fetching code"
if [ -d /opt/ams/.git ]; then
  # A server from before the root-owned layout: ams-deploy converts it (and keeps the old checkout aside).
  log "legacy ams-owned checkout in /opt/ams: ams-deploy converts it"
else
  install -d -m 755 -o root -g root /opt/ams
  [ -d "$SRC_DIR/.git" ] || git clone --branch "$AMS_BRANCH" "$AMS_REPO" "$SRC_DIR"
fi

log "installing services"
# Root runs infra scripts only from a root-owned copy; ams-deploy refreshes it on every deploy.
# Commands, backup cron file (with PATH), systemd unit + daemon-reload, validated Caddyfile + reload.
if [ -d "$SRC_DIR/.git" ]; then
  src_infra="$SRC_DIR/infra/aws"
  [ "$(stat -c %U "$SRC_DIR")" = root ] || { log "${SRC_DIR} is not owned by root"; exit 1; }
  install -d -m 755 -o root -g root "$LIB"
  install -m 755 -o root -g root "$src_infra"/* "$LIB/"
  SRC_DIR="$LIB" bash "$LIB/install-server-files.sh"
fi
systemctl enable ams-api caddy

if [ -d /opt/ams/.git ] && ! grep -q AMS_DEPLOY_STAGE /usr/local/bin/ams-deploy 2>/dev/null; then
  # The installed ams-deploy predates the root-owned layout. Install the new one from the repository
  # (a root-owned temporary clone, never the ams-owned checkout), then deploy: it converts the layout.
  tmp_src=$(mktemp -d)
  git clone --quiet --branch "$AMS_BRANCH" "$AMS_REPO" "$tmp_src"
  install -m 755 -o root -g root "$tmp_src/infra/aws/deploy.sh" /usr/local/bin/ams-deploy
  rm -rf "$tmp_src"
fi
/usr/local/bin/ams-deploy
log "done: https://${AMS_DOMAIN} (HTTPS starts once DNS points here)"
