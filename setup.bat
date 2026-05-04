@echo off
echo Installing NTE Tracker...
echo.

schtasks /create /tn "NTETracker" /tr "wscript.exe \"%~dp0launcher.vbs\"" /sc onlogon /rl limited /f
:: Allow running on battery power
powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'NTETracker' -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1

echo.
echo Scheduled task created. Starting tracker now...
echo.
wscript.exe "%~dp0launcher.vbs"

echo NTE Tracker installed and running!
echo Dashboard: http://127.0.0.1:27183
echo.
pause
