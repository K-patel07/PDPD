// src/features/metrics/useTop5RiskData.js
import { useEffect, useMemo, useState } from 'react';
import { fetchRiskList } from '../../api/risk';
import { normalizeHost } from '../../utils/hostname';

function bandFromScore(score) {
  const s = Number(score ?? 0);
  if (s < 0) return 'Unknown';
  if (s <= 15) return 'Safe';       // 0-15: Safe (light green)
  if (s <= 30) return 'Low';        // 16-30: Low (green)
  if (s <= 60) return 'Medium';     // 31-60: Moderate (yellow)
  if (s <= 85) return 'High';       // 61-85: High (orange)
  if (s <= 100) return 'Critical';  // 86-100: Critical (red)
  return 'Unknown';
}

export function useTop5RiskData(topVisited = []) {
  const [riskRows, setRiskRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await fetchRiskList(300);
        if (!cancelled) setRiskRows(rows);
      } catch (e) {
        if (!cancelled) setErr(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const data = useMemo(() => {
    // Build a map: hostname -> { score, band }
    const riskByHost = new Map();
    for (const r of riskRows) {
      const host =
        normalizeHost(r.hostname || r.website_label || r.domain || '');
      // Prefer overall_risk, fall back to total_risk or website_risk
      const score = Number(
        r.overall_risk ?? r.total_risk ?? r.website_risk ?? 0
      );
      const band = r.band || bandFromScore(score);
      if (host) riskByHost.set(host, { score: Math.max(0, Math.min(100, score)), band });
    }

    // Normalize, sort by visits desc, take top 5, then attach risk
    const top = [...topVisited]
      .map(v => ({
        hostname: normalizeHost(v.hostname),
        visits: Number(v.visits || 0),
      }))
      .filter(v => v.hostname)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5)
      .map(v => {
        const r = riskByHost.get(v.hostname);
        if (!r) return { ...v, riskScore: 0, band: 'Unknown' };
        return { ...v, riskScore: r.score, band: r.band };
      });

    return top;
  }, [riskRows, topVisited]);

  return { data, loading, error };
}
