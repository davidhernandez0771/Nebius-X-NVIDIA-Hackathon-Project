<#
.SYNOPSIS
  Start the local services in the background, each with its own venv, and wait for its health check.

.DESCRIPTION
  -Backend   uv run uvicorn app.main:app --app-dir src --port 8000      (SANT venv, $env:UV_PROJECT_ENVIRONMENT)
  -Web       npm --prefix web run dev                                    (Vite, port 5173)
  -Sim       <Isaac python> -m sim_worker.server --port 8770 --robot franka --cameras
  -Policy X  <LeRobot python> -m lerobot_tools.policy_server --checkpoint X --port 8765

  Every command comes from the repo's notes and README. Each service runs hidden, from the repo
  root, with stdout in data\logs\<service>.log and stderr in data\logs\<service>.err.log. Its PID
  and start time go to data\logs\pids.json, so stop.ps1 stops only what this script started.

  Refusals (nothing is started):
  - a sim worker when its port (8770) is already taken, or when any Isaac python process is
    running (at most one Isaac process at a time);
  - any service whose port is taken by something that does not answer its health check.
  A service that already answers its health check is left alone and counts as up.

  Exit code: 0 if every requested service is up, 1 if any was refused or failed, 2 for usage.

.EXAMPLE
  $env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-main"; $env:UV_LINK_MODE = "copy"
  powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Backend -Web
  powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Sim
  powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Policy data\experiments\<run>\train\raw_5
#>
param(
    [switch]$Backend,
    [switch]$Web,
    [switch]$Sim,
    [string]$Policy = "",
    [int]$TimeoutSec = 0,
    [string]$SantVenv = $env:UV_PROJECT_ENVIRONMENT,
    [string]$IsaacPython = "C:\isaac\env_isaaclab\Scripts\python.exe",
    [string]$IsaacVenv = "C:\isaac\env_isaaclab",
    [string]$LeRobotPython = "C:\venvs\lerobot\Scripts\python.exe",
    [string]$LogDir = "",
    [int]$BackendPort = 8000,
    [int]$SimPort = 8770,
    [int]$PolicyPort = 8765,
    [string]$Python = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if (-not ($Backend -or $Web -or $Sim -or $Policy)) {
    Write-Host "usage: start.ps1 [-Backend] [-Web] [-Sim] [-Policy <checkpoint>] [-TimeoutSec N] [-LogDir DIR]"
    Write-Host "  -Backend  FastAPI backend on :$BackendPort (needs `$env:UV_PROJECT_ENVIRONMENT or -SantVenv)"
    Write-Host "  -Web      Vite dev server on :5173 (needs npm --prefix web ci first)"
    Write-Host "  -Sim      Isaac sim worker on :$SimPort, franka with cameras (never two Isaac processes)"
    Write-Host "  -Policy   LeRobot policy server on :$PolicyPort for a checkpoint (run dir, step dir or pretrained_model)"
    exit 2
}

if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
New-Item -ItemType Directory -Force $LogDir | Out-Null
$py = Resolve-HelperPython $Python

# health.py reads these; the backend child also inherits SIM_WORKER_URL, so it finds the worker
$env:PM_BACKEND_URL = "http://127.0.0.1:$BackendPort"
$env:PM_POLICY_URL = "http://127.0.0.1:$PolicyPort"
if ($PSBoundParameters.ContainsKey("SimPort")) { $env:SIM_WORKER_URL = "http://127.0.0.1:$SimPort" }

$defaultTimeout = @{ backend = 120; web = 120; sim = 900; policy = 300 }
$labels = @{ backend = "backend"; web = "web"; sim = "sim worker"; policy = "policy server" }
$failed = @()

function Test-Up([string]$Name) {
    $r = Invoke-HealthCapture $py @("wait", $Name, "--timeout", "0")
    return @{ Up = ($r.Code -eq 0); Line = ($r.Output -join " ") }
}

function Show-LogTail([string]$Path) {
    if (Test-Path $Path) {
        Write-Host "  last lines of ${Path}:"
        Get-Content $Path -Tail 15 | ForEach-Object { Write-Host "    $_" }
    }
}

function Start-One([string]$Name, [string]$Exe, [string]$ArgString, [int]$Port) {
    # Start hidden from the repo root, record it, then wait for its health check.
    $log = Join-Path $LogDir "$Name.log"
    $errLog = Join-Path $LogDir "$Name.err.log"
    Write-Host "[$Name] starting: $Exe $ArgString"
    $proc = Start-Process -FilePath $Exe -ArgumentList $ArgString -WorkingDirectory $script:RepoRoot `
        -RedirectStandardOutput $log -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    $entries = Read-PidFile $LogDir
    $entries[$Name] = [ordered]@{
        pid = $proc.Id; start_time = (Get-StartTimeString $proc); command = "$Exe $ArgString"; port = $Port
        log = $log; err_log = $errLog; started_at = (Get-Date).ToString("o")
    }
    Write-PidFile $LogDir $entries
    Write-Host "[$Name] pid $($proc.Id); logs $log, $errLog"

    $timeout = if ($TimeoutSec -gt 0) { $TimeoutSec } else { $defaultTimeout[$Name] }
    $t0 = Get-Date
    $lastNote = 0
    Write-Host "[$Name] waiting up to $timeout s for its health check"
    while ($true) {
        $check = Test-Up $Name
        if ($check.Up) {
            Write-Host "[$Name] up after $([int]((Get-Date) - $t0).TotalSeconds) s: $($check.Line)"
            return $true
        }
        if ($proc.HasExited) {
            Write-Host "[$Name] FAILED: the process exited with code $($proc.ExitCode) before it was healthy"
            Show-LogTail $errLog
            Show-LogTail $log
            $entries = Read-PidFile $LogDir
            $entries.Remove($Name)
            Write-PidFile $LogDir $entries
            return $false
        }
        $elapsed = ((Get-Date) - $t0).TotalSeconds
        if ($elapsed -ge $timeout) {
            Write-Host "[$Name] FAILED: not healthy after $timeout s. It is still running (pid $($proc.Id));"
            Write-Host "  check the logs, status.ps1, or stop it with: stop.ps1 -Service $Name"
            Show-LogTail $errLog
            return $false
        }
        if ($elapsed - $lastNote -ge 30) {
            $lastNote = $elapsed
            Write-Host "[$Name] still starting ($([int]$elapsed) s)"
        }
        Start-Sleep -Seconds 2
    }
}

function Test-AlreadyOurs([string]$Name) {
    # True if pids.json has a live process for this service (started by an earlier start.ps1).
    $entries = Read-PidFile $LogDir
    if (-not $entries.Contains($Name)) { return $false }
    $live = Get-LiveProcess $entries[$Name]
    if ($live.Process) { return $true }
    $entries.Remove($Name)   # stale: that process is gone
    Write-PidFile $LogDir $entries
    return $false
}

function Request-Service([string]$Name, [int]$Port, [scriptblock]$Prereq, [scriptblock]$Launch, [switch]$RefuseIfPortTaken) {
    $label = $labels[$Name]
    if (Test-AlreadyOurs $Name) {
        $check = Test-Up $Name
        Write-Host "[$Name] already started by start.ps1 (see pids.json): $($check.Line)"
        if ($check.Up) { return $true }
        Write-Host "[$Name] it is not healthy yet; check status.ps1 or its logs"
        return $false
    }
    $portTaken = (Invoke-HealthCapture $py @("port-free", "$Port")).Code -ne 0
    if ($RefuseIfPortTaken -and $portTaken) {
        $check = Test-Up $Name
        Write-Host "[$Name] REFUSED: port $Port is already taken, so a second $label will not be started."
        Write-Host "  what answers there: $($check.Line)"
        Write-Host "  it was not started by start.ps1, so it is left alone"
        return $false
    }
    $check = Test-Up $Name
    if ($check.Up) {
        Write-Host "[$Name] already running, not started by start.ps1; left alone: $($check.Line)"
        return $true
    }
    if ($portTaken) {
        Write-Host "[$Name] REFUSED: port $Port is already taken, but not by a healthy ${label}: $($check.Line)"
        return $false
    }
    $problem = & $Prereq
    if ($problem) {
        Write-Host "[$Name] REFUSED: $problem"
        return $false
    }
    return (& $Launch)
}

if ($Backend) {
    $ok = Request-Service "backend" $BackendPort {
        if (-not $SantVenv) { return "set `$env:UV_PROJECT_ENVIRONMENT (the SANT venv, outside OneDrive) or pass -SantVenv" }
        if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { return "uv is not on PATH" }
        if (-not (Test-Path (Join-Path $script:RepoRoot ".env"))) {
            Write-Host "[backend] note: no .env, so Nemotron calls will fail and fall back to the rules (cp .env.example .env)"
        }
        return $null
    } {
        $env:UV_PROJECT_ENVIRONMENT = $SantVenv
        $env:UV_LINK_MODE = "copy"
        Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue
        Start-One "backend" (Get-Command uv).Source "run uvicorn app.main:app --app-dir src --port $BackendPort" $BackendPort
    }
    if (-not $ok) { $failed += "backend" }
}

if ($Web) {
    $ok = Request-Service "web" 5173 {
        if (-not (Test-Path (Join-Path $script:RepoRoot "web\node_modules"))) { return "web\node_modules is missing; run: npm --prefix web ci" }
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return "npm is not on PATH (install Node.js)" }
        return $null
    } {
        Start-One "web" $env:ComSpec "/d /c npm --prefix web run dev" 5173
    }
    if (-not $ok) { $failed += "web" }
}

function Invoke-WithRepoSrc([scriptblock]$Block) {
    # Isaac's and LeRobot's venvs hold an *editable* demo_pipeline from another checkout
    # (C:\dev\pm-t2, C:\dev\pm-t3). PYTHONPATH makes the child use this checkout's src\, so it
    # matches the sim_worker / lerobot_tools code it runs from here (sprint 3c T5 note).
    $old = $env:PYTHONPATH
    $env:PYTHONPATH = Join-Path $script:RepoRoot "src"
    try { return (& $Block) } finally { $env:PYTHONPATH = $old }
}

if ($Sim) {
    $ok = Request-Service "sim" $SimPort -RefuseIfPortTaken {
        $isaac = Invoke-HealthCapture $py @("isaac", "--isaac-venv", $IsaacVenv)
        if ($isaac.Code -eq 1) {
            return "an Isaac python process is already running (at most one at a time):`n    " + ($isaac.Output -join "`n    ")
        }
        if ($isaac.Code -ne 0) { return "could not list processes, so it can't check that no other Isaac process runs" }
        if (-not (Test-Path $IsaacPython)) { return "Isaac python not found: $IsaacPython (pass -IsaacPython)" }
        return $null
    } {
        Write-Host "[sim] note: turn Windows sleep off for long runs; a sleep once killed CUDA mid-batch"
        Invoke-WithRepoSrc { Start-One "sim" $IsaacPython "-m sim_worker.server --port $SimPort --robot franka --cameras" $SimPort }
    }
    if (-not $ok) { $failed += "sim" }
}

if ($Policy) {
    $ok = Request-Service "policy" $PolicyPort {
        if (-not (Test-Path $Policy)) { return "checkpoint not found: $Policy" }
        if (-not (Test-Path $LeRobotPython)) { return "LeRobot python not found: $LeRobotPython (pass -LeRobotPython)" }
        return $null
    } {
        $ckpt = (Resolve-Path $Policy).Path
        Invoke-WithRepoSrc { Start-One "policy" $LeRobotPython "-m lerobot_tools.policy_server --checkpoint `"$ckpt`" --port $PolicyPort" $PolicyPort }
    }
    if (-not $ok) { $failed += "policy" }
}

if ($failed.Count -gt 0) {
    Write-Host "not up: $($failed -join ', ')"
    exit 1
}
Write-Host "all requested services are up. Status: scripts\launch\status.ps1; stop: scripts\launch\stop.ps1"
exit 0
