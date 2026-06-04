import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
} from "recharts";
import {
  getCategories, getTransactions, getSummary, getTags,
  importTransactions, patchTransaction, setTransactionTags, createCategory, recategorize,
} from "./api.js";
import { parseCsvFile } from "./parseCsv.js";

const fmt = (n) => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthKey = (iso) => (iso || "").slice(0, 7);
const monthLabel = (k) => { const [y,m]=k.split("-"); return new Date(y, m-1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}); };

// Colors cycled through when the user adds a custom category.
const PALETTE = ["#e8b04b","#6aa9ff","#c792ea","#ff7a5c","#5ad1a5","#f2c0d5","#7fd6e8","#b6c95a"];

// Non-purchase kinds get a small badge so it's visible why they're not counted.
const KIND_LABELS = { income: "income", transfer: "transfer", card_payment: "card pmt", refund: "refund", p2p: "p2p" };

// Chase pre-categorizes via its "Category" column. Map the high-confidence ones
// to our scheme as a first-pass hint; the server still lets keyword/learned
// rules override it. Unmapped values fall through to keyword/Uncategorized.
export default function ExpenseTracker() {
  const [txns, setTxns] = useState([]);
  const [cats, setCats] = useState([]);
  const [tagList, setTagList] = useState([]); // [{name, count}]
  const [summary, setSummary] = useState({ total_spend_cents: 0, by_category: [], by_month: [] });
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null); // scope view + report to a sub-group
  const [chartsCollapsed, setChartsCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const fileRef = useRef();

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  // ── data loading (server is the source of truth) ────────────
  // The summary is scoped to the active tag sub-group (or the whole dataset).
  const refresh = useCallback(async () => {
    const [c, t, g, s] = await Promise.all([
      getCategories(), getTransactions(), getTags(), getSummary(tagFilter),
    ]);
    setCats(c); setTxns(t); setTagList(g); setSummary(s);
  }, [tagFilter]);

  useEffect(() => {
    (async () => {
      try { await refresh(); }
      catch (e) { showToast("Couldn't reach the server — is the backend running?"); console.error(e); }
      finally { setLoaded(true); }
    })();
  }, [refresh]);

  const catByName = useMemo(() => Object.fromEntries(cats.map((c) => [c.name, c])), [cats]);
  const colorOf = (name) => (catByName[name]?.color) || "#9aa3ad";

  // ── CSV import (parse client-side, categorize + persist server-side) ──
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    try {
      const perFile = await Promise.all(files.map(parseCsvFile));
      const collected = perFile.flat();
      const r = await importTransactions(collected);
      await refresh();
      showToast(`Imported ${r.imported} · skipped ${r.skipped} dupes`);
    } catch (e) {
      showToast("Import failed: " + e.message);
    }
  };

  // ── manual category assignment (server learns + applies across the dataset) ──
  const assignCat = async (id, catName) => {
    setTxns((prev) => prev.map((t) => (t.id === id ? { ...t, category: catName, is_manual: true } : t)));
    try {
      const r = await patchTransaction(id, catName);
      await refresh(); // bulk-apply may have changed other rows + the summary
      showToast(r.applied > 0 ? `Tagged · applied to ${r.applied} more` : "Tagged");
    } catch (e) { showToast("Update failed: " + e.message); refresh(); }
  };

  // ── tags / sub-groups ───────────────────────────────────────
  const addTag = async (txn) => {
    const name = (window.prompt("Add to sub-group (tag):") || "").trim();
    if (!name) return;
    const next = Array.from(new Set([...(txn.tags || []), name]));
    try { await setTransactionTags(txn.id, next); await refresh(); showToast(`Tagged “${name}”`); }
    catch (e) { showToast("Tag failed: " + e.message); }
  };
  const removeTag = async (txn, name) => {
    const next = (txn.tags || []).filter((t) => t !== name);
    try { await setTransactionTags(txn.id, next); await refresh(); }
    catch (e) { showToast("Untag failed: " + e.message); }
  };

  // ── re-run categorization over all auto-categorized rows ────
  const reapplyRules = async () => {
    try {
      const r = await recategorize();
      await refresh();
      showToast(`Recategorized ${r.updated} of ${r.scanned} untagged`);
    } catch (e) { showToast("Recategorize failed: " + e.message); }
  };

  // ── derived views ───────────────────────────────────────────
  const visible = useMemo(() => {
    return txns.filter((t) => {
      if (filter === "Uncategorized" && t.category !== "Uncategorized") return false;
      if (filter !== "All" && filter !== "Uncategorized" && t.category !== filter) return false;
      if (monthFilter && monthKey(t.date) !== monthFilter) return false;
      if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
      if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [txns, filter, search, monthFilter, tagFilter]);

  // A row counts as spend if it's a purchase, or a P2P send the user has tagged.
  const isSpendTxn = (t) => t.kind === "purchase" || (t.kind === "p2p" && t.is_manual);
  const totalSpend = summary.total_spend_cents / 100;
  const spendCount = useMemo(() => txns.filter(isSpendTxn).length, [txns]);
  // Only nag about spend-relevant rows (purchases / P2P), not income/transfers.
  const uncatCount = useMemo(
    () => txns.filter((t) => t.category === "Uncategorized" && (t.kind === "purchase" || t.kind === "p2p")).length,
    [txns]
  );

  const byCat = useMemo(
    () => summary.by_category.map((c) => ({ name: c.name, value: c.cents / 100 })),
    [summary]
  );
  const byMonth = useMemo(
    () => summary.by_month.map((m) => ({ k: m.month, month: monthLabel(m.month), value: m.cents / 100 })),
    [summary]
  );

  // ── custom category creation ────────────────────────────────
  const [newCat, setNewCat] = useState("");
  const addCategory = async () => {
    const name = newCat.trim();
    if (!name || catByName[name]) return;
    const color = PALETTE[cats.length % PALETTE.length];
    try {
      await createCategory(name, color);
      setCats(await getCategories());
      setNewCat("");
      showToast(`Added category “${name}”`);
    } catch (e) { showToast(e.message); }
  };

  if (!loaded) return <div style={{ ...S.wrap, color: "#7d8597", fontFamily: "JetBrains Mono" }}>Loading your ledger…</div>;

  return (
    <div style={S.wrap}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;}
        .rh:hover{background:rgba(232,176,75,0.06)!important;}
        select.catsel{ -webkit-appearance:none; appearance:none; }
        @keyframes rise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
        ::-webkit-scrollbar{width:8px;height:8px;} ::-webkit-scrollbar-thumb{background:#2a313b;border-radius:4px;}
      `}</style>

      {/* header */}
      <div style={S.header}>
        <div>
          <div style={S.kicker}>OFFLINE EXPENSE LEDGER</div>
          <h1 style={S.h1}>Your Money, Categorized</h1>
        </div>
        <div style={S.totalBox}>
          <div style={S.totalLabel}>TOTAL SPEND</div>
          <div style={S.totalVal}>{fmt(totalSpend)}</div>
          <div style={S.totalSub}>{spendCount} transactions</div>
        </div>
      </div>

      {/* import + actions */}
      <div style={S.actions}>
        <button style={S.importBtn} onClick={() => fileRef.current?.click()}>＋ Import CSV files</button>
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        {uncatCount > 0 && (
          <button style={{ ...S.ghostBtn, borderColor: "#c0392b", color: "#ff6b5c" }}
            onClick={() => { setFilter("Uncategorized"); setMonthFilter(null); }}>
            ⚑ {uncatCount} need tagging
          </button>
        )}
        {txns.length > 0 && (
          <button style={S.ghostBtn} onClick={() => setChartsCollapsed((v) => !v)}>
            {chartsCollapsed ? "▾ Show charts" : "▴ Hide charts"}
          </button>
        )}
      </div>

      {txns.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🧾</div>
          <div style={{ color: "#dfe3e8", fontWeight: 600, fontSize: 16 }}>Drop in your first statement</div>
          <div style={{ color: "#7d8597", fontSize: 13, marginTop: 6, maxWidth: 420 }}>
            Export a CSV from any bank or card, hit Import, and it auto-sorts into categories.
            Anything it can’t place lands in <span style={{ color: "#ff6b5c" }}>Uncategorized</span> for you to tag — and it remembers your choices next time.
          </div>
        </div>
      ) : (
        <>
          {/* charts (collapsible to focus on categorization) */}
          {!chartsCollapsed && (
          <div style={S.charts}>
            <div style={S.card}>
              <div style={S.cardTitle}>SPEND BY CATEGORY</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byCat} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}
                    onClick={(d) => setFilter(filter === d.name ? "All" : d.name)}>
                    {byCat.map((e) => (
                      <Cell key={e.name} fill={colorOf(e.name)} stroke="#0d0f12" strokeWidth={2}
                        opacity={filter !== "All" && filter !== e.name ? 0.3 : 1} style={{ cursor: "pointer" }} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={S.tip} formatter={(v) => fmt(v)} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
              <div style={S.legend}>
                {byCat.slice(0, 8).map((e) => (
                  <button key={e.name} onClick={() => setFilter(filter === e.name ? "All" : e.name)}
                    style={{ ...S.legendItem, opacity: filter !== "All" && filter !== e.name ? 0.4 : 1 }}>
                    <span style={{ ...S.dot, background: colorOf(e.name) }} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</span>
                    <span style={S.legendVal}>{fmt(e.value)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>MONTHLY TREND — click a point to filter</div>
              {byMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={byMonth} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
                    <defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8b04b" stopOpacity={0.5} /><stop offset="100%" stopColor="#e8b04b" stopOpacity={0.02} />
                    </linearGradient></defs>
                    <XAxis dataKey="month" tick={{ fill: "#7d8597", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#7d8597", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
                    <Tooltip contentStyle={S.tip} formatter={(v) => fmt(v)} cursor={{ fill: "rgba(232,176,75,0.06)" }} />
                    <Area type="monotone" dataKey="value" stroke="#e8b04b" strokeWidth={2.5} fill="url(#g2)"
                      dot={{ r: 4, fill: "#e8b04b", cursor: "pointer" }}
                      activeDot={{ r: 6, onClick: (e, p) => setMonthFilter(monthFilter === p.payload.k ? null : p.payload.k) }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div style={{ color: "#5a626d", fontSize: 13, padding: 30, textAlign: "center" }}>Dated transactions will chart here.</div>}
              {monthFilter && (
                <div style={{ marginTop: 6 }}>
                  <button style={{ ...S.monthBtn, ...S.monthBtnActive }} onClick={() => setMonthFilter(null)}>{monthLabel(monthFilter)} ×</button>
                </div>
              )}
            </div>
          </div>
          )}

          {/* filter bar */}
          <div style={S.filterBar}>
            <input placeholder="Search description…" value={search} onChange={(e) => setSearch(e.target.value)} style={S.searchInput} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["All", "Uncategorized"].map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ ...S.chip, ...(filter === f ? S.chipActive : {}), ...(f === "Uncategorized" && uncatCount ? { color: "#ff6b5c", borderColor: "#5a2a26" } : {}) }}>
                  {f}{f === "Uncategorized" && uncatCount ? ` (${uncatCount})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* sub-group (tag) filter — click to scope the table + report */}
          {tagList.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <span style={{ ...S.cardTitle, margin: 0 }}>SUB-GROUPS</span>
              {tagList.map((tg) => (
                <button key={tg.name} onClick={() => setTagFilter(tagFilter === tg.name ? null : tg.name)}
                  style={{ ...S.chip, ...(tagFilter === tg.name ? S.chipActive : {}) }}>
                  🏷 {tg.name} <span style={{ opacity: 0.6 }}>{tg.count}</span>
                </button>
              ))}
              {tagFilter && <button style={S.chip} onClick={() => setTagFilter(null)}>clear ×</button>}
            </div>
          )}

          {/* table */}
          <div style={S.card}>
            <div style={S.tableHead}>
              <span style={{ width: 64 }}>DATE</span>
              <span style={{ flex: 1 }}>DESCRIPTION</span>
              <span style={{ width: 116 }}>ACCOUNT</span>
              <span style={{ width: 142 }}>CATEGORY</span>
              <span style={{ width: 88, textAlign: "right" }}>AMOUNT</span>
            </div>
            <div style={{ maxHeight: chartsCollapsed ? "calc(100vh - 250px)" : "calc(100vh - 520px)", minHeight: 240, overflowY: "auto" }}>
              {visible.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#5a626d", fontSize: 13 }}>No transactions match this view.</div>}
              {visible.map((t, i) => {
                const isCredit = t.amount < 0;
                const spend = isSpendTxn(t);
                const kindLabel = KIND_LABELS[t.kind];
                const amtColor = !spend ? "#5a626d" : isCredit ? "#5ad1a5" : "#fff";
                return (
                <div key={t.id} className="rh" style={{ ...S.tr, animation: `rise .25s ease ${Math.min(i, 20) * 0.01}s both` }}>
                  <span style={{ width: 64, ...S.mono, color: "#7d8597", fontSize: 12 }}>{t.date ? t.date.slice(5) : "—"}</span>
                  <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ color: "#dfe3e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.description}</span>
                    {kindLabel && <span style={S.kindTag} title={`${kindLabel} — excluded from spend`}>{kindLabel}</span>}
                    {(t.tags || []).map((tg) => (
                      <span key={tg} style={S.tagChip} title="Click to remove from sub-group"
                        onClick={() => removeTag(t, tg)}>🏷 {tg} ×</span>
                    ))}
                    <button style={S.addTagBtn} title="Add to a sub-group" onClick={() => addTag(t)}>＋tag</button>
                  </span>
                  <span style={{ width: 116, ...S.mono, color: "#9aa3ad", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.source}>{t.source}</span>
                  <span style={{ width: 142 }}>
                    <select className="catsel" value={t.category || "Uncategorized"} onChange={(e) => assignCat(t.id, e.target.value)}
                      style={{ ...S.catSel, color: colorOf(t.category), borderColor: t.category === "Uncategorized" ? "#5a2a26" : "#2a313b",
                               background: colorOf(t.category) + "14" }}>
                      {cats.map((c) => <option key={c.name} value={c.name} style={{ color: "#dfe3e8", background: "#15181d" }}>{c.name}</option>)}
                    </select>
                  </span>
                  <span style={{ width: 88, textAlign: "right", ...S.mono, color: amtColor, fontWeight: 700 }}
                    title={!spend ? `${t.kind} — not counted as spend` : isCredit ? "Credit" : "Charge"}>{isCredit ? "+" : ""}{fmt(t.amount)}</span>
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* category manager — always available, even before any import */}
      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cardTitle}>CATEGORIES — add your own</div>
          {txns.length > 0 && (
            <button style={S.ghostBtn} onClick={reapplyRules}
              title="Re-run categorization on every untagged row (keeps your manual tags)">
              ↻ Re-apply rules to untagged
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input placeholder="e.g. Childcare, Studio Rent…" value={newCat}
            onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()}
            style={{ ...S.searchInput, flex: 1 }} />
          <button style={S.importBtn} onClick={addCategory}>Add</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {cats.map((c) => (
            <span key={c.name} style={{ ...S.catTag, color: c.color, background: c.color + "1a", border: `1px solid ${c.color}44` }}>{c.name}</span>
          ))}
        </div>
      </div>

      {toast && <div style={S.toast}>{toast}</div>}
      <div style={S.footer}>Stored in local SQLite · learns your merchants as you tag</div>
    </div>
  );
}

const S = {
  wrap: { fontFamily: "Archivo, sans-serif", background: "#0d0f12", color: "#dfe3e8", padding: "26px 22px", minHeight: "100%", backgroundImage: "radial-gradient(circle at 12% 0%, rgba(232,176,75,0.07), transparent 42%)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 14 },
  kicker: { fontFamily: "JetBrains Mono", fontSize: 11, letterSpacing: 2, color: "#e8b04b", marginBottom: 6 },
  h1: { fontSize: 28, fontWeight: 800, margin: 0, color: "#fff", letterSpacing: -0.5 },
  totalBox: { textAlign: "right", borderLeft: "2px solid #e8b04b", paddingLeft: 16 },
  totalLabel: { fontFamily: "JetBrains Mono", fontSize: 11, letterSpacing: 1.5, color: "#7d8597" },
  totalVal: { fontFamily: "JetBrains Mono", fontSize: 26, fontWeight: 700, color: "#e8b04b" },
  totalSub: { fontFamily: "JetBrains Mono", fontSize: 12, color: "#7d8597" },
  actions: { display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" },
  importBtn: { background: "#e8b04b", color: "#0d0f12", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "Archivo" },
  ghostBtn: { background: "transparent", color: "#9aa3ad", border: "1px solid #2a313b", borderRadius: 9, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "Archivo" },
  empty: { border: "1.5px dashed #2a313b", borderRadius: 16, padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" },
  charts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
  card: { background: "#15181d", border: "1px solid #232830", borderRadius: 14, padding: 16 },
  cardTitle: { fontFamily: "JetBrains Mono", fontSize: 11, letterSpacing: 1.5, color: "#7d8597", marginBottom: 12 },
  legend: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 6 },
  legendItem: { display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", color: "#dfe3e8", fontSize: 12.5, fontFamily: "Archivo", cursor: "pointer", padding: "3px 2px", textAlign: "left" },
  legendVal: { marginLeft: "auto", fontFamily: "JetBrains Mono", fontSize: 11.5, color: "#9aa3ad" },
  dot: { width: 9, height: 9, borderRadius: 2, flexShrink: 0 },
  tip: { background: "#0d0f12", border: "1px solid #232830", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 },
  filterBar: { display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" },
  searchInput: { background: "#15181d", border: "1px solid #2a313b", borderRadius: 9, padding: "9px 12px", color: "#dfe3e8", fontSize: 13.5, fontFamily: "Archivo", outline: "none", minWidth: 200 },
  chip: { background: "#15181d", border: "1px solid #2a313b", borderRadius: 20, padding: "7px 14px", color: "#9aa3ad", fontSize: 12.5, cursor: "pointer", fontFamily: "Archivo" },
  chipActive: { borderColor: "#e8b04b", color: "#e8b04b", background: "rgba(232,176,75,0.1)" },
  monthBtn: { background: "#0d0f12", border: "1px solid #232830", borderRadius: 8, padding: "6px 12px", color: "#9aa3ad", fontFamily: "JetBrains Mono", fontSize: 11, cursor: "pointer" },
  monthBtnActive: { borderColor: "#e8b04b", color: "#e8b04b", background: "rgba(232,176,75,0.08)" },
  tableHead: { display: "flex", gap: 12, padding: "0 6px 10px", borderBottom: "1px solid #232830", fontFamily: "JetBrains Mono", fontSize: 10, letterSpacing: 1, color: "#5a626d" },
  tr: { display: "flex", gap: 12, alignItems: "center", padding: "9px 6px", borderBottom: "1px solid #1a1e24", fontSize: 13.5 },
  mono: { fontFamily: "JetBrains Mono" },
  catSel: { width: "100%", fontFamily: "JetBrains Mono", fontSize: 11.5, fontWeight: 700, padding: "4px 6px", borderRadius: 6, border: "1px solid #2a313b", cursor: "pointer", outline: "none" },
  catTag: { fontFamily: "JetBrains Mono", fontSize: 11.5, padding: "4px 9px", borderRadius: 6, fontWeight: 700 },
  kindTag: { flexShrink: 0, fontFamily: "JetBrains Mono", fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#7d8597", background: "#1a1e24", border: "1px solid #2a313b", borderRadius: 4, padding: "2px 6px" },
  tagChip: { flexShrink: 0, fontFamily: "JetBrains Mono", fontSize: 10, color: "#6aa9ff", background: "rgba(106,169,255,0.12)", border: "1px solid #2a3a52", borderRadius: 10, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" },
  addTagBtn: { flexShrink: 0, fontFamily: "JetBrains Mono", fontSize: 10, color: "#5a626d", background: "transparent", border: "1px dashed #2a313b", borderRadius: 10, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" },
  toast: { position: "sticky", bottom: 12, margin: "14px auto 0", width: "fit-content", background: "#e8b04b", color: "#0d0f12", padding: "9px 18px", borderRadius: 20, fontWeight: 700, fontSize: 13, fontFamily: "JetBrains Mono", boxShadow: "0 6px 20px rgba(0,0,0,0.4)" },
  footer: { marginTop: 14, textAlign: "center", color: "#5a626d", fontSize: 11.5, fontFamily: "JetBrains Mono" },
};
