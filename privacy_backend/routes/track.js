// routes/track.js
const express = require("express");
const router = express.Router();

const Joi = require("joi");
const jwt = require("jsonwebtoken");
const psl = require("psl");
const db = require("../db");
const { requireAuth } = require("../middleware/jwt");

const { detectCategoryForVisit } = require("../services/categorizer");
const { classifyPhishing } = require("../services/phishingModel");
const computeRisk = require("../services/riskScorer"); // returns { phishing_risk,data_risk,combined_risk,risk_score,band }
const { isTracker } = require("../services/blocklist");
// const { calculateTrackerRisk } = require("../services/trackerDetector"); // Removed - not used in new risk calculation

/* ----------------------------- Config ------------------------------ */
const SESSION_TIMEOUT_MINUTES = 30;
const DEV_FALLBACK_EXT = "ext-7edda547-937d-442a-8fb3-65846e5602c9"; // dev only
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
    if (h === "localhost") return "localhost"; // allow dev
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
const safeStr = (v, fb = "") => (typeof v === "string" ? v : fb);
const clampNum = (v, min, max, dflt = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

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
    `SELECT id FROM public.users WHERE ext_user_id = $1 LIMIT 1;`,
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

/* ---------- discover available submitted_* columns (auto-adapts) --- */
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
  hostname: Joi.string().min(1).required(), // may be a hostname or full URL
  main_domain: Joi.string().allow("", null).default(null),
  path: Joi.string().allow("", null).default(""),
  title: Joi.string().allow("", null).default(""),
  category: Joi.string().allow("", null).default("Unknown"),
  category_confidence: Joi.number().allow(null).default(null),
  category_method: Joi.string().allow("", null).default(null),
  fields_detected: Joi.object().unknown(true).default({}), // booleans about seen fields
  last_input_time: Joi.alternatives(Joi.date(), Joi.string()).allow(null),
  screen_time_seconds: Joi.number().integer().min(0).default(0),
  ext_user_id: Joi.string().allow("", null).default(null),
  event_type: Joi.string().allow("", null).default("visit"), // 'visit' | 'visit_end'
}).unknown(false);

/* -------------------------------- VISIT ---------------------------- */
router.post("/visit", async (req, res) => {
  try {
    // 1) Validate
    const { error, value } = visitSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ ok: false, error: error.details?.[0]?.message || "Invalid payload" });
    }

    // 2) Host normalization (accepts full URL)
    const rawHost = value.hostname?.startsWith("http") ? value.hostname : `https://${value.hostname}`;
    const hostname = normalizeHostname(rawHost);
    if (!hostname) return res.status(400).json({ ok: false, error: "Invalid hostname" });

    // Ignore third-party if main_domain present and differs
    const mainCandidate = safeStr(value.main_domain, "") || rawHost;
    const mainDomain = normalizeHostname(mainCandidate);
    if (mainDomain && hostname !== mainDomain) return res.sendStatus(204);

    // Ignore trackers/blocked hosts
    if (isBlocked(hostname)) return res.sendStatus(204);

    // 3) ext_user_id (support Bearer fallback) — dev fallback allowed
    let ext_user_id = safeStr(value.ext_user_id, "");
    if (!ext_user_id) {
      const auth = safeStr(req.headers.authorization, "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
          if (payload?.userId) {
            const { rows } = await db.query(
              "SELECT ext_user_id FROM public.users WHERE id = $1 LIMIT 1;",
              [payload.userId]
            );
            ext_user_id = safeStr(rows?.[0]?.ext_user_id, "");
          }
        } catch { /* ignore */ }
      }
    }
    if (!ext_user_id) ext_user_id = DEV_FALLBACK_EXT; // dev only

    await getOrCreateUserIdByExt(ext_user_id);
    const website_id = await getOrCreateWebsiteId(hostname);

    // 4) Category enrichment (best-effort)
    let category = safeStr(value.category, "") || "Unknown";
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
      } catch { /* keep Unknown */ }
    }

    // 5) Timings & inputs
    const path = safeStr(value.path, "");
    const title = safeStr(value.title, "");
    const incomingTime = clampNum(value.screen_time_seconds, 0, 24 * 3600, 0);
    const last_input_time = value.last_input_time ? new Date(value.last_input_time).toISOString() : null;
    const fields_detected = value && typeof value.fields_detected === "object" ? value.fields_detected : {};

    // 6) End-of-visit aggregation
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
          path,
          title,
          category,
          category_confidence,
          category_method,
          fields_detected,
          incomingTime,
          last_input_time,
        ]
      );
      return res.sendStatus(204);
    }

    // 7) Merge into active session if last visit < SESSION_TIMEOUT_MINUTES
    const dup = await db.query(
      `
      SELECT id, last_visited
        FROM public.site_visits
       WHERE ext_user_id = $1 AND hostname = $2
       ORDER BY last_visited DESC
       LIMIT 1;
      `,
      [ext_user_id, hostname]
    );

    if (dup.rowCount) {
      const last = new Date(dup.rows[0].last_visited).getTime();
      const mins = (Date.now() - last) / 60000;
      if (mins < Number(SESSION_TIMEOUT_MINUTES || 30)) {
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
           WHERE ext_user_id = $8 AND hostname = $9;
          `,
          [
            incomingTime,
            last_input_time,
            path,
            title,
            category,
            category_confidence,
            category_method,
            ext_user_id,
            hostname,
          ]
        );
        // risk update is best-effort below (continue)
      } else {
        // 8) New/expired session upsert
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
            path,
            title,
            category,
            category_confidence,
            category_method,
            fields_detected,
            incomingTime,
            last_input_time,
          ]
        );
      }
    } else {
      // First record for this host/user
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
          path,
          title,
          category,
          category_confidence,
          category_method,
          fields_detected,
          incomingTime,
          last_input_time,
        ]
      );
    }

    /* -------- Risk upsert (best-effort; never blocks main flow) -------- */
    // Run risk calculation asynchronously to avoid blocking the response
    setImmediate(async () => {
      try {
        const ph = await classifyPhishing(hostname);
        const phishingRisk = clampNum(ph?.phishingScore ?? ph?.score ?? 0, 0, 1, 0);

        const riskRaw = (await computeRisk(fields_detected || {}, phishingRisk, hostname)) || {};
        const payload = {
          phishing_risk: Number((riskRaw.phishing_risk ?? phishingRisk) || 0), // 0..1
          data_risk:     Number((riskRaw.data_risk ?? 0) || 0),                // 0..1
          combined_risk: Number((riskRaw.combined_risk ?? 0) || 0),            // 0..1
          risk_score:    Math.min(100, Math.max(0, Math.round(Number(riskRaw.risk_score ?? 0)))), // 0..100
          band:          String(riskRaw.band || "Unknown"),
        };

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
            payload.phishing_risk,
            payload.data_risk,
            payload.combined_risk,
            payload.risk_score,
            payload.band,
          ]
        );
      } catch (e) {
        console.warn("[visit -> risk] non-fatal:", e?.message || e);
      }
    });

    return res.sendStatus(204);
  } catch (err) {
    console.error("[visit] ERROR:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* -------------------------------- SUBMIT --------------------------- */
/**
 * We accept three shapes:
 *  A) explicit submitted_* booleans
 *  B) fields_detected: { name,email,phone,card,address,age,gender,country }
 *  C) fields_union:    { ...same keys... }
 */
const KEYS = ["name", "email", "phone", "card", "address", "age", "gender", "country"];

const submitSchema = Joi.object({
  // accept both spellings in body; either is fine
  extUserId: Joi.string().allow("", null),
  ext_user_id: Joi.string().allow("", null),

  hostname: Joi.string().required(), // may be URL or host
  path: Joi.string().allow("", null),
  title: Joi.string().allow("", null),

  last_input_time: Joi.alternatives(Joi.date().iso(), Joi.string()).allow(null),
  screen_time_seconds: Joi.number().integer().min(0).default(0),
  event_type: Joi.string().allow("", null).default("submit"),
  trigger: Joi.string().allow("", null),

  // A) explicit flags
  submitted_name: Joi.boolean(),
  submitted_email: Joi.boolean(),
  submitted_phone: Joi.boolean(),
  submitted_card: Joi.boolean(),
  submitted_address: Joi.boolean(),
  submitted_age: Joi.boolean(),
  submitted_gender: Joi.boolean(),
  submitted_country: Joi.boolean(),

  // B) fields_detected
  fields_detected: Joi.object(Object.fromEntries(KEYS.map(k => [k, Joi.boolean()]))),

  // C) fields_union
  fields_union: Joi.object(Object.fromEntries(KEYS.map(k => [k, Joi.boolean()]))),

  // category info (optional)
  category: Joi.string().allow("", null),
  category_confidence: Joi.number().allow(null),
  category_method: Joi.string().allow("", null),
}).unknown(false);

router.post("/submit", async (req, res) => {
  try {
    const p = await submitSchema.validateAsync(req.body || {}, { stripUnknown: true });

    // Get ext_user_id from request body or JWT token (fallback for extension compatibility)
    let ext_user_id = safeStr(p.ext_user_id || p.extUserId, "");
    
    // Try to get from JWT token if available
    if (!ext_user_id) {
      const auth = safeStr(req.headers.authorization, "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
          ext_user_id = safeStr(payload?.ext_user_id || payload?.sub, "");
        } catch (e) {
          console.warn("[submit] Invalid JWT token:", e.message);
        }
      }
    }
    
    // Use the same fallback user ID as visit API for consistency
    if (!ext_user_id) ext_user_id = "f5ea28c1-6037-4340-a3dd-bfcbfde2e51d";

    // hostname normalized (accepts URL)
    const rawHost = p.hostname?.startsWith("http") ? p.hostname : `https://${p.hostname}`;
    const hostname = normalizeHostname(rawHost);
    if (!hostname || isBlocked(hostname)) return res.sendStatus(204);

    const user_id = await getOrCreateUserIdByExt(ext_user_id);
    if (!user_id) {
      console.error("[submit] Failed to create/find user for ext_user_id:", ext_user_id);
      return res.status(500).json({ ok: false, error: "User creation failed" });
    }
    
    const website_id = await getOrCreateWebsiteId(hostname);
    if (!website_id) {
      console.error("[submit] Failed to create/find website for hostname:", hostname);
      return res.status(500).json({ ok: false, error: "Website creation failed" });
    }

    // unify flags
    const src =
      (p.fields_union && typeof p.fields_union === "object" && p.fields_union) ||
      (p.fields_detected && typeof p.fields_detected === "object" && p.fields_detected) ||
      {};

    const submitted = {
      submitted_name:    p.submitted_name    ?? !!src.name    ?? false,
      submitted_email:   p.submitted_email   ?? !!src.email   ?? false,
      submitted_phone:   p.submitted_phone   ?? !!src.phone   ?? false,
      submitted_card:    p.submitted_card    ?? !!src.card    ?? false,
      submitted_address: p.submitted_address ?? !!src.address ?? false,
      submitted_age:     p.submitted_age     ?? !!src.age     ?? false,
      submitted_gender:  p.submitted_gender  ?? !!src.gender  ?? false,
      submitted_country: p.submitted_country ?? !!src.country ?? false,
    };

    // if nothing of interest, no-op
    if (!Object.values(submitted).some(Boolean)) return res.sendStatus(204);

    // category enrichment (best-effort)
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

    // basic site_visit linkage (optional, best effort)
    const sv = await db.query(
      `SELECT id FROM public.site_visits
        WHERE website_id=$1 AND ext_user_id=$2
        ORDER BY last_visited DESC LIMIT 1;`,
      [website_id, ext_user_id]
    );
    const site_visit_id = sv.rowCount ? sv.rows[0].id : null;

    // dynamic insert into field_submissions (only existing columns)
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
    if (colsSet.has("title")) { cols.push("title"); vals.push(safeStr(p.title, "")); }
    if (colsSet.has("category")) { cols.push("category"); vals.push(category); }
    if (colsSet.has("category_confidence")) { cols.push("category_confidence"); vals.push(category_confidence); }
    if (colsSet.has("category_method")) { cols.push("category_method"); vals.push(category_method); }
    if (colsSet.has("event_type")) { cols.push("event_type"); vals.push(safeStr(p.event_type, "submit")); }

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO public.field_submissions (${cols.join(",")}) VALUES (${placeholders});`;
    
    try {
      await db.query(sql, vals);
      console.log(`[submit] Successfully inserted field submission for ${hostname}`);
    } catch (dbError) {
      console.error("[submit] Database insert failed:", dbError.message);
      console.error("[submit] SQL:", sql);
      console.error("[submit] Values:", vals);
      return res.status(500).json({ ok: false, error: "Database insert failed" });
    }

    // risk update based on submitted fields (asynchronous to avoid blocking)
    setImmediate(async () => {
      try {
        const ph = await classifyPhishing(hostname);
        const phishingRisk = clampNum(ph?.phishingScore ?? ph?.score ?? 0, 0, 1, 0);
        
        // Tracker risk calculation removed - using exact formula from instructions

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
        
        // Use the exact risk calculation formula
        const risk = computeRisk(flags, phishingRisk, hostname) || {};
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
            Number((risk.phishing_risk ?? phishingRisk) || 0), // 0..1
            Number((risk.data_risk ?? 0) || 0),                // 0..1
            Number((risk.combined_risk ?? 0) || 0),            // 0..1
            Math.min(100, Math.max(0, Math.round(Number(risk.risk_score ?? 0)))), // 0..100
            String(risk.band || "Unknown"),
          ]
        );
        
        // log helpful info once
        const trueKeys = Object.entries(submitted).filter(([, v]) => v).map(([k]) => k).join(", ");
        console.log(`[submit] saved: ${hostname} user:${ext_user_id} flags{ ${trueKeys} } risk:${risk?.risk_score || 0}% (phishing:${(phishingRisk*100).toFixed(1)}% data:${((risk?.data_risk || 0)*100).toFixed(1)}%)`);
      } catch (e) {
        console.warn("[submit] risk update failed:", e?.message || e);
      }
    });

    // Debug: Check if data was actually inserted
    try {
      const check = await db.query(
        `SELECT COUNT(*) as count FROM public.field_submissions 
         WHERE ext_user_id = $1 AND hostname = $2`,
        [ext_user_id, hostname]
      );
      console.log(`[submit] verification: ${check.rows[0]?.count || 0} records for ${hostname}`);
    } catch (e) {
      console.warn(`[submit] verification failed:`, e.message);
    }

    return res.sendStatus(204);
  } catch (err) {
    if (err?.isJoi) {
      console.error("[submit] Validation error:", err.details?.[0]?.message);
      return res.status(400).json({ ok: false, error: err.details?.[0]?.message || "invalid submit payload" });
    }
    console.error("[submit] ERROR", err);
    console.error("[submit] Request body:", req.body);
    console.error("[submit] User:", req.user);
    return res.status(500).json({ ok: false, error: "Internal server error" });
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
        ORDER BY hostname ASC;`,
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
    const extUserId = String(req.query.extUserId || req.query.ext_user_id || "").trim();
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
