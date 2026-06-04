@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0nte-tracker.exe" (
    echo Installing NTE Tracker using nte-tracker.exe...
    "%~dp0nte-tracker.exe" --install
) else (
    echo Installing NTE Tracker using launcher.vbs...
    schtasks /create /tn "NTETracker" /tr "wscript.exe \"%~dp0launcher.vbs\"" /sc onlogon /rl limited /f
    powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'NTETracker' -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1
    echo.
    echo NTE Tracker installed successfully!
    echo It will start automatically when you log in.
    echo.
    pause
)
endlocal
