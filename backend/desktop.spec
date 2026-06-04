# PyInstaller spec — cross-platform single-file desktop build.
# Build:  pyinstaller --noconfirm desktop.spec   (run from backend/)
# Output: backend/dist/ExpenseTracker  (.exe on Windows)
from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("app")
    + collect_submodules("webview")
)

# (source, dest-in-bundle) tuples are OS-agnostic — no ':' vs ';' issue.
datas = [("../frontend/dist", "frontend_dist")]

a = Analysis(
    ["desktop.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ExpenseTracker",
    console=False,        # no terminal window
    onefile=True,
    upx=False,
)
