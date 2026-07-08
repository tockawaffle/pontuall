# Builds PontuAll Test — a parallel install that does not share credentials,
# offline data, or the default auth sidecar port with production PontuAll.
#
# Output: src-tauri/target/release/bundle/nsis/PontuAll Test_*_x64-setup.exe
#
# Usage (from repo root):
#   .\scripts\build-test-variant.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    Write-Host "Building PontuAll Test (sidecar + frontend + installer)..." -ForegroundColor Cyan
    bun run tauri:build:test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host ""
    Write-Host "Done. Install PontuAll Test alongside production PontuAll on the kiosk." -ForegroundColor Green
    Write-Host "Use a different company name during setup so PostgreSQL gets its own database." -ForegroundColor Yellow
    Write-Host "Default auth sidecar port: 3436 (production uses 3435)." -ForegroundColor Yellow
}
finally {
    Pop-Location
}
