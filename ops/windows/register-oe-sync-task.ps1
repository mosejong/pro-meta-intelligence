[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$PythonPath = "",
    [string]$TaskName = "Pro Meta Intelligence - OE Sync",
    [datetime]$FirstRunAt = (Get-Date).AddMinutes(5),
    [int]$RepeatHours = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($RepeatHours -lt 24) {
    throw "RepeatHours must be at least 24 to respect the reviewed provider interval."
}
$resolvedRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "run-oe-sync.ps1")).Path
$arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"{0}"' -f $runner),
    "-RepositoryRoot", ('"{0}"' -f $resolvedRoot)
)
if ($PythonPath) {
    $resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
    $arguments += @("-PythonPath", ('"{0}"' -f $resolvedPython))
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($arguments -join " ")
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At $FirstRunAt `
    -RepetitionInterval (New-TimeSpan -Hours $RepeatHours) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if ($PSCmdlet.ShouldProcess($TaskName, "Register a repeating Oracle's Elixir sync task")) {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Policy-gated Pro Meta Intelligence data sync and health check" `
        -Force | Out-Null
    Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
}
