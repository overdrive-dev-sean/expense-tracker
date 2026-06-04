# Contributing

Thanks for your interest! This is a small, single-user, offline expense tracker.
Contributions that keep it simple, private, and dependency-light are very welcome.

## Dev setup

**Backend** (from `backend/`):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (from `frontend/`):
```bash
npm install
npm run dev      # http://localhost:5173, proxies /api -> :8000
```

## Before opening a PR
```bash
# backend
cd backend && ruff check . && python -m pytest -q
# frontend
cd frontend && npm test && npm run build
```
CI runs exactly these. Please add/adjust tests for behavior you change.

## Adding support for a new bank / card

This is the most common contribution, and it's intentionally small. CSV parsing
is the **only** institution-specific part — everything downstream (categorization,
`kind` classification, dedup, reporting) is shared.

1. **Look at a real export.** Note the columns, the date format, the sign
   convention (does a charge come through positive or negative?), whether there's
   a unique transaction id, and any quirks (preamble rows, quoted fields, etc.).
2. **Add a detection branch in `frontend/src/parseCsv.js`.** Detect the format
   from its headers (e.g. a distinctive column name), then normalize each row to:
   ```
   { date, description, amount, source, card, reference, category_hint }
   ```
   The one rule that matters: **`amount` must be positive for money out (a
   charge/spend) and negative for money in (a credit/payment)** — flip the
   source's sign if needed. Set `source` to a human label (e.g. `"Amex"`,
   `"Chase ••1237"`), `reference` to the provider's txn id if it has one (used for
   dedup), and `category_hint` if the file carries its own category column.
3. **Add a test** in `frontend/src/parseCsv.test.js` using a couple of sample
   rows (array-of-arrays — no real data needed).
4. If the institution introduces new transaction *types* (e.g. a new way card
   payments or transfers are described), extend the patterns in
   `backend/app/kinds.py` and add a case to `backend/tests/test_kinds.py`.

Open an issue with a **sample CSV (a few fake rows is fine)** and we can usually
add it quickly.

## Guidelines
- Keep it offline and private — no telemetry, cloud calls, or account linking.
- Money is integer cents internally; dollars only at the API boundary.
- Prefer small, readable modules over cleverness.
- Don't commit data: `*.db`, CSVs, `node_modules/`, `.venv/`, and build output are
  gitignored — keep it that way.
