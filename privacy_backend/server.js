// privacy_backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const axios = require("axios");

const phishingRoutes = require("./phishing_detection/routes");
const { generalLimiter, authLimiter, otpLimiter } = require("./middleware/limits");
const { requireAuth } = require("./middleware/jwt");

const trackRoutes    = require("./routes/track");
const classifyRoutes = require("./routes/classify");
const riskRoutes     = require("./routes/risk");
const metricsRoutes  = require("./routes/metrics");
const authRoutes     = require("./routes/auth");
const { initBlocklist } = require("./services/blocklist");

/* ----------------------------- env/flags ----------------------------- */
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD  = NODE_ENV === "production";
const PORT     = process.env.PORT || 3000;

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL   = process.env.HF_MODEL || "ealvaradob/bert-finetuned-phishing";

const app = express();

/* --------------------------- hardening/base -------------------------- */
app.disable("x-powered-by");
app.set("etag", false); // avoid 304 confusion
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(morgan(IS_PROD ? "combined" : "dev"));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));

// Trust proxy config (so IP-based rate limits work as expected)
app.set("trust proxy", IS_PROD ? 1 : false);

/* -------------------------------- CORS ------------------------------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOriginFn = (origin, callback) => {
  if (!origin) return callback(null, true); // curl/server-to-server
  if (origin.startsWith("chrome-extension://")) return callback(null, true);
  if (!IS_PROD) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

app.use(
  cors({
    origin: corsOriginFn,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

/* ---------------------------- rate limits ---------------------------- */
app.use(generalLimiter);                 // global
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);  // << use /signup here
app.use("/api/auth/email-otp", otpLimiter);
app.use("/api/auth/totp", otpLimiter);

/* ---------------------- tracker blocklist init ----------------------- */
initBlocklist();

/* ---------------------------- health/root ---------------------------- */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    env: NODE_ENV,
    ts: new Date().toISOString(),
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
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

/* ----------------------------- phishing ------------------------------ */
app.use("/api/phishing", phishingRoutes);

/* ------------------------- protected routes -------------------------- */
// keep /api/track/visit public; protect submit:
app.use("/api/track/submit", requireAuth);
app.use("/api/risk", requireAuth);
app.use("/api/metrics", requireAuth);

/* ------------------------------- routes ------------------------------ */
app.use("/api/track", trackRoutes);
app.use("/api/classify", classifyRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/auth", authRoutes);

/* ----------------------- HF phishing proxy (opt) --------------------- */
app.post("/api/phishing-check", async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: "text is required" });

  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      { inputs: text },
      { headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" } }
    );
    res.json({ ok: true, input: text, result: response.data });
  } catch (err) {
    console.error("[HF API error]", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Phishing model request failed" });
  }
});

/* ------------------------------ fallbacks ---------------------------- */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error("[UNHANDLED ERROR]", IS_PROD ? err?.message || err : err);
  res.status(status).json({ ok: false, message: err.message || "Internal Server Error" });
});

/* --------------------------- process guards -------------------------- */
process.on("unhandledRejection", r => console.error("UNHANDLED REJECTION:", r));
process.on("uncaughtException", e => console.error("UNCAUGHT EXCEPTION:", e));

/* -------------------------------- start ------------------------------ */
app.listen(PORT, () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
});
