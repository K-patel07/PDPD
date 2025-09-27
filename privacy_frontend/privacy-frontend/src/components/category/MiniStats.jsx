// src/components/category/MiniStats.jsx
import React from "react";
import lastVisitIcon from "../../assets/category/lastvisit.svg";
import screenTimeIcon from "../../assets/category/screentime.svg";

/**
 * Props:
 * - kind: "lastVisit" | "screenTime"
 * - loading, error
 * - site?: object            // e.g. { last_visited, screen_time_seconds, ... }
 * - data?: object            // e.g. { lastVisitISO, screenTimeMinutes, ... }
 * - (optional top-level fallbacks)
 *   lastVisitISO, lastVisited, last_visited, last_visit, lastVisit, created_at, createdAt
 *   screenTimeSeconds, screen_time_seconds, screenTimeMinutes, screen_time, screenTime
 * - preview: boolean
 * - icon: ReactNode
 */
export default function MiniStats({
  loading,
  error,
  site,
  data,
  kind = "lastVisit",
  preview = false,          // default off so you see real values
  icon = null,

  // optional top-level fallbacks:
  lastVisitISO,
  lastVisited,
  last_visited,
  last_visit,
  lastVisit,
  created_at,
  createdAt,

  screenTimeSeconds,
  screen_time_seconds,
  screenTimeMinutes,
  screen_time,
  screenTime,
}) {
  if (loading) return <div className="card panel mini-card skeleton" />;
  if (error) {
    return (
      <div className="card panel mini-card mini-error" role="status">
        {error}
      </div>
    );
  }

  /* ------------------------------ helpers ------------------------------ */
  const isLastVisit = kind === "lastVisit";
  const title = isLastVisit ? "Last Visit" : "Screen Time";

  function getIcon() {
    if (icon) return icon;
    return isLastVisit ? (
      <img src={lastVisitIcon} alt="Last Visit" className="mini-icon-svg" />
    ) : (
      <img src={screenTimeIcon} alt="Screen Time" className="mini-icon-svg" />
    );
  }

  const coalesce = (...vals) => {
    for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
    return null;
  };

  // Robust PG/ISO timestamp parser
  function parseTimestamp(raw) {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw)) return raw;

    if (typeof raw === "number") {
      // epoch ms vs epoch s
      const ms = raw > 1e12 ? raw : raw * 1000;
      const d = new Date(ms);
      return isNaN(d) ? null : d;
    }

    let s = String(raw).trim();
    let d = new Date(s);
    if (!isNaN(d)) return d;

    // PG often returns "YYYY-MM-DD HH:MM:SS.sss+TZ" (space instead of T)
    if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");

    // If still no timezone info, treat as UTC
    if (!/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) s = s + "Z";

    d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function pickLastVisit() {
    const o = { ...(site || {}), ...(data || {}) };
    return coalesce(
      // explicit props first
      lastVisitISO, lastVisited, last_visited, last_visit, lastVisit, created_at, createdAt,
      // then from objects
      o.lastVisitISO, o.lastVisited, o.last_visited, o.last_visit, o.lastVisit, o.created_at, o.createdAt
    );
  }

  function pickScreenSeconds() {
    const o = { ...(site || {}), ...(data || {}) };
    // prefer seconds; accept both camel/snake and common aliases
    const sec = coalesce(
      screenTimeSeconds, screen_time_seconds, screen_time, screenTime,
      o.screenTimeSeconds, o.screen_time_seconds, o.screen_time, o.screenTime
    );
    if (sec !== null) {
      const n = Number(sec);
      if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
    }
    // fallback: minutes -> seconds
    const mins = coalesce(screenTimeMinutes, o.screenTimeMinutes);
    const m = Number(mins);
    if (Number.isFinite(m)) return Math.max(0, Math.trunc(m * 60));
    return 0;
  }

  function formatDateParts(rawTs) {
    const d = parseTimestamp(rawTs);
    if (!d) return null;
    const day = String(d.getDate()).padStart(2, "0").replace(/^0/, "");
    const mon = d.toLocaleString(undefined, { month: "short" });
    const year = String(d.getFullYear());
    return { day, mon, year };
  }

  function formatTimeParts(totalSeconds) {
    const s = Math.max(0, Number(totalSeconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return { h, m, s: r };
  }

  /* ------------------------------ values ------------------------------- */
  let valueNode = null;

  if (preview) {
    valueNode = isLastVisit ? (
      <div className="mini-value">
        <span className="mini-number">19&nbsp;Aug</span>
        <span className="mini-year">2025</span>
      </div>
    ) : (
      <div className="mini-value">
        <span className="mini-number">1</span>
        <span className="mini-unit">h</span>&nbsp;
        <span className="mini-number">30</span>
        <span className="mini-unit">mins</span>
      </div>
    );
  } else if (isLastVisit) {
    const raw = pickLastVisit();
    const p = formatDateParts(raw);
    valueNode = p ? (
      <div className="mini-value">
        <span className="mini-number">{p.day}&nbsp;{p.mon}</span>
        <span className="mini-year">{p.year}</span>
      </div>
    ) : (
      <div className="mini-value">—</div>
    );
  } else {
    const secs = pickScreenSeconds();
    const t = formatTimeParts(secs);
    valueNode = (
      <div className="mini-value">
        {t.h ? (
          <>
            <span className="mini-number">{t.h}</span>
            <span className="mini-unit">h</span>
            {(t.m || t.s) ? <>&nbsp;</> : null}
          </>
        ) : null}
        {t.m ? (
          <>
            <span className="mini-number">{t.m}</span>
            <span className="mini-unit">mins</span>
            {t.s ? <>&nbsp;</> : null}
          </>
        ) : null}
        {!t.h && !t.m ? (
          <>
            <span className="mini-number">{t.s}</span>
            <span className="mini-unit">s</span>
          </>
        ) : t.s ? (
          <>
            <span className="mini-number">{t.s}</span>
            <span className="mini-unit">s</span>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card panel mini-card mini-body mini-row">
      <div className="mini-header">
        <div className="mini-icon">{getIcon()}</div>
        <div className="mini-title">{title}</div>
      </div>
      <div className="mini-value-wrap">{valueNode}</div>
    </div>
  );
}
