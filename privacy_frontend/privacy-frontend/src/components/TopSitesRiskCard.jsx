import React, { useEffect, useState } from "react";
import { normalizeHost } from "@/utils/hostname";   // ✅ NEW import
import http from "@/api/http";

const RISK = {
  1: { tone: "low",  color: "#22c55e", label: "low1"  },
  2: { tone: "low",  color: "#22c55e", label: "low2"  },
  3: { tone: "mid",  color: "#f59e0b", label: "mid1"  },
  4: { tone: "mid",  color: "#f59e0b", label: "mid2"  },
  5: { tone: "high", color: "#ef4444", label: "high1" },
  6: { tone: "high", color: "#ef4444", label: "high2" },
};

function scoreToLevel(score = 0) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const level = Math.ceil((s / 100) * 6) || 1;
  return Math.max(1, Math.min(6, level));
}

export default function TopSitesRiskCard({ extUserId, limit = 5, endpoint = "/api/metrics/risk-analysis" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    let ignore = false;
    
    async function fetchData(showLoading = false) {
      // Only show loading spinner on initial load, not on auto-refresh
      if (showLoading && !ignore) {
        setLoading(true);
      }
      setNote("");
      
      try {
        const url = `${endpoint}?extUserId=${encodeURIComponent(extUserId)}&limit=${encodeURIComponent(limit)}`;
        const res = await http.get(endpoint, {
          params: { extUserId, limit }
        });
        const { items = [] } = res.data;

        const mapped = items.map(it => ({
          domain: normalizeHost(it.hostname),
          risk_level: scoreToLevel(it.risk_score),
          visits: it.visits ?? 0,
        }));

        if (!ignore) {
          if (items.length === 0) {
            setNote("No visits found in database");
            setRows([]);
          } else {
            setRows(mapped.slice(0, limit));
          }
        }
      } catch (e) {
        if (!ignore) {
          setNote("Error loading data");
          setRows([]);
        }
      } finally {
        if (!ignore && showLoading) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    }
    
    // Initial load with loading spinner
    fetchData(true);
    
    // Auto-refresh every 15 seconds (silent, no loading state)
    const pollInterval = setInterval(() => {
      if (!ignore && !isInitialLoad) fetchData(false);
    }, 15000);
    
    // Refresh when page becomes visible (silent)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !ignore && !isInitialLoad) {
        fetchData(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      ignore = true;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [extUserId, limit, endpoint]);

  return (
    <div className="risk-card">
      <h4>Risk Analysis — Most Visited 5 websites</h4>

      {loading ? (
        <div className="risk-skeleton">Loading…</div>
      ) : rows.length > 0 ? (
        <ul className="risk-list">
          {rows.map((r, i) => {
            const level = Math.min(6, Math.max(1, Number(r.risk_level) || 1));
            const cfg = RISK[level] || RISK[1];
            const stepWidth = (level * 100) / 6;

            return (
              <li key={i} className="risk-row" data-level={cfg.label}>
                <div className="risk-name">{r.domain}</div>
                <div className="risk-meter" aria-hidden="true">
                  <div
                    className="risk-fill"
                    style={{ width: `${stepWidth}%`, backgroundColor: cfg.color }}
                    title={`${r.domain} • level=${cfg.label} (${level}/6)`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="risk-empty">No data available</div>
      )}

      {note && <div className="risk-note">{note}</div>}
    </div>
  );
}
