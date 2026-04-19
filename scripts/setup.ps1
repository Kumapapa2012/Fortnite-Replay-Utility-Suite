# Fortnite Replay Suite - one-time environment setup.
#
# Usage:
#   pwsh -File scripts/setup.ps1
#
# Creates the Python venv, installs requirements, and initializes the global
# config file. Safe to run multiple times.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ParentRoot = Split-Path -Parent $RepoRoot

# Prefer existing venv (inside or parent), else create inside Integrated_App/.venv
$VenvCandidates = @(
    (Join-Path $RepoRoot   ".venv\Scripts\python.exe"),
    (Join-Path $ParentRoot "venv\Scripts\python.exe")
)
$VenvPython = $VenvCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $VenvPython) {
    $VenvDir = Join-Path $RepoRoot ".venv"
    Write-Host "[setup] creating venv at $VenvDir" -ForegroundColor Cyan
    python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }
    $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
} else {
    Write-Host "[setup] using existing venv: $VenvPython" -ForegroundColor Cyan
}

$Requirements = Join-Path $RepoRoot "services\requirements.txt"

Write-Host "[setup] upgrading pip" -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip

Write-Host "[setup] installing requirements" -ForegroundColor Cyan
& $VenvPython -m pip install -r $Requirements
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "[setup] initializing global config" -ForegroundColor Cyan
& $VenvPython (Join-Path $PSScriptRoot "init_config.py")

$EnvExample = Join-Path $RepoRoot "services\log_monitor_api\.env.example"
$EnvFile = Join-Path $RepoRoot "services\log_monitor_api\.env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "[setup] creating $EnvFile from example - edit OBS_PASSWORD before starting log_monitor_api" -ForegroundColor Yellow
    Copy-Item $EnvExample $EnvFile
}

Write-Host "[setup] done" -ForegroundColor Green
