# Fortnite Replay Suite - show running services.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ParentRoot = Split-Path -Parent $RepoRoot

$VenvCandidates = @(
    (Join-Path $RepoRoot   ".venv\Scripts\python.exe"),
    (Join-Path $ParentRoot "venv\Scripts\python.exe")
)
$VenvPython = $VenvCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$py = if ($VenvPython) { $VenvPython } else { "python" }

Push-Location $RepoRoot
try {
    & $py "scripts\process_manager.py" "status"
    $rc = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $rc
