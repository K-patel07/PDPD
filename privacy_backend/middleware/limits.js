// privacy_backend/middleware/limits.js
const rateLimit = require('express-rate-limit');

// Global: sane default for everything
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,                  // 100 req per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth endpoints: much tighter to deter guessing
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 5,              // 5 attempts/min/IP
  message: { ok: false, message: 'Too many attempts, slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP/TOTP endpoints: a little looser than login but still strict
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 6,                   // 6 OTP actions/10 min/IP
  message: { ok: false, message: 'Too many OTP requests. Try later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, authLimiter, otpLimiter };