// services/phishingModel.js
// Robust phishing scorer with normalization + flexible response parsing (Node 18+)

const psl = require("psl");

const PHISHING_API_URL =
  process.env.PHISHING_API_URL || "http://127.0.0.1:8000/phishing";
const LOG_PHISHING =
  String(process.env.LOG_PHISHING || "").toLowerCase() === "true";

/** Normalize input (hostname or URL) to a full https:// URL */
function toUrl(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return null;

  // Already a URL?
  if (s.includes("://")) {
    try {
      return new URL(s).toString();
    } catch {
      /* fall through and treat as hostname */
    }
  }

  // Treat as hostname: strip accidental bits, reduce to registrable domain
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  try {
    const parsed = psl.parse(s);
    const domain = parsed.domain || s;
    return `https://www.${domain}/`;
  } catch {
    return null;
  }
}

/** Extract a numeric phishing probability [0..1] from various response shapes */
function extractScore(data) {
  if (!data || typeof data !== "object") return 0;

  const phishRe = /(phish|malicious|scam|fraud|attack|spam)/i;
  const benignRe = /(benign|legit|ham|safe|clean|non[-_ ]?phish)/i;
  const label1Re = /(?:^|_)1$/; // LABEL_1 often = positive (phishing)
  const label0Re = /(?:^|_)0$/;

  const scoreFromLabel = (label, score) => {
    const v = Number(score) || 0;
    if (phishRe.test(label)) return v;          // "phish" → use as-is
    if (benignRe.test(label)) return 1 - v;     // "benign" → invert
    if (label1Re.test(label)) return v;         // LABEL_1 → phishing
    if (label0Re.test(label)) return 1 - v;     // LABEL_0 → invert
    // Unknown label: assume score is for predicted class; take as-is
    return v;
  };

  // 1) { result: [...] }
  if (Array.isArray(data.result)) {
    const arr = data.result;

    // Prefer an explicit phishing entry if present
    const phishEntry = arr.find(
      (r) => r && typeof r.label === "string" && phishRe.test(r.label)
    );
    if (phishEntry) return Number(phishEntry.score) || 0;

    // If only benign is present (top-1 output), invert it
    const benignEntry = arr.find(
      (r) => r && typeof r.label === "string" && benignRe.test(r.label)
    );
    if (benignEntry && arr.length === 1) return 1 - (Number(benignEntry.score) || 0);

    // LABEL_1 / LABEL_0 mapping
    const lab1 = arr.find(
      (r) => r && typeof r.label === "string" && label1Re.test(r.label)
    );
    const lab0 = arr.find(
      (r) => r && typeof r.label === "string" && label0Re.test(r.label)
    );
    if (lab1) return Number(lab1.score) || 0;
    if (lab0 && arr.length === 1) return 1 - (Number(lab0.score) || 0);

    // Fallback: take the max and infer by label
    const max = arr.reduce(
      (a, b) => ((a?.score || 0) >= (b?.score || 0) ? a : b),
      null
    );
    if (max && typeof max.label === "string") {
      return scoreFromLabel(max.label, max.score);
    }
    return Number(max?.score) || 0;
  }

  // 2) Single object with label/score
  if (typeof data.label === "string" && typeof data.score === "number") {
    return scoreFromLabel(data.label, data.score);
  }

  // 3) Plain numeric score (assume it's already phishing probability)
  if (typeof data.score === "number") return data.score;
  if (typeof data.probability === "number") return data.probability;

  // 4) Sometimes wrapped deeper
  if (data.output && typeof data.output.score === "number") return data.output.score;

  return 0;
}

/** Small allowlist clamp to avoid noisy false-positives for well-known legit domains */
const SAFE_DOMAINS = new Set([
  "google.com",
  "youtube.com",
  "microsoft.com",
  "apple.com",
  "github.com",
  "cloudflare.com",
  "figma.com",
  "openai.com",
  "amazon.com",
  "linkedin.com",
  "binge.com.au", // you mentioned Binge misflags
]);

function clampForAllowlist(urlString, score) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.replace(/^www\./, "");
    const parsed = psl.parse(host);
    const domain = parsed.domain || host;

    // If it's allowlisted and the model isn't near-certain, clamp to a low risk
    if (SAFE_DOMAINS.has(domain) && score < 0.99) {
      return Math.min(score, 0.15);
    }
  } catch {
    /* ignore */
  }
  return score;
}

/** Fetch with timeout (AbortController) */
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: ac.signal });
    const ok = resp.ok;
    let json = null;
    try {
      json = await resp.json();
    } catch {
      // if non-JSON, keep as null
    }
    return { ok, status: resp.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Main function */
async function classifyPhishing(input) {
  try {
    const url = toUrl(input);
    if (!url) {
      return { phishingScore: 0.0, ok: false, error: "Invalid URL/hostname" };
    }

    const { ok, status, json } = await fetchJsonWithTimeout(
      PHISHING_API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      },
      8000
    );

    if (!ok) {
      const msg = `Python service ${status}`;
      if (LOG_PHISHING) console.warn("[phishingModel] Service error:", msg);
      return { phishingScore: 0.0, ok: false, error: msg, url };
    }

    let score = extractScore(json);
    score = clampForAllowlist(url, score);
    score = Math.max(0, Math.min(1, Number(score))); // [0..1]
    const final = Number(score.toFixed(4));

    // Helpful logs
    console.log("[phishingModel] URL:", url);
    console.log(
      "[phishingModel] Raw score:",
      Array.isArray(json?.result) ? json.result : (json?.score ?? json)
    );
    console.log("[phishingModel] Final phishingScore:", final);

    return { phishingScore: final, ok: true, url };
  } catch (err) {
    console.error("[phishingModel] Error:", err.message);
    return { phishingScore: 0.0, ok: false, error: err.message };
  }
}

module.exports = { classifyPhishing };
