// services/riskScorer.js

/**
 * Field weights for risk calculation (0-1 scale)
 * Higher weights = more sensitive data = higher risk
 */
const fieldWeights = {
  card: 0.9,      // Most sensitive - credit card details
  password: 0.8,  // High sensitivity - passwords
  email: 0.4,     // Medium-high - email addresses
  phone: 0.3,     // Medium - phone numbers
  address: 0.25,  // Medium - physical addresses
  name: 0.15,     // Low-medium - names
  age: 0.1,       // Low - age information
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
 */
function bandFromPercent(pct) {
  if (pct >= 82) return "Critical";
  if (pct > 60) return "High";
  if (pct > 40) return "Moderate";
  if (pct > 20) return "Low";
  return "Safe";
}

/**
 * Compute combined risk using the proper weighted formula
 * RiskRaw = (0.6 * PhishingScore) + (0.35 * FieldRisk) + (0.05 * TrackerFlag)
 * RiskPct = clamp(round(RiskRaw * 100), 0, 100)
 * 
 * Flexible args:
 *   computeRisk(fields, phishingScore, hostname, trackerRisk)
 *   OR computeRisk(phishingScore, fields, hostname, trackerRisk)
 */
function computeRisk(a, b, c, d) {
  let fields = {};
  let phishingScore = 0;
  let hostname = null;
  let trackerRisk = 0;

  // Support both call styles without breaking callers
  if (typeof a === "number") {
    phishingScore = a;
    fields = b || {};
    hostname = c ?? null;
    trackerRisk = d ?? 0;
  } else {
    fields = a || {};
    phishingScore = typeof b === "number" ? b : 0;
    hostname = c ?? null;
    trackerRisk = d ?? 0;
  }

  // Normalize scores to [0,1]
  const ps = Math.max(0, Math.min(1, Number(phishingScore) || 0));
  const tr = Math.max(0, Math.min(1, Number(trackerRisk) || 0));

  // Calculate individual risk components
  const data_risk_num = computeFieldRisk(fields);         // 0–1
  const phishing_risk_num = ps;                           // 0–1
  const tracker_risk_num = tr;                            // 0–1

  // Apply the weighted formula: 60% phishing + 35% fields + 5% trackers
  const riskRaw = (0.6 * phishing_risk_num) + (0.35 * data_risk_num) + (0.05 * tracker_risk_num);
  const combined_risk_num = Math.max(0, Math.min(1, riskRaw));

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
    tracker_risk: Number(tracker_risk_num.toFixed(4)),
  };
}

module.exports = computeRisk;
