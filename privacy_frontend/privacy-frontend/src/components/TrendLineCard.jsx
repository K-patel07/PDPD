// TrendLineCard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import http from "@/api/http"; // axios instance

const PAD = { top: 24, right: 24, bottom: 40, left: 40 };

/* ---------------- helpers ---------------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const stripWWW = (h = "") => h.toLowerCase().replace(/^www\./, "");

/* =============================== Component =============================== */
export default function TrendLineCard({
  // If not provided, we read the extension id from localStorage
  extUserId = (localStorage.getItem("ext_user_id") ||
               localStorage.getItem("extUserId") || ""),
  defaultRange = "weekly", // "weekly" | "monthly" | "yearly"
}) {
  const [range, setRange] = useState(defaultRange);
  const [points, setPoints] = useState([]); // [{label,date,value,topHost}]
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(null);
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  /* ---------------- fetch: top site per bucket ---------------- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNote("");
    setErr(null);

    const _ext =
      (extUserId || "").trim() ||
      (localStorage.getItem("ext_user_id") || localStorage.getItem("extUserId") || "").trim();

    if (!_ext) {
      setErr(new Error("Missing extUserId"));
      setLoading(false);
      setPoints([]);
      setNote("No data available");
      return;
    }

    (async () => {
      try {
        // Ask backend for "top site per bucket"
        const { data } = await http.get("/api/metrics/login-frequency", {
          params: { extUserId: _ext, range, mode: "topsite" },
        });

        // Accept either {items:[...]} or plain array; fallback to {data:[...]} (old API)
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.data) // old totals (no top_host)
          ? data.data
          : [];

        const mapped = rows
          .map((r) => {
            const iso = r.bucket || r.date;
            if (!iso) return null;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return null;

            // x-axis label keeps the time
            const label =
              range === "weekly"
                ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
                : range === "monthly"
                ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
                : String(d.getFullYear());

            const value = Number(r.value ?? r.logins ?? 0);
            const topHost = stripWWW(r.top_host || r.topHost || r.hostname || r.host || "");

            return { label, date: iso, value, topHost: topHost || null };
          })
          .filter(Boolean);

        if (!cancelled) setPoints(mapped);
      } catch (e) {
        console.error("[TrendLineCard] fetch error:", e);
        if (!cancelled) {
          setErr(e);
          setPoints([]);
          setNote("No data available");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [extUserId, range]);

  /* ---------------- geometry ---------------- */
  const W = 600, H = 250;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxY = Math.max(1, ...points.map((p) => p.value || 0));
  const xs = points.map((_, i) =>
    PAD.left + (innerW * i) / Math.max(1, points.length - 1)
  );
  const ys = points.map((p) =>
    PAD.top + innerH - (p.value / maxY) * innerH
  );

  const pathD = () => {
    if (points.length === 0) return "";
    let d = `M ${xs[0]},${ys[0]}`;
    for (let i = 1; i < points.length; i++) {
      const x0 = xs[i - 1], y0 = ys[i - 1];
      const x1 = xs[i],     y1 = ys[i];
      const dx = (x1 - x0) * 0.35;
      d += ` C ${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
    }
    return d;
  };

  /* ---------------- tooltip (site name + count) ---------------- */
  const tooltipText = (i) => {
    const p = points[i];
    if (!p) return "";
    return `${p.topHost || "—"}\n${Number(p.value || 0)} logins`;
  };

  const onEnterDot = (i, evt) => {
    if (!points[i]) return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const svgBox = evt.currentTarget.ownerSVGElement.getBoundingClientRect();
    const relX = xs[i] * (svgBox.width / W);
    const relY = ys[i] * (svgBox.height / H);
    setHover({ i, left: relX + svgBox.left - box.left, top: relY + svgBox.top - box.top });
  };
  const onLeave = () => setHover(null);

  /* ---------------- x labels ---------------- */
  const xLabels = useMemo(() => points.map((p) => String(p.label ?? "")), [points]);

  /* ---------------- render ---------------- */
  const isDark =
    document.documentElement.classList.contains("dark") ||
    document.documentElement.classList.contains("theme-dark");

  return (
    <section className="card trend-card line-card" aria-label="Login trend">
      <div className="line-top">
        <h4>Login Frequency</h4>
        <label className="select-like">
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <span className="caret">▾</span>
        </label>
      </div>

      <div className="line-wrap" ref={wrapRef} onMouseLeave={onLeave}>
        {loading ? (
          <div className="risk-skeleton">Loading…</div>
        ) : (
          <svg className="line-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend line">
            <defs>
              <linearGradient id="lineGradientLight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6ce2f4" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#29559b" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id="lineGradientDark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {/* baseline */}
            <line
              x1={PAD.left}
              y1={H - PAD.bottom}
              x2={W - PAD.right}
              y2={H - PAD.bottom}
              stroke="currentColor"
              opacity="0.1"
            />

            {/* shaded area */}
            {points.length > 0 && (
              <path
                d={`${pathD()} L ${xs[xs.length - 1]},${H - PAD.bottom} L ${xs[0]},${H - PAD.bottom} Z`}
                fill={isDark ? "url(#lineGradientDark)" : "url(#lineGradientLight)"}
              />
            )}

            {/* line */}
            <path d={pathD()} className="line-path" fill="none" strokeWidth="0.5" />

            {/* dots */}
            {points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={xs[i]} cy={ys[i]} r="2.5"
                  className="line-dot"
                  onMouseEnter={(e) => onEnterDot(i, e)}
                />
              </g>
            ))}

            {/* x labels */}
            {xLabels.map((lab, i) => (
              <text
                key={i}
                x={xs[i]}
                y={H - PAD.bottom + 22}
                textAnchor="middle"
                className="line-xlab"
              >
                {lab}
              </text>
            ))}
          </svg>
        )}

        {/* tooltip */}
        {hover && (
          <div className="line-tooltip" style={{ left: hover.left, top: hover.top }}>
            {tooltipText(hover.i).split("\n").map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
      </div>

      {note && <div className="risk-note">{note}</div>}
      {err && <div className="risk-error">Failed to load</div>}
    </section>
  );
}
