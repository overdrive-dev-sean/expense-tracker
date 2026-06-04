// Client-side CSV parsing & normalization. Kept pure (no React) so the exact
// shipping logic can be unit-tested in Node. CSV parsing stays on the client;
// categorization, "kind" classification, and persistence live on the server.
//
// We parse WITHOUT papaparse's header mode and detect the real header row
// ourselves, so a summary preamble (Bank of America checking exports start with
// a 4-row balance summary under its own "Description,,Summary Amt." header) is
// skipped rather than mistaken for the transaction header.
import Papa from "papaparse";

// Chase pre-categorizes via its "Category" column. Map the high-confidence ones
// to our scheme as a first-pass hint; the server still lets keyword/learned
// rules override it. Unmapped values fall through to keyword/Uncategorized.
const CHASE_CATEGORY_MAP = {
  "food & drink": "Meals",
  "travel": "Travel",
  "gas": "Fuel",
  "groceries": "Groceries",
  "bills & utilities": "Utilities",
  "merchandise & inventory": "Equipment",
};
const mapChaseCategory = (raw) =>
  CHASE_CATEGORY_MAP[(raw || "").toString().trim().toLowerCase()] || null;

// Parse a number, stripping $, commas, and parentheses. Handles BofA's quoted
// thousands-separated signed amounts like "-2,500.00".
const num = (v) => parseFloat((v ?? "").toString().replace(/[$,()]/g, "")) || 0;

const cell = (v) => (v ?? "").toString();
const isDateHdr = (c) => /date/i.test(c);
const isAmtHdr = (c) => /amount|amt|debit|credit|withdrawal|deposit/i.test(c);

// The real transaction header is the first row that has both a date-ish and an
// amount-ish column. Rows above it (a preamble) are skipped.
function findHeaderIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map(cell);
    if (cells.some(isDateHdr) && cells.some(isAmtHdr)) return i;
  }
  return 0;
}

// Normalize parsed CSV rows (array-of-arrays) into the API's import shape:
//   { date, description, amount, source, card, reference, category_hint }
export function normalizeRows(rawRows, filename) {
  const rows = (rawRows || []).filter(
    (r) => Array.isArray(r) && r.some((c) => cell(c).trim() !== "")
  );
  if (!rows.length) return [];

  const hIdx = findHeaderIndex(rows);
  const headers = (rows[hIdx] || []).map(cell);
  const find = (cands) =>
    headers.find((h) => cands.some((c) => h.toLowerCase().trim().includes(c)));

  const hDate = find(["date", "posted", "transaction date"]); // Transaction Date precedes Post Date
  const hDesc = find(["description", "name", "merchant", "payee", "memo", "details"]);
  const hAmt = find(["amount", "amt"]);
  const hDebit = find(["debit", "withdrawal"]);
  const hCredit = find(["credit", "deposit"]);
  const hRef = find(["reference", "ref #", "ref number", "transaction id"]);
  const hType = find(["type"]); // Chase: Sale/Fee/Payment/Return
  const hCard = find(["card"]); // Chase: multiple cards per file
  const hCat = find(["category"]); // provider's own category column
  const hRunBal = find(["running bal"]); // Bank of America checking marker
  const hAmex = find(["extended details", "appears on your statement"]); // Amex markers
  const isChase = !!hType;
  const isBofA = !!hRunBal;
  const isAmex = !!hAmex;
  const filenameLabel = (filename || "").replace(/\.csv$/i, "").slice(0, 24);

  // A human-readable "where it came from" label for the ACCOUNT column.
  const accountFor = (card) => {
    if (isChase) return card ? `Chase ••${card}` : "Chase";
    if (isBofA) return "BofA checking";
    if (isAmex) return "Amex";
    return filenameLabel; // unknown format: fall back to the file name
  };

  const out = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const cells = rows[i] || [];
    const row = {};
    headers.forEach((h, j) => { row[h] = cells[j]; });

    const rawDate = hDate ? row[hDate] : "";
    const desc = (hDesc ? row[hDesc] : "").toString().trim();
    if (!desc) continue;
    // BofA: the first transaction row restates the opening balance — drop it.
    if (isBofA && /^beginning balance/i.test(desc)) continue;

    const card = isChase && hCard ? (row[hCard] || "").toString().trim() : "";

    // Normalize every source into one internal convention:
    //   positive = money OUT (spend/charge), negative = money IN (credit).
    let amt = 0;
    let hint = null;
    if (isChase) {
      const type = (hType ? row[hType] : "").toString().trim().toLowerCase();
      const mag = Math.abs(num(row[hAmt]));
      if (type === "sale" || type === "fee") amt = mag;
      else if (type === "payment") { amt = -mag; hint = "Payment"; }
      else if (type === "return") amt = -mag;
      else amt = -num(row[hAmt]);
      if (!hint) hint = mapChaseCategory(hCat ? row[hCat] : "");
    } else if (isBofA) {
      // Checking export: negative = money out. Flip so spend is positive,
      // matching the card convention. Server classifies the kind from the text.
      amt = -num(row[hAmt]);
    } else {
      // AmEx / generic: positive Amount is already a charge.
      if (hAmt && row[hAmt]) amt = num(row[hAmt]);
      else if (hDebit && row[hDebit]) amt = Math.abs(num(row[hDebit]));
      else if (hCredit && row[hCredit]) amt = -Math.abs(num(row[hCredit]));
    }
    if (!amt) continue; // drops empty/zero amounts (incl. BofA balance-only rows)

    let iso = null;
    const d = new Date(rawDate);
    if (!isNaN(d)) iso = d.toISOString().slice(0, 10);
    const reference = (hRef ? row[hRef] : "").toString().trim() || null;

    // Keep the remaining statement columns (Extended Details, address, "Appears
    // On Your Statement As", etc.) so a charge can be identified later.
    const skip = new Set([hDate, hDesc, hAmt, hDebit, hCredit, hRunBal]);
    const details = {};
    for (const h of headers) {
      if (!h || skip.has(h)) continue;
      const v = (row[h] ?? "").toString().trim();
      if (v) details[h] = v;
    }

    out.push({
      date: iso,
      description: desc,
      amount: amt,
      source: accountFor(card), // human-readable account/institution label
      card: card || null,       // dedup component (not the filename)
      reference,
      category_hint: hint,
      details: Object.keys(details).length ? details : null,
    });
  }
  return out;
}

// Parse a browser File/Blob into normalized rows. papaparse handles quoted
// fields with embedded newlines and tolerates unescaped inner quotes; we read
// array-of-arrays (no header mode) so we can skip any preamble.
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => resolve(normalizeRows(res.data, file.name)),
      error: reject,
    });
  });
}
