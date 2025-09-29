// services/riskScorer.js

/**
 * Field weights for risk calculation (0-1 scale)
 * Keep these identical to instructions
 */
const fieldWeights = {
  card: 0.80,     // Most sensitive - credit card details
  address: 0.30,  // Medium - physical addresses
  email: 0.20,    // Medium-high - email addresses
  phone: 0.20,    // Medium - phone numbers
  name: 0.10,     // Low-medium - names
  age: 0.05,      // Low - age information
  gender: 0.05,   // Very low - gender
  country: 0.05,  // Very low - country
};

/**
 * Compute field-based risk (0–1)
 * Uses weighted sum of submitted fields
 */
function computeFieldRisk(fields = {}) {
  let total = 0;
  let count = 0;
  
  for (const [key, value] of Object.entries(fields || {})) {
    if (value && fieldWeights[key] != null) {
      total += fieldWeights[key];
      count++;
    }
  }
  
  // If no fields submitted, return 0
  if (count === 0) return 0;
  
  // Return weighted average, capped at 1.0
  return Math.min(1, total);
}

/**
 * Banding from percent (0–100)
 * 0-15: Safe, 16-30: Low, 31-60: Moderate, 61-85: High, 86-100: Critical
 */
function bandFromPercent(pct) {
  if (pct >= 86) return "Critical";  // 86-100
  if (pct >= 61) return "High";      // 61-85
  if (pct >= 31) return "Moderate";  // 31-60
  if (pct >= 16) return "Low";       // 16-30
  return "Safe";                     // 0-15
}

/**
 * Compute combined risk using the exact formula from instructions
 * combined_risk = clamp0to1( (data_risk + phishing_risk) / 2 )
 * risk_score = round( combined_risk * 100 ) → integer [0..100]
 * 
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

  // Normalize scores to [0,1]
  const ps = Math.max(0, Math.min(1, Number(phishingScore) || 0));

  // Calculate individual risk components
  const data_risk_num = computeFieldRisk(fields);         // 0–1
  const phishing_risk_num = ps;                           // 0–1

  // Apply the exact formula: (data_risk + phishing_risk) / 2
  const combined_risk_num = Math.max(0, Math.min(1, (data_risk_num + phishing_risk_num) / 2));

  // Convert to percentage and round
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
