// src/api/metrics.js
import http from "./http"; // axios instance (reads VITE_API_URL)

const METRICS_BASE = "/api/metrics";

/* ------------------------------------------------------------------
   Utilities
-------------------------------------------------------------------*/

/** ext_user_id from localStorage (safe default). */
function getExtUserId() {
  try {
    return (
      (localStorage.getItem("ext_user_id") ||
        localStorage.getItem("extUserId") ||
        "")
        .trim()
    );
  } catch {
    return "";
  }
}

/** Drop null/undefined/empty so we don’t send junk params. */
function cleanParams(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const str = typeof v === "string" ? v.trim() : v;
    if (String(str) === "") continue;
    out[k] = v;
  }
  return out;
}

/** Axios GET with safe params and consistent error handling. */
async function safeGet(url, params = {}) {
  const p = cleanParams(params);
  try {
    const { data } = await http.get(url, { params: p });
    return data ?? {};
  } catch (e) {
    console.error(`[metrics] GET ${url} failed:`, e?.message || e);
    return {};
  }
}

/** host helpers + timestamp normalizer */
const stripWWW = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
function normTs(x) {
  if (!x) return null;
  if (x instanceof Date && !isNaN(x)) return x.toISOString();
  if (typeof x === "number") {
    const ms = x > 1e12 ? x : x * 1000; // guess ms vs s
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }
  let s = String(x).trim();
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T"); // PG "YYYY-MM-DD HH:MM"
  if (!/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) s += "Z"; // assume UTC if missing
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

/* ------------------------------------------------------------------
   Risk & Category Metrics
-------------------------------------------------------------------*/

/** Top sites by visits with latest risk score. */
export async function fetchRiskAnalysis({ extUserId, userId, limit = 5 } = {}) {
  const data = await safeGet(`${METRICS_BASE}/risk-analysis`, {
    extUserId: extUserId ?? getExtUserId(),
    userId,
    limit,
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/** Visits per category. -> [{ category, visits }] */
export async function fetchCategoryBreakdown({ extUserId, userId } = {}) {
  const data = await safeGet(`${METRICS_BASE}/category-breakdown`, {
    extUserId: extUserId ?? getExtUserId(),
    userId,
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/** Category risk for donut. -> [{ category, risk_pct, sites }] */
export async function fetchCategoryRisk({ extUserId } = {}) {
  const _ext = extUserId ?? getExtUserId();
  if (!_ext) return [];
  const data = await safeGet(`${METRICS_BASE}/category-risk`, { extUserId: _ext });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((r) => ({
    category: r.category,
    risk_pct: Number(r.risk_pct || 0),
    sites: Number(r.sites || 0),
  }));
}

/** Buckets of logins. range: weekly|monthly|yearly  -> [{ bucket, value, top_host? }] */
export async function fetchLoginFrequency({ extUserId, range = "weekly" } = {}) {
  const _ext = extUserId ?? getExtUserId();
  const data = await safeGet(`${METRICS_BASE}/login-frequency`, {
    extUserId: _ext,
    range,
    mode: "topsite",
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((r) => ({
    bucket: r.bucket,
    value: Number(r.logins ?? r.value ?? 0),
    top_host: r.top_host || null,
  }));
}

/** Latest saved risk for this user+hostname. -> { score, band, ... } */
export async function fetchSiteRisk({ extUserId, hostname } = {}) {
  const data = await safeGet(`${METRICS_BASE}/site-risk`, {
    extUserId: extUserId ?? getExtUserId(),
    hostname,
  });
  return data || {};
}

/* ------------------------------------------------------------------
   Provided Data
-------------------------------------------------------------------*/

/** Sites (in a category) where user provided any data. */
export async function fetchProvidedData({ extUserId, category, limit = 50 } = {}) {
  const data = await safeGet(`${METRICS_BASE}/provided-data`, {
    extUserId: extUserId ?? getExtUserId(),
    category,
    limit,
  });
  return Array.isArray(data?.items) ? data.items : [];
}

/** Detail for one site's provided data */
export async function fetchProvidedDataForSite({ extUserId, hostname } = {}) {
  const data = await safeGet(`${METRICS_BASE}/provided-data/site`, {
    extUserId: extUserId ?? getExtUserId(),
    hostname,
  });
  console.log("[fetchProvidedDataForSite] API response:", { extUserId: extUserId ?? getExtUserId(), hostname, data });
  return data || {};
}

/* ------------------------------------------------------------------
   Sites by Category (drives Category page + WebsiteList)
-------------------------------------------------------------------*/

/**
 * Tries the new endpoint first: GET /api/track/sites?extUserId=&category=
 * Fallback: GET /api/track/category/:name?extUserId=
 *
 * Normalized return:
 *   Array<{
 *     hostname: string,
 *     lastVisitISO: string|null,         // ISO string
 *     screenTimeSeconds: number,         // int seconds
 *     visitCounts: number
 *   }>
 */
export async function fetchSitesByCategory({ extUserId, category }) {
  const _ext = extUserId ?? getExtUserId();
  if (!_ext || !category) return [];

  // --- 1) New endpoint
  const primary = await safeGet("/api/track/sites", {
    extUserId: _ext,
    category,
  });
  if (Array.isArray(primary) && primary.length) {
    return normalizeSitesList(primary);
  }

  // --- 2) Legacy endpoint
  const legacy = await safeGet(`/api/track/category/${encodeURIComponent(category)}`, {
    extUserId: _ext,
  });
  if (Array.isArray(legacy) && legacy.length) {
    // legacy rows don’t include screen time; still normalize names & dates
    return normalizeSitesList(
      legacy.map((r) => ({
        hostname: r.hostname ?? r.host ?? "",
        lastVisitISO: r.lastVisit ?? r.last_visit ?? r.last_visited ?? null,
        screen_time_seconds: r.screen_time_seconds ?? r.screen_time ?? 0,
        visitCounts: r.visitCounts ?? r.visit_count ?? r.visits ?? 0,
      }))
    );
  }

  // --- 3) Extra safety for label mismatches (e.g., Others/Other, E-commerce variants)
  for (const alt of altCategoryLabels(category)) {
    const altRows = await safeGet("/api/track/sites", {
      extUserId: _ext,
      category: alt,
    });
    if (Array.isArray(altRows) && altRows.length) {
      return normalizeSitesList(altRows);
    }
  }

  return [];
}

/* ---------- helpers for site normalization ---------- */

function normalizeSitesList(rawList) {
  return (rawList || []).map((r) => {
    const lastRaw =
      r.lastVisitISO ??
      r.last_visited ??
      r.lastVisited ??
      r.last_visit ??
      r.created_at ??
      r.createdAt ??
      null;

    const secs =
      Number(
        r.screenTimeSeconds ??
          r.screen_time_seconds ??
          r.screen_time ??
          0
      ) || 0;

    const visits =
      Number(
        r.visitCounts ??
          r.visit_counts ??
          r.visit_count ??
          r.visits ??
          0
      ) || 0;

    return {
      hostname: stripWWW(r.hostname ?? r.host ?? ""),
      websiteId: r.website_id ?? r.websiteId ?? null,
      lastVisitISO: normTs(lastRaw),
      screenTimeSeconds: Math.max(0, Math.trunc(secs)),
      visitCounts: Math.max(0, Math.trunc(visits)),
      // keep originals too (harmless for callers that want raw)
      ...r,
    };
  });
}

/** Generate alternative labels to cope with legacy category names. */
function altCategoryLabels(category) {
  const c = String(category || "").toLowerCase().trim();
  const out = new Set();

  // Others / Other
  if (c === "others") out.add("Other");
  if (c === "other") out.add("Others");

  // E-commerce variants
  if (c === "e-commerce" || c === "e commerce" || c === "ecommerce") {
    out.add("E-commerce");
    out.add("E commerce");
    out.add("Ecommerce");
  }

  return Array.from(out);
}
