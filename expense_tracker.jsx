import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Papa from "papaparse";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
} from "recharts";

// ── storage keys ─────────────────────────────────────────────
const K_TXNS = "expense:txns:v1";
const K_CATS = "expense:cats:v1";
const K_LEARN = "expense:learned:v1";

const DEFAULT_CATS = [
  { name: "Travel",        color: "#e8b04b", kw: ["uber","lyft","delta","united","southwest","american air","hertz","enterprise","avis","airline","flight","taxi","amtrak"] },
  { name: "Lodging",       color: "#6aa9ff", kw: ["hotel","marriott","hilton","hampton","airbnb","inn","motel","hyatt","lodge","resort"] },
  { name: "Meals",         color: "#c792ea", kw: ["restaurant","cafe","coffee","starbucks","grill","pizza","in-n-out","catering","kitchen","tavern","bar ","diner","doordash","grubhub"] },
  { name: "Fuel",          color: "#ff7a5c", kw: ["shell","chevron","exxon","bp ","gas","fuel","diesel","mobil","arco","texaco"] },
  { name: "Groceries",     color: "#5ad1a5", kw: ["whole foods","trader joe","safeway","kroger","grocery","costco","ralphs","aldi","publix"] },
  { name: "Equipment",     color: "#f2c0d5", kw: ["home depot","grainger","mouser","digikey","lowes","hardware","amazon","mcmaster","supply"] },
  { name: "Utilities",     color: "#7fd6e8", kw: ["electric","water","comcast","internet","utility","at&t","verizon","power co"] },
  { name: "Subscriptions", color: "#b6c95a", kw: ["netflix","spotify","adobe","hetzner","aws","subscription","annual","apple.com","github","openai"] },
  { name: "Payment",       color: "#5a626d", kw: ["payment","autopay","thank you","pymt","transfer","online pmt"] },
  { name: "Other",         color: "#9aa3ad", kw: [] },
  { name: "Uncategorized", color: "#c0392b", kw: [] },
];

const fmt = (n) => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthKey = (iso) => (iso || "").slice(0, 7);
const monthLabel = (k) => { const [y,m]=k.split("-"); return new Date(y, m-1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}); };

// normalize a merchant string into a learning key
const merchantKey = (desc) =>
  (desc || "").toLowerCase().replace(/[0-9#*]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");

// ── storage helpers (graceful if unavailable) ───────────────
async function loadKey(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r && r.value ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function saveKey(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch {}
}

export default function ExpenseTracker() {
  const [txns, setTxns] = useState([]);
  const [cats, setCats] = useState(DEFAULT_CATS);
  const [learned, setLearned] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(null);
  const [toast, setToast] = useState("");
  const fileRef = useRef();

  // load once
  useEffect(() => {
    (async () => {
      const [t, c, l] = await Promise.all([
        loadKey(K_TXNS, []), loadKey(K_CATS, DEFAULT_CATS), loadKey(K_LEARN, {}),
      ]);
      setTxns(t); setCats(c && c.length ? c : DEFAULT_CATS); setLearned(l); setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveKey(K_TXNS, txns); }, [txns, loaded]);
  useEffect(() => { if (loaded) saveKey(K_CATS, cats); }, [cats, loaded]);
  useEffect(() => { if (loaded) saveKey(K_LEARN, learned); }, [learned, loaded]);

  const catByName = useMemo(() => Object.fromEntries(cats.map((c) => [c.name, c])), [cats]);
  const colorOf = (name) => (catByName[name]?.color) || "#9aa3ad";

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  // ── categorization engine ──────────────────────────────────
  const categorize = useCallback((desc) => {
    const mk = merchantKey(desc);
    if (learned[mk]) return learned[mk];
    const d = (desc || "").toLowerCase();
    for (const c of cats) {
      if (c.name === "Uncategorized" || c.name === "Other") continue;
      if (c.kw.some((k) => d.includes(k))) return c.name;
    }
    return "Uncategorized";
  }, [cats, learned]);

  // ── CSV import ──────────────────────────────────────────────
  const handleFiles = (fileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    let imported = 0, skipped = 0;
    const existing = new Set(txns.map((t) => t.sig));
    let pending = files.length;
    const collected = [];

    files.forEach((file) => {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => {
          const headers = res.meta.fields || [];
          const find = (cands) => headers.find((h) => cands.some((c) => h.toLowerCase().trim().includes(c)));
          const hDate = find(["date","posted","transaction date"]);
          const hDesc = find(["description","name","merchant","payee","memo","details"]);
          const hAmt = find(["amount","amt"]);
          const hDebit = find(["debit","withdrawal"]);
          const hCredit = find(["credit","deposit"]);

          res.data.forEach((row) => {
            const rawDate = hDate ? row[hDate] : "";
            const desc = (hDesc ? row[hDesc] : "").toString().trim();
            let amt = 0;
            if (hAmt && row[hAmt]) amt = parseFloat(row[hAmt].toString().replace(/[$,()]/g, "")) || 0;
            else if (hDebit && row[hDebit]) amt = -Math.abs(parseFloat(row[hDebit].toString().replace(/[$,]/g, "")) || 0);
            else if (hCredit && row[hCredit]) amt = Math.abs(parseFloat(row[hCredit].toString().replace(/[$,]/g, "")) || 0);
            if (!desc || !amt) return;
            // normalize date
            let iso = "";
            const d = new Date(rawDate);
            if (!isNaN(d)) iso = d.toISOString().slice(0, 10);
            const sig = `${iso}|${desc}|${amt}`;
            if (existing.has(sig)) { skipped++; return; }
            existing.add(sig);
            collected.push({
              id: sig + "|" + Math.random().toString(36).slice(2, 7),
              sig, date: iso || "—", desc, amt: Math.abs(amt),
              card: file.name.replace(/\.csv$/i, "").slice(0, 14),
              cat: categorize(desc), manual: false,
            });
            imported++;
          });
          if (--pending === 0) {
            setTxns((prev) => [...collected, ...prev].sort((a, b) => (b.date > a.date ? 1 : -1)));
            showToast(`Imported ${imported} · skipped ${skipped} dupes`);
          }
        },
      });
    });
  };

  // ── manual category assignment (with learning) ──────────────
  const assignCat = (id, catName) => {
    setTxns((prev) => prev.map((t) => (t.id === id ? { ...t, cat: catName, manual: true } : t)));
    const t = txns.find((x) => x.id === id);
    if (t) {
      const mk = merchantKey(t.desc);
      if (mk) setLearned((prev) => ({ ...prev, [mk]: catName }));
    }
  };

  // ── derived views ───────────────────────────────────────────
  const visible = useMemo(() => {
    return txns.filter((t) => {
      if (filter === "Uncategorized" && t.cat !== "Uncategorized") return false;
      if (filter !== "All" && filter !== "Uncategorized" && t.cat !== filter) return false;
      if (monthFilter && monthKey(t.date) !== monthFilter) return false;
      if (search && !t.desc.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [txns, filter, search, monthFilter]);

  const spendTxns = useMemo(() => txns.filter((t) => t.cat !== "Payment"), [txns]);
  const totalSpend = useMemo(() => spendTxns.reduce((s, t) => s + t.amt, 0), [spendTxns]);
  const uncatCount = useMemo(() => txns.filter((t) => t.cat === "Uncategorized").length, [txns]);

  const byCat = useMemo(() => {
    const m = {};
    spendTxns.forEach((t) => (m[t.cat] = (m[t.cat] || 0) + t.amt));
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [spendTxns]);

  const byMonth = useMemo(() => {
    const m = {};
    spendTxns.forEach((t) => { const k = monthKey(t.date); if (k && k !== "—") m[k] = (m[k] || 0) + t.amt; });
    return Object.keys(m).sort().map((k) => ({ k, month: monthLabel(k), value: m[k] }));
  }, [spendTxns]);

  // ── custom category creation ────────────────────────────────
  const [newCat, setNewCat] = useState("");
  const PALETTE = ["#e8b04b","#6aa9ff","#c792ea","#ff7a5c","#5ad1a5","#f2c0d5","#7fd6e8","#b6c95a"];
  const addCategory = () => {
    const name = newCat.trim();
    if (!name || catByName[name]) return;
    const color = PALETTE[cats.length % PALETTE.length];
    setCats((prev) => {
      const idx = prev.findIndex((c) => c.name === "Other");
      const next = [...prev];
      next.splice(idx < 0 ? prev.length : idx, 0, { name, color, kw: [] });
      return next;
    });
    setNewCat("");
    showToast(`Added category “${name}”`);
  };

  const resetAll = () => {
    if (!window.confirm("Clear ALL transactions and learned rules? This cannot be undone.")) return;
    setTxns([]); setLearned({}); setCats(DEFAULT_CATS);
    showToast("Cleared everything");
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
          <div style={S.totalSub}>{spendTxns.length} transactions</div>
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
        {txns.length > 0 && <button style={S.ghostBtn} onClick={resetAll}>Reset all</button>}
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
          {/* charts */}
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

          {/* table */}
          <div style={S.card}>
            <div style={S.tableHead}>
              <span style={{ width: 64 }}>DATE</span>
              <span style={{ flex: 1 }}>DESCRIPTION</span>
              <span style={{ width: 96 }}>SOURCE</span>
              <span style={{ width: 142 }}>CATEGORY</span>
              <span style={{ width: 88, textAlign: "right" }}>AMOUNT</span>
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {visible.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#5a626d", fontSize: 13 }}>No transactions match this view.</div>}
              {visible.map((t, i) => (
                <div key={t.id} className="rh" style={{ ...S.tr, animation: `rise .25s ease ${Math.min(i, 20) * 0.01}s both` }}>
                  <span style={{ width: 64, ...S.mono, color: "#7d8597", fontSize: 12 }}>{t.date === "—" ? "—" : t.date.slice(5)}</span>
                  <span style={{ flex: 1, color: "#dfe3e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.desc}>{t.desc}</span>
                  <span style={{ width: 96, ...S.mono, color: "#5a626d", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.card}</span>
                  <span style={{ width: 142 }}>
                    <select className="catsel" value={t.cat} onChange={(e) => assignCat(t.id, e.target.value)}
                      style={{ ...S.catSel, color: colorOf(t.cat), borderColor: t.cat === "Uncategorized" ? "#5a2a26" : "#2a313b",
                               background: colorOf(t.cat) + "14" }}>
                      {cats.map((c) => <option key={c.name} value={c.name} style={{ color: "#dfe3e8", background: "#15181d" }}>{c.name}</option>)}
                    </select>
                  </span>
                  <span style={{ width: 88, textAlign: "right", ...S.mono, color: "#fff", fontWeight: 700 }}>{fmt(t.amt)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* category manager */}
          <div style={{ ...S.card, marginTop: 14 }}>
            <div style={S.cardTitle}>CATEGORIES — add your own</div>
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
        </>
      )}

      {toast && <div style={S.toast}>{toast}</div>}
      <div style={S.footer}>Auto-saved · learns your merchants · {Object.keys(learned).length} rules remembered</div>
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
  toast: { position: "sticky", bottom: 12, margin: "14px auto 0", width: "fit-content", background: "#e8b04b", color: "#0d0f12", padding: "9px 18px", borderRadius: 20, fontWeight: 700, fontSize: 13, fontFamily: "JetBrains Mono", boxShadow: "0 6px 20px rgba(0,0,0,0.4)" },
  footer: { marginTop: 14, textAlign: "center", color: "#5a626d", fontSize: 11.5, fontFamily: "JetBrains Mono" },
};
