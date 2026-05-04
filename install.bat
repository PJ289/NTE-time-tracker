@echo off
schtasks /create /tn "NTETracker" /tr "wscript.exe \"%~dp0launcher.vbs\"" /sc onlogon /rl limited /f
:: Allow running on battery power
powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'NTETracker' -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1
echo.
echo NTE Tracker installed successfully!
echo It will start automatically when you log in.
echo.
pause
