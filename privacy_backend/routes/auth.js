// routes/auth.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const { authenticator } = require("otplib");

const { validate, withValidators } = require("../middleware/validate");
const {
  registerValidator,
  loginValidator,
  otpSendValidator,
  otpVerifyValidator,
  totpSetupValidator,
  totpVerifyValidator,
} = require("../middleware/validators/authValidators");

/* ----------------------------- Config ------------------------------ */
const JWT_SECRET =
  process.env.JWT_SECRET || "dev-only-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const signToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const SALT_ROUNDS = 10;
const OTP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_TRIES = 5;

/* --------------------------- In-memory stores --------------------------- */
/** For email OTP (not TOTP). In production, store in DB or Redis. */
const otpStore = new Map(); // email -> { code, expiresAt, tries }

/** For TOTP secrets & status. Persist in DB for real-world use. */
const totpStore = new Map(); // email -> { secret, enabled: boolean }

const { rows } = await db.query(`
  SELECT id, email, username, password_hash
  FROM users
  WHERE LOWER(email) = LOWER($1)
  LIMIT 1
`, [req.body.email]);
/* --------------------------- Mail Transport --------------------------- */
/**
 * Uses SMTP if available, otherwise falls back to a safe JSON transport
 * that logs emails to the console (no external call).
 */
function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  // Dev fallback: don't error if SMTP isn't configured
  return nodemailer.createTransport({ jsonTransport: true });
}

const mailer = buildTransport();

/* ----------------------------- Helpers ----------------------------- */
async function findUserByEmail(email) {
  const q = `SELECT id, email, username, password_hash, ext_user_id
             FROM users WHERE email = $1 LIMIT 1`;
  const { rows } = await db.query(q, [email]);
  return rows[0] || null;
}

async function findUserByUsername(username) {
  const q = `SELECT id FROM users WHERE username = $1 LIMIT 1`;
  const { rows } = await db.query(q, [username]);
  return rows[0] || null;
}

async function createUser({ email, username, passwordHash, extUserId }) {
  const q = `
    INSERT INTO users (email, username, password_hash, ext_user_id, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id, email, username, ext_user_id
  `;
  const { rows } = await db.query(q, [
    email,
    username,
    passwordHash,
    extUserId,
  ]);
  return rows[0];
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/* ------------------------------ Routes ------------------------------ */

/**
 * POST /auth/register
 * Body: { email, username, password }
 */
async function handleRegister(req, res) {
  try {
    const { email, username, password } = req.body;

    const [existingEmail, existingUsername] = await Promise.all([
      findUserByEmail(email),
      findUserByUsername(username),
    ]);
    if (existingEmail)
      return res.status(409).json({ ok: false, error: "Email already in use" });
    if (existingUsername)
      return res.status(409).json({ ok: false, error: "Username already taken" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const extUserId = randomUUID();

    const user = await createUser({
      email,
      username,
      passwordHash,
      extUserId,
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      username: user.username,
      ext_user_id: user.ext_user_id,
    });

    return res.status(201).json({
      ok: true,
      token,
      user,
    });
  } catch (err) {
    console.error("[register] ERROR:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

router.post("/register", registerValidator, validate, handleRegister);
// Backwards-compatible alias
router.post("/signup", registerValidator, validate, handleRegister);

/**
 * POST /auth/login
 * Body: { email, password }
 */
router.post(
  "/login",
  loginValidator,
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await findUserByEmail(email);
      if (!user)
        return res.status(401).json({ ok: false, error: "Invalid credentials" });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok)
        return res.status(401).json({ ok: false, error: "Invalid credentials" });

      const token = signToken({
        sub: user.id,
        email: user.email,
        username: user.username,
        ext_user_id: user.ext_user_id,
      });

      return res.json({
        ok: true,
        token,
        user: sanitizeUser(user),
      });
    } catch (err) {
      console.error("[login] ERROR:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  }
);

/**
 * POST /auth/otp/send
 * Body: { email }
 * Sends a one-time 6-digit code via email. Expires in 10 minutes.
 */
async function handleOtpSend(req, res) {
  try {
    const { email } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + OTP_WINDOW_MS;

    otpStore.set(email, { code, expiresAt, tries: 0 });

    const info = await mailer.sendMail({
      to: email,
      from: process.env.MAIL_FROM || "no-reply@yourapp.local",
      subject: "Your verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });

    return res.json({ ok: true, sent: !!info, hint: process.env.SMTP_HOST ? undefined : "dev-json-transport" });
  } catch (err) {
    console.error("[otp/send] ERROR:", err);
    return res.status(500).json({ ok: false, error: "Failed to send code" });
  }
}

router.post("/otp/send", otpSendValidator, validate, handleOtpSend);
// Backwards-compatible alias
router.post("/email-otp/request", otpSendValidator, validate, handleOtpSend);

/**
 * POST /auth/otp/verify
 * Body: { email, code }
 */
async function handleOtpVerify(req, res) {
  try {
    const { email, code } = req.body;
    const rec = otpStore.get(email);
    if (!rec) return res.status(400).json({ ok: false, error: "No active code" });

    if (Date.now() > rec.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ ok: false, error: "Code expired" });
    }

    if (rec.tries >= OTP_MAX_TRIES) {
      otpStore.delete(email);
      return res.status(429).json({ ok: false, error: "Too many attempts" });
    }

    rec.tries += 1;

    if (rec.code !== code) {
      return res.status(400).json({ ok: false, error: "Invalid code" });
    }

    otpStore.delete(email);
    return res.json({ ok: true, verified: true });
  } catch (err) {
    console.error("[otp/verify] ERROR:", err);
    return res.status(500).json({ ok: false, error: "Verification failed" });
  }
}

router.post("/otp/verify", otpVerifyValidator, validate, handleOtpVerify);
// Backwards-compatible alias
router.post("/email-otp/verify", otpVerifyValidator, validate, handleOtpVerify);

/**
 * POST /auth/totp/setup
 * Body: { email, label?, issuer? }
 * Returns { secret, otpauth } for use in authenticator apps (e.g., Google Authenticator).
 */
router.post(
  "/totp/setup",
  totpSetupValidator,
  validate,
  async (req, res) => {
    try {
      const { email, label = "PrivacyPulse", issuer = "PrivacyPulse" } = req.body;
      const user = await findUserByEmail(email);
      if (!user) return res.status(404).json({ ok: false, error: "User not found" });

      const secret = authenticator.generateSecret();
      const accountLabel = encodeURIComponent(`${label}:${email}`);
      const encodedIssuer = encodeURIComponent(issuer);
      const otpauth = `otpauth://totp/${accountLabel}?secret=${secret}&issuer=${encodedIssuer}`;

      totpStore.set(email, { secret, enabled: false });

      return res.json({ ok: true, secret, otpauth });
    } catch (err) {
      console.error("[totp/setup] ERROR:", err);
      return res.status(500).json({ ok: false, error: "Failed to setup TOTP" });
    }
  }
);

/**
 * POST /auth/totp/verify
 * Body: { email, token }
 * Verifies a TOTP token. If correct, enables TOTP for the user (in-memory here).
 */
router.post(
  "/totp/verify",
  totpVerifyValidator,
  validate,
  async (req, res) => {
    try {
      const { email, token } = req.body;
      const entry = totpStore.get(email);
      if (!entry || !entry.secret)
        return res.status(400).json({ ok: false, error: "TOTP not initialized" });

      const isValid = authenticator.verify({ token, secret: entry.secret });
      if (!isValid) return res.status(400).json({ ok: false, error: "Invalid token" });

      totpStore.set(email, { ...entry, enabled: true });
      return res.json({ ok: true, enabled: true });
    } catch (err) {
      console.error("[totp/verify] ERROR:", err);
      return res.status(500).json({ ok: false, error: "Verification failed" });
    }
  }
);

module.exports = router;
