# AWS staging: one server

Practice runs on a single EC2 instance (Ubuntu 24.04, arm64): PostgreSQL, the API (Node, managed by
systemd) and Caddy (HTTPS and the built web app). There is no SSH; you reach the server through AWS
Systems Manager (Session Manager / Run Command). Backups go to a private, encrypted S3 bucket.

Examples use the AWS CLI profile `csdv` and region `ap-south-1`. Use whatever profile and region
you provisioned with: every command below takes `--profile` and `--region`.

## The files

| File | Runs where | What it does |
| --- | --- | --- |
| `provision.sh` | your computer | Creates (or reuses) the backup bucket, the server IAM role, the `ams-web` security group (80/443 only), the `ams-staging` instance and its Elastic IP. Safe to rerun; rerunning also updates the role policy. |
| `server-setup.sh` | server, as root (EC2 user data on first boot) | Swap, packages, Node 22, Caddy, AWS CLI, the `ams` user, `/etc/ams/env` with generated secrets, the database, the systemd unit, the `ams-*` commands and the nightly backup cron, then a first deploy. Safe to rerun. |
| `deploy.sh` | server (`ams-deploy`) | Pulls `AMS_BRANCH`, installs, builds the web app in live mode, restarts the API, waits for `/api/v1/health`. |
| `deploy-remote.ps1` | your computer (Windows) | Runs `ams-deploy` on the server through `aws ssm send-command` and prints the result. |
| `backup.sh` | server (`ams-backup`, cron 02:30 UTC) | `pg_dump` to `s3://<bucket>/db/ams-<UTC time>.dump`. On failure: exits non-zero and logs to the system log under the tag `ams-backup`. |
| `restore.sh` | server (`ams-restore`) | Restores a named dump from S3. Dry run unless given `--yes-replace-database`; always takes a safety dump first. |
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
   AWS_PROFILE=csdv AWS_REGION=ap-south-1 AMS_DOMAIN=app.csdv.in bash infra/aws/provision.sh
   ```

   Optional: `AMS_BRANCH`, `AMS_REPO`, `INSTANCE_TYPE` (default `t4g.small`).
3. Add the DNS A record it prints (`AMS_DOMAIN` to the Elastic IP). Caddy gets the certificate once DNS resolves.
4. Watch the first boot (about 10 minutes):

   ```bash
   aws ssm start-session --target <instance-id> --profile csdv --region ap-south-1
   sudo tail -f /var/log/ams-setup.log
   ```

5. Create the platform admin (below).

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

## Logs

The API writes one JSON line per event to stdout; systemd sends it to journald.

```bash
journalctl -u ams-api -f                      # follow
journalctl -u ams-api --since "1 hour ago"
journalctl -u ams-api -o cat | grep '"level":50'   # 5xx errors only (pino level 50)
journalctl -u ams-api | grep <request id>      # one request, by the x-request-id response header
journalctl -t ams-backup                       # backup results and failures
journalctl -t ams-restore
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
- Stored as `s3://ams-backups-<account>-<region>/db/ams-<UTC time>.dump`, kept 30 days (bucket lifecycle rule).
- Run one now: `sudo ams-backup`.
- A failure exits non-zero and writes `[ams-backup] ... FAILED at step '...'` to the system log
  (`journalctl -t ams-backup -p err`).
- From your computer: `aws s3 ls s3://ams-backups-<account>-ap-south-1/db/ --profile csdv`.

## Restore

On the server, as root:

```bash
sudo ams-restore --list                                              # what is in the bucket
sudo ams-restore ams-2026-11-08T023001Z.dump                         # dry run: changes nothing
sudo ams-restore ams-2026-11-08T023001Z.dump --yes-replace-database  # the real thing
```

The real run downloads and checks the dump, writes a safety dump of the current database to
`/var/backups/ams/before-restore-<time>.dump`, stops the API, drops and recreates the database,
restores, starts the API and waits for the health check. If anything fails it prints how to put the
safety dump back. Restoring needs `s3:GetObject` and `s3:ListBucket` on the bucket; servers created
before restore.sh existed get them by rerunning `provision.sh`.

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
