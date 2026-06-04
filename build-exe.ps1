# build-exe.ps1 — Builds nte-tracker.exe using Node.js Single Executable Applications (SEA)
# Requires: Node.js 22+, npx (for postject)
# Output: nte-tracker.exe in the project root
#
# Usage:  .\build-exe.ps1
#         .\build-exe.ps1 -OutputPath "C:\output\nte-tracker.exe"

param(
    [string]$OutputPath = "nte-tracker.exe"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Building nte-tracker.exe (Node SEA)" -ForegroundColor Cyan

# 1. Verify Node version
$nodeVersion = node --version 2>&1
Write-Host "    Node: $nodeVersion"
$major = [int]($nodeVersion -replace 'v(\d+).*','$1')
if ($major -lt 20) {
    Write-Error "Node.js 20 or higher is required (22 recommended)."
}

# 2. Generate SEA blob
Write-Host "==> Generating SEA blob..."
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { Write-Error "sea-config generation failed" }

# 3. Copy the current node binary as base executable
Write-Host "==> Copying node binary..."
$nodePath = (Get-Command node).Source
Copy-Item $nodePath $OutputPath -Force

# 4. Remove existing signature (required on Windows before injection)
Write-Host "==> Removing existing signature..."
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
if (Test-Path $signtool) {
    & $signtool remove /s $OutputPath 2>$null
    Write-Host "    Signature removed via signtool."
} else {
    # Try via PowerShell module (available without SDK)
    try {
        $null = & signtool remove /s $OutputPath 2>$null
    } catch {
        Write-Warning "signtool not found — skipping signature removal. Injection may fail on signed Node builds."
    }
}

# 5. Inject the SEA blob with postject
Write-Host "==> Injecting blob with postject..."
npx --yes postject $OutputPath NODE_SEA_BLOB sea-prep.blob `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { Write-Error "postject injection failed" }

# 6. Clean up blob
Remove-Item -Force sea-prep.blob -ErrorAction SilentlyContinue

# 7. Verify
$exeSize = (Get-Item $OutputPath).Length
$exeSizeMB = [math]::Round($exeSize / 1MB, 1)
Write-Host "==> Done: $OutputPath ($exeSizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "To install as startup task:"
Write-Host "    .\nte-tracker.exe --install"
Write-Host "To uninstall:"
Write-Host "    .\nte-tracker.exe --uninstall"
