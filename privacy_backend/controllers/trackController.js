// controllers/trackController.js
const { pool, insertFieldSubmission } = require('../db');
const { insertVisit } = require('../models/siteVisitModel');
const computeRisk = require("../services/riskScorer");       // returns { phishing_risk, data_risk, combined_risk, risk_score, band }
const { bandFromPercent } = require('../services/riskHelper'); // kept for compatibility (we primarily use risk.band)

/* ------------------ User Helper ------------------ */
async function getOrCreateUserIdByExt(extUserId) {
  if (!extUserId) return 1; // fallback for testing
  const sel = await pool.query(
    'SELECT id FROM users WHERE ext_user_id = $1 LIMIT 1',
    [extUserId]
  );
  if (sel.rowCount) return sel.rows[0].id;

  const ins = await pool.query(
    'INSERT INTO users (ext_user_id) VALUES ($1) RETURNING id',
    [extUserId]
  );
  return ins.rows[0].id;
}

/* ------------------ Normalize Payload ------------------ */
function normalizePayload(raw) {
  const p = raw || {};

  if (!p.hostname || typeof p.hostname !== 'string') {
    return { error: 'MISSING_HOSTNAME' };
  }

  if (p.path != null && typeof p.path !== 'string') p.path = String(p.path);
  if (p.category != null && typeof p.category !== 'string') p.category = String(p.category);

  // fields_detected normalization
  if (typeof p.fields_detected === 'string') {
    try { p.fields_detected = JSON.parse(p.fields_detected); } catch { p.fields_detected = {}; }
  }
  if (typeof p.fields_detected !== 'object' || p.fields_detected == null) {
    p.fields_detected = {};
  }

  // last_input_time normalization
  if (p.last_input_time && typeof p.last_input_time !== 'string') {
    try { p.last_input_time = new Date(p.last_input_time).toISOString(); } catch { p.last_input_time = null; }
  }

  // screen_time normalization
  if (p.screen_time_seconds != null) {
    const n = Number(p.screen_time_seconds);
    p.screen_time_seconds = Number.isFinite(n) ? n : 0;
  }

  // ext_user_id normalization
  if (p.ext_user_id != null && typeof p.ext_user_id !== 'string') {
    p.ext_user_id = String(p.ext_user_id);
  }

  return { p };
}

/* ------------------ Visit Handler ------------------ */
exports.createVisit = async (req, res) => {
  try {
    console.log('[createVisit] body:', req.body);

    const { p, error } = normalizePayload(req.body);
    if (error) return res.status(400).json({ ok: false, error });

    // Resolve user (ensures users.id exists for triggers/joins)
    p.user_id = await getOrCreateUserIdByExt(p.ext_user_id);

    // Insert/Upsert visit (site_visits upsert is handled inside the model)
    const visit = await insertVisit(p); // must return { id, website_id, ... }

    // Compute risk (no phishing score here → 0). Supports both call styles.
    // Prefer fields-first style: computeRisk(fields, phishingScore, hostname)
    const risk = computeRisk(p.fields_detected, 0, p.hostname);
    const finalBand = risk?.band ?? bandFromPercent(risk?.risk_score ?? 0);

    // Save/Upsert risk (one row per user+website)
    await pool.query(
      `
      INSERT INTO risk_assessments
        (website_id, ext_user_id, phishing_risk, data_risk, combined_risk, risk_score, band, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, now(), now())
      ON CONFLICT ON CONSTRAINT ux_risk_user_site
      DO UPDATE SET
        phishing_risk = EXCLUDED.phishing_risk,
        data_risk     = EXCLUDED.data_risk,
        combined_risk = EXCLUDED.combined_risk,
        risk_score    = EXCLUDED.risk_score,
        band          = EXCLUDED.band,
        updated_at    = now();
      `,
      [
        visit.website_id,           // $1
        p.ext_user_id,              // $2
        risk.phishing_risk || 0,    // $3
        risk.data_risk || 0,        // $4
        risk.combined_risk || 0,    // $5
        risk.risk_score || 0,       // $6
        finalBand || 'Unknown',     // $7
      ]
    );

    console.log("[visit -> risk] upserted:", p.hostname, {
      phishing: risk.phishing_risk,
      data: risk.data_risk,
      combined: risk.combined_risk,
      score: `${risk.risk_score}%`,
      band: finalBand
    });

    return res.status(201).json({ ok: true, visit, risk });
  } catch (e) {
    console.error('[createVisit][ERROR]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};

/* ------------------ Beacon Visit Handler ------------------ */
exports.beaconVisit = async (req, res) => {
  try {
    const rawText = typeof req.body === 'string' ? req.body : '';
    console.log('[beaconVisit] raw text:', rawText?.slice(0, 500));

    let parsed = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      return res.status(400).json({ ok: false, error: 'BAD_JSON' });
    }

    const { p, error } = normalizePayload(parsed);
    if (error) return res.status(400).json({ ok: false, error });

    // ensure user exists
    p.user_id = await getOrCreateUserIdByExt(p.ext_user_id);

    // write visit
    const visit = await insertVisit(p);

    // compute risk from this beacon payload
    const risk = computeRisk(p.fields_detected, 0, p.hostname);
    const finalBand = risk?.band ?? bandFromPercent(risk?.risk_score ?? 0);

    // upsert risk
    await pool.query(
      `
      INSERT INTO risk_assessments
        (website_id, ext_user_id, phishing_risk, data_risk, combined_risk, risk_score, band, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, now(), now())
      ON CONFLICT ON CONSTRAINT ux_risk_user_site
      DO UPDATE SET
        phishing_risk = EXCLUDED.phishing_risk,
        data_risk     = EXCLUDED.data_risk,
        combined_risk = EXCLUDED.combined_risk,
        risk_score    = EXCLUDED.risk_score,
        band          = EXCLUDED.band,
        updated_at    = now();
      `,
      [
        visit.website_id,
        p.ext_user_id,
        risk.phishing_risk || 0,
        risk.data_risk || 0,
        risk.combined_risk || 0,
        risk.risk_score || 0,
        finalBand || 'Unknown',
      ]
    );

    return res.status(201).json({ ok: true, visit, risk });
  } catch (e) {
    console.error('[beaconVisit][ERROR]', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
};

/* ------------------ Get Visits ------------------ */
exports.getVisits = async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT hostname, category, created_at FROM site_visits ORDER BY created_at DESC"
    );
    return res.json(result.rows);
  } catch (e) {
    console.error("[getVisits][ERROR]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
};
