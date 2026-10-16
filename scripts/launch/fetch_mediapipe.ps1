<#
.SYNOPSIS
  Put the MediaPipe hand-tracking files where the Record page loads them from.

.DESCRIPTION
  1. Copies web\node_modules\@mediapipe\tasks-vision\wasm\* to web\public\mediapipe\wasm\
     (the pinned package's own files, so they match it exactly; run `npm --prefix web ci` first).
  2. Downloads hand_landmarker.task (pinned float16/1, not latest) to web\public\models\,
     unless a non-empty one is already there (-Force downloads it again).

  The download goes to a .part file and replaces the model only once it is complete, so a failed
  or cut-off download never leaves a half model behind. Both folders are git-ignored.
  Source of the paths and the URL: HAND_INTERACTION_PLAN.md (Assets), README (MediaPipe assets).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\launch\fetch_mediapipe.ps1
  powershell -ExecutionPolicy Bypass -File scripts\launch\fetch_mediapipe.ps1 -Force
#>
param(
    [string]$WebDir = "",
    [string]$ModelUrl = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # 5.1's progress bar slows downloads a lot

if (-not $WebDir) { $WebDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "web" }
$wasmSrc = Join-Path $WebDir "node_modules\@mediapipe\tasks-vision\wasm"
$wasmDest = Join-Path $WebDir "public\mediapipe\wasm"
$modelDir = Join-Path $WebDir "public\models"
$modelPath = Join-Path $modelDir "hand_landmarker.task"

# 1. WASM files from the pinned npm package
$wasmFiles = @(Get-ChildItem -Path $wasmSrc -File -ErrorAction SilentlyContinue)
if ($wasmFiles.Count -eq 0) {
    Write-Host "REFUSED: no MediaPipe WASM files in $wasmSrc"
    Write-Host "  install the web packages first: npm --prefix web ci"
    exit 1
}
New-Item -ItemType Directory -Force -Path $wasmDest | Out-Null
Copy-Item -Force -Path (Join-Path $wasmSrc "*") -Destination $wasmDest
Write-Host "wasm:  copied $($wasmFiles.Count) files to $wasmDest"

# 2. The hand model
$existing = Get-Item -LiteralPath $modelPath -ErrorAction SilentlyContinue
if ($existing -and $existing.Length -gt 0 -and -not $Force) {
    Write-Host "model: already there ($($existing.Length) bytes): $modelPath; not downloaded (-Force to download again)"
    exit 0
}

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
$part = "$modelPath.part"
Write-Host "model: downloading $ModelUrl"
$wc = New-Object Net.WebClient
try {
    # Windows PowerShell 5.1 may not offer TLS 1.2 by default
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $wc.DownloadFile($ModelUrl, $part)
    $got = (Get-Item -LiteralPath $part).Length
    $expected = $wc.ResponseHeaders["Content-Length"]
    if ($got -eq 0) { throw "the download is empty" }
    if ($expected -and [int64]$expected -ne $got) { throw "the download is incomplete: $got of $expected bytes" }
    Move-Item -Force -LiteralPath $part -Destination $modelPath
} catch {
    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
    Write-Host "model: FAILED: $msg"
    if ($existing) { Write-Host "  the existing $modelPath was left as it was" }
    exit 1
} finally {
    $wc.Dispose()
}
Write-Host "model: saved $got bytes to $modelPath"
exit 0
