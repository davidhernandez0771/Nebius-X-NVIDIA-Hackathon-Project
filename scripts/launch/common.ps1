# Shared helpers for status.ps1, start.ps1 and stop.ps1. Dot-source it: . "$PSScriptRoot\common.ps1"
# Windows PowerShell 5.1. Keep this file ASCII: 5.1 reads a BOM-less script as the ANSI code page.

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:HealthPy = Join-Path $PSScriptRoot "health.py"

function Resolve-HelperPython([string]$Explicit) {
    # A Python for health.py (stdlib only, so any 3.10+ works). Order: -Python, $env:PM_PYTHON,
    # the SANT venv ($env:UV_PROJECT_ENVIRONMENT), the py launcher. A bare `python` on PATH is
    # skipped on purpose: on this machine it is a broken uv trampoline into a OneDrive .venv.
    if ($Explicit) { return @{ Exe = $Explicit; Args = @() } }
    if ($env:PM_PYTHON) { return @{ Exe = $env:PM_PYTHON; Args = @() } }
    if ($env:UV_PROJECT_ENVIRONMENT) {
        $venvPy = Join-Path $env:UV_PROJECT_ENVIRONMENT "Scripts\python.exe"
        if (Test-Path $venvPy) { return @{ Exe = $venvPy; Args = @() } }
    }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @{ Exe = $py.Source; Args = @("-3") } }
    throw "No Python found for health.py. Pass -Python <python.exe>, or set PM_PYTHON or UV_PROJECT_ENVIRONMENT."
}

function Invoke-Health($HelperPython, [string[]]$HealthArgs) {
    # Runs health.py and returns its exit code; its output goes to the console.
    $allArgs = @($HelperPython.Args) + @($script:HealthPy) + $HealthArgs
    & $HelperPython.Exe @allArgs | Out-Host
    return $LASTEXITCODE
}

function Invoke-HealthCapture($HelperPython, [string[]]$HealthArgs) {
    # Runs health.py quietly: @{ Code = exit code; Output = its lines }.
    $allArgs = @($HelperPython.Args) + @($script:HealthPy) + $HealthArgs
    $out = & $HelperPython.Exe @allArgs 2>&1 | ForEach-Object { "$_" }
    return @{ Code = $LASTEXITCODE; Output = @($out) }
}

function Get-DefaultLogDir { return (Join-Path $script:RepoRoot "data\logs") }

function Read-PidFile([string]$LogDir) {
    # pids.json -> ordered hashtable service -> entry (hashtable). Missing file -> empty.
    $path = Join-Path $LogDir "pids.json"
    $result = [ordered]@{}
    if (-not (Test-Path $path)) { return $result }
    $text = [IO.File]::ReadAllText($path)
    if (-not $text.Trim()) { return $result }
    $obj = $text | ConvertFrom-Json
    foreach ($prop in $obj.PSObject.Properties) {
        $entry = @{}
        foreach ($p in $prop.Value.PSObject.Properties) { $entry[$p.Name] = $p.Value }
        $result[$prop.Name] = $entry
    }
    return $result
}

function Write-PidFile([string]$LogDir, $Entries) {
    # Writes UTF-8 without a BOM (5.1's Set-Content -Encoding UTF8 adds one); no entries -> file removed.
    $path = Join-Path $LogDir "pids.json"
    if ($Entries.Count -eq 0) {
        if (Test-Path $path) { Remove-Item $path }
        return
    }
    $json = [pscustomobject]$Entries | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
}

function Get-StartTimeString($Process) {
    return $Process.StartTime.ToUniversalTime().ToString("o")
}

function Get-LiveProcess($Entry) {
    # The process an entry recorded, or $null if it is gone or its PID now belongs to another
    # process (Windows reuses PIDs). Returns @{ Process; Reason }.
    $proc = Get-Process -Id ([int]$Entry.pid) -ErrorAction SilentlyContinue
    if (-not $proc) { return @{ Process = $null; Reason = "not running" } }
    try { $started = Get-StartTimeString $proc } catch { return @{ Process = $null; Reason = "start time unreadable" } }
    if ($started -ne [string]$Entry.start_time) {
        return @{ Process = $null; Reason = "PID $($Entry.pid) now belongs to another process (started $started)" }
    }
    return @{ Process = $proc; Reason = "" }
}
