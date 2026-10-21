<#
.SYNOPSIS
  Start a live test from this checkout: the backend (with the teleop relay) and the web, then print the sink
  command and the URL to open.

.DESCRIPTION
  1. Refuses if port 8000 or 5173 is held by something this checkout's start.ps1 didn't start: with many
     worktrees, that is usually another checkout's backend or dev server, and the test would run its code.
     Then restarts a backend or web that this checkout started earlier (unless -KeepRunning). The backend has no
     reload, so one started before a merge keeps the old relay, and an old relay rejects newer sim_status fields
     (the record-contact note).
  2. Starts both with scripts\launch\start.ps1 -Backend -Web (hidden, logs in data\logs, stop.ps1 stops them).
     The web's predev puts the hand-tracking files in web\public (web\scripts\hand-assets.mjs), so a restarted
     web copies them again.
  3. Checks the relay at http://127.0.0.1:8000/teleop/status and that the hand-tracking files are there.
  4. Prints the sink command (Isaac Lab; it is not started here, and only one Isaac process may run) and the URL.

  The backend runs in -SantVenv: $env:UV_PROJECT_ENVIRONMENT if set, else this checkout's .venv (uv's default).
  Demos: the sink saves them and the backend serves them (Delete last demo, camera video), so both must use one
  store. -DataDir sets DATA_DIR for the backend and puts the same --data-dir in the printed sink command; without it,
  both use $env:DATA_DIR, else this checkout's data folder. A restart is needed to change it (step 1b does it).
  Exit code: 0 when the backend, the relay, the web and the hand files are all ready; 1 otherwise.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-live.ps1
#>
param(
    [switch]$KeepRunning,
    [string]$DataDir = "",
    [string]$SantVenv = $env:UV_PROJECT_ENVIRONMENT,
    [string]$IsaacPython = "C:\isaac\env_isaaclab\Scripts\python.exe",
    [string]$LogDir = "",
    [int]$TimeoutSec = 0,
    [string]$Python = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "launch\common.ps1")   # $script:RepoRoot, pids.json helpers, health.py
$repo = $script:RepoRoot
$backendPort = 8000   # the web's API base (web/src/pm/api.ts) and the sink's relay URL
$webPort = 5173       # start.ps1's dev server port
$env:PM_BACKEND_URL = "http://127.0.0.1:$backendPort"

if (-not $SantVenv) { $SantVenv = Join-Path $repo ".venv" }
if ($DataDir) { $env:DATA_DIR = (New-Item -ItemType Directory -Force -Path $DataDir).FullName }
$demoRoot = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $repo "data" }
if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
$py = Resolve-HelperPython $Python

function Get-Listener([int]$Port) {
    # The process listening on 127.0.0.1:<port> as "pid N: command line", or $null if none.
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
    $cmd = if ($proc -and $proc.CommandLine) { $proc.CommandLine } else { "(command line unreadable)" }
    return "pid $($conn.OwningProcess): $cmd"
}

function Test-Ours([string]$Name) {
    $entries = Read-PidFile $LogDir
    return ($entries.Contains($Name) -and (Get-LiveProcess $entries[$Name]).Process)
}

# 1. The ports must be free, or held by what this checkout started
$refused = $false
foreach ($svc in @(@{ Name = "backend"; Port = $backendPort }, @{ Name = "web"; Port = $webPort })) {
    $holder = Get-Listener $svc.Port
    if ($holder -and -not (Test-Ours $svc.Name)) {
        Write-Host "[$($svc.Name)] REFUSED: port $($svc.Port) is held by something this checkout didn't start:"
        Write-Host "  $holder"
        Write-Host "  stop it (another worktree's backend or dev server?), then run this again"
        $refused = $true
    }
}
if ($refused) { exit 1 }

# 1b. What this checkout started earlier may be older code than what is checked out now: restart it
$head = (& git -C $repo log -1 --format="%h %s" 2>$null)
$branch = (& git -C $repo rev-parse --abbrev-ref HEAD 2>$null)
Write-Host "[code] $branch @ $head"
Write-Host "[data] demos: $(Join-Path $demoRoot 'demos') (the backend and the sink command below both use it)"
$ours = @(@("backend", "web") | Where-Object { Test-Ours $_ })
if ($ours.Count -gt 0) {
    if ($KeepRunning) {
        Write-Host "[restart] -KeepRunning: $($ours -join ', ') left as started earlier (they may run older code)"
    } else {
        Write-Host "[restart] $($ours -join ', ') started earlier by this checkout: restarting, so they run the code above"
        & (Join-Path $PSScriptRoot "launch\stop.ps1") -Service ($ours -join ",") -LogDir $LogDir
        if ($LASTEXITCODE -ne 0) { Write-Host "[restart] FAILED to stop them (see above)"; exit 1 }
        foreach ($svc in @(@{ Name = "backend"; Port = $backendPort }, @{ Name = "web"; Port = $webPort })) {
            for ($i = 0; $i -lt 40 -and (Get-Listener $svc.Port); $i++) { Start-Sleep -Milliseconds 250 }
            if (Get-Listener $svc.Port) { Write-Host "[restart] FAILED: port $($svc.Port) still held: $(Get-Listener $svc.Port)"; exit 1 }
        }
    }
}

# 2. Backend + web
$startArgs = @{ Backend = $true; Web = $true; SantVenv = $SantVenv; LogDir = $LogDir }
if ($TimeoutSec -gt 0) { $startArgs.TimeoutSec = $TimeoutSec }
if ($Python) { $startArgs.Python = $Python }
& (Join-Path $PSScriptRoot "launch\start.ps1") @startArgs
$started = ($LASTEXITCODE -eq 0)

# 3. The relay and the hand-tracking files
$relay = Invoke-HealthCapture $py @("wait", "teleop", "--timeout", "15")
$relayUp = ($relay.Code -eq 0)
Write-Host "[relay] $($relay.Output -join ' ')"

$handFiles = @("web\public\mediapipe\wasm\vision_wasm_internal.js", "web\public\mediapipe\wasm\vision_wasm_internal.wasm",
    "web\public\models\hand_landmarker.task")
$missing = @($handFiles | Where-Object { -not (Test-Path (Join-Path $repo $_)) })
if ($missing.Count -gt 0) {
    Write-Host "[hand] MISSING: $($missing -join ', ')"
    Write-Host "  the camera can't track hands without them; run: node web\scripts\hand-assets.mjs"
} else {
    Write-Host "[hand] tracking files are in web\public"
}

$isaac = Invoke-HealthCapture $py @("isaac")
if ($isaac.Code -eq 1) {
    Write-Host "[sink] note: an Isaac python is already running; stop it before the sink (one Isaac process at a time):"
    $isaac.Output | ForEach-Object { Write-Host "  $_" }
}

# 4. What to run and open next
Write-Host ""
Write-Host "Sink (Isaac Lab with the Kit window), in a new PowerShell:"
Write-Host "  cd `"$repo`""
Write-Host "  `$env:PYTHONPATH = `"$(Join-Path $repo 'src')`""
Write-Host "  & `"$IsaacPython`" sim_worker\scripts\teleop_sink_loop.py --viz kit --data-dir `"$demoRoot`""
Write-Host "  (the Record page's scene picker can then restart it in a scene with new bodies; add"
Write-Host "   --scene s3, or --scene-list s1,s2,s3 --takes-per-scene 2 for a recording session)"
Write-Host ""
Write-Host "Open: http://localhost:$webPort/record"
Write-Host "Stop: powershell -ExecutionPolicy Bypass -File scripts\launch\stop.ps1"

if ($started -and $relayUp -and $missing.Count -eq 0) { exit 0 }
Write-Host "not ready: see the lines above (logs in $LogDir)"
exit 1
