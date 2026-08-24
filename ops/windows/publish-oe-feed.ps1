[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = "",
    [string]$PythonPath = "",
    [string]$PublisherRoot = "",
    [string]$RemoteName = "origin",
    [string]$PublishBranch = "main",
    [string]$CommitterName = "Pro Meta Intelligence Feed Bot",
    [string]$CommitterEmail = "feed-bot@pro-meta-intelligence.local"
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
if (-not $PublisherRoot) {
    $PublisherRoot = Join-Path (Split-Path $resolvedRoot -Parent) ".pro-meta-intelligence-publisher"
}
$publisherFullPath = [System.IO.Path]::GetFullPath($PublisherRoot)
$insideDeveloperTree = $publisherFullPath.StartsWith(
    $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
)
if ($publisherFullPath.Equals($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $insideDeveloperTree) {
    throw "PublisherRoot must be outside the developer worktree: $publisherFullPath"
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
$sourceFeedDir = Join-Path $resolvedRoot "web\public\feed"
$healthOutput = Join-Path $runDir "publisher-health.json"
$allowedPaths = @(
    "web/public/feed/current.json",
    "web/public/feed/history-status.json",
    "web/public/feed/schedule.json"
)

& $resolvedPython -m pro_meta_intelligence check-oe-feed-health `
    --run-dir $runDir `
    --feed-dir $sourceFeedDir `
    --output $healthOutput
if ($LASTEXITCODE -ne 0) {
    throw "Feed health gate rejected publication. Inspect $healthOutput"
}
$health = Get-Content -LiteralPath $healthOutput -Raw -Encoding UTF8 | ConvertFrom-Json
if ($health.healthy -ne $true) {
    throw "Feed health report is not healthy."
}

$target = "$RemoteName/$PublishBranch via isolated worktree $publisherFullPath"
if (-not $PSCmdlet.ShouldProcess($target, "Publish three allowlisted public feed artifacts")) {
    return
}

& git -C $resolvedRoot fetch $RemoteName $PublishBranch
if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

if (Test-Path -LiteralPath $publisherFullPath) {
    $worktreeRoot = (& git -C $publisherFullPath rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($worktreeRoot) -ne $publisherFullPath) {
        throw "PublisherRoot exists but is not the expected Git worktree: $publisherFullPath"
    }
    $dirty = @(& git -C $publisherFullPath status --porcelain)
    if ($dirty.Count -gt 0) {
        throw "Publisher worktree is not clean; refusing to overwrite or mix changes."
    }
    & git -C $publisherFullPath checkout --detach "$RemoteName/$PublishBranch"
    if ($LASTEXITCODE -ne 0) { throw "publisher checkout failed" }
} else {
    $publisherParent = Split-Path $publisherFullPath -Parent
    New-Item -ItemType Directory -Force -Path $publisherParent | Out-Null
    & git -C $resolvedRoot worktree add --detach --lock --reason "isolated feed publisher" $publisherFullPath "$RemoteName/$PublishBranch"
    if ($LASTEXITCODE -ne 0) { throw "publisher worktree creation failed" }
}

foreach ($relativePath in $allowedPaths) {
    $windowsRelativePath = $relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $source = Join-Path $resolvedRoot $windowsRelativePath
    $destination = Join-Path $publisherFullPath $windowsRelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required public artifact is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

& git -C $publisherFullPath add -- $allowedPaths
if ($LASTEXITCODE -ne 0) { throw "git add failed" }
$stagedPaths = @(& git -C $publisherFullPath diff --cached --name-only --diff-filter=ACMRT)
$unexpectedPaths = @($stagedPaths | Where-Object { $_ -notin $allowedPaths })
if ($unexpectedPaths.Count -gt 0) {
    throw "Unexpected staged paths: $($unexpectedPaths -join ', ')"
}
if ($stagedPaths.Count -eq 0) {
    Write-Output "Public feed is already current; no commit created."
    return
}

$snapshotTime = if ($health.summary.history_status) { $health.checked_at } else { (Get-Date).ToUniversalTime().ToString("o") }
$message = "chore(feed): publish verified snapshot $snapshotTime"
& git -C $publisherFullPath -c "user.name=$CommitterName" -c "user.email=$CommitterEmail" commit -m $message
if ($LASTEXITCODE -ne 0) { throw "feed commit failed" }
& git -C $publisherFullPath push $RemoteName "HEAD:$PublishBranch"
if ($LASTEXITCODE -ne 0) {
    throw "feed push was rejected; remote history was not overwritten"
}
Write-Output "Published allowlisted feed artifacts to $RemoteName/$PublishBranch"
