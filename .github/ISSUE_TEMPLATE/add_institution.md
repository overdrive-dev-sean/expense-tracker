---
name: Add a bank / card format
about: Request support for importing a new institution's CSV export
labels: institution
---

**Institution & account type**
e.g. "Capital One — credit card", "Ally — checking".

**Sample CSV** ⚠️ fake data only
Paste the header row and 3–5 example rows with **made-up** amounts/descriptions
(keep the column structure and any quirks intact):

```csv
(paste here)
```

**Format details (if you know them)**
- Date column & format (e.g. `MM/DD/YYYY`):
- Sign convention: is a charge/spend positive or negative?
- Unique transaction id column? (used for dedup):
- Any quirks? (summary/preamble rows, quoted fields with newlines, multiple
  accounts per file, a category column, etc.):

See [CONTRIBUTING.md](../../CONTRIBUTING.md) → "Adding support for a new bank" —
PRs welcome!
