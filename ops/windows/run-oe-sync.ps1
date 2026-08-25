[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$PythonPath = "",
    [int]$Year = (Get-Date).ToUniversalTime().Year,
    [double]$MaximumJobAgeHours = 30,
    [double]$MaximumSourceAgeHours = 50,
    [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$resolvedRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot "pyproject.toml"))) {
    throw "RepositoryRoot does not contain pyproject.toml: $resolvedRoot"
}

if (-not $PythonPath) {
    $venvPython = Join-Path $resolvedRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        $PythonPath = $venvPython
    } else {
        $PythonPath = (Get-Command python -ErrorAction Stop).Source
    }
}
$resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
$runDir = Join-Path $resolvedRoot "outputs\oe-feed-jobs"
$archiveDir = Join-Path $resolvedRoot "outputs\oracles-elixir\raw"
$scheduleArchiveDir = Join-Path $resolvedRoot "outputs\lolesports\raw"
$feedDir = Join-Path $resolvedRoot "web\public\feed"
$scheduleOutput = Join-Path $feedDir "schedule.json"
$scheduleChangesOutput = Join-Path $feedDir "schedule-changes.json"
$syncOutput = Join-Path $runDir "latest-sync.json"
$healthOutput = Join-Path $runDir "health.json"
$schedulerLog = Join-Path $runDir "scheduler.log"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Write-OperationLog {
    param([string]$Message)
    $timestamp = (Get-Date).ToUniversalTime().ToString("o")
    Add-Content -LiteralPath $schedulerLog -Encoding UTF8 -Value "$timestamp $Message"
}

Push-Location $resolvedRoot
try {
    Write-OperationLog "sync-start year=$Year"
    $syncArguments = @(
        "-m", "pro_meta_intelligence", "sync-oe-feed",
        "--year", $Year,
        "--source-timezone", "UTC",
        "--archive-dir", $archiveDir,
        "--feed-dir", $feedDir,
        "--run-dir", $runDir,
        "--output", $syncOutput
    )
    & $resolvedPython @syncArguments
    $syncExitCode = $LASTEXITCODE

    $scheduleArguments = @(
        "-m", "pro_meta_intelligence", "fetch-schedule",
        "--league", "lck",
        "--league", "lec",
        "--league", "lpl",
        "--league", "lcs",
        "--league", "msi",
        "--league", "worlds",
        "--archive-dir", $scheduleArchiveDir,
        "--output", $scheduleOutput,
        "--changes-output", $scheduleChangesOutput,
        "--watch-team", "T1"
    )
    & $resolvedPython @scheduleArguments
    $scheduleExitCode = $LASTEXITCODE

    $healthArguments = @(
        "-m", "pro_meta_intelligence", "check-oe-feed-health",
        "--run-dir", $runDir,
        "--feed-dir", $feedDir,
        "--maximum-job-age-hours", $MaximumJobAgeHours,
        "--maximum-source-age-hours", $MaximumSourceAgeHours,
        "--output", $healthOutput
    )
    & $resolvedPython @healthArguments
    $healthExitCode = $LASTEXITCODE
    $publishExitCode = 0
    if ($Publish -and $syncExitCode -eq 0 -and $healthExitCode -eq 0) {
        & (Join-Path $PSScriptRoot "publish-oe-feed.ps1") `
            -RepositoryRoot $resolvedRoot `
            -PythonPath $resolvedPython
        $publishExitCode = $LASTEXITCODE
    }
    Write-OperationLog "sync-finish sync_exit=$syncExitCode schedule_exit=$scheduleExitCode health_exit=$healthExitCode publish_exit=$publishExitCode"
} catch {
    Write-OperationLog "runner-failed type=$($_.Exception.GetType().Name)"
    throw
} finally {
    Pop-Location
}

if ($syncExitCode -ne 0) {
    exit $syncExitCode
}
if ($healthExitCode -ne 0) {
    exit $healthExitCode
}
if ($publishExitCode -ne 0) {
    exit $publishExitCode
}
exit $healthExitCode
