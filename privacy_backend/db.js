// db.js — unified PG layer (one-row-per-site visits, audit, risk, helpers)
require("dotenv").config();
const { Pool } = require("pg");
const psl = require("psl");

const { classifyPhishing } = require("./services/phishingModel");
const { bandFromPercent } = require("./services/riskHelper");

/* ------------------------------ Pool ------------------------------ */
/** prefer DATABASE_URL; fall back to PG* vars; optional SSL via DB_SSL=true */
const hasUrl =
  typeof process.env.DATABASE_URL === "string" &&
  /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL.trim());

const wantSSL = String(process.env.DB_SSL || "").toLowerCase() === "true";
const sslOption = wantSSL ? { rejectUnauthorized: false } : false;

const pool = hasUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      ssl: sslOption,
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || undefined,
      database: process.env.PGDATABASE || "pdpd",
      port: Number(process.env.PGPORT || 5432),
      ssl: sslOption,
    });

// Force the schema so reads/writes go to public
pool
  .query("SET search_path TO public")
  .catch((e) => console.error("[DB] set search_path failed", e.message));

// one-time: print where we’re connected
(async () => {
  try {
    const r = await pool.query('SELECT current_database() db, current_user "user"');
    console.log("[DB] connected to", r.rows[0]);
  } catch (e) {
    console.error("[DB] connection test failed:", e.message);
  }
})();

// logging toggles
const LOG_DB = String(process.env.LOG_DB || "").toLowerCase() === "true";
const DISABLE_AUDIT = String(process.env.DISABLE_AUDIT || "").toLowerCase() === "true";
const debug = (...args) => {
  if (LOG_DB) console.log("[db]", ...args);
};

/* ----------------------------- Utils ------------------------------ */
function normalizeHostname(host) {
  if (!host) return "";
  try {
    let urlHost = host;
    if (urlHost.includes("://")) urlHost = new URL(urlHost).hostname;
    urlHost = urlHost.toLowerCase().trim();
    if (urlHost.startsWith("www.")) urlHost = urlHost.slice(4);
    const parsed = psl.parse(urlHost);

    // require a registrable domain (has a dot)
    if (!parsed.domain || !parsed.domain.includes(".")) return "";

    return parsed.domain; // collapses subdomains
  } catch {
    return String(host || "").toLowerCase();
  }
}

function coerceDate(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

async function ping() {
  await pool.query("SELECT 1");
  return true;
}
async function query(text, params = []) {
  if (LOG_DB) console.log("[db.query]", text, params);
  return pool.query(text, params);
}

/* ----------------------------- Tx helper --------------------------- */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/* -------------------- Baseline & Migration Helpers ----------------- */
async function ensureTables(client) {
  // Minimal users: avoids 500s when autocreating ext users
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      ext_user_id TEXT UNIQUE
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.websites (
      id SERIAL PRIMARY KEY,
      hostname TEXT UNIQUE NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.site_visits (
      id SERIAL PRIMARY KEY,
      website_id INTEGER NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
      hostname TEXT NOT NULL,
      path TEXT,
      title TEXT,
      category TEXT DEFAULT 'Unknown',
      category_confidence NUMERIC(5,4),
      category_method TEXT,
      event_type TEXT NOT NULL DEFAULT 'visit',
      fields_detected JSONB NOT NULL DEFAULT '{}'::jsonb,
      fields TEXT[] NOT NULL DEFAULT '{}', -- legacy
      last_input_time TIMESTAMPTZ NULL,
      screen_time_seconds INTEGER NOT NULL DEFAULT 0,
      ext_user_id TEXT,
      raw_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visit_count INTEGER NOT NULL DEFAULT 1,
      last_visited TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visit_date DATE
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id SERIAL PRIMARY KEY,
      website_id INTEGER NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL DEFAULT 'visit',
      ext_user_id TEXT,
      last_input_time TIMESTAMPTZ NULL,
      raw_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.risk_assessments (
      id SERIAL PRIMARY KEY,
      website_id INTEGER NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
      ext_user_id TEXT NOT NULL,
      phishing_risk NUMERIC(5,4) DEFAULT 0,
      data_risk     NUMERIC(5,4) DEFAULT 0,
      combined_risk NUMERIC(5,4) DEFAULT 0,
      risk_score    INT          DEFAULT 0,
      band          TEXT         DEFAULT 'Unknown',
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT ux_risk_user_site UNIQUE (website_id, ext_user_id)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.field_submissions (
      id SERIAL PRIMARY KEY,
      hostname TEXT NOT NULL,
      ext_user_id TEXT,
      fields_detected JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_input_time TIMESTAMPTZ NULL,
      screen_time_seconds INT NOT NULL DEFAULT 0,
      path TEXT,
      category TEXT,
      category_confidence NUMERIC,
      category_method TEXT,
      event_type TEXT DEFAULT 'submit',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      website_id INTEGER,
      site_visit_id INTEGER,
      CONSTRAINT field_submissions_website_fk
        FOREIGN KEY (website_id) REFERENCES public.websites(id) ON DELETE CASCADE,
      CONSTRAINT field_submissions_site_visit_fk
        FOREIGN KEY (site_visit_id) REFERENCES public.site_visits(id) ON DELETE SET NULL
    );
  `);

  // Helpful indexes
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_site_visits_user_last
      ON public.site_visits (ext_user_id, last_visited DESC);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_field_submissions_user_cat_time
      ON public.field_submissions (ext_user_id, category, created_at DESC);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_field_submissions_user_host_time
      ON public.field_submissions (ext_user_id, hostname, created_at DESC);
  `);
}

/** De-dupe helper used by ensureVisitsUniqueKey */
async function flattenSiteVisits(client) {
  // duplicates?
  const dup = await client.query(`
    SELECT COUNT(*)::int AS dups
    FROM (
      SELECT ext_user_id, hostname, COUNT(*) c
      FROM public.site_visits
      GROUP BY 1,2
      HAVING COUNT(*) > 1
    ) x;
  `);
  const need = dup.rows[0]?.dups || 0;
  if (!need) return;

  await client.query(`
    CREATE TEMP TABLE sv_keep ON COMMIT DROP AS
    SELECT DISTINCT ON (ext_user_id, hostname)
      id AS keep_id, ext_user_id, hostname
    FROM public.site_visits
    ORDER BY ext_user_id, hostname, last_visited DESC NULLS LAST, created_at DESC NULLS LAST, id DESC;

    CREATE TEMP TABLE sv_agg ON COMMIT DROP AS
    SELECT
      ext_user_id,
      hostname,
      COALESCE(SUM(visit_count), COUNT(*)) AS total_visits,
      COALESCE(SUM(screen_time_seconds), 0) AS total_st,
      MAX(last_visited) AS last_visited,
      MIN(created_at) AS created_at,
      MAX(website_id) AS website_id,
      (ARRAY_REMOVE(ARRAY_AGG(title ORDER BY last_visited DESC NULLS LAST), NULL))[1]    AS title,
      (ARRAY_REMOVE(ARRAY_AGG(path  ORDER BY last_visited DESC NULLS LAST), NULL))[1]    AS path,
      (ARRAY_REMOVE(ARRAY_AGG(category ORDER BY last_visited DESC NULLS LAST), NULL))[1] AS category,
      (ARRAY_REMOVE(ARRAY_AGG(category_confidence ORDER BY last_visited DESC NULLS LAST), NULL))[1] AS category_confidence,
      (ARRAY_REMOVE(ARRAY_AGG(category_method ORDER BY last_visited DESC NULLS LAST), NULL))[1]     AS category_method
    FROM public.site_visits
    GROUP BY ext_user_id, hostname;

    UPDATE public.site_visits s
       SET visit_count         = a.total_visits,
           screen_time_seconds = a.total_st,
           last_visited        = a.last_visited,
           created_at          = COALESCE(a.created_at, s.created_at),
           title               = COALESCE(a.title, s.title),
           path                = COALESCE(a.path, s.path),
           category            = COALESCE(a.category, s.category),
           category_confidence = COALESCE(a.category_confidence, s.category_confidence),
           category_method     = COALESCE(a.category_method, s.category_method),
           website_id          = COALESCE(a.website_id, s.website_id)
      FROM sv_keep k
      JOIN sv_agg a USING (ext_user_id, hostname)
     WHERE s.id = k.keep_id;

    UPDATE public.field_submissions fs
       SET site_visit_id = k.keep_id
      FROM public.site_visits s
      JOIN sv_keep k USING (ext_user_id, hostname)
     WHERE fs.site_visit_id = s.id
       AND s.id <> k.keep_id;

    DELETE FROM public.site_visits s
     USING sv_keep k
     WHERE s.ext_user_id = k.ext_user_id
       AND s.hostname    = k.hostname
       AND s.id         <> k.keep_id;
  `);
}

async function ensureVisitsUniqueKey(client) {
  await client.query(`
    ALTER TABLE public.site_visits
      ALTER COLUMN visit_date DROP NOT NULL,
      ALTER COLUMN visit_date SET DEFAULT (NOW() AT TIME ZONE 'Australia/Melbourne')::date;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_site_visits_user_host_day') THEN
        ALTER TABLE public.site_visits DROP CONSTRAINT ux_site_visits_user_host_day;
      END IF;
    END$$;
  `);

  await flattenSiteVisits(client);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_site_visits_user_host') THEN
        ALTER TABLE public.site_visits
        ADD CONSTRAINT ux_site_visits_user_host UNIQUE (ext_user_id, hostname);
      END IF;
    END$$;
  `);
}

/** Creates/repairs baseline schema and flips site_visits to one-row-per-site. */
async function ensureBaseline() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureTables(client);
    await ensureVisitsUniqueKey(client);
    await client.query("COMMIT");
    debug("ensureBaseline: OK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ensureBaseline ERROR:", e.message || e);
    throw e;
  } finally {
    client.release();
  }
}

/* --------------------------- Core helpers -------------------------- */
async function ensureWebsiteId({ hostname, client: c }) {
  const own = !c;
  const client = c || (await pool.connect());
  try {
    const h = String(hostname || "").toLowerCase();
    if (!h) throw new Error("ensureWebsiteId: hostname missing");
    const { rows } = await client.query(
      `INSERT INTO websites (hostname)
       VALUES ($1)
       ON CONFLICT ((lower(hostname))) DO UPDATE
         SET hostname = EXCLUDED.hostname
       RETURNING id AS website_id`,
      [h]
    );
    return rows[0].website_id;
  } finally {
    if (own) client.release();
  }
}

/* ------------------------------ Visits ----------------------------- */
async function insertVisit(payload = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hostname = normalizeHostname(payload.hostname);
    if (!hostname) throw new Error("hostname is required");

    const website_id = await ensureWebsiteId({ hostname, client });

    const record = {
      hostname,
      path: payload.path || "",
      title: payload.title || "",
      category: payload.category || "Unknown",
      category_confidence: payload.category_confidence ?? null,
      category_method: payload.category_method ?? null,
      event_type: payload.event_type || "visit",
      fields_detected: payload.fields_detected || {},
      last_input_time: payload.last_input_time
        ? new Date(payload.last_input_time).toISOString()
        : null,
      screen_time_seconds: Number.isInteger(payload.screen_time_seconds)
        ? payload.screen_time_seconds
        : 0,
      ext_user_id: payload.ext_user_id || null,
    };

    const sql = `
      INSERT INTO public.site_visits (
        website_id, hostname, path, title,
        category, category_confidence, category_method,
        event_type, fields_detected,
        last_input_time, screen_time_seconds,
        ext_user_id, raw_jsonb, data, created_at, last_visited, visit_count
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9::jsonb,
        $10,$11,
        $12,$13::jsonb,'{}'::jsonb, NOW(), NOW(), 1
      )
      ON CONFLICT (ext_user_id, hostname)
      DO UPDATE SET
        visit_count         = public.site_visits.visit_count + 1,
        last_visited        = NOW(),
        screen_time_seconds = public.site_visits.screen_time_seconds + EXCLUDED.screen_time_seconds,
        path                = EXCLUDED.path,
        title               = EXCLUDED.title,
        category            = COALESCE(EXCLUDED.category, public.site_visits.category),
        category_confidence = COALESCE(EXCLUDED.category_confidence, public.site_visits.category_confidence),
        category_method     = COALESCE(EXCLUDED.category_method, public.site_visits.category_method),
        fields_detected     = COALESCE(EXCLUDED.fields_detected, public.site_visits.fields_detected),
        last_input_time     = COALESCE(EXCLUDED.last_input_time, public.site_visits.last_input_time)
      RETURNING id AS site_visit_id, website_id, last_visited, visit_count, created_at;
    `;

    const params = [
      website_id,
      record.hostname,
      record.path,
      record.title,
      record.category,
      record.category_confidence,
      record.category_method,
      record.event_type,
      JSON.stringify(record.fields_detected),
      record.last_input_time ? new Date(record.last_input_time) : null,
      record.screen_time_seconds,
      record.ext_user_id,
      JSON.stringify(record),
    ];

    const { rows } = await client.query(sql, params);
    const saved = rows[0];

    if (!DISABLE_AUDIT) {
      const auditSql = `
        INSERT INTO public.audit_logs
          (website_id, event_type, ext_user_id, last_input_time, raw_jsonb, created_at)
        VALUES ($1,$2,$3,$4,$5::jsonb, NOW());
      `;
      await client.query(auditSql, [
        website_id,
        record.event_type,
        record.ext_user_id,
        record.last_input_time ? new Date(record.last_input_time) : null,
        JSON.stringify(record),
      ]);
    }

    await client.query("COMMIT");
    return saved;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[insertVisit] ERROR:", e.message || e);
    throw new Error(`[insertVisit] ${e.message || e}`);
  } finally {
    client.release();
  }
}

/* --------------------- Field Submissions --------------------------- */
async function insertFieldSubmission(data) {
  const hostname = normalizeHostname(data.hostname);
  const { rows: wrows } = await pool.query(
    `INSERT INTO public.websites (hostname)
     VALUES ($1)
     ON CONFLICT ((lower(hostname))) DO UPDATE
       SET hostname = EXCLUDED.hostname
     RETURNING id`,
    [normalizeHostname(data.hostname)]
  );

  const websiteId = wrows[0].id;

  let siteVisitId = null;
  if (data.ext_user_id) {
    const r = await pool.query(
      `SELECT id
       FROM public.site_visits
       WHERE website_id = $1 AND ext_user_id = $2
       ORDER BY last_visited DESC
       LIMIT 1`,
      [websiteId, data.ext_user_id]
    );
    siteVisitId = r.rows?.[0]?.id || null;
  }

  const q = `
    INSERT INTO public.field_submissions
      (hostname, website_id, site_visit_id, ext_user_id, fields_detected,
       last_input_time, screen_time_seconds, path, category, category_confidence, category_method,
       created_at, event_type)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), $12)
    RETURNING id;
  `;
  const values = [
    hostname,
    websiteId,
    siteVisitId,
    data.ext_user_id || null,
    data.fields_detected || {},
    data.last_input_time || null,
    Number.isFinite(+data.screen_time_seconds) ? +data.screen_time_seconds : 0,
    data.path || null,
    data.category || null,
    data.category_confidence ?? null,
    data.category_method ?? null,
    data.event_type || "submit",
  ];

  const { rows } = await pool.query(q, values);
  return rows[0];
}

/* ---------------------- Risk assessment helpers --------------------- */
function normalizeRiskInput(risk = {}) {
  const phishing_risk = Number(risk.phishing_risk ?? risk.phishingScore ?? 0);
  const data_risk = Number(risk.data_risk ?? risk.fieldRisk ?? 0);
  const combined_risk_raw =
    risk.combined_risk ?? risk.combinedRisk ?? Math.min(1, (phishing_risk + data_risk) / 2);
  const combined_risk = Number(Number(combined_risk_raw).toFixed(4));
  const risk_score = Number.isFinite(risk.risk_score)
    ? Math.round(Number(risk.risk_score))
    : Math.round(combined_risk * 100);
  const band = risk.band || bandFromPercent(risk_score);

  return {
    phishing_risk: Number(isFinite(phishing_risk) ? phishing_risk.toFixed(4) : 0),
    data_risk: Number(isFinite(data_risk) ? data_risk.toFixed(4) : 0),
    combined_risk,
    risk_score,
    band,
  };
}

async function upsertRiskAssessment({ website_id, hostname, ext_user_id, risk }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wid = website_id || (await ensureWebsiteId({ hostname, client }));
    const nr = normalizeRiskInput(risk || {});

    await client.query(
      `
      INSERT INTO risk_assessments
        (website_id, ext_user_id, phishing_risk, data_risk, combined_risk, risk_score, band, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (website_id, ext_user_id)
      DO UPDATE SET
        phishing_risk = EXCLUDED.phishing_risk,
        data_risk     = EXCLUDED.data_risk,
        combined_risk = EXCLUDED.combined_risk,
        risk_score    = EXCLUDED.risk_score,
        band          = EXCLUDED.band,
        updated_at    = NOW()
      `,
      [wid, ext_user_id, nr.phishing_risk, nr.data_risk, nr.combined_risk, nr.risk_score, nr.band]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getRiskByHostname(hostname) {
  const q = `
    SELECT website_id, ext_user_id, phishing_risk, data_risk,
           combined_risk, risk_score, band, updated_at
    FROM risk_assessments
    WHERE website_id = (SELECT id FROM websites WHERE hostname = $1 LIMIT 1)
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [normalizeHostname(hostname)]);
  return rows[0] || null;
}

/* ---------------------- NEW Risk updater --------------------------- */
async function updateRiskForUserWebsite(ext_user_id, hostname) {
  const websiteId = await ensureWebsiteId({ hostname: normalizeHostname(hostname) });

  // crude proxy for data_risk: number of non-empty submissions
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS submitted_fields
    FROM field_submissions
    WHERE website_id = $1 AND ext_user_id = $2
      AND fields_detected <> '{}'::jsonb
    `,
    [websiteId, ext_user_id]
  );
  const count = rows[0]?.submitted_fields ?? 0;
  const data_risk = Math.min(1, count / 10.0);

  // phishing via classifier (0–1)
  let phishing_risk = 0;
  try {
    const res = await classifyPhishing(hostname);
    const s = Number(res?.phishingScore ?? res?.score ?? 0);
    phishing_risk = Math.max(0, Math.min(1, isFinite(s) ? s : 0));
  } catch (e) {
    console.warn("[updateRiskForUserWebsite] phishing fallback 0:", e.message);
  }

  const combined_risk = Math.min(1, (data_risk + phishing_risk) / 2);
  const risk_score = Math.round(combined_risk * 100);
  const band = bandFromPercent(risk_score);

  await upsertRiskAssessment({
    website_id: websiteId,
    hostname,
    ext_user_id,
    risk: { phishing_risk, data_risk, combined_risk, risk_score, band },
  });
}

/* ------------------------------ Exports --------------------------- */
module.exports = {
  pool,
  ping,
  query,
  withTx,
  ensureBaseline,
  ensureWebsiteId,
  insertVisit,
  insertFieldSubmission,
  upsertRiskAssessment,
  getRiskByHostname,
  updateRiskForUserWebsite,
  coerceDate,
  normalizeHostname,
};
