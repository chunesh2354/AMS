#!/usr/bin/env bash
# Create the staging stack in one AWS account: backup bucket, alert topic, server role, firewall, server and
# fixed IP. Run from your own computer with an AWS CLI profile. Every step reuses what already exists, so it can
# be rerun.
#   AWS_PROFILE=csdv AMS_DOMAIN=app.csdv.in ALERT_EMAIL=owner@example.com bash infra/aws/provision.sh
# ALERT_EMAIL receives backup and deploy failure alerts; AWS emails it a confirmation link that must be clicked.
# Costs (ap-south-1, approx.): t4g.small ~$12/month, 20 GB gp3 ~$2, public IPv4 ~$3.6, S3 backups < $0.5,
# SNS email alerts: free tier.
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${AMS_DOMAIN:?set AMS_DOMAIN}"
: "${ALERT_EMAIL:?set ALERT_EMAIL, the address that receives backup and deploy failure alerts}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
# core-path until its PR merges; switch this default back to main after the merge.
AMS_BRANCH="${AMS_BRANCH:-core-path}"
AMS_REPO="${AMS_REPO:-https://github.com/chunesh2354/AMS.git}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
AWS="${AWS_CLI:-aws}"
aws_() { "$AWS" --region "$AWS_REGION" --output text "$@"; }
TAGS="Key=Project,Value=ams"

ACCOUNT=$(aws_ sts get-caller-identity --query Account)
BUCKET="ams-backups-${ACCOUNT}-${AWS_REGION}"
ROLE=ams-server
echo "account ${ACCOUNT}, region ${AWS_REGION}, domain ${AMS_DOMAIN}, branch ${AMS_BRANCH}"

# 1. Backup bucket: private, encrypted, dumps expire after 30 days.
if ! aws_ s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws_ s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
fi
aws_ s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws_ s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws_ s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-db-dumps","Status":"Enabled","Filter":{"Prefix":"db/"},"Expiration":{"Days":30}}]}'
aws_ s3api put-bucket-tagging --bucket "$BUCKET" --tagging "TagSet=[{Key=Project,Value=ams}]"
echo "bucket ${BUCKET}"

# 2. Alert topic: backup.sh and deploy.sh publish failures here (ams-alert); ALERT_EMAIL is subscribed.
TOPIC_NAME=ams-alerts
TOPIC_ARN="arn:aws:sns:${AWS_REGION}:${ACCOUNT}:${TOPIC_NAME}"
if ! aws_ sns get-topic-attributes --topic-arn "$TOPIC_ARN" >/dev/null 2>&1; then
  TOPIC_ARN=$(aws_ sns create-topic --name "$TOPIC_NAME" --tags "$TAGS" --query TopicArn)
fi
SUB=$(aws_ sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query "Subscriptions[?Protocol=='email' && Endpoint=='${ALERT_EMAIL}'].SubscriptionArn | [0]")
if [ "$SUB" = "None" ] || [ -z "$SUB" ]; then
  aws_ sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
  echo "alerts: subscribed ${ALERT_EMAIL}; open the email from AWS Notifications and click 'Confirm subscription'"
elif [ "$SUB" = "PendingConfirmation" ]; then
  echo "alerts: ${ALERT_EMAIL} has not confirmed yet; click 'Confirm subscription' in the email from AWS Notifications"
else
  echo "alerts: ${ALERT_EMAIL} is subscribed"
fi
echo "topic ${TOPIC_ARN}"

# 3. Server role: Session Manager access (no SSH), write, list and read back backups (restore.sh), store the
#    admin password, publish alerts to the ams-alerts topic only.
if ! aws_ iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws_ iam create-role --role-name "$ROLE" --tags "$TAGS" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws_ iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws_ iam put-role-policy --role-name "$ROLE" --policy-name ams-server --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::${BUCKET}/db/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::${BUCKET}\",\"Condition\":{\"StringLike\":{\"s3:prefix\":[\"db/*\"]}}},
    {\"Effect\":\"Allow\",\"Action\":[\"ssm:PutParameter\",\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:${AWS_REGION}:${ACCOUNT}:parameter/ams/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"sns:Publish\"],\"Resource\":\"${TOPIC_ARN}\"}
  ]}"
if ! aws_ iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws_ iam create-instance-profile --instance-profile-name "$ROLE" --tags "$TAGS" >/dev/null
  aws_ iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  sleep 10 # a new instance profile takes a moment before EC2 accepts it
fi
echo "role ${ROLE}"

# 4. Firewall: only HTTP and HTTPS in. No SSH; use Session Manager.
VPC=$(aws_ ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId')
[ "$VPC" != "None" ] || { echo "No default VPC in ${AWS_REGION}. Create one: aws ec2 create-default-vpc" >&2; exit 1; }
SG=$(aws_ ec2 describe-security-groups --filters Name=group-name,Values=ams-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId')
if [ "$SG" = "None" ]; then
  SG=$(aws_ ec2 create-security-group --group-name ams-web --description "AMS web: HTTP and HTTPS only" --vpc-id "$VPC" --tag-specifications "ResourceType=security-group,Tags=[{$TAGS}]" --query GroupId)
  aws_ ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' >/dev/null
fi
echo "security group ${SG}"

# 5. Server: Ubuntu 24.04 arm64, encrypted disk, IMDSv2 only. User data runs server-setup.sh.
INSTANCE=$(aws_ ec2 describe-instances --filters Name=tag:Name,Values=ams-staging Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[0].Instances[0].InstanceId')
NEW_INSTANCE=0
if [ "$INSTANCE" = "None" ]; then
  NEW_INSTANCE=1
  AMI=$(aws_ ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value)
  USERDATA=$(mktemp)
  cat > "$USERDATA" <<EOF
#!/bin/bash
set -euo pipefail
exec > /var/log/ams-setup.log 2>&1
export AMS_DOMAIN='${AMS_DOMAIN}' AMS_BACKUP_BUCKET='${BUCKET}' AWS_REGION='${AWS_REGION}' AMS_BRANCH='${AMS_BRANCH}' AMS_REPO='${AMS_REPO}' AMS_ALERT_TOPIC_ARN='${TOPIC_ARN}'
apt-get update -y && apt-get install -y git
# Root-owned checkout: root never runs a file the ams user can change (infra/aws/README.md).
install -d -m 755 -o root -g root /opt/ams
[ -d /opt/ams/src/.git ] || git clone --branch "\$AMS_BRANCH" "\$AMS_REPO" /opt/ams/src
bash /opt/ams/src/infra/aws/server-setup.sh
EOF
  INSTANCE=$(aws_ ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --iam-instance-profile "Name=${ROLE}" --security-group-ids "$SG" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
    --user-data "file://$(command -v cygpath >/dev/null && cygpath -m "$USERDATA" || echo "$USERDATA")" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=ams-staging},{$TAGS}]" "ResourceType=volume,Tags=[{$TAGS}]" \
    --query 'Instances[0].InstanceId')
  rm -f "$USERDATA"
  aws_ ec2 wait instance-running --instance-ids "$INSTANCE"
fi
echo "instance ${INSTANCE}"

# 6. Existing server: write the topic into /etc/ams/env (a new server gets it from user data above).
if [ "$NEW_INSTANCE" -eq 0 ]; then
  PARAMS=$(mktemp)
  cat > "$PARAMS" <<EOF
{"commands":["set -e; test -f /etc/ams/env; if grep -q '^AMS_ALERT_TOPIC_ARN=' /etc/ams/env; then sed -i 's|^AMS_ALERT_TOPIC_ARN=.*|AMS_ALERT_TOPIC_ARN=${TOPIC_ARN}|' /etc/ams/env; else echo 'AMS_ALERT_TOPIC_ARN=${TOPIC_ARN}' >> /etc/ams/env; fi; grep '^AMS_ALERT_TOPIC_ARN=' /etc/ams/env"]}
EOF
  if CMD=$(aws_ ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --comment 'ams alert topic'       --parameters "file://$(command -v cygpath >/dev/null && cygpath -m "$PARAMS" || echo "$PARAMS")" --query Command.CommandId 2>/dev/null); then
    echo "alerts: AMS_ALERT_TOPIC_ARN sent to /etc/ams/env on ${INSTANCE} (SSM command ${CMD})"
  else
    echo "alerts: could not reach ${INSTANCE} through SSM. On the server, add this line to /etc/ams/env:" >&2
    echo "  AMS_ALERT_TOPIC_ARN=${TOPIC_ARN}" >&2
  fi
  rm -f "$PARAMS"
fi

# 7. Fixed public IP for the DNS record.
EIP=$(aws_ ec2 describe-addresses --filters Name=tag:Name,Values=ams-staging --query 'Addresses[0].AllocationId')
if [ "$EIP" = "None" ]; then
  EIP=$(aws_ ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=ams-staging},{$TAGS}]" --query AllocationId)
fi
aws_ ec2 associate-address --allocation-id "$EIP" --instance-id "$INSTANCE" --allow-reassociation >/dev/null
IP=$(aws_ ec2 describe-addresses --allocation-ids "$EIP" --query 'Addresses[0].PublicIp')
echo
echo "Server IP: ${IP}"
echo "DNS: add an A record for ${AMS_DOMAIN} -> ${IP}"
echo "Setup log: aws ssm start-session --target ${INSTANCE}, then: sudo tail -f /var/log/ams-setup.log"
echo "Alerts: ${ALERT_EMAIL} must confirm the AWS subscription email; test on the server with: sudo ams-alert test 'alert test'"
