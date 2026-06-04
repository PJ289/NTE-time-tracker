@echo off
setlocal
cd /d "%~dp0"

echo Stopping NTE tracker (this project only)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-tracker.ps1"
if errorlevel 1 (
    echo Failed to run stop-tracker.ps1
    exit /b 1
)

timeout /t 1 /nobreak >nul

echo Starting NTE tracker...
wscript.exe "%~dp0launcher.vbs"
echo Done. Dashboard: http://127.0.0.1:27183
endlocal
