// routes/risk.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { classifyPhishing } = require("../services/phishingModel");
const { bandFromPercent } = require("../services/riskHelper");

/* ----------------------------- helpers ------------------------------ */

// Parse anything (URL or hostname) to a clean hostname (lowercase)
function coerceHostname(input) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // if it already looks like a bare host, return it
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    try {
      // Add a scheme so URL() can parse
      const u = new URL("http://" + s);
      return u.hostname;
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(s);
    return u.hostname || null;
  } catch {
    return null;
  }
}

// Map a DB row to a clean response object (keeps both 0–1 and %)
function mapRiskRow(row) {
  const phishing_risk = Number(row.phishing_risk || 0);
  const data_risk = Number(row.data_risk || 0);
  const combined_risk = Number(row.combined_risk || 0);
  const risk_score = Number.isFinite(row.risk_score) ? Number(row.risk_score) : Math.round(combined_risk * 100);
  const band = row.band || bandFromPercent(risk_score);

  return {
    id: row.id ?? null,
    website_id: row.website_id,
    hostname: row.hostname ?? null,
    ext_user_id: row.ext_user_id ?? null,

    // DB-aligned names
    phishing_risk,
    data_risk,
    combined_risk,
    risk_score,
    band,

    // Friendly aliases for UI code that expects camelCase
    phishingRisk: phishing_risk,
    dataRisk: data_risk,
    combinedRisk: combined_risk,

    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

/* ------------------------------- routes ------------------------------ */

/**
 * GET /api/risk/list
 * Optional query params:
 *   - limit (default 20, max 200)
 *   - hostname (filter)
 *   - ext_user_id (filter)
 */
router.get("/list", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 200);
    const filters = [];
    const args = [];

    if (req.query.hostname) {
      const h = coerceHostname(req.query.hostname);
      if (!h) return res.status(400).json({ ok: false, error: "invalid hostname" });
      args.push(h);
      filters.push(`w.hostname = $${args.length}`);
    }

    if (req.query.ext_user_id) {
      args.push(String(req.query.ext_user_id));
      filters.push(`r.ext_user_id = $${args.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    args.push(limit);

    const { rows } = await db.pool.query(
      `
      SELECT
        r.id,
        r.website_id,
        w.hostname,
        r.ext_user_id,
        r.phishing_risk,
        r.data_risk,
        r.combined_risk,
        r.risk_score,
        r.band,
        r.created_at,
        r.updated_at
      FROM risk_assessments r
      LEFT JOIN websites w ON w.id = r.website_id
      ${where}
      ORDER BY r.updated_at DESC
      LIMIT $${args.length}
      `,
      args
    );

    res.json({ ok: true, data: rows.map(mapRiskRow) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/risk/latest?hostname=example.com[&ext_user_id=...]
 * Returns the latest saved risk row for a hostname (optionally specific user).
 */
router.get("/latest", async (req, res, next) => {
  try {
    const hostname = coerceHostname(req.query.hostname);
    if (!hostname) {
      return res.status(400).json({ ok: false, error: "hostname required" });
    }

    const args = [hostname];
    let filterUser = "";
    if (req.query.ext_user_id) {
      args.push(String(req.query.ext_user_id));
      filterUser = `AND r.ext_user_id = $2`;
    }

    const { rows } = await db.pool.query(
      `
      SELECT
        r.id,
        r.website_id,
        w.hostname,
        r.ext_user_id,
        r.phishing_risk,
        r.data_risk,
        r.combined_risk,
        r.risk_score,
        r.band,
        r.created_at,
        r.updated_at
      FROM risk_assessments r
      JOIN websites w ON w.id = r.website_id
      WHERE w.hostname = $1
      ${filterUser}
      ORDER BY r.updated_at DESC
      LIMIT 1
      `,
      args
    );

    if (!rows.length) return res.json({ ok: true, data: null });
    res.json({ ok: true, data: mapRiskRow(rows[0]) });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/risk/:hostname
 * Compute an on-the-fly combined risk for a hostname:
 * - Reads latest saved data_risk (if any)
 * - Runs phishing classifier to get phishing score (0–1)
 * - Combines them (average), returns result WITHOUT writing to DB
 */
router.get("/:hostname", async (req, res) => {
  try {
    const hostname = coerceHostname(req.params.hostname);
    if (!hostname) {
      return res.status(400).json({ ok: false, error: "hostname required" });
    }

    // 1) read latest saved data_risk (any user)
    const { rows } = await db.pool.query(
      `
      SELECT
        r.website_id,
        w.hostname,
        r.data_risk,
        r.updated_at,
        r.created_at
      FROM risk_assessments r
      JOIN websites w ON w.id = r.website_id
      WHERE w.hostname = $1
      ORDER BY r.updated_at DESC
      LIMIT 1
      `,
      [hostname]
    );

    const saved = rows[0] || null;
    const dataRisk = saved ? Number(saved.data_risk || 0) : 0;

    // 2) phishing risk via classifier with caching (0–1)
    let phishingRisk = 0;
    try {
      // Check cache first
      const cached = await db.getCachedPhishingScore(hostname);
      if (cached) {
        phishingRisk = Number(cached.phishing_score);
      } else {
        // Get fresh score and cache it
        const phishingRes = await classifyPhishing(hostname);
        let s = Number(phishingRes?.phishingScore ?? phishingRes?.score);
        if (!Number.isFinite(s)) s = 0;
        phishingRisk = Math.max(0, Math.min(1, s));
        
        // Cache the result
        await db.cachePhishingScore(hostname, phishingRisk, phishingRes?.label || 'unknown', phishingRes?.model || 'unknown');
      }
    } catch (err) {
      console.warn("[risk:get/:hostname] phishing check failed:", err?.message || err);
    }

    // 3) combine (simple average)
    const combinedRisk = Math.min(1, (dataRisk + phishingRisk) / 2);
    const riskScore = Math.round(combinedRisk * 100);
    const band = bandFromPercent(riskScore);

    // 4) respond (no DB write here)
    return res.json({
      ok: true,
      risk: {
        hostname,
        dataRisk,
        phishingRisk,
        combinedRisk,
        risk_score: riskScore,
        band,
        updated_at: saved?.updated_at ?? saved?.created_at ?? null,
      },
    });
  } catch (e) {
    console.error("[risk:get/:hostname] ERROR", e);
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

router.get("/track/sites", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    const category  = String(req.query.category || "").trim();
    if (!extUserId || !category) {
      return res.status(400).json({ ok:false, error:"extUserId and category are required" });
    }

    const sql = `
      WITH v AS (
        SELECT
          REGEXP_REPLACE(LOWER(COALESCE(sv.hostname,'')), '^www\\.', '') AS host,
          sv.website_id,
          sv.category,
          COALESCE(sv.visit_counts, 0) AS vc,
          COALESCE(sv.screen_time_seconds, 0) AS st,
          sv.last_visited
        FROM site_visits sv
        WHERE sv.ext_user_id = $1 AND sv.category = $2
      ),
      agg AS (
        SELECT
          host,
          MIN(website_id)                        AS website_id,
          MAX(last_visited)                      AS last_visited,
          SUM(vc)::int                           AS visit_counts,
          SUM(st)::int                           AS screen_time_seconds
        FROM v
        GROUP BY host
      )
      SELECT host AS hostname, website_id, last_visited, visit_counts, screen_time_seconds
      FROM agg
      ORDER BY host ASC;
    `;
    const { rows } = await db.pool.query(sql, [extUserId, category]);
    res.json(rows);
  } catch (e) { next(e); }
});


module.exports = router;
