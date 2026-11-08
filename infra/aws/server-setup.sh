#!/usr/bin/env bash
# One-time setup of the single staging server (Ubuntu 24.04, arm64). Run as root, usually from EC2 user data.
# Installs PostgreSQL, Node 22 and Caddy, creates the database and secrets, then calls deploy.sh.
# Safe to run again: every step checks what already exists.
#
# Required environment: AMS_DOMAIN, AMS_BACKUP_BUCKET, AWS_REGION. Optional: AMS_REPO, AMS_BRANCH.
set -euo pipefail

: "${AMS_DOMAIN:?set AMS_DOMAIN, e.g. app.csdv.in}"
: "${AMS_BACKUP_BUCKET:?set AMS_BACKUP_BUCKET}"
: "${AWS_REGION:?set AWS_REGION}"
AMS_REPO="${AMS_REPO:-https://github.com/chunesh2354/AMS.git}"
AMS_BRANCH="${AMS_BRANCH:-main}"
APP_DIR=/opt/ams
ENV_FILE=/etc/ams/env
export DEBIAN_FRONTEND=noninteractive

log() { echo "[ams-setup] $*"; }

# 2 GB swap so npm install and the web build fit on a 2 GB instance.
if ! swapon --show | grep -q /swapfile; then
  log "adding swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "installing packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git unzip postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

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
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$AMS_BRANCH" "$AMS_REPO" "$APP_DIR"
fi
chown -R ams:ams "$APP_DIR"
git config --system --add safe.directory "$APP_DIR"

log "installing services"
install -m 644 "$APP_DIR/infra/aws/ams-api.service" /etc/systemd/system/ams-api.service
sed "s|{\$AMS_DOMAIN}|${AMS_DOMAIN}|g" "$APP_DIR/infra/aws/Caddyfile" > /etc/caddy/Caddyfile
install -m 755 "$APP_DIR/infra/aws/backup.sh" /usr/local/bin/ams-backup
install -m 755 "$APP_DIR/infra/aws/deploy.sh" /usr/local/bin/ams-deploy
install -m 755 "$APP_DIR/infra/aws/create-platform-admin.sh" /usr/local/bin/ams-create-platform-admin
cat > /etc/cron.d/ams-backup <<'EOF'
# Nightly database backup to S3 at 02:30 server time (UTC).
30 2 * * * root /usr/local/bin/ams-backup >> /var/log/ams-backup.log 2>&1
EOF
systemctl daemon-reload
systemctl enable ams-api caddy

/usr/local/bin/ams-deploy
systemctl reload caddy || systemctl restart caddy
log "done: https://${AMS_DOMAIN} (HTTPS starts once DNS points here)"
