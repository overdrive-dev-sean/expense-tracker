@echo off
REM One-click Windows build -> dist\ExpenseTracker.exe
REM Double-click this file (it lives in the backend\ folder).
setlocal

echo ============================================
echo   Expense Tracker - building Windows .exe
echo ============================================
echo.

REM Run from this script's own folder (backend\), with repo root one level up.
cd /d "%~dp0"
set "BACKEND=%cd%"
cd ..
set "ROOT=%cd%"
cd /d "%BACKEND%"

REM --- 1. Python virtual environment -------------------------------------
if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Creating virtual environment...
  where py >nul 2>nul
  if not errorlevel 1 ( py -m venv .venv ) else ( python -m venv .venv )
) else (
  echo [1/4] Using existing virtual environment.
)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo ERROR: could not create a virtual environment.
  echo Install Python 3.11+ from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this again.
  pause & exit /b 1
)
set "PY=.venv\Scripts\python.exe"

REM --- 2. Build the frontend (needs Node); else use prebuilt dist --------
where npm >nul 2>nul
if not errorlevel 1 (
  echo [2/4] Building frontend with npm...
  pushd "%ROOT%\frontend"
  call npm install
  call npm run build
  popd
) else (
  if exist "%ROOT%\frontend\dist\index.html" (
    echo [2/4] npm not found - using existing prebuilt frontend\dist.
  ) else (
    echo.
    echo ERROR: Node/npm not found and no prebuilt frontend\dist exists.
    echo Install Node 18+ from https://nodejs.org/ and run this again.
    pause & exit /b 1
  )
)

REM --- 3. Install Python dependencies ------------------------------------
echo [3/4] Installing Python dependencies...
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt -r requirements-desktop.txt
if errorlevel 1 ( echo ERROR: pip install failed. & pause & exit /b 1 )

REM --- 4. Package into a single .exe -------------------------------------
echo [4/4] Packaging with PyInstaller...
"%PY%" -m PyInstaller --noconfirm desktop.spec
if errorlevel 1 ( echo ERROR: PyInstaller build failed. & pause & exit /b 1 )

echo.
echo ============================================
echo   DONE
echo   App: %BACKEND%\dist\ExpenseTracker.exe
echo   Double-click it to run.
echo ============================================
pause
