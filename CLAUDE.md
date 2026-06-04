# CLAUDE.md — Finance / Expense Tracker

## What this is
A personal, offline-first expense tracker. Import CSV exports from banks and credit
cards, auto-categorize transactions, manually retag anything uncategorized (the app
learns from each correction), and view spend by category and month. Data lives in a
local SQLite file the owner controls — no third-party services.

This is a single-user personal tool. Favor clarity and solid fundamentals over
scale, auth, or multi-tenancy. Do NOT add login, cloud sync, or user accounts.

## Tech stack
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.x, SQLite. Run with uvicorn.
- **Frontend:** Vite + React (JavaScript). Charting: recharts. CSV parsing: papaparse.
- **No ORM migrations tool needed yet** — create tables on startup. (Leave room to add Alembic later.)

## Architecture & data flow
1. User selects CSV file(s) in the browser.
2. Frontend parses them with papaparse and sniffs the columns (date / description /
   amount, or separate debit/credit columns). It normalizes each row to
   `{ date, description, amount, source }` and POSTs the batch to the API.
   **CSV parsing stays client-side. Categorization and persistence live server-side.**
3. Backend computes a dedupe signature, categorizes each transaction (learned merchant
   rules first, then keyword rules, else "Uncategorized"), stores it, and returns
   what was imported vs skipped.
4. When the user retags a transaction, the backend records a learned merchant→category
   mapping so future imports of that merchant auto-sort.

## Repo structure
```
finance/
  backend/
    app/
      main.py            # FastAPI app, CORS, startup seed, router includes
      database.py        # engine, SessionLocal, Base, get_db dependency
      models.py          # SQLAlchemy models
      schemas.py         # Pydantic request/response models
      categorize.py      # categorization engine + merchant-key normalization
      seed.py            # default categories + keyword rules, seeded if empty
      routers/
        transactions.py
        categories.py
        summary.py
    requirements.txt
  frontend/              # Vite React app (adapt the provided expense_tracker.jsx)
  CLAUDE.md
  README.md
  .gitignore             # must ignore: backend/*.db, __pycache__, node_modules, .env
```

## Data model (SQLite)
- **categories**: id, name (unique), color (hex), is_system (bool), sort_order (int)
- **category_rules**: id, category_id (fk), keyword (lowercase substring to match against description)
- **transactions**: id, txn_date (date, nullable), description (text), amount_cents (int),
  source (text), category_id (fk, nullable), is_manual (bool, default false),
  signature (text, unique), created_at (datetime)
- **learned_merchants**: id, merchant_key (text, unique), category_id (fk)

**Money is stored as integer cents** (`amount_cents`) to avoid floating-point error.
Convert to/from dollars only at the API boundary (Pydantic). Never store money as a float.

**Dedupe signature** = stable hash of `f"{date}|{description}|{amount_cents}|{source}"`.
The `signature` column is unique; imports skip rows whose signature already exists.

**merchant_key** = description lowercased, digits/`#`/`*` stripped, collapsed whitespace,
first 3 tokens joined. Used for the learned-merchant lookup.

## Categorization engine (categorize.py)
Given a description, return a category name in this priority order:
1. Exact `merchant_key` match in `learned_merchants`.
2. First category whose any `keyword` is a substring of the lowercased description
   (skip the "Other" and "Uncategorized" categories during keyword matching).
3. Fallback: "Uncategorized".

## Default seed (seed.py) — only if categories table is empty
Seed these categories with starter keyword rules (extend sensibly):
- Travel: uber, lyft, delta, united, southwest, american air, hertz, enterprise, avis, airline, flight, taxi, amtrak
- Lodging: hotel, marriott, hilton, hampton, airbnb, inn, motel, hyatt, resort
- Meals: restaurant, cafe, coffee, starbucks, grill, pizza, catering, doordash, grubhub, diner
- Fuel: shell, chevron, exxon, mobil, arco, gas, fuel, diesel
- Groceries: whole foods, trader joe, safeway, kroger, grocery, costco, publix, aldi
- Equipment: home depot, grainger, mouser, digikey, lowes, hardware, mcmaster, amazon
- Utilities: electric, water, comcast, internet, utility, verizon, at&t
- Subscriptions: netflix, spotify, adobe, hetzner, aws, github, apple.com, subscription
- Payment (excluded from spend totals): payment, autopay, thank you, transfer, online pmt
- Other (no keywords)
- Uncategorized (no keywords; system fallback)

Mark Payment, Other, and Uncategorized as `is_system = true`.
"Payment" transactions are excluded from all spend totals and charts.

## API surface (prefix /api)
- `POST /api/transactions/import` — body: `[{date, description, amount, source}]`.
  Dedupe + categorize + insert. Returns `{ imported: int, skipped: int }`.
- `GET  /api/transactions?category=&month=&search=` — filtered list (month = "YYYY-MM").
- `PATCH /api/transactions/{id}` — body `{category}`. Sets category, is_manual=true,
  and upserts the learned_merchants mapping for that description.
- `GET  /api/categories` — list ordered by sort_order.
- `POST /api/categories` — body `{name, color}`. Rejects duplicate names.
- `DELETE /api/categories/{id}` — only if not is_system; reassign its txns to Uncategorized.
- `GET  /api/summary` — `{ total_spend_cents, by_category: [{name,color,cents}], by_month: [{month,cents}] }`.
  Excludes the Payment category.

## Conventions / guardrails
- Money as integer cents everywhere internally; dollars only at the edge.
- Keep CSV parsing on the client; the server trusts normalized rows.
- Idempotent imports — re-importing the same or overlapping files must not duplicate.
- CORS: allow the Vite dev origin (http://localhost:5173) in dev.
- Never commit the SQLite db, node_modules, or any secrets.
- No auth, no cloud, no accounts. Single user, local.
- Prefer small, readable modules over cleverness.

## Dev commands
Backend (from `backend/`):
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Frontend (from `frontend/`):
```
npm install
npm run dev          # Vite serves on :5173, proxies /api -> :8000
```

## Definition of done for the bones
End-to-end, runnable: start backend + frontend, import a real CSV, see it categorized
into charts and a table, retag an Uncategorized row, reload the page, and the data +
the learned categorization persist (stored in SQLite). Nothing beyond this scope yet.
