#!/usr/bin/env bash
# Create (or reset) the platform admin with a random password, stored encrypted in SSM Parameter Store.
# The password is never printed. Read it on your own computer with:
#   aws ssm get-parameter --name /ams/platform-admin-password --with-decryption --query Parameter.Value --output text --profile csdv
# Usage (as root on the server): ams-create-platform-admin <email> <name...>
set -euo pipefail
email="${1:?usage: ams-create-platform-admin <email> <name>}"; shift
name="${*:?usage: ams-create-platform-admin <email> <name>}"
set -a; . /etc/ams/env; set +a
password=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
cd /opt/ams/app/apps/api
sudo -u ams -H env HOME=/home/ams NODE_ENV=production AMS_OWNER_URL="$AMS_OWNER_URL" PLATFORM_ADMIN_PASSWORD="$password" \
  node --import tsx src/dev/platform-admin.ts "$email" "$name" >/dev/null
aws ssm put-parameter --region "$AWS_REGION" --name /ams/platform-admin-password --type SecureString --overwrite --value "$password" >/dev/null
echo "[ams] platform admin ${email} is ready; password saved to SSM /ams/platform-admin-password"
