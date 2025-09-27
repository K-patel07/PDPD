// routes/metrics.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/* ----------------------------- small helpers ------------------------------ */

// Prefer extUserId if passed; keep userId for older clients
function resolveUser(req) {
  const userId = req.query.userId != null ? Number(req.query.userId) : null;
  const extUserId = req.query.extUserId != null ? String(req.query.extUserId) : null;
  return { userId: Number.isFinite(userId) ? userId : null, extUserId };
}

/** Best-effort hostname canonicalizer: trim → lowercase → extract host → strip leading www. */
function normalizeHostname(input) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    try { s = new URL("http://" + s).hostname; } catch { return null; }
  } else {
    try { s = new URL(s).hostname; } catch { return null; }
  }
  return s.replace(/^www\./, "") || null;
}

// unified query helper
function dbq(sql, params) {
  return (db.pool && db.pool.query ? db.pool.query(sql, params) : db.query(sql, params));
}

/* ---------- information_schema helpers (with tiny in-process cache) ---------- */
const _colsCache = new Map(); // key: "schema.table" -> Set(columns)
async function getCols(schema, table) {
  const key = `${schema}.${table}`;
  if (_colsCache.has(key)) return _colsCache.get(key);
  const { rows } = await dbq(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2`,
    [schema, table]
  );
  const set = new Set(rows.map(r => r.column_name));
  _colsCache.set(key, set);
  return set;
}

/** Build SELECT boolean expressions for each PII field, compatible with either storage shape. */
async function buildFieldExprs() {
  const cols = await getCols("public", "field_submissions");
  const expr = (col, jsonKey) =>
    cols.has(col)
      ? `COALESCE(s.${col}, false)`
      : `COALESCE((s.fields_detected->>'${jsonKey}')::boolean, false)`;

  return {
    email:   expr("submitted_email",   "email"),
    phone:   expr("submitted_phone",   "phone"),
    name:    expr("submitted_name",    "name"),
    card:    expr("submitted_card",    "card"),
    address: expr("submitted_address", "address"),
    age:     expr("submitted_age",     "age"),
    gender:  expr("submitted_gender",  "gender"),
    country: expr("submitted_country", "country"),
  };
}

/* ------------------------------- routes ------------------------------ */
// routes/metrics.js  — replace the /site-risk handler with this version
router.get("/site-risk", async (req, res, next) => {
  try {
    const { extUserId } = resolveUser(req);
    const host = normalizeHostname(req.query.hostname);

    if (!extUserId || !host) {
      return res.status(400).json({ ok: false, error: "extUserId and hostname are required" });
    }

    const sql = `
      SELECT
        COALESCE(
          r.risk_score,
          ROUND(r.combined_risk * 100),
          ROUND(r.phishing_risk * 100),
          0
        )::int AS score,
        r.band,
        r.updated_at
      FROM risk_assessments r
      JOIN websites w ON w.id = r.website_id
      WHERE r.ext_user_id = $1::text
        AND REGEXP_REPLACE(LOWER(COALESCE(w.hostname,'')), '^www\\.', '') = LOWER($2::text)
      ORDER BY r.updated_at DESC
      LIMIT 1;
    `;

    const { rows } = await (db.pool?.query ? db.pool.query(sql, [extUserId, host])
                                           : db.query(sql, [extUserId, host]));
    if (!rows.length) {
      return res.json({ ok: true, score: 0, band: "Unknown" });
    }
    return res.json({ ok: true, ...rows[0] });
  } catch (e) {
    next(e);
  }
});


/**
 * GET /api/metrics/category-breakdown?userId=... or &extUserId=...
 * Returns total *visits* per category (summing visit_count), not just number of sites.
 */
router.get("/category-breakdown", async (req, res, next) => {
  try {
    const { userId, extUserId } = resolveUser(req);
    if (!userId && !extUserId) {
      return res.status(400).json({ ok: false, error: "userId or extUserId required" });
    }

    const sql = `
      SELECT v.category,
             SUM(COALESCE(v.visit_count, 0))::int AS visits
      FROM site_visits v
      WHERE ($1::int  IS NULL OR v.user_id     = $1)
        AND ($2::text IS NULL OR v.ext_user_id = $2)
      GROUP BY v.category
      ORDER BY visits DESC NULLS LAST, v.category ASC NULLS LAST;
    `;
    const { rows } = await dbq(sql, [userId, extUserId]);
    res.json({ ok: true, items: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/metrics/category-risk?extUserId=...
 * For each category, compute the average latest risk % (0–100) across that user's websites.
 * - Risk source: risk_assessments (latest per website_id for this extUserId)
 * - Category source: site_visits (latest category per website_id for this extUserId)
 */
router.get("/category-risk", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    if (!extUserId) return res.status(400).json({ ok: false, error: "extUserId required" });

    // detect a timestamp column on site_visits for "latest category" selection
    const cols = await getCols("public", "site_visits");
    const tsCol =
      (cols.has("last_visited") && `"last_visited"`) ||
      (cols.has("created_at")   && `"created_at"`)   ||
      (cols.has("timestamp")    && `"timestamp"`)    ||
      (cols.has("ts")           && `"ts"`)           ||
      null;

    if (!cols.has("category"))   return res.status(500).json({ ok: false, error: "site_visits.category is required" });
    if (!cols.has("website_id")) return res.status(500).json({ ok: false, error: "site_visits.website_id is required" });

    const timeExpr = tsCol ? `${tsCol}::timestamptz` : `NOW()::timestamptz`;

    const sql = `
      WITH visits AS (
        SELECT website_id, category, ${timeExpr} AS ts
        FROM site_visits
        WHERE ext_user_id = $1
          AND category IS NOT NULL
      ),
      latest_cat AS (
        SELECT DISTINCT ON (website_id)
          website_id, category
        FROM visits
        ORDER BY website_id, ts DESC
      ),
      latest_risk AS (
        SELECT DISTINCT ON (r.website_id)
          r.website_id,
          COALESCE(
            r.risk_score,
            ROUND(r.combined_risk * 100),
            ROUND(r.phishing_risk * 100),
            0
          )::int AS score
        FROM risk_assessments r
        WHERE r.ext_user_id = $1
        ORDER BY r.website_id, r.updated_at DESC
      )
      SELECT
        lc.category,
        AVG(lr.score)::float AS risk_pct,
        COUNT(*)::int        AS sites
      FROM latest_cat lc
      JOIN latest_risk lr ON lr.website_id = lc.website_id
      GROUP BY lc.category
      ORDER BY risk_pct DESC NULLS LAST, lc.category ASC;
    `;
    const { rows } = await dbq(sql, [extUserId]);
    const items = rows.map(r => ({
      category: r.category,
      risk_pct: Math.max(0, Math.min(100, Number(r.risk_pct || 0))),
      sites: Number(r.sites || 0),
    }));
    return res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/metrics/login-frequency?extUserId=...&range=weekly|monthly|yearly[&mode=topsite]
 * Source of truth: site_visits.visit_count (prefers singular; falls back to legacy plural if present).
 */
router.get("/login-frequency", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    if (!extUserId) return res.status(400).json({ ok: false, error: "extUserId required" });

    const range = String(req.query.range || "weekly").toLowerCase();
    const mode  = String(req.query.mode  || "").toLowerCase();
    const useTop = mode === "topsite";

    // whitelist the bucket unit + back window (rolling, ends at last activity)
    let unit = "day", back = "6 days";
    if (range === "monthly") { unit = "month"; back = "5 months"; }
    if (range === "yearly")  { unit = "year";  back = "4 years"; }
    if (!["day", "month", "year"].includes(unit)) {
      return res.status(400).json({ ok: false, error: "range must be weekly|monthly|yearly" });
    }

    const cols = await getCols("public", "site_visits");
    const hostCol =
      cols.has("hostname") ? `"hostname"` :
      cols.has("host")     ? `"host"`     : null;
    const tsCol =
      cols.has("last_visited") ? `"last_visited"` :
      cols.has("created_at")   ? `"created_at"`   :
      cols.has("timestamp")    ? `"timestamp"`    :
      cols.has("ts")           ? `"ts"`           : null;
    const vcCol =
      cols.has("visit_count")  ? `"visit_count"`  :
      cols.has("visit_counts") ? `"visit_counts"` : null;

    if (!tsCol) {
      // cannot build a time series without a timestamp column; return empty frame
      const empty = await dbq(
        `SELECT generate_series(
           date_trunc('${unit}', NOW()) - interval '${back}',
           date_trunc('${unit}', NOW()),
           '1 ${unit}'::interval
         ) AS bucket`
      );
      return useTop
        ? res.json({ ok: true, items: empty.rows.map(r => ({ bucket: r.bucket, top_host: null, logins: 0 })) })
        : res.json({ ok: true, data: empty.rows.map(r => ({ bucket: r.bucket, value: 0 })) });
    }

    const lastSql = `
      SELECT COALESCE(MAX(${tsCol}) FILTER (WHERE ext_user_id = $1), NOW()::timestamptz) AS end_ts
      FROM site_visits
    `;

    if (useTop) {
      const sql = `
        WITH series AS (
          SELECT generate_series(
            date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z) - interval '${back}'),
            date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z)),
            '1 ${unit}'::interval
          ) AS bucket
        ),
        raw AS (
          SELECT
            ${hostCol ? `${hostCol}::text` : `'unknown'`} AS hostname,
            ${tsCol}::timestamptz AS ts,
            ${vcCol ? `${vcCol}::int` : `1::int`} AS vc
          FROM site_visits
          WHERE ext_user_id = $1
            ${hostCol ? `AND ${hostCol} IS NOT NULL AND ${hostCol} <> ''` : ``}
            AND ${tsCol} >= (date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z) - interval '${back}'))
            AND ${tsCol} <  (date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z)) + '1 ${unit}'::interval)
        ),
        bucketed AS (
          SELECT date_trunc('${unit}', ts)::date AS bucket, LOWER(hostname) AS hostname, vc
          FROM raw
        ),
        counts AS (
          SELECT bucket, hostname, SUM(vc)::int AS logins
          FROM bucketed
          GROUP BY 1,2
        ),
        ranked AS (
          SELECT *, RANK() OVER (PARTITION BY bucket ORDER BY logins DESC, hostname ASC) AS r
          FROM counts
        ),
        tops AS (
          SELECT bucket, hostname AS top_host, logins
          FROM ranked
          WHERE r = 1
        )
        SELECT s.bucket, t.top_host, COALESCE(t.logins, 0) AS logins
        FROM series s
        LEFT JOIN tops t USING (bucket)
        ORDER BY s.bucket ASC;
      `;
      const { rows } = await dbq(sql, [extUserId]);
      return res.json({ ok: true, items: rows });
    }

    const totalsSql = `
      WITH series AS (
        SELECT generate_series(
          date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z) - interval '${back}'),
          date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z)),
          '1 ${unit}'::interval
        ) AS bucket
      ),
      agg AS (
        SELECT date_trunc('${unit}', ${tsCol})::date AS bucket,
               SUM(${vcCol ? vcCol : "1"})::int AS value
        FROM site_visits
        WHERE ext_user_id = $1
          AND ${tsCol} >= (date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z) - interval '${back}'))
          AND ${tsCol} <  (date_trunc('${unit}', (SELECT end_ts FROM (${lastSql}) z)) + '1 ${unit}'::interval)
        GROUP BY 1
      )
      SELECT s.bucket, COALESCE(a.value, 0) AS value
      FROM series s
      LEFT JOIN agg a USING (bucket)
      ORDER BY s.bucket ASC;
    `;
    const { rows } = await dbq(totalsSql, [extUserId]);
    return res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
});


/* -------------------- Provided Data (supports both shapes) ------------------- */

/**
 * GET /api/metrics/provided-data?extUserId=...&category=...&limit=50
 * Aggregates latest submissions per site for the given category.
 * Works with either submitted_* boolean columns or fields_detected JSONB.
 */
router.get("/provided-data", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    const category  = String(req.query.category || "").trim();
    const limit     = Math.min(Number(req.query.limit || 50) || 50, 200);

    if (!extUserId) return res.status(400).json({ ok: false, error: "extUserId required" });
    if (!category)  return res.status(400).json({ ok: false, error: "category required" });

    const F = await buildFieldExprs();

    const sql = `
      WITH fs AS (
        SELECT
          s.ext_user_id,
          s.hostname,
          s.website_id,
          s.category,
          s.created_at,
          COALESCE(s.screen_time_seconds, 0) AS screen_time_seconds,
          ${F.email}   AS email,
          ${F.phone}   AS phone,
          ${F.name}    AS name,
          ${F.card}    AS card,
          ${F.address} AS address,
          ${F.age}     AS age,
          ${F.gender}  AS gender,
          ${F.country} AS country,
          w.hostname AS site_hostname
        FROM field_submissions s
        LEFT JOIN websites w ON w.id = s.website_id
        WHERE s.ext_user_id = $1
          AND s.category    = $2
          AND (
            ${F.email}   OR ${F.phone}  OR ${F.name} OR ${F.card} OR
            ${F.address} OR ${F.age}    OR ${F.gender} OR ${F.country}
          )
      ),
      latest_risk AS (
        SELECT DISTINCT ON (r.website_id)
          r.website_id,
          r.risk_score,
          r.band,
          r.updated_at
        FROM risk_assessments r
        WHERE r.ext_user_id = $1
        ORDER BY r.website_id, r.updated_at DESC
      )
      SELECT
        COALESCE(MAX(fs.site_hostname), MAX(fs.hostname)) AS hostname,
        fs.website_id,
        COUNT(*)::int                    AS submit_count,
        MAX(fs.created_at)               AS last_submit_at,
        SUM(fs.screen_time_seconds)::int AS screen_time_sum,
        JSONB_BUILD_OBJECT(
          'email',   BOOL_OR(fs.email),
          'phone',   BOOL_OR(fs.phone),
          'name',    BOOL_OR(fs.name),
          'card',    BOOL_OR(fs.card),
          'address', BOOL_OR(fs.address),
          'age',     BOOL_OR(fs.age),
          'gender',  BOOL_OR(fs.gender),
          'country', BOOL_OR(fs.country)
        ) AS fields_union,
        lr.risk_score,
        lr.band
      FROM fs
      LEFT JOIN latest_risk lr ON lr.website_id = fs.website_id
      GROUP BY fs.website_id, lr.risk_score, lr.band
      ORDER BY last_submit_at DESC
      LIMIT $3;
    `;
    const { rows } = await dbq(sql, [extUserId, category, limit]);
    return res.json({ ok: true, items: rows || [] });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/metrics/provided-data/site?extUserId=...&hostname=...
 * Aggregates submissions for a single site (by canonical hostname).
 * Works with either submitted_* boolean columns or fields_detected JSONB.
 */
router.get("/provided-data/site", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    const canonHost = normalizeHostname(String(req.query.hostname || ""));

    if (!extUserId) return res.status(400).json({ ok: false, error: "extUserId required" });
    if (!canonHost) return res.status(400).json({ ok: false, error: "hostname required" });

    const F = await buildFieldExprs();

    const sql = `
      WITH canon AS ( SELECT $2::text AS p ),
      target AS (
        SELECT id AS website_id
        FROM websites w
        WHERE REGEXP_REPLACE(LOWER(w.hostname), '^www\\.', '') = (SELECT p FROM canon)
        LIMIT 1
      ),
      fs AS (
        SELECT
          s.ext_user_id,
          s.hostname,
          s.website_id,
          s.created_at,
          COALESCE(s.screen_time_seconds, 0) AS screen_time_seconds,
          ${F.email}   AS email,
          ${F.phone}   AS phone,
          ${F.name}    AS name,
          ${F.card}    AS card,
          ${F.address} AS address,
          ${F.age}     AS age,
          ${F.gender}  AS gender,
          ${F.country} AS country
        FROM field_submissions s
        LEFT JOIN websites w ON w.id = s.website_id
        CROSS JOIN canon c
        WHERE s.ext_user_id = $1
          AND (
                s.website_id = (SELECT website_id FROM target)
             OR REGEXP_REPLACE(LOWER(s.hostname), '^www\\.', '') = c.p
             OR REGEXP_REPLACE(LOWER(COALESCE(w.hostname, '')), '^www\\.', '') = c.p
          )
      )
      SELECT
        MIN(fs.website_id)               AS website_id,
        COUNT(*)::int                    AS submit_count,
        MAX(fs.created_at)               AS last_submit_at,
        SUM(fs.screen_time_seconds)::int AS screen_time_sum,
        JSONB_BUILD_OBJECT(
          'email',   BOOL_OR(fs.email),
          'phone',   BOOL_OR(fs.phone),
          'name',    BOOL_OR(fs.name),
          'card',    BOOL_OR(fs.card),
          'address', BOOL_OR(fs.address),
          'age',     BOOL_OR(fs.age),
          'gender',  BOOL_OR(fs.gender),
          'country', BOOL_OR(fs.country)
        ) AS fields_union,
        JSONB_BUILD_OBJECT(
          'email',   SUM(CASE WHEN fs.email   THEN 1 ELSE 0 END),
          'phone',   SUM(CASE WHEN fs.phone   THEN 1 ELSE 0 END),
          'name',    SUM(CASE WHEN fs.name    THEN 1 ELSE 0 END),
          'card',    SUM(CASE WHEN fs.card    THEN 1 ELSE 0 END),
          'address', SUM(CASE WHEN fs.address THEN 1 ELSE 0 END),
          'age',     SUM(CASE WHEN fs.age     THEN 1 ELSE 0 END),
          'gender',  SUM(CASE WHEN fs.gender  THEN 1 ELSE 0 END),
          'country', SUM(CASE WHEN fs.country THEN 1 ELSE 0 END)
        ) AS fields_count
      FROM fs;
    `;
    const { rows } = await dbq(sql, [extUserId, canonHost]);
    let base = rows?.[0] || null;

    if (!base || base.website_id == null) {
      base = {
        website_id: null,
        submit_count: 0,
        last_submit_at: null,
        screen_time_sum: 0,
        fields_union: {
          email: false, phone: false, name: false, card: false,
          address: false, age: false, gender: false, country: false
        },
        fields_count: {
          email: 0, phone: 0, name: 0, card: 0,
          address: 0, age: 0, gender: 0, country: 0
        }
      };
    }

    // Risk snapshot (canonical hostname)
    const riskQ = `
      SELECT r.risk_score, r.band, r.phishing_risk, r.data_risk, r.combined_risk, r.updated_at
      FROM risk_assessments r
      JOIN websites w ON w.id = r.website_id
      WHERE r.ext_user_id = $1
        AND REGEXP_REPLACE(LOWER(w.hostname), '^www\\.', '') = $2
      ORDER BY r.updated_at DESC
      LIMIT 1
    `;
    const riskRes = await dbq(riskQ, [extUserId, canonHost]);
    const risk = riskRes.rows?.[0] || null;

    return res.json({ ok: true, hostname: canonHost, ...base, risk });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
