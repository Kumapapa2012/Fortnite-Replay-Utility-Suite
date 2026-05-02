# Fortnite Replay Suite - unified lifecycle management (start/status/smoke/stop).
#
# Usage:
#   pwsh -File scripts/manage.ps1                    # start all, check status, run smoke test
#   pwsh -File scripts/manage.ps1 -Dev               # start all + vite dev server
#   pwsh -File scripts/manage.ps1 -Stop              # stop all services
#   pwsh -File scripts/manage.ps1 -Service gateway   # start only gateway, check status, smoke
#   pwsh -File scripts/manage.ps1 -Stop -Service log_monitor_api  # stop only log_monitor_api

param(
    [switch]$Stop,
    [switch]$Dev,
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
    Write-Host "[manage.ps1] venv not found. Tried:" -ForegroundColor Yellow
    $VenvCandidates | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host "[manage.ps1] Create it first, e.g.:" -ForegroundColor Yellow
    Write-Host "    python -m venv .venv" -ForegroundColor Yellow
    Write-Host "    .venv\Scripts\python -m pip install -r services\requirements.txt" -ForegroundColor Yellow
    exit 1
}

Push-Location $RepoRoot
try {
    if ($Stop) {
        # ===== STOP MODE =====
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "Stopping services..." -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan
        
        # Stop Vite dev server if running
        try {
            $frontendPath = Join-Path $RepoRoot "frontend"
            Write-Host "Checking for active Vite dev server process..." -ForegroundColor Gray
            # Find node processes whose command line contains the frontend path and "vite.js"
            $viteProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$frontendPath*vite.js*" }
            
            if ($viteProcesses) {
                foreach ($viteProcess in $viteProcesses) {
                    $viteProcessId = $viteProcess.ProcessId
                    Write-Host "Found Vite dev server process (PID: $viteProcessId). Stopping..." -ForegroundColor Yellow
                    Stop-Process -Id $viteProcessId -Force
                    Write-Host "✓ Vite dev server (PID: $viteProcessId) stopped." -ForegroundColor Green
                }
            }
            else {
                Write-Host "No active Vite dev server process found." -ForegroundColor Gray
            }
        }
        catch {
            # This might fail if the process is already gone, which is fine.
            Write-Host "i Could not stop Vite dev server (maybe already stopped): $_" -ForegroundColor DarkGray
        }

        $pmArgs = @("scripts\process_manager.py", "stop")
        foreach ($s in $Service) {
            $pmArgs += @("--service", $s)
        }
        & $VenvPython @pmArgs
        $rc = $LASTEXITCODE
        
        if ($rc -eq 0) {
            Write-Host "`n✓ Services stopped successfully." -ForegroundColor Green
        }
        else {
            Write-Host "`n✗ Error stopping services (exit code: $rc)." -ForegroundColor Red
        }
    }
    else {
        # ===== START + STATUS + SMOKE MODE =====
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "Starting services..." -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan
        
        $pmArgs = @("scripts\process_manager.py", "start")
        foreach ($s in $Service) {
            $pmArgs += @("--service", $s)
        }
        & $VenvPython @pmArgs
        $rc = $LASTEXITCODE
        
        if ($rc -ne 0) {
            Write-Host "`n✗ Error starting services (exit code: $rc)." -ForegroundColor Red
            exit $rc
        }
        
        Write-Host "`n✓ Services started." -ForegroundColor Green
        
        # Wait for services to stabilize.
        # suite_core startup includes OBS WebSocket probe (~2s) + match scan, taking ~5s total.
        Write-Host "`nWaiting 8s for services to stabilize..." -ForegroundColor Gray
        Start-Sleep -Seconds 8
        
        # ===== STATUS CHECK =====
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "Service Status" -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan
        
        & $VenvPython "scripts\process_manager.py" "status"
        $rc = $LASTEXITCODE
        
        if ($rc -ne 0) {
            Write-Host "`n✗ Error checking status (exit code: $rc)." -ForegroundColor Red
            exit $rc
        }
        
        # ===== SMOKE TEST =====
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "Running smoke test (health check)..." -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan
        
        & $VenvPython "scripts\smoke.py"
        $rc = $LASTEXITCODE
        
        if ($rc -eq 0) {
            Write-Host "`n✓ All services healthy!" -ForegroundColor Green
            Write-Host "`nReady to use:" -ForegroundColor Green
            Write-Host "  - Browser (Vite dev):   http://localhost:5173" -ForegroundColor Gray
            Write-Host "  - Browser (Gateway):    http://localhost:8080" -ForegroundColor Gray
            Write-Host "  - Stop services:        pwsh scripts\manage.ps1 -Stop" -ForegroundColor Gray
            
            # ===== VITE DEV SERVER (optional) =====
            if ($Dev) {
                Write-Host "`n========================================" -ForegroundColor Cyan
                Write-Host "Starting Vite dev server..." -ForegroundColor Cyan
                Write-Host "========================================`n" -ForegroundColor Cyan
                
                $frontendPath = Join-Path $RepoRoot "frontend"
                if (Test-Path $frontendPath) {
                    # Start Vite in a new PowerShell window
                    # $viteCmd = "cd '$frontendPath'; npm run dev"
                    # Start-Process pwsh -ArgumentList "-NoExit", "-Command", $viteCmd -WindowStyle Normal
                    # Start Vite in a new PowerShell tab
                    wt -w 0 nt -d $frontendPath pwsh -NoExit -Command "npm run dev"
                    Write-Host "`n✓ Vite dev server started in new window." -ForegroundColor Green
                    Write-Host "   (Access at http://localhost:5173)" -ForegroundColor Gray
                }
                else {
                    Write-Host "`n✗ Frontend directory not found at: $frontendPath" -ForegroundColor Red
                }
            }
        }
        else {
            Write-Host "`n✗ Smoke test failed (exit code: $rc)." -ForegroundColor Red
            Write-Host "   Some services may be unhealthy. Check logs/" -ForegroundColor Red
            exit $rc
        }
    }
}
finally {
    Pop-Location
}

exit 0
