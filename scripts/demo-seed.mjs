// Seed a running instance with a small, FABRICATED dataset for screenshots/demos.
// No real financial data. Usage (with the app running):
//   node scripts/demo-seed.mjs                 # targets http://localhost:8000
//   API_BASE=http://localhost:8011 node scripts/demo-seed.mjs
const API = process.env.API_BASE || "http://localhost:8000";

const D = (date, description, amount, source, opts = {}) => ({
  date, description, amount, source,
  card: opts.card || null, reference: opts.reference || null,
  category_hint: opts.hint || null, details: opts.details || null,
});

const rows = [
  D("2026-03-05", "TRADER JOE'S #112", 58.30, "Amex", { reference: "a1" }),
  D("2026-03-09", "SHELL OIL 47821", 44.10, "Chase ••8842", { reference: "c1" }),
  D("2026-03-14", "NETFLIX.COM", 15.49, "Amex", { reference: "a2" }),
  D("2026-03-22", "DELTA AIR LINES 0061", 388.40, "Amex", { reference: "a3", details: { "Extended Details": "DELTA 0061 ATL->AUS\nTICKET 0067890123", "Appears On Your Statement As": "DELTA AIR LINES", "Address": "1030 Delta Blvd", "City/State": "ATLANTA\nGA", "Category": "Travel-Airline" } }),
  D("2026-03-28", "MARRIOTT AUSTIN", 242.00, "Chase ••8842", { reference: "c2", hint: "Lodging" }),
  D("2026-04-02", "WHOLE FOODS MKT", 91.16, "Amex", { reference: "a4" }),
  D("2026-04-06", "STARBUCKS STORE 441", 6.75, "Amex", { reference: "a5" }),
  D("2026-04-08", "ONLINE PAYMENT - THANK YOU", -600.00, "Amex", { reference: "a6" }),
  D("2026-04-11", "ACME CORP DES:PAYROLL ID:9981", -4200.00, "BofA checking", { reference: "b1" }),
  D("2026-04-15", "UBER TRIP 8842", 24.80, "Amex", { reference: "a7" }),
  D("2026-04-19", "HOME DEPOT #512", 137.42, "Chase ••8842", { reference: "c3", hint: "Equipment" }),
  D("2026-04-23", "AMC THEATRES 0042", 33.50, "Chase ••8842", { reference: "c4", hint: "Entertainment" }),
  D("2026-04-27", "SQ *LOCAL MAKERS MKT", 47.80, "Chase ••8842", { reference: "c5" }),
  D("2026-04-29", "Zelle payment to Jamie R", 90.00, "BofA checking", { reference: "b2" }),
  D("2026-05-03", "TRADER JOE'S #112", 62.04, "Amex", { reference: "a8" }),
  D("2026-05-07", "SPOTIFY USA", 11.99, "Amex", { reference: "a9" }),
  D("2026-05-10", "CHEVRON 220041", 51.25, "Chase ••8842", { reference: "c6" }),
  D("2026-05-13", "BLUE BOTTLE COFFEE", 5.50, "Amex", { reference: "a10" }),
  D("2026-05-16", "DELTA AIR LINES 0061", 402.10, "Amex", { reference: "a11", details: { "Appears On Your Statement As": "DELTA AIR LINES", "City/State": "AUSTIN\nTX", "Category": "Travel-Airline" } }),
  D("2026-05-18", "HAMPTON INN AUSTIN", 178.20, "Chase ••8842", { reference: "c7", hint: "Lodging" }),
  D("2026-05-21", "WHOLE FOODS MKT", 73.88, "Amex", { reference: "a12" }),
  D("2026-05-24", "DOORDASH*THE SPOT", 38.60, "Amex", { reference: "a13" }),
  D("2026-05-28", "SQ *VINTAGE FINDS", 64.00, "Chase ••8842", { reference: "c8" }),
];

const post = (path, body) =>
  fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

console.log("import:", await post("/api/transactions/import", rows));
const txns = await fetch(`${API}/api/transactions`).then((r) => r.json());
for (const desc of ["DELTA AIR LINES 0061", "MARRIOTT AUSTIN", "HAMPTON INN AUSTIN", "UBER TRIP 8842"]) {
  const t = txns.find((x) => x.description === desc);
  if (t) await fetch(`${API}/api/transactions/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: ["trip-austin"] }) });
}
console.log("done — tagged a 'trip-austin' sub-group.");
