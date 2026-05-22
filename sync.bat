@echo off
setlocal
cd /d %~dp0
node tracker.js --sync
endlocal
