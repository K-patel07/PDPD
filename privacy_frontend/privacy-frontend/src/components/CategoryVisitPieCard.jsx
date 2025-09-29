// src/components/.../CategoryVisitPieCard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { fetchCategoryRisk } from "@/api/metrics"; // expects [{ category, risk_pct }]

/* ----------------------------- canonicals ---------------------------- */
const CANONICAL = [
  "Social Media","Entertainment","News","Sports","Productivity",
  "E-commerce","Education","Finance","Health","Travel","Others"
];

// lowercase alias -> canonical (UI-side safety net)
const UI_ALIASES = {
  "shopping": "E-commerce",
  "ecommerce": "E-commerce",
  "e-commerce": "E-commerce",
  "e commerece": "E-commerce",
  "e-commerece": "E-commerce",

  "social": "Social Media",
  "social media": "Social Media",
  "social-media": "Social Media",

  "other": "Others",
  "others": "Others",
  "misc": "Others",
  "uncategorized": "Others"
};

function normalizeCategoryUI(name) {
  if (!name) return "Others";
  const s = String(name).trim().toLowerCase();
  const hit = UI_ALIASES[s];
  if (hit) return hit;
  const exact = CANONICAL.find(c => c.toLowerCase() === s);
  return exact || "Others";
}

/* ----------------------------- helpers ------------------------------ */
const toNum  = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp100 = (n) => Math.max(0, Math.min(100, toNum(n, 0)));
const pctStr = (n) => `${clamp100(n).toFixed(1)}%`;

// ensure we respect a caller-provided order but still include all 11
function buildOrder(preferred) {
  const seen = new Set();
  const out = [];
  (Array.isArray(preferred) ? preferred : []).forEach(raw => {
    const c = normalizeCategoryUI(raw);
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  });
  CANONICAL.forEach(c => { if (!seen.has(c)) out.push(c); });
  return out;
}

/* --------------------------- default palette ------------------------ */
const PALETTE = [
  "#ef4444","#f97316","#f59e0b","#eab308","#a3e635",
  "#22c55e","#10b981","#14b8a6","#8b5cf6","#a855f7","#f472b6"
];

/** Build color map = provided mapping (wins) + fallback palette in given order. */
function buildColorMap({ preferredOrder = [], provided = {} }) {
  const map = {};
  // seed with provided (canonicalized keys)
  Object.entries(provided || {}).forEach(([rawKey, color]) => {
    const key = normalizeCategoryUI(rawKey);
    if (key && color) map[key] = color;
  });
  // fill rest from palette following order
  preferredOrder.forEach((key, i) => {
    if (key && !map[key]) map[key] = PALETTE[i % PALETTE.length];
  });
  return map;
}

/** Fold raw API rows into a stable array aligned to ORDER, averaging duplicates, filling 0s. */
function foldToOrder(rows, ORDER) {
  const sum = new Map(), cnt = new Map();
  (rows || []).forEach(it => {
    const cat = normalizeCategoryUI(it?.category);
    const v = clamp100(it?.risk_pct ?? it?.value ?? it?.avg_risk ?? 0);
    sum.set(cat, (sum.get(cat) || 0) + v);
    cnt.set(cat, (cnt.get(cat) || 0) + 1);
  });
  return ORDER.map(cat => {
    const c = cnt.get(cat) || 0;
    const avg = c ? (sum.get(cat) || 0) / c : 0;
    return { category: cat, risk_pct: clamp100(avg) };
  });
}

/* ------------------------------- component --------------------------- */
export default function CategoryVisitPieCard({
  extUserId: extUserIdProp,
  categories,      // optional preferred order (array of names)
  categoryColors,  // optional color overrides: { "Entertainment": "#FF7F50", ... }
}) {
  const extUserId =
    (extUserIdProp ||
      localStorage.getItem("ext_user_id") ||
      localStorage.getItem("extUserId") ||
      "").trim();

  const ORDER = useMemo(() => buildOrder(categories), [categories]);

  const [rows, setRows] = useState([]); // normalized [{ category, risk_pct }]
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  // Stable color map (uses your provided colors first, then palette)
  const COLOR_OF = useMemo(() => buildColorMap({ preferredOrder: ORDER, provided: categoryColors }), [ORDER, categoryColors]);

  /* ----------------------------- data fetch ----------------------------- */
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!extUserId) {
        setRows(ORDER.map(c => ({ category: c, risk_pct: 0 })));
        setLoading(false);
        setNote("Sign in to see category risk.");
        return;
      }
      setLoading(true); setErr(""); setNote("");

      try {
        const items = await fetchCategoryRisk({ extUserId }); // raw array
        if (cancelled) return;

        // fold to ORDER and fill zeros for missing categories
        const folded = foldToOrder(items || [], ORDER);

        setRows(folded);
        if (folded.every(r => r.risk_pct === 0)) setNote("No risk data yet.");
      } catch (e) {
        console.error("[CategoryVisitPieCard] fetch error:", e);
        if (!cancelled) {
          setErr(e?.message || "Failed to load category risk");
          // safe example (aligned to ORDER)
          const demo = {
            "Entertainment": 78.0,
            "Social Media": 62.5,
            "Finance": 28.0,
            "Education": 18.0,
            "Others": 8.0
          };
          setRows(ORDER.map(c => ({ category: c, risk_pct: demo[c] ?? 0 })));
          setNote("Showing example data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Initial load
    fetchData();

    // Auto-refresh every 15 seconds
    const pollInterval = setInterval(() => {
      if (!cancelled) fetchData();
    }, 15000);

    // Refresh when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        fetchData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [extUserId, ORDER]);

  /* -------------------------- computed display -------------------------- */
  // Use risk% as weight; normalize so arcs fill the donut.
  const display = useMemo(() => {
    const weights = rows.map(r => clamp100(r.risk_pct));
    const sumW = weights.reduce((s, x) => s + x, 0);
    const safeSum = sumW > 0 ? sumW : 1; // avoid NaN when all zeros
    return rows.map(r => ({
      category: r.category,
      risk_pct: clamp100(r.risk_pct),
      weight: clamp100(r.risk_pct) / safeSum
    }));
  }, [rows]);

  /* ----------------------------- donut geometry ------------------------- */
  const size = 200, r = 70, stroke = 26;
  const C = 2 * Math.PI * r;

  let acc = 0;
  const arcs = display.map(s => {
    const len = s.weight * C;
    const arc = {
      ...s,
      color: COLOR_OF[s.category] || "#94a3b8",
      dash: `${len} ${Math.max(C - len, 0)}`,
      offset: -acc
    };
    acc += len;
    return arc;
  });

  /* ---------------------------------- UI -------------------------------- */
  return (
    <div className="pie-card">
      <h4>Category Risk (0–100%)</h4>

      {loading ? (
        <div className="risk-skeleton">Loading…</div>
      ) : err && rows.every(r => r.risk_pct === 0) ? (
        <div className="risk-error">Failed to load</div>
      ) : (
        <div className="pie-layout">
          {/* Donut */}
          <svg className="donut" viewBox={`0 0 ${size} ${size}`}>
            <g transform={`translate(${size / 2} ${size / 2}) rotate(-90)`}>
              {/* base ring */}
              <circle
                r={r}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth={stroke}
              />
              {arcs.map(a => (
                <circle
                  key={a.category}
                  r={r}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={stroke}
                  strokeDasharray={a.dash}
                  strokeDashoffset={a.offset}
                />
              ))}
            </g>
          </svg>

          {/* Legend: fixed order, always 11 */}
          <ul className="pie-legend">
            {rows.map(s => (
              <li key={s.category} className="legend-row">
                <span
                  className="dot"
                  style={{ backgroundColor: COLOR_OF[s.category] || "#94a3b8" }}
                />
                <span className="legend-name">{s.category}</span>
                <span className="legend-pct">{pctStr(s.risk_pct)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && <div className="risk-note">{note}</div>}
    </div>
  );
}
