<#
.SYNOPSIS
  Stop ONLY the processes start.ps1 started, using data\logs\pids.json.

.DESCRIPTION
  For each entry it checks that the PID is still the same process (same start time; Windows
  reuses PIDs), then stops it with its child processes (taskkill /T: a uv venv's python.exe and
  `uv run` both start a child that does the work). A process that is gone, or whose PID now
  belongs to another process, is not touched; its entry is removed. Anything start.ps1 did not
  start (for example a sim worker another terminal runs) is never in pids.json, so it is never
  stopped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\launch\stop.ps1
  powershell -ExecutionPolicy Bypass -File scripts\launch\stop.ps1 -Service web,backend
#>
param(
    [string]$Service = "",
    [string]$LogDir = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
$entries = Read-PidFile $LogDir
if ($entries.Count -eq 0) {
    Write-Host "nothing to stop: no entries in $(Join-Path $LogDir 'pids.json')"
    exit 0
}

$targets = if ($Service) { @($Service -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } else { @($entries.Keys) }
$code = 0
foreach ($name in $targets) {
    if (-not $entries.Contains($name)) {
        Write-Host "[$name] no entry in pids.json; start.ps1 did not start it, so it is not touched"
        continue
    }
    $entry = $entries[$name]
    $live = Get-LiveProcess $entry
    if (-not $live.Process) {
        Write-Host "[$name] pid $($entry.pid): $($live.Reason); not touched, entry removed"
        $entries.Remove($name)
        continue
    }
    $out = & taskkill.exe /PID $entry.pid /T /F 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$name] stopped pid $($entry.pid) and its child processes"
        $entries.Remove($name)
    } else {
        Write-Host "[$name] FAILED to stop pid $($entry.pid): $($out -join ' ')"
        $code = 1
    }
}
Write-PidFile $LogDir $entries
exit $code
