@echo off
setlocal EnableExtensions
REM Thin wrapper to launch via the .cmd starter
call "%~dp0slr-harvester_dashboard.cmd" %*
endlocal
