// services/phishingModel.js
// Robust phishing scorer: URL normalization, flexible response parsing,
// retries with exponential backoff, API key support, timeouts, and allowlist clamp.
// Node 18+ (built-in fetch)

const psl = require("psl");

/* ============================== Config ============================== */
const PH_API_URL = process.env.PHISHING_API_URL || "http://127.0.0.1:8000/phishing";
const PH_API_KEY = process.env.PHISHING_API_KEY || "";
const PH_ENABLED = String(process.env.PHISHING_ENABLED ?? "true").toLowerCase() === "true";
const LOG_PHISH  = String(process.env.LOG_PHISHING || "").toLowerCase() === "true";

// Milliseconds
const CONNECT_TIMEOUT_MS = Number(process.env.PHISHING_CONNECT_TIMEOUT_MS || 1500); // connect
const READ_TIMEOUT_MS    = Number(process.env.PHISHING_READ_TIMEOUT_MS || 2500);    // read
const TOTAL_TIMEOUT_MS   = Math.max(READ_TIMEOUT_MS, Number(process.env.PHISHING_TIMEOUT_MS || 4000)); // overall
const RETRIES            = Math.max(0, Number(process.env.PHISHING_RETRIES || 2));

/* ========================== URL Normalization ========================== */
/** Normalize input (hostname or URL) to a full https:// URL */
function toUrl(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return null;

  // Already a URL?
  if (s.includes("://")) {
    try { return new URL(s).toString(); } catch { /* fall through */ }
  }

  // Treat as hostname: strip accidental bits, reduce to registrable domain
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  try {
    const parsed = psl.parse(s);
    const domain = parsed.domain || s;
    // Prefer https + www for consistency; trailing slash avoids path concatenation issues
    return `https://www.${domain}/`;
  } catch {
    return null;
  }
}

/* ======================== Response Score Parsing ======================== */
/** Extract a numeric phishing probability [0..1] from various response shapes */
function extractScore(data) {
  if (!data || typeof data !== "object") return 0;

  const phishRe   = /(phish|malicious|scam|fraud|attack|spam)/i;
  const benignRe  = /(benign|legit|ham|safe|clean|non[-_ ]?phish)/i;
  const label1Re  = /(?:^|_)1$/; // LABEL_1 often = positive (phishing)
  const label0Re  = /(?:^|_)0$/;

  const scoreFromLabel = (label, score) => {
    const v = Number(score) || 0;
    if (phishRe.test(label))  return v;          // "phish" → use as-is
    if (benignRe.test(label)) return 1 - v;      // "benign" → invert
    if (label1Re.test(label)) return v;          // LABEL_1 → phishing
    if (label0Re.test(label)) return 1 - v;      // LABEL_0 → invert
    return v;                                    // unknown label → trust score
  };

  // 1) { result: [...] }
  if (Array.isArray(data.result)) {
    const arr = data.result;

    const phishEntry = arr.find(r => r && typeof r.label === "string" && phishRe.test(r.label));
    if (phishEntry) return Number(phishEntry.score) || 0;

    const benignEntry = arr.find(r => r && typeof r.label === "string" && benignRe.test(r.label));
    if (benignEntry && arr.length === 1) return 1 - (Number(benignEntry.score) || 0);

    const lab1 = arr.find(r => r && typeof r.label === "string" && label1Re.test(r.label));
    const lab0 = arr.find(r => r && typeof r.label === "string" && label0Re.test(r.label));
    if (lab1) return Number(lab1.score) || 0;
    if (lab0 && arr.length === 1) return 1 - (Number(lab0.score) || 0);

    const max = arr.reduce((a, b) => ((a?.score || 0) >= (b?.score || 0) ? a : b), null);
    if (max && typeof max.label === "string") return scoreFromLabel(max.label, max.score);
    return Number(max?.score) || 0;
  }

  // 2) Single object with label/score
  if (typeof data.label === "string" && typeof data.score === "number") {
    return scoreFromLabel(data.label, data.score);
  }

  // 3) Plain numeric score fields
  if (typeof data.score === "number")       return data.score;
  if (typeof data.probability === "number") return data.probability;

  // 4) Wrapped deeper
  if (data.output && typeof data.output.score === "number") return data.output.score;

  return 0;
}

/* ============================ Allowlist Clamp ============================ */
/** Small allowlist clamp to avoid noisy false-positives for well-known legit domains */
const SAFE_DOMAINS = new Set([
  "google.com","youtube.com","microsoft.com","apple.com","github.com","cloudflare.com",
  "figma.com","openai.com","amazon.com","linkedin.com","binge.com.au",
]);

function clampForAllowlist(urlString, score) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.replace(/^www\./, "");
    const parsed = psl.parse(host);
    const domain = parsed.domain || host;
    if (SAFE_DOMAINS.has(domain) && score < 0.99) return Math.min(score, 0.15);
  } catch { /* ignore */ }
  return score;
}

/* ============================== Fetch Helpers ============================== */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Fetch JSON with overall timeout; optional connect/read split via AbortController */
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = TOTAL_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: ac.signal });
    let json = null;
    try { json = await resp.json(); } catch { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON with retries + exponential backoff + jitter */
async function postJsonWithRetry(url, body, retries = RETRIES, timeoutMs = TOTAL_TIMEOUT_MS) {
  const headers = { "Content-Type": "application/json" };
  if (PH_API_KEY) headers.Authorization = `Bearer ${PH_API_KEY}`;

  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      const res = await fetchJsonWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, timeoutMs);

      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      // Retry on 5xx & 429; don't retry on 4xx (except 408)
      if (!(res.status >= 500 || res.status === 429 || res.status === 408)) break;
    } catch (e) {
      lastErr = e;
    }
    attempt += 1;
    if (attempt > retries) break;
    const backoff = Math.min(800, 150 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 80);
    await sleep(backoff);
  }
  throw lastErr || new Error("unknown fetch error");
}

/* ============================== Public API ============================== */
/**
 * classifyPhishing(input) → { ok, phishingScore, url, label, model, error? }
 * - input: hostname or URL
 * - always returns a result; never throws
 */
async function classifyPhishing(input) {
  try {
    if (!PH_ENABLED) {
      if (LOG_PHISH) console.log("[phishingModel] disabled");
      return { ok: true, phishingScore: 0, url: null, label: "disabled", model: "phishing-off" };
    }

    const url = toUrl(input);
    if (!url) return { ok: false, phishingScore: 0, error: "Invalid URL/hostname" };

    const { ok, status, json } = await postJsonWithRetry(PH_API_URL, { url }, RETRIES, TOTAL_TIMEOUT_MS);

    if (!ok) {
      const msg = `Python service error: ${status}`;
      if (LOG_PHISH) console.warn("[phishingModel]", msg);
      return { ok: false, phishingScore: 0, error: msg, url };
    }

    let score = extractScore(json);
    score = clampForAllowlist(url, score);
    score = Math.max(0, Math.min(1, Number(score)));
    const phishingScore = Number(score.toFixed(4));
    const label = phishingScore >= 0.5 ? "phishing" : "safe";
    const model = json?.model || "phishing-service";

    if (LOG_PHISH) {
      const raw = Array.isArray(json?.result) ? json.result : (json?.score ?? json);
      console.log("[phishingModel] URL:", url);
      console.log("[phishingModel] Raw:", raw);
      console.log("[phishingModel] Final:", phishingScore, label);
    }

    return { ok: true, phishingScore, url, label, model };
  } catch (err) {
    console.error("[phishingModel] fetch failed:", err.message);
    // Fail-safe: never break caller flow
    return { ok: false, phishingScore: 0, error: err.message };
  }
}

/** Lightweight health probe (best-effort) */
async function health() {
  if (!PH_ENABLED) return { ok: true, reason: "disabled" };
  try {
    // Try a conventional /health; if your service uses something else, adjust here
    const healthUrl = PH_API_URL.replace(/\/phishing\b/, "/health");
    const { ok, json, status } = await fetchJsonWithTimeout(healthUrl, { method: "GET" }, 1000);
    if (ok && (json?.ok === true || json === "ok")) return { ok: true, reason: "ok" };
    return { ok: false, reason: `status ${status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { classifyPhishing, health };
