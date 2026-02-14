@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Build a standalone Windows executable for SLR Harvester using PyInstaller

cd /d "%~dp0" || exit /b 1

REM Ensure venv is prepared
if not exist ".venv\Scripts\python.exe" (
  call "%~dp0build_venv.cmd" || exit /b 1
)

REM Install PyInstaller if missing
call .venv\Scripts\python.exe -c "import PyInstaller" 1>nul 2>nul || (
  echo [build] Installing PyInstaller...
  call .venv\Scripts\python.exe -m pip install pyinstaller || exit /b 1
)

REM Clean previous build artifacts
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

REM Common options
set NAME=slr-harvester_dashboard
set ENTRY=slr-harvester_dashboard.py
set ICON=
if exist src\assets\icons\app.ico set ICON=--icon src\assets\icons\app.ico

REM Include resources (icons, configs, src package)
set DATA=
if exist src\assets\icons (
  set DATA=--add-data "src\assets\icons;src/assets/icons" %DATA%
)
if exist slr_config.json (
  set DATA=--add-data "slr_config.json;." %DATA%
)
if exist slr_gui_settings.json (
  set DATA=--add-data "slr_gui_settings.json;." %DATA%
)
if exist projects.json (
  set DATA=--add-data "projects.json;." %DATA%
)

echo [build] Building %NAME% ...
call .venv\Scripts\pyinstaller.exe ^
  --noconfirm --clean --windowed --onefile ^
  --name "%NAME%" %ICON% %DATA% ^
  --paths src ^
  --hidden-import customtkinter ^
  --hidden-import matplotlib.backends.backend_tkagg ^
  --hidden-import PIL ^
  --hidden-import unicodedata ^
  --hidden-import kiwisolver ^
  --hidden-import kiwisolver._cext ^
  --collect-all kiwisolver ^
  --collect-data matplotlib ^
  --hidden-import ui.dashboard ^
  --hidden-import ui.history_view ^
  --hidden-import ui.search_view ^
  --hidden-import ui.project_view ^
  --hidden-import ui.corpus_view ^
  --hidden-import models.models ^
  --hidden-import utils.ui_helpers ^
  --hidden-import utils.ctk_dialogs ^
  --hidden-import utils.tooltip ^
  --hidden-import utils.mb_shim ^
  --hidden-import api.client ^
  %ENTRY% || exit /b 1

echo [build] Build finished. Output in dist\%NAME%
endlocal & exit /b 0
