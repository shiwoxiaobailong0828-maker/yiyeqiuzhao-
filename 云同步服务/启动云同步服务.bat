@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Using global Node.js, no dependencies required.
)
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
