@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Launcher for SLR Harvester Dashboard (Windows)

REM Change to repo root (this script's directory)
cd /d "%~dp0" || goto :fail

REM 1) Prefer packaged executable if available
set "EXE_PATH=%~dp0dist\SLR-Harvester\SLR-Harvester.exe"
if exist "%EXE_PATH%" (
  echo [run] Launching packaged app...
  start "" "%EXE_PATH%" %*
  endlocal & exit /b 0
)

REM 2) Ensure venv exists and is usable
if not exist ".venv\Scripts\python.exe" (
  echo [setup] Creating virtual environment...
  call "%~dp0build_venv.cmd" || goto :fail
) else (
  REM Lightweight check that Python in venv works
  call ".venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3,8)" 1>nul 2>nul || (
    echo [setup] Repairing virtual environment...
    call "%~dp0build_venv.cmd" || goto :fail
  )
)

REM 3) Launch via Python
echo [run] Starting SLR Harvester Dashboard...
call ".venv\Scripts\python.exe" "%~dp0slr-harvester_dashboard.py" %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto :fail
echo [run] Exit code: %EXITCODE%
endlocal & exit /b %EXITCODE%

:fail
set "EXITCODE=%ERRORLEVEL%"
if "%EXITCODE%"=="" set "EXITCODE=1"
echo [error] Failed with exit code %EXITCODE%.
echo Press any key to close...
pause >nul
endlocal & exit /b %EXITCODE%
