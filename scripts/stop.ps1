# Fortnite Replay Suite - stop all backend services.
#
# Usage:
#   pwsh -File scripts/stop.ps1
#   pwsh -File scripts/stop.ps1 -Service gateway

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
$py = if ($VenvPython) { $VenvPython } else { "python" }

$pmArgs = @("scripts\process_manager.py", "stop")
foreach ($s in $Service) {
    $pmArgs += @("--service", $s)
}

Push-Location $RepoRoot
try {
    & $py @pmArgs
    $rc = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $rc
