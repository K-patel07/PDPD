// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const { authenticator } = require("otplib");

// ✅ validators you already have
const { validate } = require("../middleware/validate");
const {
  registerValidator,
  loginValidator,
} = require("../middleware/validators/authValidators");

// ====== CONFIG / HELPERS ======================================================
const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-key-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// In-memory stores (demo-friendly). Replace with DB tables if needed.
const otpStore = new Map();   // key: email -> { code, expiresAt, tries }
const totpStore = new Map();  // key: email -> { secret, enabled }

// Nodemailer transport: use real SMTP if provided, else dev console transport.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: !!process.env.SMTP_SECURE, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : nodemailer.createTransport({
      streamTransport: true,
      newline: "unix",
      buffer: true,
    });

function sixDigits() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function ensureExtUserId(user) {
  if (user.ext_user_id) return user.ext_user_id;
  const ext = "ext-" + randomUUID();
  const upd = await db.pool.query("UPDATE users SET ext_user_id=$1 WHERE id=$2 RETURNING ext_user_id", [ext, user.id]);
  return upd.rows[0].ext_user_id;
}

// ====== SIGNUP ===============================================================
router.post("/signup", registerValidator, validate, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Uniqueness
    const emailDup = await db.pool.query("SELECT 1 FROM users WHERE email=$1", [email]);
    if (emailDup.rows.length) return res.status(409).json({ ok: false, error: "User with this email already exists" });

    const userDup = await db.pool.query("SELECT 1 FROM users WHERE username=$1", [username]);
    if (userDup.rows.length) return res.status(409).json({ ok: false, error: "Username already taken" });

    // Create
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await db.pool.query(
      "INSERT INTO users (username,email,password_hash,created_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
      [username, email, password_hash]
    );
    const newUser = rows[0];

    const ext_user_id = await ensureExtUserId(newUser);

    const token = signToken({
      userId: newUser.id,
      ext_user_id,
      username: newUser.username,
      email: newUser.email,
    });

    res.status(201).json({
      ok: true,
      message: "User created successfully",
      token,
      ext_user_id,
      user: { id: newUser.id, username: newUser.username, email: newUser.email },
    });
  } catch (err) {
    console.error("Signup error:", err);
    next(err);
  }
});

// ====== LOGIN (password -> JWT) ==============================================
router.post("/login", loginValidator, validate, async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows } = await db.pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    if (user.password_hash) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ext_user_id = await ensureExtUserId(user);

    // (optional) record login event if table exists
    try {
      await db.pool.query("INSERT INTO login_events (ext_user_id) VALUES ($1)", [ext_user_id]);
    } catch (_) {}

    const token = signToken({
      userId: user.id,
      ext_user_id,
      username: user.username,
      email: user.email,
    });

    res.json({
      ok: true,
      token,
      ext_user_id,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ ok: false, error: "Login error" });
  }
});

// ====== EMAIL OTP (2FA) ======================================================
// 1) Request OTP
router.post("/email-otp/request", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });

    const code = sixDigits();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpStore.set(email, { code, expiresAt, tries: 0 });

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || "no-reply@privacypulse.app",
      to: email,
      subject: "Your PrivacyPulse verification code",
      text: `Your one-time code is ${code}. It expires in 5 minutes.`,
    });

    // If using dev transport, log the raw message so you can see it in terminal
    if (info.message) {
      console.log("[email-otp] message preview:\n" + info.message.toString());
    }

    res.json({ ok: true, message: "OTP sent to email" });
  } catch (e) {
    console.error("email-otp/request error:", e);
    res.status(500).json({ ok: false, error: "failed to send OTP" });
  }
});

// 2) Verify OTP
router.post("/email-otp/verify", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    if (!email || !code) return res.status(400).json({ ok: false, error: "email and code required" });

    const rec = otpStore.get(email);
    if (!rec) return res.status(400).json({ ok: false, error: "no OTP requested" });
    if (Date.now() > rec.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ ok: false, error: "code expired" });
    }

    rec.tries++;
    if (rec.tries > 5) {
      otpStore.delete(email);
      return res.status(429).json({ ok: false, error: "too many attempts" });
    }

    if (rec.code !== code) return res.status(401).json({ ok: false, error: "invalid code" });

    // Success → issue/upgrade JWT (login via email)
    const { rows } = await db.pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    const ext_user_id = await ensureExtUserId(user);

    const token = signToken({
      userId: user.id,
      ext_user_id,
      username: user.username,
      email: user.email,
      mfa: { emailOtp: true },
    });

    otpStore.delete(email);
    res.json({ ok: true, token, ext_user_id, user: { id: user.id, username: user.username, email: user.email } });
  } catch (e) {
    console.error("email-otp/verify error:", e);
    res.status(500).json({ ok: false, error: "verification failed" });
  }
});

// ====== TOTP (Google Authenticator) ==========================================
// 1) Setup: generate secret + otpauth URL (QR content). Frontend renders the QR.
router.post("/totp/setup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });

    const secret = authenticator.generateSecret();
    const issuer = process.env.TOTP_ISSUER || "PrivacyPulse";
    const otpauth = authenticator.keyuri(email, issuer, secret);

    totpStore.set(email, { secret, enabled: false });

    res.json({ ok: true, otpauth, secret });
  } catch (e) {
    console.error("totp/setup error:", e);
    res.status(500).json({ ok: false, error: "totp setup failed" });
  }
});

// 2) Verify: user enters 6-digit code from their Authenticator app.
router.post("/totp/verify", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const token = String(req.body.token || "").trim();
    const secret = String(req.body.secret || "").trim(); // from setup response

    if (!email || !token || !secret) {
      return res.status(400).json({ ok: false, error: "email, token, secret required" });
    }

    const ok = authenticator.verify({ token, secret });
    if (!ok) return res.status(401).json({ ok: false, error: "invalid code" });

    // mark enabled in memory
    totpStore.set(email, { secret, enabled: true });

    // issue/upgrade JWT with mfa claim
    const { rows } = await db.pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    const ext_user_id = await ensureExtUserId(user);

    const newJwt = signToken({
      userId: user.id,
      ext_user_id,
      username: user.username,
      email: user.email,
      mfa: { totp: true },
    });

    res.json({ ok: true, token: newJwt, message: "TOTP verified" });
  } catch (e) {
    console.error("totp/verify error:", e);
    res.status(500).json({ ok: false, error: "totp verification failed" });
  }
});

// (Optional) Login with TOTP after password step, if you want a separate endpoint
router.post("/login/totp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const token = String(req.body.token || "").trim();
    if (!email || !token) return res.status(400).json({ ok: false, error: "email and token required" });

    const t = totpStore.get(email);
    if (!t?.secret || !t.enabled) return res.status(400).json({ ok: false, error: "totp not set up" });

    const ok = authenticator.verify({ token, secret: t.secret });
    if (!ok) return res.status(401).json({ ok: false, error: "invalid code" });

    const { rows } = await db.pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    const ext_user_id = await ensureExtUserId(user);
    const newJwt = signToken({
      userId: user.id,
      ext_user_id,
      username: user.username,
      email: user.email,
      mfa: { totp: true },
    });

    res.json({ ok: true, token: newJwt });
  } catch (e) {
    console.error("login/totp error:", e);
    res.status(500).json({ ok: false, error: "totp login failed" });
  }
});

module.exports = router;
