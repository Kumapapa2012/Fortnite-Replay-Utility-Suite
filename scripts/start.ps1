# Fortnite Replay Suite - start all backend services.
#
# Usage:
#   pwsh -File scripts/start.ps1
#   pwsh -File scripts/start.ps1 -Service gateway -Service replay_parser
#
# See docs/06_deployment.md.

param(
    [string[]]$Service = @()
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ParentRoot = Split-Path -Parent $RepoRoot

$VenvCandidates = @(
    (Join-Path $RepoRoot   ".venv\Scripts\python.exe"),
    (Join-Path $ParentRoot "venv\Scripts\python.exe")
)
$VenvPython = $VenvCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $VenvPython) {
    Write-Host "[start.ps1] venv not found. Tried:" -ForegroundColor Yellow
    $VenvCandidates | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host "[start.ps1] Create it first, e.g.:" -ForegroundColor Yellow
    Write-Host "    python -m venv .venv" -ForegroundColor Yellow
    Write-Host "    .venv\Scripts\python -m pip install -r services\requirements.txt" -ForegroundColor Yellow
    exit 1
}

$pmArgs = @("scripts\process_manager.py", "start")
foreach ($s in $Service) {
    $pmArgs += @("--service", $s)
}

Push-Location $RepoRoot
try {
    & $VenvPython @pmArgs
    $rc = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $rc
