# Finance — Personal Expense Tracker

A single-user, offline-first expense tracker. Import CSV exports from banks and
credit cards, auto-categorize transactions, retag anything uncategorized (the app
learns from each correction), and view spend by category and month. Data lives in
a local SQLite file you control — no third-party services, no login, no cloud.

See [CLAUDE.md](./CLAUDE.md) for the full spec.

## About
Think of it as a small, **offline, private alternative to Mint.com** — for now.
You stay in control of the data: export CSVs from your bank and card sites, import
them here, and everything lives in one local SQLite file you own. No account
linking, no cloud, no third-party aggregator holding your credentials — just your
statements, categorized, with spend by category and month.

**Supported institutions today** (the importer auto-detects each file's format):

| Institution | Account type | Handling |
|---|---|---|
| **Chase** | Credit card | Classifies by the `Type` column (Sale/Fee/Payment/Return); maps Chase's own category column as a hint; supports multiple cards in one file |
| **American Express** | Credit card | Dedupes on the `Reference` transaction id; tolerates the embedded newlines in its `Extended Details` column |
| **Bank of America** | Checking | Skips the summary preamble and finds the real header; classifies income / transfers / credit-card payments so only true purchases count as spend |

This is designed to grow. **More institutions get added to the repo as needed** —
each is a small format-detection branch in `frontend/src/parseCsv.js` (the sign
convention + which columns to read), with any institution-specific quirks handled
there; the server's categorization and "kind" rules are shared across all of them.
Got a statement format that isn't supported yet? A sample CSV is usually all it
takes to add it.

## Stack
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.x, SQLite (uvicorn)
- **Frontend:** Vite + React, recharts (charts), papaparse (CSV parsing)

CSV parsing runs in the browser; categorization and persistence run on the server.

## Prerequisites
- Python 3.11+ with `venv` + `pip`
  (on Debian/Ubuntu/WSL: `sudo apt install -y python3-venv python3-pip`)
- Node 18+ and npm

## Run

**Backend** (from `backend/`):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Tables are created and default categories seeded automatically on first start.
The SQLite file is written to `backend/expense_tracker.db` (gitignored).

**Frontend** (from `frontend/`, in a second terminal):
```bash
npm install
npm run dev        # serves http://localhost:5173, proxies /api -> :8000
```

Then open http://localhost:5173 and click **Import CSV files**.

## Desktop app (single executable)
Instead of running two dev servers, you can build one double-clickable app: it
runs the backend in-process and opens a native window (pywebview). FastAPI serves
the built frontend itself (no Vite, no proxy). Everything runs in memory except
the SQLite file, which persists in a per-user folder:

| OS | Database location |
|----|-------------------|
| Windows | `%APPDATA%\ExpenseTracker\expense_tracker.db` |
| macOS | `~/Library/Application Support/ExpenseTracker/expense_tracker.db` |
| Linux | `~/.local/share/ExpenseTracker/expense_tracker.db` |

> **PyInstaller can't cross-compile** — build on the OS you want to run on. A
> Windows `.exe` must be built on Windows, a macOS app on macOS, etc.

### Build prerequisites (all platforms)
- **Python 3.11+** (with `pip`)
- **Node 18+** — only to build the frontend once (`npm run build`); not needed to
  *run* the finished app.

### Windows → `ExpenseTracker.exe`
In **PowerShell** from the repo root:
```powershell
# 1. build the frontend (static files)
cd frontend; npm install; npm run build; cd ..\backend

# 2. create a venv + install deps
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -r requirements-desktop.txt

# 3. package
pyinstaller --noconfirm desktop.spec        # -> backend\dist\ExpenseTracker.exe
```
Double-click `backend\dist\ExpenseTracker.exe` to run.

Windows gotchas:
- **`py` not recognized** → install Python: `winget install -e --id Python.Python.3.12`
  (or python.org, tick *Add to PATH*), then reopen PowerShell. Use `python` if `py`
  still isn't found.
- **`Activate.ps1` "running scripts is disabled"** → `Set-ExecutionPolicy -Scope
  Process -ExecutionPolicy Bypass` (this session only), or skip activation and call
  `.\.venv\Scripts\python.exe -m PyInstaller --noconfirm desktop.spec`.
- **typing `python` opens the Microsoft Store** → Settings → Apps → Advanced app
  settings → App execution aliases → turn off `python.exe`/`python3.exe`.
- **Window is blank / WebView2 error** → install the free *Microsoft Edge WebView2
  Runtime* (preinstalled on Windows 11 and most updated Windows 10).

### macOS → `ExpenseTracker`
```bash
cd frontend && npm install && npm run build && cd ../backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-desktop.txt
./build-desktop.sh          # or: pyinstaller --noconfirm desktop.spec
```
Run `./dist/ExpenseTracker` (or double-click). Uses the built-in WebKit webview.
If Gatekeeper blocks the unsigned app, right-click → **Open** the first time.

### Linux → `ExpenseTracker`
The native window needs WebKitGTK (Debian/Ubuntu):
```bash
sudo apt install -y gir1.2-webkit2-4.1
cd frontend && npm install && npm run build && cd ../backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-desktop.txt
./build-desktop.sh          # -> backend/dist/ExpenseTracker
```
Run `./dist/ExpenseTracker`. (On WSL this opens via WSLg.)

### Useful flags / tips
- **Headless / testing:** `ExpenseTracker --no-window` starts the server and prints
  a `http://127.0.0.1:<port>` URL without opening a window.
- **Use an existing database:** set `EXPENSE_DB_URL`, e.g.
  `EXPENSE_DB_URL=sqlite:////full/path/to/expense_tracker.db`. Or just copy an
  existing `expense_tracker.db` into the per-user folder from the table above.
- Build artifacts land in `backend/build/` and `backend/dist/` (both gitignored).

## How it works
- **Import:** the browser parses the CSV (papaparse), normalizes each row to
  `{ date, description, amount, source, card, reference, category_hint }`, and
  POSTs the batch. The server dedupes, categorizes, and stores each row.
- **Sign convention (internal):** positive = money out (charge), negative =
  money in (credit). Each source format is normalized into this:
  - *AmEx* — positive Amount is already a charge.
  - *Chase* — classified by the `Type` column (Sale/Fee = spend, Payment/Return =
    credit), since sign alone is ambiguous.
  - *Bank of America (checking)* — a summary preamble is skipped (the real header
    is detected dynamically); negative = money out, so the sign is flipped to
    match. Quoted, comma-grouped amounts and unescaped inner quotes are handled.
- **Transaction `kind`** (purchase / income / transfer / card_payment / refund /
  p2p) is classified server-side from the description + direction, so spend
  exclusions are explicit and visible. Only **purchases** count toward spend;
  income, transfers, credit-card payments and refunds are excluded. Zelle/Cash
  App **sends** are `p2p` — ambiguous, so they're excluded until you tag one
  (tagging makes it count). Non-purchase rows show a small badge in the table.
- **Dedup:** uses the provider's transaction id (`Reference`) when present;
  otherwise a computed signature of `date|description|amount_cents|card:occurrence`.
  The occurrence counter preserves genuinely repeated identical charges while a
  re-import of the same file still dedupes.
- **Categorization (server):** learned merchant → keyword rule → provider hint →
  `Uncategorized`. Retagging a row records a learned merchant→category mapping so
  future imports of that merchant auto-sort.
- **Spend totals/charts** count only `purchase` rows (income/transfers/card
  payments/refunds and untagged P2P are excluded by `kind`).
- **Tags / sub-groups:** transactions can carry free-form tags (many-to-many,
  independent of category) — e.g. `reimbursable`, `trip-tokyo`. Filter the table
  by a tag, and the summary report scopes to that sub-group (`GET /api/summary?tag=`).
- **Re-categorize** (`POST /api/transactions/recategorize`) re-runs rules over
  non-manual rows non-destructively: it fills Uncategorized rows and propagates
  learned-merchant rules, but never downgrades an already-categorized row.
- Manually tagging a transaction propagates that category to other
  auto-categorized rows from the same merchant (P2P excluded — payees are
  individual).

## Money
Stored as integer cents internally; converted to/from dollars only at the API
boundary (never stored as float).

## Layout
```
backend/app/   main.py, database.py, models.py, schemas.py, categorize.py,
               seed.py, routers/{transactions,categories,summary}.py
frontend/src/  ExpenseTracker.jsx, parseCsv.js, api.js, main.jsx
```
