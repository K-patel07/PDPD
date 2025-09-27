// services/riskScorer.js

/**
 * Field weights for risk calculation
 */
const fieldWeights = {
  age: 0.05,
  card: 0.8,
  name: 0.1,
  email: 0.2,
  phone: 0.2,
  gender: 0.05,
  address: 0.3,
  country: 0.05,
};

/**
 * Compute field-based risk (0–1)
 */
function computeFieldRisk(fields = {}) {
  let total = 0;
  for (const [key, value] of Object.entries(fields || {})) {
    if (value && fieldWeights[key] != null) {
      total += fieldWeights[key];
    }
  }
  return Math.min(1, total);
}

/**
 * Banding from percent (0–100)
 */
function bandFromPercent(pct) {
  if (pct >= 82) return "Critical";
  if (pct > 60) return "High";
  if (pct > 40) return "Moderate";
  if (pct > 20) return "Low";
  return "Safe";
}

/**
 * Compute combined risk aligned with DB schema
 * Flexible args:
 *   computeRisk(fields, phishingScore, hostname)
 *   OR computeRisk(phishingScore, fields, hostname)
 */
function computeRisk(a, b, c) {
  let fields = {};
  let phishingScore = 0;
  let hostname = null;

  // Support both call styles without breaking callers
  if (typeof a === "number") {
    phishingScore = a;
    fields = b || {};
    hostname = c ?? null;
  } else {
    fields = a || {};
    phishingScore = typeof b === "number" ? b : 0;
    hostname = c ?? null;
  }

  // Normalize phishing score to [0,1]
  const ps = Math.max(0, Math.min(1, Number(phishingScore) || 0));

  const data_risk_num = computeFieldRisk(fields);         // 0–1
  const phishing_risk_num = ps;                           // 0–1
  const combined_risk_num = Math.min(1, (data_risk_num + phishing_risk_num) / 2);

  const risk_score = Math.round(combined_risk_num * 100); // 0–100
  const band = bandFromPercent(risk_score);

  return {
    // === final names used by DB and routes ===
    phishing_risk: Number(phishing_risk_num.toFixed(4)),
    data_risk:     Number(data_risk_num.toFixed(4)),
    combined_risk: Number(combined_risk_num.toFixed(4)),
    risk_score, // integer 0–100
    band,
    // kept for convenience in logs (not stored in DB):
    hostname,
  };
}

module.exports = computeRisk;
