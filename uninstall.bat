@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0nte-tracker.exe" (
    echo Uninstalling NTE Tracker using nte-tracker.exe...
    "%~dp0nte-tracker.exe" --uninstall
) else (
    schtasks /delete /tn "NTETracker" /f
    echo.
    echo NTE Tracker uninstalled successfully.
    echo.
    pause
)
endlocal
