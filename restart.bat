@echo off
setlocal
cd /d "%~dp0"

echo Stopping NTE tracker...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-tracker.ps1"
if errorlevel 1 (
    echo Warning: stop-tracker.ps1 reported an error, continuing anyway...
)

timeout /t 1 /nobreak >nul

echo Starting NTE tracker...
if exist "%~dp0nte-tracker.exe" (
    start "" "%~dp0nte-tracker.exe"
    echo Done. Dashboard: http://127.0.0.1:27183
) else (
    wscript.exe "%~dp0launcher.vbs"
    echo Done. Dashboard: http://127.0.0.1:27183
)
endlocal
