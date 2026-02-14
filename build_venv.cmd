@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Create or repair a local Python virtual environment for SLR Harvester

cd /d "%~dp0" || exit /b 1

REM Pick Python
set PYTHON=
for %%P in (python.exe py.exe) do (
  where %%P >nul 2>nul && (
    set PYTHON=%%P
    goto :found_py
  )
)
echo [venv] No Python launcher found in PATH. Please install Python 3.9+.
exit /b 1

:found_py
echo [venv] Using Python: %PYTHON%

REM Create venv if missing
if not exist ".venv\Scripts\python.exe" (
  echo [venv] Creating .venv ...
  %PYTHON% -m venv .venv || exit /b 1
)

REM Upgrade pip and install requirements
call .venv\Scripts\python.exe -m pip install --upgrade pip || exit /b 1
if exist requirements.txt (
  echo [venv] Installing requirements...
  call .venv\Scripts\python.exe -m pip install -r requirements.txt || exit /b 1
) else (
  echo [venv] requirements.txt not found. Skipping.
)

echo [venv] Ready.
endlocal & exit /b 0

