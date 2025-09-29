// services/riskHelper.js

/**
 * Convert a risk percentage (0–100) into a band label
 * (Keep this in sync with riskScorer.js)
 */
function bandFromPercent(pct) {
  pct = Number(pct) || 0;
  if (pct >= 86) return "Critical";  // 86-100
  if (pct >= 61) return "High";      // 61-85
  if (pct >= 31) return "Moderate";  // 31-60
  if (pct >= 16) return "Low";       // 16-30
  return "Safe";                     // 0-15
}

/**
 * Get the latest risk row by hostname (optionally for a specific user)
 * @param {object} db - expects { pool } (pg Pool)
 * @param {string} hostname
 * @param {object} [opts] - optional filters, e.g. { ext_user_id: 'abc123' }
 * @returns {Promise<object|null>}
 */
async function getRiskRowByHostname(db, hostname, opts = {}) {
  if (!db?.pool) throw new Error("db.pool required");
  if (!hostname || typeof hostname !== "string") return null;

  const args = [hostname.toLowerCase()];
  let userFilter = "";
  if (opts.ext_user_id) {
    args.push(String(opts.ext_user_id));
    userFilter = `AND r.ext_user_id = $2`;
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
    ${userFilter}
    ORDER BY r.updated_at DESC
    LIMIT 1
    `,
    args
  );

  const row = rows[0];
  if (!row) return null;

  // Normalize numeric fields and fill derived values
  const phishing_risk = Number(row.phishing_risk || 0);
  const data_risk     = Number(row.data_risk || 0);
  const combined_risk = Number(row.combined_risk || 0);
  const risk_score    = Number.isFinite(row.risk_score)
    ? Number(row.risk_score)
    : Math.round(combined_risk * 100);
  const band          = row.band || bandFromPercent(risk_score);

  return {
    ...row,
    phishing_risk,
    data_risk,
    combined_risk,
    risk_score,
    band,
  };
}

module.exports = {
  bandFromPercent,
  getRiskRowByHostname,
};
