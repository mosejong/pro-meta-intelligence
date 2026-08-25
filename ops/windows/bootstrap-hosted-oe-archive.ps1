[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = "",
    [string]$ArchiveDirectory = "outputs/oracles-elixir/raw",
    [string]$Repository = "mosejong/pro-meta-intelligence",
    [string]$SecretName = "OE_ARCHIVE_KEY",
    [string]$DraftTag = "oe-history-bootstrap"
)

$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
}
$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$archive = (Resolve-Path -LiteralPath (Join-Path $root $ArchiveDirectory)).Path
if (-not $archive.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) {
    throw "Archive directory escaped the repository root: $archive"
}

$inspection = & python -m pro_meta_intelligence audit-oe-history `
    --archive-dir $archive `
    --source-timezone UTC
if ($LASTEXITCODE -notin @(0, 2)) {
    throw "Existing OE archive failed integrity inspection."
}
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& gh release view $DraftTag --repo $Repository --json isDraft 2>$null | Out-Null
$releaseLookupExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($releaseLookupExitCode -eq 0) {
    throw "Bootstrap draft release already exists: $DraftTag"
}

if (-not $PSCmdlet.ShouldProcess(
    $Repository,
    "Create an archive key secret and upload one encrypted draft bootstrap asset"
)) {
    return
}

$temporaryRoot = Join-Path $root ("outputs/hosted-bootstrap-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
$encrypted = Join-Path $temporaryRoot "oe-private-history-bootstrap.pmi"
$report = Join-Path $temporaryRoot "pack-report.json"
$keyBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$releaseCreated = $false
$completed = $false
try {
    $rng.GetBytes($keyBytes)
    $key = [Convert]::ToBase64String($keyBytes).Replace("+", "-").Replace("/", "_")
    $env:OE_ARCHIVE_KEY = $key

    & python -m pro_meta_intelligence pack-private-oe-archive `
        --archive-dir $archive `
        --output $encrypted `
        --report $report
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the authenticated archive bootstrap."
    }

    $key | & gh secret set $SecretName --repo $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to configure the GitHub archive secret."
    }

    & gh release create $DraftTag `
        --repo $Repository `
        --draft `
        --title "Encrypted OE history bootstrap" `
        --notes "Temporary encrypted bootstrap. Delete after the first hosted artifact succeeds."
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the bootstrap draft release."
    }
    $releaseCreated = $true
    & gh release upload $DraftTag $encrypted --repo $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload the encrypted bootstrap asset."
    }
    & gh api "repos/$Repository/releases/tags/$DraftTag" `
        --jq '.assets[] | select(.name == "oe-private-history-bootstrap.pmi") | {id, name, size, url}'
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to resolve the uploaded bootstrap asset ID."
    }
    $completed = $true
}
finally {
    if ($releaseCreated -and -not $completed) {
        & gh release delete $DraftTag --repo $Repository --yes --cleanup-tag 2>$null
    }
    $rng.Dispose()
    Remove-Item Env:OE_ARCHIVE_KEY -ErrorAction SilentlyContinue
    $key = $null
    [Array]::Clear($keyBytes, 0, $keyBytes.Length)
    $resolvedTemporary = Resolve-Path -LiteralPath $temporaryRoot -ErrorAction SilentlyContinue
    if ($resolvedTemporary -and $resolvedTemporary.Path.StartsWith(
        $root + [IO.Path]::DirectorySeparatorChar
    )) {
        Remove-Item -LiteralPath $resolvedTemporary.Path -Recurse -Force
    }
}
