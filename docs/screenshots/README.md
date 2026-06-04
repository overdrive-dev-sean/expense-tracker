# Screenshots

`dashboard.png` and `detail.png` are generated from a **fabricated** demo dataset
(`scripts/demo-seed.mjs`) — there is no real financial data in them.

To regenerate:

1. Start the app against a throwaway database, e.g.:
   ```bash
   cd backend && EXPENSE_DB_URL="sqlite:////tmp/demo.db" \
     uvicorn app.main:app --port 8011
   ```
   (the built `frontend/dist` is served at `/`, so the whole UI is on that port)
2. Seed the demo data:
   ```bash
   API_BASE=http://localhost:8011 node scripts/demo-seed.mjs
   ```
3. Open `http://localhost:8011` and capture, or script it with Playwright pointed
   at a system Chrome.

If you ever screenshot **real** data instead, redact account numbers, amounts,
and merchant names before committing.
