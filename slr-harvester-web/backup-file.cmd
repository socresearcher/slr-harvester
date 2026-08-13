@echo off
setlocal
if "%~1"=="" (
  echo Usage: backup-file.cmd ^<path-to-file^>
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-file.ps1" -FilePath "%~1"
