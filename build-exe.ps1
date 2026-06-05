# build-exe.ps1 — Builds nte-tracker.exe using Node.js Single Executable Applications (SEA)
# Requires: Node.js 22+, npx (for postject, resedit)
# Output: nte-tracker.exe in the project root
#
# Usage:  .\build-exe.ps1
#         .\build-exe.ps1 -OutputPath "C:\output\nte-tracker.exe"

param(
    [string]$OutputPath = "nte-tracker.exe"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Find-SignTool {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($pattern in $candidates) {
        $found = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Convert-PngToIco {
    param(
        [string]$PngPath,
        [string]$IcoPath
    )

    $png = [System.IO.File]::ReadAllBytes((Resolve-Path $PngPath))
    if ($png.Length -lt 24 -or $png[0] -ne 0x89 -or $png[1] -ne 0x50 -or $png[2] -ne 0x4e -or $png[3] -ne 0x47) {
        throw "Icon source is not a valid PNG: $PngPath"
    }

    $width = ($png[16] -shl 24) -bor ($png[17] -shl 16) -bor ($png[18] -shl 8) -bor $png[19]
    $height = ($png[20] -shl 24) -bor ($png[21] -shl 16) -bor ($png[22] -shl 8) -bor $png[23]
    if ($width -gt 255) { $widthByte = 0 } else { $widthByte = [byte]$width }
    if ($height -gt 255) { $heightByte = 0 } else { $heightByte = [byte]$height }

    $fs = [System.IO.File]::Create($IcoPath)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
        $bw.Write([UInt16]0)      # reserved
        $bw.Write([UInt16]1)      # icon type
        $bw.Write([UInt16]1)      # one image
        $bw.Write([byte]$widthByte)
        $bw.Write([byte]$heightByte)
        $bw.Write([byte]0)        # colors
        $bw.Write([byte]0)        # reserved
        $bw.Write([UInt16]1)      # planes
        $bw.Write([UInt16]32)     # bit count
        $bw.Write([UInt32]$png.Length)
        $bw.Write([UInt32]22)     # image data offset
        $bw.Write($png)
    } finally {
        $bw.Dispose()
        $fs.Close()
    }
}

function Invoke-ResEditIcon {
    param(
        [string]$ExePath,
        [string]$IcoPath
    )

    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npmCmd) {
        throw "npm was not found. Install Node.js with npm to apply the exe icon."
    }

    function Quote-Arg([string]$Value) {
        return '"' + ($Value -replace '"', '\"') + '"'
    }

    $nodeCmd = (Get-Command node -ErrorAction Stop).Source
    $resolvedExePath = (Resolve-Path $ExePath).Path
    $resolvedIcoPath = (Resolve-Path $IcoPath).Path
    $pkgDir = Join-Path $env:TEMP "nte-resedit-package"
    $reseditModule = Join-Path $pkgDir "node_modules\resedit"
    if (-not (Test-Path $reseditModule)) {
        Write-Host "    Installing temporary resedit package..."
        New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null
        & $npmCmd.Source install --silent --no-audit --no-fund --prefix $pkgDir resedit pe-library
        if ($LASTEXITCODE -ne 0) {
            throw "npm install resedit failed with exit code $LASTEXITCODE"
        }
    }

    $js = @"
const fs = require('fs');
const ResEdit = require('resedit');
const PELibrary = require('pe-library');
const exe = process.argv[2];
const icon = process.argv[3];
const data = fs.readFileSync(exe);
const nt = PELibrary.NtExecutable.from(data, { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(nt);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icon));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const iconData = iconFile.icons.map((item) => item.data);
if (groups.length) {
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconData
    );
  }
} else {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconData);
}
res.outputResource(nt);
fs.writeFileSync(exe, Buffer.from(nt.generate()));
"@
    $jsPath = Join-Path $pkgDir "patch-icon.cjs"
    Set-Content -Path $jsPath -Value $js -Encoding UTF8
    try {
        Push-Location $pkgDir
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $nodeCmd
        $psi.WorkingDirectory = $pkgDir
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.Arguments = (Quote-Arg $jsPath) + " " + (Quote-Arg $resolvedExePath) + " " + (Quote-Arg $resolvedIcoPath)
        $proc = [System.Diagnostics.Process]::Start($psi)
        if (-not $proc.WaitForExit(30000)) {
            try { $proc.Kill() } catch {}
            throw "resedit timed out while applying the icon"
        }
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        if ($stdout) { Write-Host $stdout.TrimEnd() }
        if ($stderr) { Write-Host $stderr.TrimEnd() }
        if ($proc.ExitCode -ne 0) {
            throw "resedit failed with exit code $($proc.ExitCode)"
        }
    } finally {
        Pop-Location
        Remove-Item -Force $jsPath -ErrorAction SilentlyContinue
    }
}

Write-Host "==> Building nte-tracker.exe (Node SEA)" -ForegroundColor Cyan

# 1. Verify Node version
$nodeVersion = node --version 2>&1
Write-Host "    Node: $nodeVersion"
$major = [int]($nodeVersion -replace 'v(\d+).*','$1')
if ($major -lt 20) {
    Write-Error "Node.js 20 or higher is required (22 recommended)."
}

# 2. Generate SEA blob (embeds tracker.js + dashboard assets)
Write-Host "==> Generating SEA blob (tracker + dashboard assets)..."
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { Write-Error "sea-config generation failed" }

# 3. Copy the current node binary as base executable
Write-Host "==> Copying node binary..."
$nodePath = (Get-Command node).Source
Copy-Item $nodePath $OutputPath -Force

# 4. Remove existing signature (required on Windows before injection)
Write-Host "==> Removing existing signature..."
$signtool = Find-SignTool
if ($signtool) {
    & $signtool remove /s $OutputPath 2>$null
    Write-Host "    Signature removed via $signtool"
} else {
    Write-Warning "signtool not found - injection may show 'corrupted signature' but often still works."
    Write-Warning "Install Windows SDK (Signing Tools) for a clean build."
}

# 5. Inject the SEA blob with postject
Write-Host "==> Injecting blob with postject..."
npx --yes postject $OutputPath NODE_SEA_BLOB sea-prep.blob `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { Write-Error "postject injection failed" }

# 6. Clean up blob
Remove-Item -Force sea-prep.blob -ErrorAction SilentlyContinue

# 7. Set tray/taskbar/file icon.
Write-Host "==> Applying Windows icon..."
$iconPng = Join-Path $PSScriptRoot "icons\icon-192.png"
if (-not (Test-Path $iconPng)) { $iconPng = Join-Path $PSScriptRoot "icons\icon-512.png" }
$icoPath = Join-Path $env:TEMP "nte-tracker-build.ico"
if (Test-Path $iconPng) {
    Convert-PngToIco -PngPath $iconPng -IcoPath $icoPath
    Invoke-ResEditIcon -ExePath $OutputPath -IcoPath $icoPath
    Remove-Item -Force $icoPath -ErrorAction SilentlyContinue
    Write-Host "    Icon set from $iconPng"
} else {
    Write-Warning "icons/icon-512.png not found - built without custom icon."
}

# 8. Verify
$exeSize = (Get-Item $OutputPath).Length
$exeSizeMB = [math]::Round($exeSize / 1MB, 1)
Write-Host "==> Done: $OutputPath ($exeSizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Note: ~80 MB is normal - the exe embeds the Node.js runtime."
Write-Host 'Logs (when running): %LOCALAPPDATA%\nte-tracker\tracker.log'
Write-Host "Normal launch self-restarts hidden; use NTE_CONSOLE_LOG=1 for a foreground console."
Write-Host ""
Write-Host "To install as startup task:"
Write-Host "    .\nte-tracker.exe --install"
Write-Host "To uninstall:"
Write-Host "    .\nte-tracker.exe --uninstall"
