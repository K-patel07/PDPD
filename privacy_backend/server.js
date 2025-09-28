// privacy_backend/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const axios = require("axios");

/* ----------------------------- Routers ------------------------------ */
const trackRoutes    = require("./routes/track");
const classifyRoutes = require("./routes/classify");
const riskRoutes     = require("./routes/risk");
const metricsRoutes  = require("./routes/metrics");
const authRoutes     = require("./routes/auth");
const phishingRoutes = require("./phishing_detection/routes");

/* ---------------------------- Middleware ---------------------------- */
const { generalLimiter, authLimiter, otpLimiter } = require("./middleware/limits");
const { requireAuth } = require("./middleware/jwt");

/* ----------------------------- Services ----------------------------- */
const { initBlocklist } = require("./services/blocklist");

/* ----------------------------- Env/Flags ---------------------------- */
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD  = NODE_ENV === "production";
const PORT     = process.env.PORT || 3000;

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL   = process.env.HF_MODEL || "ealvaradob/bert-finetuned-phishing";

const app = express();

const db = require("./db");
app.get("/health/db", async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT 1 as ok");
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("[DB health] ERROR:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

(async () => {
  try {
    await db.ensureUsersTable(db.pool);
    await db.ensureTables(db.pool);
  } catch (e) {
    console.error("[db] init error", e);
  }
})();

/* --------------------------- Hardening/Base -------------------------- */
app.disable("x-powered-by");
app.set("etag", false); // avoid 304 confusion on API clients

// Trust proxy so rate limits and IPs work correctly behind proxies (e.g., Render/Heroku)
app.set("trust proxy", IS_PROD ? 1 : false);

// Ensure API responses aren't cached by clients
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Helmet with relaxed CORP so the extension/frontend can fetch assets when needed
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Gzip/deflate
app.use(compression());

// Logging
app.use(morgan(IS_PROD ? "combined" : "dev"));
app.use((req, _res, next) => {
  // Lightweight request trace (kept from the original)
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// Parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));

/* -------------------------------- CORS ------------------------------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOriginFn = (origin, callback) => {
  // Allow server-to-server / curl
  if (!origin) return callback(null, true);
  // Allow Chrome extension
  if (origin.startsWith("chrome-extension://")) return callback(null, true);
  // Allow all origins in dev
  if (!IS_PROD) return callback(null, true);
  // In prod: allow listed origins + localhost
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

app.use(
  cors({
    origin: corsOriginFn,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    optionsSuccessStatus: 204,
  })
);

// CORS middleware already handles OPTIONS requests

/* ---------------------------- Rate Limits ---------------------------- */
// Global limiter
app.use(generalLimiter);

// Auth-specific throttles
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/email-otp", otpLimiter);
app.use("/api/auth/totp", otpLimiter);

/* ---------------------- Tracker Blocklist Init ----------------------- */
// Non-blocking initialization with clear logging (combines both behaviors)
try {
  const maybe = initBlocklist && initBlocklist();
  if (maybe && typeof maybe.then === "function") {
    maybe.then(
      () => console.log("[blocklist] initialized"),
      (e) => console.warn("[blocklist] init failed:", e?.message || e)
    );
  } else {
    console.log("[blocklist] initialized");
  }
} catch (e) {
  console.warn("[blocklist] init failed (sync):", e?.message || e);
}

/* ---------------------------- Health/Root ---------------------------- */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    env: NODE_ENV,
    ts: new Date().toISOString(),
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
  });
});

// Debug endpoint to check CORS configuration
app.get("/debug/cors", (_req, res) => {
  res.json({
    allowedOrigins: allowedOrigins,
    isProd: IS_PROD,
    nodeEnv: NODE_ENV,
    hfApiKey: HF_API_KEY ? "SET" : "NOT_SET",
    hfModel: HF_MODEL,
    jwtSecret: process.env.JWT_SECRET ? "SET" : "NOT_SET",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "privacy_backend",
    env: NODE_ENV,
    time: new Date().toISOString(),
    endpoints: [
      "/health",
      "/api/track/visit",
      "/api/track/submit",
      "/api/classify",
      "/api/risk",
      "/api/metrics",
      "/api/auth",
      "/api/phishing",
      "/api/phishing-check",
    ],
  });
});

/* ----------------------------- Phishing ------------------------------ */
app.use("/api/phishing", phishingRoutes);

// Optional Hugging Face phishing inference proxy
app.post("/api/phishing-check", async (req, res) => {
  const { text } = req.body || {};
  if (!text) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }
  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      { inputs: text },
      { headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" } }
    );
    return res.json({ ok: true, input: text, result: response.data });
  } catch (err) {
    console.error("[HF API error]", err.response?.data || err.message);
    return res.status(500).json({ ok: false, error: "Phishing model request failed" });
  }
});

/* ------------------------- Route Protection -------------------------- */
// Keep /api/track/visit public; protect submit/risk/metrics behind JWT
app.use("/api/track/submit", requireAuth);
app.use("/api/risk", requireAuth);
app.use("/api/metrics", requireAuth);

/* -------------------------------- Routes ----------------------------- */
app.use("/api/track", trackRoutes);
app.use("/api/classify", classifyRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/auth", authRoutes);

/* ------------------------------ 404/Errors --------------------------- */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.originalUrl,
  });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  // In prod, keep logs terse; in dev, print full error
  console.error("[UNHANDLED ERROR]", IS_PROD ? err?.message || err : err);
  res.status(status).json({
    ok: false,
    message: err.message || "Internal Server Error",
  });
});

/* --------------------------- Process Guards -------------------------- */
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

/* -------------------------------- Start ------------------------------ */
app.listen(PORT, () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
});
