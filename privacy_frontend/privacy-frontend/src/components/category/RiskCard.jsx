// src/components/category/RiskCard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import "@/styles/RiskCard.css";

import HappyFace from "@/assets/risk/light - Happy.svg";
import NeutralFace from "@/assets/risk/light - Neutral.svg";
import SadFace from "@/assets/risk/light - Sad.svg";

import LightHappyFace from "@/assets/risk/Happy.svg";
import LightNeutralFace from "@/assets/risk/Neutral.svg";
import LightSadFace from "@/assets/risk/Sad.svg";

const cx = (...a) => a.filter(Boolean).join(" ");

/* ----------------------- helpers ----------------------- */
function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}
function bandFromScore(score /* 0..100 or null */) {
  if (score == null) return "unknown";
  if (score <= 24) return "low";
  if (score <= 49) return "moderate";
  if (score <= 74) return "high";
  return "critical";
}
// Accept API synonyms but NEVER return "unknown" if score is valid.
function canonicalBandName(bandProp, score) {
  const byScore = bandFromScore(score);
  if (score != null) return byScore; // score wins
  if (!bandProp) return "unknown";
  const b = String(bandProp).trim().toLowerCase();
  if (["low", "ok", "safe"].includes(b)) return "low";
  if (["moderate", "medium", "med"].includes(b)) return "moderate";
  if (["high"].includes(b)) return "high";
  if (["critical", "crit", "severe"].includes(b)) return "critical";
  return "unknown";
}

const BAND = {
  low:      { color: "#22c55e", label: "Low Risk Level", emoji: "🟢", face: "happy" },
  moderate: { color: "#f59e0b", label: "Moderate Risk Level", emoji: "🟡", face: "neutral" },
  high:     { color: "#f97316", label: "High Risk Level", emoji: "🟠", face: "sad" },
  critical: { color: "#ef4444", label: "Critical Risk Level", emoji: "🔴", face: "sad" },
  unknown:  { color: "#94a3b8", label: "Unknown Risk Level", emoji: "⚪️", face: "neutral" },
};

/* ----------------------- component ----------------------- */
export default function RiskCard({
  className = "",
  style,
  extUserId,
  hostname,             // kept for API fetch, not shown in UI anymore
  endpoint = "/api/metrics/site-risk",

  // visual overrides (CSS vars)
  cardFill, // -> --frame-fill
  cardFg,   // -> --card-fg

  // data overrides (skip fetch if provided)
  score: scoreProp,
  band: bandProp,

  subtitle = "Based on activity",
  thickness = 20,
  ...props
}) {
  const { darkMode } = useTheme();

  // only used if props not provided
  const [scoreState, setScoreState] = useState(null);
  const [bandState, setBandState] = useState(null);
  const [loading, setLoading] = useState(!Number.isFinite(scoreProp));
  const [errMsg, setErrMsg] = useState("");

  // SVG arc refs
  const progressRef = useRef(null);
  const [arcLen, setArcLen] = useState(283); // replaced after mount

  /* ----------------------- fetch (optional) ----------------------- */
  useEffect(() => {
    let cancelled = false;
    async function fetchRisk() {
      if (Number.isFinite(scoreProp) || bandProp) {
        setLoading(false);
        setErrMsg("");
        return;
      }
      if (!extUserId || !hostname) {
        setLoading(false);
        setErrMsg("");
        return;
      }
      try {
        setLoading(true);
        setErrMsg("");
        const url = `${endpoint}?extUserId=${encodeURIComponent(extUserId)}&hostname=${encodeURIComponent(hostname)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          const s = Number(data?.score);
          setScoreState(Number.isFinite(s) ? s : null);
          setBandState(data?.band ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[RiskCard] fetch error:", e);
          setScoreState(null);
          setBandState(null);
          setErrMsg(e?.message || "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRisk();
    return () => { cancelled = true; };
  }, [extUserId, hostname, endpoint, scoreProp, bandProp]);

  /* ----------------------- final values ----------------------- */
  const scoreRaw =
    Number.isFinite(scoreProp) ? Number(scoreProp) :
    Number.isFinite(scoreState) ? Number(scoreState) :
    null;

  const score = clampScore(scoreRaw); // null => unknown
  const bandFinal = canonicalBandName(bandProp ?? bandState, score);
  const cfg = BAND[bandFinal] || BAND.unknown;
  const percentLabel = score == null ? "—" : `${score}%`;

  /* ----------------------- measure once ----------------------- */
  useEffect(() => {
    const el = progressRef.current;
    if (!el || !el.getTotalLength) return;
    setArcLen(el.getTotalLength());
  }, []);

  /* ----------------------- animate arc ----------------------- */
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    const len = el.getTotalLength ? el.getTotalLength() : arcLen;
    const p = Math.max(0, Math.min(1, Number(score ?? 0) / 100));
    const dash = p * len;

    // NON-REPEATING PATTERN: set a huge gap so the dash never wraps.
    const GAP = len * 2; // bigger than path length prevents a second segment
    el.style.strokeDasharray = `${dash} ${GAP}`;
    el.style.strokeDashoffset = "0";

    // Hide stroke entirely at 0% so no round-cap bead appears.
    el.style.opacity = dash > 0 ? "1" : "0";
  }, [score, arcLen]);

  /* ----------------------- styles ----------------------- */
  const mergedStyle = {
    ...style,
    ...(cardFill ? { "--frame-fill": cardFill } : null),
    ...(cardFg ? { "--card-fg": cardFg } : null),
  };

  /* ----------------------- render ----------------------- */
  return (
    <div
      className={cx("card panel risk-card", className)}
      style={mergedStyle}
      data-band={bandFinal}
      data-score={score ?? "na"}
      {...props}
    >
      <div className="risk-heading">
        <h4 className="risk-title">Risk Rate</h4>
        <div className="risk-subtitle">{subtitle}</div>
      </div>

      {loading ? (
        <div className="risk-loading">Loading…</div>
      ) : (
        <>
          <div className="risk-gauge">
            <svg
              viewBox="0 0 200 120"
              className="gauge-svg"
              role="img"
              aria-label={`Risk ${percentLabel}`}
            >
              {/* base track */}
              <path
                d="M10,110 A90,90 0 0,1 190,110"
                fill="none"
                stroke="var(--risk-track, #e5e7eb)"
                strokeWidth={thickness}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* progress */}
              <path
                ref={progressRef}
                d="M10,110 A90,90 0 0,1 190,110"
                fill="none"
                stroke={cfg.color}
                strokeWidth={thickness}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="0 999999" /* overwritten in effect */
                strokeDashoffset="0"
                style={{ transition: "stroke-dasharray 500ms ease, opacity 150ms linear" }}
              />
            </svg>

            {/* center face */}
            <div className="risk-face">
              <img
                src={
                  darkMode
                    ? (cfg.face === "happy" ? LightHappyFace : cfg.face === "sad" ? LightSadFace : LightNeutralFace)
                    : (cfg.face === "happy" ? HappyFace : cfg.face === "sad" ? SadFace : NeutralFace)
                }
                alt={`${cfg.face} face`}
              />
            </div>
          </div>

          {/* bottom plate */}
          <div className="risk-plate" aria-hidden="true">
            <span className="min">0%</span>
            <div className="value">{percentLabel}</div>
            <span className="max">100%</span>
            <div className="caption">
              {cfg.emoji} {cfg.label}
            </div>
          </div>

          {/* hostname removed from UI on purpose */}
          {errMsg ? <p className="risk-error">Error: {errMsg}</p> : null}
        </>
      )}
    </div>
  );
}
