# Fortnite Replay Suite - developer mode: backend services + Vite dev server.
#
# Usage:
#   pwsh -File scripts/dev.ps1
#
# Starts backend services (same as start.ps1) and then runs Vite dev server
# in the foreground. Ctrl-C stops Vite; use stop.ps1 to stop backend services.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "start.ps1")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[dev.ps1] backend start failed" -ForegroundColor Red
    exit $LASTEXITCODE
}

$Frontend = Join-Path $RepoRoot "frontend"
if (-not (Test-Path (Join-Path $Frontend "package.json"))) {
    Write-Host "[dev.ps1] frontend/package.json not found; skipping Vite" -ForegroundColor Yellow
    exit 0
}

Push-Location $Frontend
try {
    npm run dev
}
finally {
    Pop-Location
}
