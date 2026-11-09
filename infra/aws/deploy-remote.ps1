<#
.SYNOPSIS
  Deploy from your own Windows computer: runs `ams-deploy` on the server through AWS Systems Manager
  (no SSH), waits for it to finish and prints its output.

.EXAMPLE
  .\infra\aws\deploy-remote.ps1 -Profile csdv -Region ap-south-1
  .\infra\aws\deploy-remote.ps1 -Profile csdv -Region ap-south-1 -InstanceId i-0123456789abcdef0

.NOTES
  Without -InstanceId it finds the running instance tagged Name=ams-staging.
  The branch deployed is AMS_BRANCH in /etc/ams/env on the server.
#>
[CmdletBinding()]
param(
  [Alias('Profile')]
  [string]$AwsProfile = $(if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { 'csdv' }),
  [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { 'ap-south-1' }),
  [string]$InstanceId = '',
  [int]$TimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'

function Invoke-Aws {
  $out = & aws --profile $AwsProfile --region $Region --output text @args
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
  return $out
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'The AWS CLI is not installed (https://aws.amazon.com/cli/).' }

if (-not $InstanceId) {
  $InstanceId = Invoke-Aws ec2 describe-instances --filters 'Name=tag:Name,Values=ams-staging' 'Name=instance-state-name,Values=running' --query 'Reservations[0].Instances[0].InstanceId'
  if (-not $InstanceId -or $InstanceId -eq 'None') { throw "No running instance tagged Name=ams-staging in $Region. Pass -InstanceId." }
}
Write-Host "[deploy-remote] instance $InstanceId ($Region, profile $AwsProfile)"

$params = '{"commands":["/usr/local/bin/ams-deploy"],"executionTimeout":["' + $TimeoutSeconds + '"]}'
$paramFile = New-TemporaryFile
try {
  Set-Content -Path $paramFile -Value $params -Encoding ascii
  $commandId = Invoke-Aws ssm send-command --instance-ids $InstanceId --document-name AWS-RunShellScript `
    --comment 'ams-deploy' --timeout-seconds 60 --parameters "file://$($paramFile.FullName)" --query 'Command.CommandId'
} finally {
  Remove-Item $paramFile -ErrorAction SilentlyContinue
}
Write-Host "[deploy-remote] command $commandId sent; waiting (up to $TimeoutSeconds s)"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds + 60)
$status = 'Pending'
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  # The invocation is not visible for the first second or two; Windows PowerShell 5.1 turns the
  # redirected stderr into an error record, hence the try.
  try {
    $status = & aws --profile $AwsProfile --region $Region --output text ssm get-command-invocation `
      --command-id $commandId --instance-id $InstanceId --query 'Status' 2>$null
  } catch { continue }
  if ($LASTEXITCODE -ne 0) { continue }
  if ($status -notin @('Pending', 'InProgress', 'Delayed')) { break }
}

$stdout = & aws --profile $AwsProfile --region $Region --output text ssm get-command-invocation --command-id $commandId --instance-id $InstanceId --query 'StandardOutputContent'
$stderr = & aws --profile $AwsProfile --region $Region --output text ssm get-command-invocation --command-id $commandId --instance-id $InstanceId --query 'StandardErrorContent'
if ($stdout) { Write-Host $stdout }
if ($stderr -and $stderr -ne 'None') { Write-Host $stderr -ForegroundColor Yellow }
Write-Host "[deploy-remote] status: $status"
Write-Host "[deploy-remote] SSM truncates output at 24,000 characters; full log on the server: journalctl -u ams-api, /var/log/ams-setup.log"

if ($status -ne 'Success') { exit 1 }
