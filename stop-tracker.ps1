# Stops only this project's tracker: node.exe running tracker.js or nte-tracker.exe in this folder.
# Does not affect other Node.js apps.

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$trackerPath = (Join-Path $scriptDir 'tracker.js').ToLowerInvariant()
$exePath = (Join-Path $scriptDir 'nte-tracker.exe').ToLowerInvariant()

$stopped = 0

$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
if ($procs) {
    foreach ($p in $procs) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        if ($cmd.ToLowerInvariant().Contains($trackerPath)) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
}

$exeProcs = Get-CimInstance Win32_Process -Filter "Name = 'nte-tracker.exe'" -ErrorAction SilentlyContinue
if ($exeProcs) {
    foreach ($p in $exeProcs) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        if ($cmd.ToLowerInvariant().Contains($exePath)) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
}

Write-Host "Stopped $stopped tracker process(es)."
exit 0
