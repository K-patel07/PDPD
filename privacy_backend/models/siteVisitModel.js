// models/siteVisitModel.js 
const { pool } = require('../db');

const toInt = v => (v == null || v === '' ? null : Number(v));
const toJsonb = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') { 
    try { return JSON.stringify(JSON.parse(v)); } 
    catch { return null; } 
  }
  return null;
};

/**
 * Get or create a website_id for a hostname
 */
async function getOrCreateWebsiteId(host) {
  if (!host) return null;

  // Try existing hostname
  const sel = await pool.query(
    'SELECT id FROM websites WHERE hostname = $1 LIMIT 1',
    [host]
  );
  if (sel.rowCount) return sel.rows[0].id;

  // Insert new hostname
  const ins = await pool.query(
    `INSERT INTO websites (hostname)
     VALUES ($1)
     ON CONFLICT (hostname) DO UPDATE SET hostname = EXCLUDED.hostname
     RETURNING id`,
    [host]
  );
  return ins.rows[0].id;
}

/**
 * Insert a site visit record
 */
async function insertVisit(p) {
  const userId = toInt(p.user_id);
  if (!userId) throw new Error('MISSING_USER_ID');

  const websiteId = await getOrCreateWebsiteId(p.hostname);
  if (!websiteId) throw new Error('MISSING_WEBSITE_ID');

  const screenSecs = toInt(p.screen_time_seconds);
  const safeScreenSecs = screenSecs == null ? 0 : screenSecs;

  const q = `
    INSERT INTO site_visits
      (user_id, website_id, hostname, path, category, fields_detected,
       last_input_time, screen_time_seconds, ext_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, website_id
  `;
  const vals = [
    userId,
    websiteId,
    p.hostname || null,
    p.path || null,
    p.category || null,
    toJsonb(p.fields_detected),
    p.last_input_time || null,
    safeScreenSecs,
    p.ext_user_id || null
  ];

  const { rows } = await pool.query(q, vals);
  return rows[0]; // return id + website_id (useful for risk_assessments upsert)
}

// ✅ Named exports
module.exports = { insertVisit, getOrCreateWebsiteId };
