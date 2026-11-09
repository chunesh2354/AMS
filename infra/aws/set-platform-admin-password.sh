#!/usr/bin/env bash
# Apply a platform admin password that the owner stored themselves in SSM Parameter Store, so it never
# appears in a chat, a command line or command history:
#   1. On your own computer:
#        aws ssm put-parameter --name /ams/platform-admin-password --type SecureString --overwrite --value '<password>' --profile csdv --region ap-southeast-2
#   2. On the server (as root):  ams-set-platform-admin-password <email> <name...>
# The CLI it calls enforces the minimum length (14 characters).
set -euo pipefail
email="${1:?usage: ams-set-platform-admin-password <email> <name>}"; shift
name="${*:?usage: ams-set-platform-admin-password <email> <name>}"
set -a; . /etc/ams/env; set +a
password=$(aws ssm get-parameter --region "$AWS_REGION" --name /ams/platform-admin-password --with-decryption --query Parameter.Value --output text)
cd /opt/ams/app/apps/api
sudo -u ams -H env HOME=/home/ams NODE_ENV=production AMS_OWNER_URL="$AMS_OWNER_URL" PLATFORM_ADMIN_PASSWORD="$password" \
  node --import tsx src/dev/platform-admin.ts "$email" "$name"
