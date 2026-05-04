@echo off
schtasks /delete /tn "NTETracker" /f
echo.
echo NTE Tracker uninstalled successfully.
echo.
pause
