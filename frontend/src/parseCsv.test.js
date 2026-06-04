import { describe, it, expect } from "vitest";
import { normalizeRows } from "./parseCsv.js";

// normalizeRows takes array-of-arrays (header detection happens inside), so we
// can exercise the real logic without a CSV string.

describe("Amex", () => {
  const rows = [
    ["Date", "Description", "Amount", "Extended Details", "Appears On Your Statement As", "Reference", "Category"],
    ["04/16/2026", "BLUE BOTTLE", "6.25", "x", "BLUE BOTTLE", "'320261060973265550'", "Restaurant"],
  ];
  const out = normalizeRows(rows, "activity (1).csv");

  it("keeps positive amount as a charge", () => expect(out[0].amount).toBe(6.25));
  it("labels the account Amex", () => expect(out[0].source).toBe("Amex"));
  it("carries the Reference id", () => expect(out[0].reference).toBe("'320261060973265550'"));
  it("normalizes the date to ISO", () => expect(out[0].date).toBe("2026-04-16"));
});

describe("Chase", () => {
  const rows = [
    ["Card", "Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"],
    ["1237", "05/10/2026", "05/11/2026", "STARBUCKS", "Food & Drink", "Sale", "-6.75", ""],
    ["2008", "05/12/2026", "05/13/2026", "AUTOPAY PMT", "", "Payment", "500.00", ""],
  ];
  const out = normalizeRows(rows, "Chase_Activity.csv");
  const sale = out.find((r) => r.description === "STARBUCKS");
  const payment = out.find((r) => r.description === "AUTOPAY PMT");

  it("flips Sale to positive spend", () => expect(sale.amount).toBe(6.75));
  it("labels the card account", () => expect(sale.source).toBe("Chase ••1237"));
  it("maps the Chase category to a hint", () => expect(sale.category_hint).toBe("Meals"));
  it("treats Payment as money in (negative) with a Payment hint", () => {
    expect(payment.amount).toBe(-500);
    expect(payment.category_hint).toBe("Payment");
  });
});

describe("Bank of America (checking)", () => {
  const rows = [
    ["Description", "", "Summary Amt."],                              // preamble header
    ["Beginning balance as of 04/23/2026", "", "29,377.48"],          // preamble row
    ["Total credits", "", "10,997.80"],                              // preamble row
    ["Date", "Description", "Amount", "Running Bal."],                // the real header
    ["04/23/2026", "Beginning balance as of 04/23/2026", "", "29,377.48"], // dropped
    ["04/24/2026", "Zelle payment to Gale", "-275.00", "29,102.48"],
    ["04/28/2026", "PCI L583 PURCHASE", "-12.00", "29,090.48"],
  ];
  const out = normalizeRows(rows, "stmt.csv");

  it("skips the preamble + beginning-balance row", () => expect(out.length).toBe(2));
  it("flips money-out to positive and strips commas", () => {
    const pci = out.find((r) => r.description.startsWith("PCI"));
    expect(pci.amount).toBe(12);
  });
  it("labels the account BofA checking", () => expect(out[0].source).toBe("BofA checking"));
});

describe("empty input", () => {
  it("returns an empty array", () => expect(normalizeRows([], "x.csv")).toEqual([]));
});
