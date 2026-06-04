#!/usr/bin/env bash
# Build the single-file desktop app (Linux/macOS). Run from anywhere.
# Windows: do the same steps in PowerShell with the venv active — the final
# command is identical: `pyinstaller --noconfirm desktop.spec` (produces
# dist\ExpenseTracker.exe). PyInstaller builds for the OS it runs on.
set -euo pipefail
cd "$(dirname "$0")"   # backend/

echo "==> building frontend"
( cd ../frontend && npm install && npm run build )

echo "==> installing app + desktop build deps into the active venv"
pip install -r requirements.txt -r requirements-desktop.txt

echo "==> packaging with PyInstaller"
pyinstaller --noconfirm desktop.spec

echo "==> done: $(pwd)/dist/ExpenseTracker"
echo "    (Linux native window needs a WebKitGTK runtime: 'sudo apt install gir1.2-webkit2-4.1')"
