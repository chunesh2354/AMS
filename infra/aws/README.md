# AWS staging: one server

Practice runs on a single EC2 instance (Ubuntu 24.04, arm64): PostgreSQL, the API (Node, managed by
systemd) and Caddy (HTTPS and the built web app). There is no SSH; you reach the server through AWS
Systems Manager (Session Manager / Run Command). Backups go to a private, encrypted S3 bucket. Backup,
deploy and restore failures are emailed to the owner through an SNS topic (`ams-alerts`).

Examples use the AWS CLI profile `csdv` and region `ap-south-1`. Use whatever profile and region
you provisioned with: every command below takes `--profile` and `--region`.

## The files

| File | Runs where | What it does |
| --- | --- | --- |
| `provision.sh` | your computer | Creates (or reuses) the backup bucket, the `ams-alerts` SNS topic with an email subscription for `ALERT_EMAIL`, the server IAM role, the `ams-web` security group (80/443 only), the `ams-staging` instance and its Elastic IP, and puts the topic ARN in the server's `/etc/ams/env`. Safe to rerun; rerunning also updates the role policy. |
| `server-setup.sh` | server, as root (EC2 user data on first boot) | Swap, packages, Node 22, Caddy, AWS CLI, the `ams` user, `/etc/ams/env` with generated secrets (and `AMS_ALERT_TOPIC_ARN`), the database, then `install-server-files.sh` and a first deploy. Safe to rerun. |
| `install-server-files.sh` | server, as root (called by `server-setup.sh` and by every `ams-deploy`) | Installs the `ams-*` commands, `/etc/cron.d/ams-backup` (with a `PATH` that includes `/usr/local/bin`), the systemd unit (then `daemon-reload`) and the Caddyfile (checked with `caddy validate` first; Caddy reloads only if it changed, and the previous file is put back if the reload fails). |
| `deploy.sh` | server (`ams-deploy`) | Pulls `AMS_BRANCH` (and continues with the new `deploy.sh` if it changed), runs `install-server-files.sh`, installs, builds the web app in live mode, restarts the API, waits for `/api/v1/health`. A failed health check sends an alert. |
| `deploy-remote.ps1` | your computer (Windows) | Runs `ams-deploy` on the server through `aws ssm send-command` and prints the result. On a server whose `ams-deploy` predates `install-server-files.sh`, it also runs that script once after the deploy. |
| `backup.sh` | server (`ams-backup`, cron 02:30 UTC) | `pg_dump` to `s3://<bucket>/db/ams-<UTC time>.dump`. On failure: exits non-zero, logs to the system log under the tag `ams-backup` and sends an alert. |
| `restore.sh` | server (`ams-restore`) | Restores a named dump from S3 into a temporary database, then swaps it in. Dry run unless given `--yes-replace-database`; always takes a safety dump first. |
| `alert.sh` | server (`ams-alert`) | Publishes a message to the `ams-alerts` topic (`AMS_ALERT_TOPIC_ARN` in `/etc/ams/env`) and logs it under the tag `ams-alert`. |
| `create-platform-admin.sh` | server (`ams-create-platform-admin`) | Creates or resets the platform admin with a random password stored only in SSM. |
| `set-platform-admin-password.sh` | server (`ams-set-platform-admin-password`) | Applies a password you put in SSM yourself. |
| `ams-api.service` | server | systemd unit for the API (`/etc/systemd/system/ams-api.service`). |
| `Caddyfile` | server | HTTPS, security headers, `/api/*` to `127.0.0.1:3000`, everything else to the built web app. |

The branch: `AMS_BRANCH` defaults to `core-path` in `provision.sh` and `server-setup.sh` until that
branch's pull request is merged. After the merge, change both defaults back to `main` and, on an
existing server, edit `AMS_BRANCH` in `/etc/ams/env`.

## First-time provision

1. Install the AWS CLI and sign in to a profile with admin rights in the target account.
2. From the repository root (Git Bash on Windows):

   ```bash
   AWS_PROFILE=csdv AWS_REGION=ap-south-1 AMS_DOMAIN=app.csdv.in ALERT_EMAIL=owner@example.com bash infra/aws/provision.sh
   ```

   `ALERT_EMAIL` is required: it receives backup, deploy and restore failure alerts.
   Optional: `AMS_BRANCH`, `AMS_REPO`, `INSTANCE_TYPE` (default `t4g.small`).
3. Confirm the alert subscription: AWS Notifications emails `ALERT_EMAIL` a "Subscription Confirmation";
   click **Confirm subscription**. Until then no alert is delivered (rerunning `provision.sh` says whether it
   is still pending).
4. Add the DNS A record it prints (`AMS_DOMAIN` to the Elastic IP). Caddy gets the certificate once DNS resolves.
5. Watch the first boot (about 10 minutes):

   ```bash
   aws ssm start-session --target <instance-id> --profile csdv --region ap-south-1
   sudo tail -f /var/log/ams-setup.log
   ```

6. Create the platform admin (below).
7. Once the subscription is confirmed, test the alert on the server: `sudo ams-alert test "alert test"`.

Secrets are generated on the server in `/etc/ams/env` (root and the `ams` group only) and never
leave it, except the platform admin password, which goes to SSM Parameter Store encrypted.

## Deploy

From Windows (PowerShell):

```powershell
.\infra\aws\deploy-remote.ps1 -Profile csdv -Region ap-south-1
# or a specific instance:
.\infra\aws\deploy-remote.ps1 -Profile csdv -Region ap-south-1 -InstanceId i-0123456789abcdef0
```

It finds the running instance tagged `Name=ams-staging` when no id is given, waits for the command
and exits non-zero unless the deploy succeeded. On the server itself: `sudo ams-deploy`.
Migrations run when the API starts (`apps/api/src/main.ts`).

Every deploy reinstalls the server's own files from the new checkout (`install-server-files.sh`): the
`ams-*` commands, the backup cron file, the systemd unit (followed by `systemctl daemon-reload`) and the
Caddyfile (validated with `caddy validate` before it replaces the live one; Caddy is reloaded only when it
changed). So a fix to anything in `infra/aws` reaches an existing server with an ordinary deploy. If the
new Caddyfile does not validate, the deploy stops before restarting the API and the live Caddyfile is
left as it was.

If the API does not answer `/api/v1/health` within 60 seconds of the restart, `ams-deploy` prints the
last 40 log lines, sends an alert ("deploy FAILED: API not healthy") and exits non-zero.

### Existing servers (set up before install-server-files.sh)

Their `/usr/local/bin/ams-deploy` is the old one and does not reinstall anything. `deploy-remote.ps1`
handles this by itself: after `ams-deploy` it runs `install-server-files.sh` once when the installed
`ams-deploy` does not mention it. On the server by hand, the same thing is:

```bash
sudo ams-deploy && sudo bash /opt/ams/infra/aws/install-server-files.sh
```

Then rerun `provision.sh` (with `ALERT_EMAIL`) from your computer: it creates the topic, grants the
server `sns:Publish` on it and writes `AMS_ALERT_TOPIC_ARN` into the server's `/etc/ams/env` through
SSM Run Command. If SSM cannot reach the server it prints the line to add by hand.

## Logs

The API writes one JSON line per event to stdout; systemd sends it to journald.

```bash
journalctl -u ams-api -f                      # follow
journalctl -u ams-api --since "1 hour ago"
journalctl -u ams-api -o cat | grep '"level":50'   # 5xx errors only (pino level 50)
journalctl -u ams-api | grep <request id>      # one request, by the x-request-id response header
journalctl -t ams-backup                       # backup results and failures
journalctl -t ams-restore
journalctl -t ams-alert                        # every alert sent, and alerts that could not be sent
journalctl -t ams-install                      # install-server-files.sh failures
journalctl -u caddy                            # HTTPS and proxy
```

Every response carries an `x-request-id` header; a user can quote it and you can find the request.
Every 5xx is logged with the error, request id, method and URL. Request bodies, cookies,
authorization headers, password fields and tokens in invite or reset URLs are never logged.
Set `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace`; default `info`) in `/etc/ams/env`
and `systemctl restart ams-api` to change verbosity.

Sign-in endpoints (firm login, platform login, accept invite, password reset) allow 10 requests per
minute per client IP each and answer `429 RATE_LIMITED` beyond that. Tune with `AUTH_RATE_LIMIT_MAX`
and `AUTH_RATE_LIMIT_WINDOW_MS` in `/etc/ams/env` (`AUTH_RATE_LIMIT_MAX=0` turns it off). The client IP
is taken from Caddy's `X-Forwarded-For` because the API trusts only loopback proxies (`TRUST_PROXY`).

## Backups

- Nightly at 02:30 UTC (`/etc/cron.d/ams-backup`), output also appended to `/var/log/ams-backup.log`.
  The cron file sets `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` (cron's default
  `PATH` does not include `/usr/local/bin`, where the AWS CLI is), and `backup.sh` calls the CLI by its
  absolute path, `/usr/local/bin/aws`. Before this fix every nightly upload failed with `aws: command not found`.
- Stored as `s3://ams-backups-<account>-<region>/db/ams-<UTC time>.dump`, kept 30 days (bucket lifecycle rule).
- Run one now: `sudo ams-backup`.
- A failure exits non-zero, writes `[ams-backup] ... FAILED at step '...'` to the system log
  (`journalctl -t ams-backup -p err`) and emails `ALERT_EMAIL` through `ams-alert` ("backup FAILED (step)").
  If the alert itself cannot be sent (no `AMS_ALERT_TOPIC_ARN`, no permission), that is logged too.
- From your computer: `aws s3 ls s3://ams-backups-<account>-ap-south-1/db/ --profile csdv`.

## Restore

On the server, as root:

```bash
sudo ams-restore --list                                              # what is in the bucket
sudo ams-restore ams-2026-11-08T023001Z.dump                         # dry run: changes nothing
sudo ams-restore ams-2026-11-08T023001Z.dump --yes-replace-database  # the real thing
```

The real run:

1. downloads and checks the dump and writes a safety dump of the current database to
   `/var/backups/ams/before-restore-<time>.dump`;
2. restores the dump into a new temporary database, `ams_restoring_<time>`, while the API keeps
   serving the current one;
3. only if `pg_restore` succeeded: stops the API, renames `ams` to `ams_before_restore_<time>` and the
   temporary database to `ams`, starts the API (migrations run) and waits for the health check.

Nothing is dropped: the previous data stays in `ams_before_restore_<time>` (and in the safety dump).
When you are satisfied, free the space with `sudo -u postgres dropdb ams_before_restore_<time>`.

On any failure it puts the previous database back if it had already been renamed, drops the temporary
database, starts the API again (it never leaves it stopped), prints the state and the exact recovery
steps that apply (renames, `systemctl start ams-api`, the health check), writes them to
`journalctl -t ams-restore` and sends an alert. If the swap succeeded but the API is not healthy on the
restored data, it leaves the restored data in place and prints the two renames that go back.

Restoring needs `s3:GetObject` and `s3:ListBucket` on the bucket; servers created before restore.sh
existed get them by rerunning `provision.sh`.

## Alerts

- `provision.sh` creates the SNS topic `ams-alerts`, subscribes `ALERT_EMAIL` (the owner confirms the
  email from AWS), allows the server role `sns:Publish` on that topic only, and writes
  `AMS_ALERT_TOPIC_ARN` into `/etc/ams/env`.
- Sent on: a failed nightly backup, a failed health check after `ams-deploy` restarts the API, a failed restore.
- Send a test: `sudo ams-alert test "alert test"`.
- Change the address: rerun `provision.sh` with the new `ALERT_EMAIL`, then remove the old subscription
  in the SNS console (or `aws sns unsubscribe --subscription-arn <arn>`).

## Platform admin password (SSM)

The password lives only in SSM Parameter Store as `/ams/platform-admin-password` (SecureString).

Let the server generate one (never printed):

```bash
sudo ams-create-platform-admin owner@example.com "Owner Name"
# then, on your computer:
aws ssm get-parameter --name /ams/platform-admin-password --with-decryption --query Parameter.Value --output text --profile csdv --region ap-south-1
```

Or choose your own, without it appearing in a chat or on the server's command line:

```bash
# on your computer
aws ssm put-parameter --name /ams/platform-admin-password --type SecureString --overwrite --value '<password>' --profile csdv --region ap-south-1
# on the server
sudo ams-set-platform-admin-password owner@example.com "Owner Name"
```

Minimum length is 14 characters.
