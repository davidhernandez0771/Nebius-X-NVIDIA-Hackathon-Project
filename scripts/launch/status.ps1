<#
.SYNOPSIS
  Read-only health check: one line per service (OK, BUSY or DOWN), GPU memory, Isaac processes.

.DESCRIPTION
  backend        http://127.0.0.1:8000/api/health
  web            http://127.0.0.1:5173 (also tries localhost:5173)
  sim worker     http://127.0.0.1:8770/health (BUSY while it runs a job)
  policy server  http://127.0.0.1:8765/health
  teleop relay   http://127.0.0.1:8000/teleop/status (says whether a sim is connected)

  Exit code 0 if every -Require service is OK or BUSY, else 1. It never starts or stops anything.
  Base URLs can be overridden with PM_BACKEND_URL, PM_WEB_URL, SIM_WORKER_URL and PM_POLICY_URL.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\launch\status.ps1
  powershell -ExecutionPolicy Bypass -File scripts\launch\status.ps1 -Require backend,sim,policy
#>
param(
    [string]$Require = "backend,web,sim",
    [switch]$Json,
    [string]$Python = "",
    [double]$TimeoutSec = 3
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$py = Resolve-HelperPython $Python
$healthArgs = @("status", "--require", $Require, "--timeout", "$TimeoutSec")
if ($Json) { $healthArgs += "--json" }
$code = Invoke-Health $py $healthArgs
exit $code
