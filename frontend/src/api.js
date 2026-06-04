// Thin fetch() wrapper around the FastAPI backend (proxied at /api in dev).

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getCategories = () => fetch("/api/categories").then(handle);

export const getTransactions = () => fetch("/api/transactions").then(handle);

export const getSummary = (tag) =>
  fetch("/api/summary" + (tag ? `?tag=${encodeURIComponent(tag)}` : "")).then(handle);

export const getTags = () => fetch("/api/tags").then(handle);

// rows: [{ date, description, amount, source, reference }]
export const importTransactions = (rows) =>
  fetch("/api/transactions/import", json("POST", rows)).then(handle);

// returns { transaction, applied } — `applied` = other same-merchant rows updated
export const patchTransaction = (id, category) =>
  fetch(`/api/transactions/${id}`, json("PATCH", { category })).then(handle);

// replace a transaction's tag set (sub-group labels)
export const setTransactionTags = (id, tags) =>
  fetch(`/api/transactions/${id}`, json("PATCH", { tags })).then(handle);

// re-run categorization over all non-manual rows; returns { updated, scanned }
export const recategorize = () =>
  fetch("/api/transactions/recategorize", json("POST", {})).then(handle);

export const createCategory = (name, color) =>
  fetch("/api/categories", json("POST", { name, color })).then(handle);
