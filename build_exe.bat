@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0" || exit /b 1

set PY_CMD=
for %%P in (python.exe py.exe) do (
  where %%P >nul 2>nul && (
    set PY_CMD=%%P
    goto :found_py
  )
)
echo [build] No Python launcher found in PATH. Please install Python 3.9+.
exit /b 1

:found_py
"%PY_CMD%" "%~dp0build_exe.py" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
