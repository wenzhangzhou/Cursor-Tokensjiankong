@echo off
cd /d "%~dp0"
set CURSOR_USAGE_OPEN=1
"C:\Program Files\nodejs\node.exe" "%~dp0server.js"
echo.
echo Workbench stopped.
pause
