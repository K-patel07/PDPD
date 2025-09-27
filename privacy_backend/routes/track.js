// routes/track.js
const express = require("express");
const router = express.Router();

const Joi = require("joi");
const jwt = require("jsonwebtoken");
const psl = require("psl");

const db = require("../db");
const { detectCategoryForVisit } = require("../services/categorizer");
const { classifyPhishing } = require("../services/phishingModel");
const computeRisk = require("../services/riskScorer");
const { isTracker } = require("../services/blocklist");

/* ----------------------------- Config ------------------------------ */
const SESSION_TIMEOUT_MINUTES = 30;
const BLOCKED_HOSTNAMES = [
  "google.com",
  "gstatic.com",
  "googleusercontent.com",
  "doubleclick.net",
  "googlesyndication.com",
  "adnxs.com",
  "fbcdn.net",
];

/* ----------------------------- Helpers ----------------------------- */
function normalizeHostname(input) {
  if (!input) return null;
  try {
    let h = input;
    if (h.includes("://")) h = new URL(h).hostname;
    h = h.toLowerCase().trim();
    if (h.startsWith("www.")) h = h.slice(4);
    if (h === "localhost") return "localhost"; // dev

    const parsed = psl.parse(h);
    if (!parsed.domain || !parsed.domain.includes(".")) return null;
    return parsed.domain;
  } catch {
    return null;
  }
}
function isBlocked(hostname) {
  if (!hostname) return true;
  if (isTracker(hostname)) return true;
  return BLOCKED_HOSTNAMES.some((b) => hostname.endsWith(b));
}
function safeStr(v, fb = "") {
  return typeof v === "string" ? v : fb;
}

async function getOrCreateWebsiteId(hostname) {
  const host = String(hostname || "").toLowerCase();
  const ins = await db.query(
    `INSERT INTO public.websites (hostname)
     VALUES ($1)
     ON CONFLICT DO NOTHING
     RETURNING id;`,
    [host]
  );
  if (ins.rows[0]?.id) return ins.rows[0].id;
  const sel = await db.query(
    `SELECT id FROM public.websites WHERE lower(hostname) = lower($1) LIMIT 1;`,
    [host]
  );
  return sel.rows[0]?.id;
}
async function getOrCreateUserIdByExt(extUserId) {
  if (!extUserId) return null;
  const sel = await db.query(
    `SELECT id FROM public.users WHERE ext_user_id = $1 LIMIT 1`,
    [extUserId]
  );
  if (sel.rowCount) return sel.rows[0].id;

  const unameSafe = String(extUserId).replace(/[^a-z0-9_-]/gi, "").slice(0, 12) || "user";
  const uname = `ext_${unameSafe}`;
  const email = `${extUserId}@placeholder.local`;
  const ins = await db.query(
    `INSERT INTO public.users (username, email, password_hash, ext_user_id)
     VALUES ($1, $2, 'EXT_AUTOCREATED', $3)
     RETURNING id`,
    [uname, email, extUserId]
  );
  return ins.rows[0].id;
}

/* ---------- discover available submitted_* columns (auto-adapts to DB) ---------- */
const SUBMITTED_COLS = [
  "submitted_name",
  "submitted_email",
  "submitted_phone",
  "submitted_card",
  "submitted_address",
  "submitted_age",
  "submitted_gender",
  "submitted_country",
];
let _fieldSubmissionsColsCache = null;
async function getFieldSubmissionsCols() {
  if (_fieldSubmissionsColsCache) return _fieldSubmissionsColsCache;
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'field_submissions';`
  );
  _fieldSubmissionsColsCache = new Set(rows.map((r) => r.column_name));
  return _fieldSubmissionsColsCache;
}

/* ----------------------------- Schemas ----------------------------- */
const visitSchema = Joi.object({
  hostname: Joi.string().min(1).required(),
  main_domain: Joi.string().allow("", null).default(null),
  path: Joi.string().allow("", null).default(""),
  title: Joi.string().allow("", null).default(""),
  category: Joi.string().allow("", null).default("Unknown"),
  category_confidence: Joi.number().allow(null).default(null),
  category_method: Joi.string().allow("", null).default(null),
  fields_detected: Joi.object().unknown(true).default({}),
  last_input_time: Joi.alternatives(Joi.date(), Joi.string()).allow(null),
  screen_time_seconds: Joi.number().integer().min(0).default(0),
  ext_user_id: Joi.string().allow("", null).default(null),
  event_type: Joi.string().allow("", null).default("visit"),
});

/* -------------------------------- VISIT ---------------------------- */
router.post("/visit", async (req, res) => {
  try {
    const { error, value } = visitSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ ok: false, error: error.details?.[0]?.message });
    }

    const rawHost = value.hostname.startsWith("http") ? value.hostname : `https://${value.hostname}`;
    const hostname = normalizeHostname(rawHost);
    if (!hostname) return res.status(400).json({ ok: false, error: "Invalid hostname" });

    const mainDomain = normalizeHostname(value.main_domain || rawHost);
    if (mainDomain && hostname !== mainDomain) return res.sendStatus(204); // third-party

    if (isBlocked(hostname)) return res.sendStatus(204);

    // resolve ext_user_id
    let ext_user_id = safeStr(value.ext_user_id, "");
    if (!ext_user_id) {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
          if (payload?.userId) {
            const { rows } = await db.query(
              "SELECT ext_user_id FROM public.users WHERE id=$1 LIMIT 1",
              [payload.userId]
            );
            ext_user_id = rows?.[0]?.ext_user_id || "";
          }
        } catch {}
      }
    }
    if (!ext_user_id) ext_user_id = "ext-7edda547-937d-442a-8fb3-65846e5602c9"; // dev

    await getOrCreateUserIdByExt(ext_user_id);
    const website_id = await getOrCreateWebsiteId(hostname);

    // category
    let category = safeStr(value.category, "").trim() || "Unknown";
    let category_confidence = value.category_confidence ?? null;
    let category_method = safeStr(value.category_method, null);
    if (category.toLowerCase() === "unknown") {
      try {
        const det = await detectCategoryForVisit({
          hostname,
          path: safeStr(value.path, ""),
          title: safeStr(value.title, ""),
        });
        category = det?.category || "Unknown";
        category_confidence = det?.confidence ?? null;
        category_method = det?.method ?? null;
      } catch {}
    }

    const incomingTime = Number(value.screen_time_seconds) || 0;
    const last_input_time = value.last_input_time
      ? new Date(value.last_input_time).toISOString()
      : null;

    if (value.event_type === "visit_end") {
      await db.query(
        `
        INSERT INTO public.site_visits
          (website_id, ext_user_id, hostname, path, title,
           category, category_confidence, category_method,
           event_type, fields_detected, screen_time_seconds,
           last_input_time, created_at, last_visited, visit_count)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,
           'visit_end',$9::jsonb,$10,
           $11, NOW(), NOW(), 1)
        ON CONFLICT (ext_user_id, hostname)
        DO UPDATE SET
          screen_time_seconds = site_visits.screen_time_seconds + EXCLUDED.screen_time_seconds,
          last_visited        = NOW(),
          last_input_time     = COALESCE(EXCLUDED.last_input_time, site_visits.last_input_time),
          path                = COALESCE(EXCLUDED.path, site_visits.path),
          title               = COALESCE(EXCLUDED.title, site_visits.title),
          category            = COALESCE(EXCLUDED.category, site_visits.category),
          category_confidence = COALESCE(EXCLUDED.category_confidence, site_visits.category_confidence),
          category_method     = COALESCE(EXCLUDED.category_method, site_visits.category_method),
          fields_detected     = COALESCE(EXCLUDED.fields_detected, site_visits.fields_detected);
      `,
        [
          website_id,
          ext_user_id,
          hostname,
          safeStr(value.path, ""),
          safeStr(value.title, ""),
          category,
          category_confidence,
          category_method,
          value.fields_detected || {},
          incomingTime,
          last_input_time,
        ]
      );
      return res.sendStatus(204);
    }

    const dup = await db.query(
      `SELECT id, last_visited FROM public.site_visits
       WHERE ext_user_id=$1 AND hostname=$2
       ORDER BY last_visited DESC LIMIT 1;`,
      [ext_user_id, hostname]
    );

    if (dup.rowCount) {
      const mins = (Date.now() - new Date(dup.rows[0].last_visited).getTime()) / 60000;
      if (mins < SESSION_TIMEOUT_MINUTES) {
        await db.query(
          `
          UPDATE public.site_visits
             SET screen_time_seconds = site_visits.screen_time_seconds + $1,
                 last_visited        = NOW(),
                 last_input_time     = COALESCE($2, site_visits.last_input_time),
                 path                = COALESCE($3, site_visits.path),
                 title               = COALESCE($4, site_visits.title),
                 category            = COALESCE($5, site_visits.category),
                 category_confidence = COALESCE($6, site_visits.category_confidence),
                 category_method     = COALESCE($7, site_visits.category_method)
           WHERE ext_user_id=$8 AND hostname=$9;
        `,
          [
            incomingTime,
            last_input_time,
            safeStr(value.path, ""),
            safeStr(value.title, ""),
            category,
            category_confidence,
            category_method,
            ext_user_id,
            hostname,
          ]
        );
        return res.sendStatus(204);
      }
    }

    await db.query(
      `
      INSERT INTO public.site_visits
        (website_id, ext_user_id, hostname, path, title,
         category, category_confidence, category_method,
         event_type, fields_detected, screen_time_seconds,
         last_input_time, created_at, last_visited, visit_count)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,
         'visit',$9::jsonb,$10,
         $11, NOW(), NOW(), 1)
      ON CONFLICT (ext_user_id, hostname)
      DO UPDATE SET
        visit_count         = CASE
                                WHEN NOW() - site_visits.last_visited > INTERVAL '30 minutes'
                                THEN site_visits.visit_count + 1
                                ELSE site_visits.visit_count
                              END,
        screen_time_seconds = site_visits.screen_time_seconds + EXCLUDED.screen_time_seconds,
        last_visited        = NOW(),
        last_input_time     = COALESCE(EXCLUDED.last_input_time, site_visits.last_input_time),
        path                = EXCLUDED.path,
        title               = EXCLUDED.title,
        category            = COALESCE(EXCLUDED.category, site_visits.category),
        category_confidence = COALESCE(EXCLUDED.category_confidence, site_visits.category_confidence),
        category_method     = COALESCE(EXCLUDED.category_method, site_visits.category_method),
        fields_detected     = COALESCE(EXCLUDED.fields_detected, site_visits.fields_detected);
    `,
      [
        website_id,
        ext_user_id,
        hostname,
        safeStr(value.path, ""),
        safeStr(value.title, ""),
        category,
        category_confidence,
        category_method,
        value.fields_detected || {},
        incomingTime,
        last_input_time,
      ]
    );

    // risk upsert (non-fatal)
    try {
      const phishingRes = await classifyPhishing(hostname);
      const phishingRisk = Number(phishingRes?.phishingScore ?? phishingRes?.score ?? 0) || 0;
      const fields =
        value?.fields_detected && typeof value.fields_detected === "object"
          ? value.fields_detected
          : {};
      const risk = computeRisk(fields, phishingRisk, hostname);
      await db.query(
        `
        INSERT INTO public.risk_assessments
          (website_id, ext_user_id, phishing_risk, data_risk, combined_risk, risk_score, band, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(), NOW())
        ON CONFLICT (website_id, ext_user_id)
        DO UPDATE SET
          phishing_risk = EXCLUDED.phishing_risk,
          data_risk     = EXCLUDED.data_risk,
          combined_risk = EXCLUDED.combined_risk,
          risk_score    = EXCLUDED.risk_score,
          band          = EXCLUDED.band,
          updated_at    = NOW();
      `,
        [
          website_id,
          ext_user_id,
          risk.phishing_risk || 0,
          risk.data_risk || 0,
          risk.combined_risk || 0,
          risk.risk_score || 0,
          risk.band || "Unknown",
        ]
      );
    } catch (e) {
      console.warn("[visit -> risk] non-fatal error:", e?.message || e);
    }

    return res.sendStatus(204);
  } catch (err) {
    console.error("[visit] ERROR", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* -------------------------------- SUBMIT --------------------------- */
const KEYS = ["name", "email", "phone", "card", "address", "age", "gender", "country"];

const submitA = Joi.object({
  ext_user_id: Joi.string().allow(null, ""),
  hostname: Joi.string().required(),
  path: Joi.string().allow("", null),
  title: Joi.string().allow("", null),
  last_input_time: Joi.alternatives(Joi.date().iso(), Joi.string()).allow(null),
  screen_time_seconds: Joi.number().integer().min(0).default(0),
  event_type: Joi.string().allow("", null).default("submit"),
  trigger: Joi.string().allow("", null),

  submitted_name: Joi.boolean().default(false),
  submitted_email: Joi.boolean().default(false),
  submitted_phone: Joi.boolean().default(false),
  submitted_card: Joi.boolean().default(false),
  submitted_address: Joi.boolean().default(false),
  submitted_age: Joi.boolean().default(false),
  submitted_gender: Joi.boolean().default(false),
  submitted_country: Joi.boolean().default(false),

  category: Joi.string().allow("", null),
  category_confidence: Joi.number().allow(null),
  category_method: Joi.string().allow("", null),
}).unknown(false);

const submitB = Joi.object({
  ext_user_id: Joi.string().allow(null, ""),
  hostname: Joi.string().required(),
  path: Joi.string().allow("", null),
  title: Joi.string().allow("", null),
  last_input_time: Joi.alternatives(Joi.date().iso(), Joi.string()).allow(null),
  screen_time_seconds: Joi.number().integer().min(0).default(0),
  event_type: Joi.string().allow("", null).default("submit"),
  trigger: Joi.string().allow("", null),
  fields_detected: Joi.object(
    Object.fromEntries(KEYS.map((k) => [k, Joi.boolean()]))
  ).required(),
  category: Joi.string().allow("", null),
  category_confidence: Joi.number().allow(null),
  category_method: Joi.string().allow("", null),
}).unknown(false);

const submitSchema = Joi.alternatives().try(submitA, submitB);

router.post("/submit", async (req, res) => {
  try {
    const p = await submitSchema.validateAsync(req.body, { stripUnknown: true });

    const submitted = {
      submitted_name: p.submitted_name ?? p.fields_detected?.name ?? false,
      submitted_email: p.submitted_email ?? p.fields_detected?.email ?? false,
      submitted_phone: p.submitted_phone ?? p.fields_detected?.phone ?? false,
      submitted_card: p.submitted_card ?? p.fields_detected?.card ?? false,
      submitted_address: p.submitted_address ?? p.fields_detected?.address ?? false,
      submitted_age: p.submitted_age ?? p.fields_detected?.age ?? false,
      submitted_gender: p.submitted_gender ?? p.fields_detected?.gender ?? false,
      submitted_country: p.submitted_country ?? p.fields_detected?.country ?? false,
    };
    const anyTrue = Object.values(submitted).some(Boolean);
    if (!anyTrue) return res.sendStatus(204);

    const hostname = normalizeHostname(
      p.hostname?.startsWith("http") ? p.hostname : `https://${p.hostname}`
    );
    if (!hostname || isBlocked(hostname)) return res.sendStatus(204);

    const ext_user_id = p.ext_user_id || "ext-7edda547-937d-442a-8fb3-65846e5602c9";
    await getOrCreateUserIdByExt(ext_user_id);
    const website_id = await getOrCreateWebsiteId(hostname);

    // Link to latest site_visit
    const sv = await db.query(
      `SELECT id FROM public.site_visits
        WHERE website_id=$1 AND ext_user_id=$2
        ORDER BY last_visited DESC LIMIT 1`,
      [website_id, ext_user_id]
    );
    const site_visit_id = sv.rowCount ? sv.rows[0].id : null;

    // Category (detect if Unknown)
    let category = safeStr(p.category, "") || "Unknown";
    let category_confidence = p.category_confidence ?? null;
    let category_method = safeStr(p.category_method, null);
    if (category.toLowerCase() === "unknown") {
      try {
        const det = await detectCategoryForVisit({
          hostname,
          path: safeStr(p.path, ""),
          title: safeStr(p.title, ""),
        });
        category = det?.category || "Unknown";
        category_confidence = det?.confidence ?? null;
        category_method = det?.method ?? null;
      } catch {}
    }

    // Build dynamic INSERT based on actual table cols
    const colsSet = await getFieldSubmissionsCols();
    const cols = ["hostname", "website_id", "site_visit_id", "ext_user_id"];
    const vals = [hostname, website_id, site_visit_id, ext_user_id];

    for (const c of SUBMITTED_COLS) {
      if (colsSet.has(c)) {
        cols.push(c);
        vals.push(!!submitted[c]);
      }
    }
    if (colsSet.has("last_input_time")) {
      cols.push("last_input_time");
      vals.push(p.last_input_time ? new Date(p.last_input_time).toISOString() : null);
    }
    if (colsSet.has("screen_time_seconds")) {
      cols.push("screen_time_seconds");
      vals.push(Number(p.screen_time_seconds) || 0);
    }
    if (colsSet.has("path")) { cols.push("path"); vals.push(safeStr(p.path, "")); }
    if (colsSet.has("category")) { cols.push("category"); vals.push(category); }
    if (colsSet.has("category_confidence")) { cols.push("category_confidence"); vals.push(category_confidence); }
    if (colsSet.has("category_method")) { cols.push("category_method"); vals.push(category_method); }
    if (colsSet.has("event_type")) { cols.push("event_type"); vals.push(safeStr(p.event_type, "submit")); }

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO public.field_submissions (${cols.join(",")}) VALUES (${placeholders});`;
    await db.query(sql, vals);

    // Helpful debug log: which flags were true
    const trueKeys = Object.entries(submitted).filter(([_, v]) => v).map(([k]) => k).join(", ");
    console.log(`[submit] saved: ${hostname} user:${ext_user_id} flags{ ${trueKeys} }`);

    // Risk upsert
    try {
      const phishingRes = await classifyPhishing(hostname);
      const phishingRisk = Number(phishingRes?.phishingScore ?? phishingRes?.score ?? 0) || 0;
      const flags = {
        name: submitted.submitted_name,
        email: submitted.submitted_email,
        phone: submitted.submitted_phone,
        card: submitted.submitted_card,
        address: submitted.submitted_address,
        age: submitted.submitted_age,
        gender: submitted.submitted_gender,
        country: submitted.submitted_country,
      };
      const risk = computeRisk(flags, phishingRisk, hostname);
      await db.query(
        `
        INSERT INTO public.risk_assessments
          (website_id, ext_user_id, phishing_risk, data_risk, combined_risk, risk_score, band, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(), NOW())
        ON CONFLICT (website_id, ext_user_id)
        DO UPDATE SET
          phishing_risk = EXCLUDED.phishing_risk,
          data_risk     = EXCLUDED.data_risk,
          combined_risk = EXCLUDED.combined_risk,
          risk_score    = EXCLUDED.risk_score,
          band          = EXCLUDED.band,
          updated_at    = NOW();
      `,
        [
          website_id,
          ext_user_id,
          risk.phishing_risk || 0,
          risk.data_risk || 0,
          risk.combined_risk || 0,
          risk.risk_score || 0,
          risk.band || "Unknown",
        ]
      );
      console.log(
        "[submit] risk updated:",
        hostname,
        "user:",
        ext_user_id,
        "score:",
        (risk.risk_score || 0) + "%"
      );
    } catch (e) {
      console.warn("[submit] risk update failed:", e?.message || e);
    }

    return res.sendStatus(204);
  } catch (err) {
    if (err?.isJoi) {
      return res.status(400).json({ error: err.details?.[0]?.message || "invalid submit payload" });
    }
    console.error("[submit] ERROR", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ---------------------- Simple category listing -------------------- */
router.get("/category/:name", async (req, res) => {
  try {
    const categoryName = decodeURIComponent(req.params.name);
    const { rows } = await db.query(
      `SELECT MIN(id) as id, hostname, MAX(created_at) as created_at
         FROM public.site_visits
        WHERE category = $1
        GROUP BY hostname
        ORDER BY hostname ASC`,
      [categoryName]
    );
    res.json(rows);
  } catch (err) {
    console.error("[getCategoryVisits] ERROR", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* -------------------------- Sites by category ---------------------- */
router.get("/sites", async (req, res, next) => {
  try {
    const extUserId = String(req.query.extUserId || "").trim();
    const category = String(req.query.category || "").trim();
    if (!extUserId || !category) {
      return res.status(400).json({ ok: false, error: "extUserId and category are required" });
    }

    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const key = norm(category);
    const SYN = {
      "social media": ["social media", "social", "social-media", "social_media"],
      "e commerce": ["e commerce", "e-commerce", "ecommerce", "e_commerce"],
      productivity: ["productivity", "work"],
      others: ["others", "other", "misc", "miscellaneous"],
      news: ["news", "news & blogs", "blogs", "blog"],
      entertainment: ["entertainment", "movies", "movies & tv", "video"],
      education: ["education"],
      finance: ["finance"],
      health: ["health"],
      travel: ["travel"],
      sports: ["sports"],
    };
    const accepted = (SYN[key] || [category]).map(norm);

    const sql = `
  WITH v AS (
    SELECT
      REGEXP_REPLACE(LOWER(COALESCE(sv.hostname,'')), '^www\\.', '') AS host,
      sv.website_id,
      sv.category,
      COALESCE(sv.visit_count, 0)         AS vc,
      COALESCE(sv.screen_time_seconds, 0) AS st,
      sv.last_visited,
      sv.created_at
    FROM site_visits sv
    WHERE sv.ext_user_id = $1
      AND LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(COALESCE(sv.category,''), '[_-]+', ' ', 'g'),
              '\\s+', ' ', 'g'
            )
          ) = ANY($2::text[])
  ),
  agg AS (
    SELECT
      host,
      MIN(website_id)                                  AS website_id,
      MAX(COALESCE(last_visited, created_at))          AS last_visited,
      SUM(vc)::int                                     AS visit_counts,
      SUM(st)::int                                     AS screen_time_seconds
    FROM v
    GROUP BY host
  )
  SELECT
    host AS hostname,
    website_id,
    to_char(last_visited AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastVisitISO",
    visit_counts        AS "visitCounts",
    screen_time_seconds AS "screenTimeSeconds"
  FROM agg
  ORDER BY host ASC;
`;


    const { rows } = await db.query(sql, [extUserId, accepted]);
    return res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
